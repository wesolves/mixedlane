import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "./config";

export interface ByteRange {
  start: number;
  end: number;
}

/** Keys are generated server-side (<uuid>.<ext>); anything else is refused outright. */
const assertKey = (key: string) => {
  if (!/^[0-9a-f-]{36}\.[a-z0-9]+$/.test(key)) throw new Error("Invalid storage key");
};

/** Where uploaded files live: local disk (dev, single server) or any S3-compatible bucket. */
export abstract class StorageDriver {
  abstract put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Size in bytes, or null if missing. */
  abstract size(key: string): Promise<number | null>;
  /** Streams the file, or an inclusive byte range of it. */
  abstract stream(key: string, range?: ByteRange): Promise<Readable>;
}

@Injectable()
export class LocalStorage extends StorageDriver {
  private readonly dir = config().UPLOAD_DIR;

  constructor() {
    super();
    mkdirSync(this.dir, { recursive: true });
  }

  private path(key: string) {
    assertKey(key);
    return join(this.dir, key);
  }

  async put(key: string, data: Buffer) {
    await writeFile(this.path(key), data);
  }

  async size(key: string) {
    const p = this.path(key);
    return existsSync(p) ? statSync(p).size : null;
  }

  async stream(key: string, range?: ByteRange) {
    return createReadStream(this.path(key), range);
  }
}

/** S3, MinIO, Cloudflare R2, DigitalOcean Spaces… Files are private; the API streams them. */
@Injectable()
export class S3Storage extends StorageDriver {
  private readonly cfg = config();
  private readonly client = new S3Client({
    region: this.cfg.S3_REGION,
    endpoint: this.cfg.S3_ENDPOINT,
    forcePathStyle: this.cfg.S3_FORCE_PATH_STYLE,
    // Without explicit keys the SDK uses its default chain (env, instance role, …).
    credentials:
      this.cfg.S3_ACCESS_KEY_ID && this.cfg.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: this.cfg.S3_ACCESS_KEY_ID, secretAccessKey: this.cfg.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
  private readonly bucket = this.cfg.S3_BUCKET!;

  private objectKey(key: string) {
    assertKey(key);
    return `${this.cfg.S3_PREFIX}${key}`;
  }

  async put(key: string, data: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), Body: data, ContentType: contentType }));
  }

  async size(key: string) {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
      return head.ContentLength ?? null;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (err as Error).name === "NotFound") return null;
      throw err;
    }
  }

  async stream(key: string, range?: ByteRange) {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), Range: range ? `bytes=${range.start}-${range.end}` : undefined }),
    );
    return res.Body as Readable;
  }
}

@Global()
@Module({
  providers: [
    {
      provide: StorageDriver,
      useFactory: () => {
        const driver = config().STORAGE_DRIVER;
        new Logger("Storage").log(driver === "s3" ? `S3 bucket "${config().S3_BUCKET}"` : `Local disk (${config().UPLOAD_DIR})`);
        return driver === "s3" ? new S3Storage() : new LocalStorage();
      },
    },
  ],
  exports: [StorageDriver],
})
export class StorageModule {}
