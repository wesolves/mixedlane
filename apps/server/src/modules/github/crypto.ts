import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../../core/config";
import { devSecret } from "../../core/secrets";

/** GitHub tokens are encrypted at rest with AES-256-GCM (key: SECRET_KEY, or a generated dev key). */
function loadKey(): Buffer {
  return Buffer.from(config().SECRET_KEY ?? devSecret("secret"), "hex");
}

let key: Buffer | null = null;
const getKey = () => (key ??= loadKey());

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export const randomSecret = () => randomBytes(24).toString("hex");

/** Verifies GitHub's X-Hub-Signature-256 header against the raw request body. */
export function verifySignature(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
