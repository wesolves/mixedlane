import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SERVER_ROOT, config } from "./config";

/**
 * Secret material used when JWT_SECRET / SECRET_KEY aren't configured: generated once and kept
 * in SECRETS_DIR (a persistent volume in Docker) or, in development, apps/server/data (git-ignored).
 * Production without SECRETS_DIR must provide real secrets via env (enforced in config()).
 */
const cache = new Map<string, string>();

export function devSecret(name: string, bytes = 32): string {
  // Read once per process: secrets are used on every request, and repeated disk reads were
  // enough to trip the dev file watcher on FAT32 drives.
  const hit = cache.get(name);
  if (hit) return hit;
  const { NODE_ENV, SECRETS_DIR } = config();
  if (NODE_ENV === "production" && !SECRETS_DIR) throw new Error(`Secret "${name}" must be configured in production`);
  const dir = SECRETS_DIR ?? join(SERVER_ROOT, "data");
  const file = join(dir, `${name}.key`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(bytes).toString("hex"), { mode: 0o600 });
    if (SECRETS_DIR) console.warn(`[mixedlane] Generated secret "${name}" in ${file} — keep this volume (or set it via env) or sessions and stored tokens stop working.`);
  }
  const value = readFileSync(file, "utf8").trim();
  cache.set(name, value);
  return value;
}
