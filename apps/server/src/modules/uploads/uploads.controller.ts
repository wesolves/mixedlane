import { Controller, Get, Inject, Module, Param, Post, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Ctx, Public, type RequestContext } from "../../core/context";
import { DB, type Db } from "../../core/database/database";
import { orgMembers, uploads } from "../../core/database/schema";
import { AppError } from "../../core/http";
import { StorageDriver } from "../../core/storage";
import { FILE_COOKIE } from "../auth/auth.controller";
import { verifyFileToken } from "../auth/crypto";

const MB = 1024 * 1024;

/**
 * Allowlist by MIME type → stored extension. SVG is deliberately excluded (it can carry scripts).
 * Files are saved under random names; the client's filename is never used as a path.
 */
const TYPES: Record<string, { ext: string; kind: "image" | "video"; max: number }> = {
  "image/png": { ext: "png", kind: "image", max: 20 * MB },
  "image/jpeg": { ext: "jpg", kind: "image", max: 20 * MB },
  "image/gif": { ext: "gif", kind: "image", max: 20 * MB },
  "image/webp": { ext: "webp", kind: "image", max: 20 * MB },
  "image/avif": { ext: "avif", kind: "image", max: 20 * MB },
  "video/mp4": { ext: "mp4", kind: "video", max: 200 * MB },
  "video/webm": { ext: "webm", kind: "video", max: 200 * MB },
  "video/ogg": { ext: "ogv", kind: "video", max: 200 * MB },
  "video/quicktime": { ext: "mov", kind: "video", max: 200 * MB },
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([mime, t]) => [t.ext, mime]));

@ApiTags("Uploads")
@ApiBearerAuth()
@Controller("uploads")
export class UploadsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageDriver,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 200 * MB } }))
  async upload(@Ctx() ctx: RequestContext, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new AppError(400, "Send the file as multipart field 'file'");
    const type = TYPES[file.mimetype];
    if (!type) {
      throw new AppError(415, `Unsupported file type "${file.mimetype || "unknown"}". Use PNG, JPG, GIF, WebP, AVIF, MP4, WebM, OGG or MOV.`);
    }
    if (file.size > type.max) throw new AppError(413, `${type.kind === "image" ? "Images" : "Videos"} can be at most ${type.max / MB} MB`);

    const key = `${randomUUID()}.${type.ext}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    await this.db.insert(uploads).values({
      orgId: ctx.orgId,
      storageKey: key,
      mime: file.mimetype,
      size: file.size,
      name: file.originalname,
      uploadedBy: ctx.actor.id,
    });
    return { url: `/api/uploads/${key}`, kind: type.kind, name: file.originalname, size: file.size, mime: file.mimetype };
  }

  /**
   * <img>/<video> can't send an Authorization header, so files are authorized with the httpOnly
   * fb_file cookie (set at sign-in, scoped to this path). Only members of the file's org get it.
   */
  @Public()
  @Get(":name")
  async serve(@Param("name") name: string, @Req() req: Request, @Res() res: Response) {
    const ext = name.match(/^[0-9a-f-]{36}\.([a-z0-9]+)$/)?.[1];
    const mime = ext ? MIME_BY_EXT[ext] : undefined;
    const userId = await verifyFileToken(req.cookies?.[FILE_COOKIE]);
    const [row] =
      mime && userId
        ? await this.db
            .select({ id: uploads.id })
            .from(uploads)
            .innerJoin(orgMembers, and(eq(orgMembers.orgId, uploads.orgId), eq(orgMembers.userId, userId)))
            .where(eq(uploads.storageKey, name))
        : [];
    const size = row ? await this.storage.size(name) : null;
    if (!mime || size === null) return res.status(404).json({ error: "Not found" });

    res.set({
      "content-type": mime,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    });
    // Range requests let browsers seek in videos without downloading the whole file.
    const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(end, size - 1);
      if (start > end) return res.status(416).set("content-range", `bytes */${size}`).end();
      res.status(206).set({ "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) });
      return (await this.storage.stream(name, { start, end })).pipe(res);
    }
    res.set("content-length", String(size));
    return (await this.storage.stream(name)).pipe(res);
  }
}

@Module({ controllers: [UploadsController] })
export class UploadsModule {}
