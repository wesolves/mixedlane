import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SERVER_ROOT, config } from "./config";

/**
 * Development-only secret material, generated once into apps/server/data (git-ignored).
 * Production must provide real secrets via env (enforced in config()).
 */
const cache = new Map<string, string>();

export function devSecret(name: string, bytes = 32): string {
  // Read once per process: secrets are used on every request, and repeated disk reads were
  // enough to trip the dev file watcher on FAT32 drives.
  const hit = cache.get(name);
  if (hit) return hit;
  if (config().NODE_ENV === "production") throw new Error(`Secret "${name}" must be configured in production`);
  const dir = join(SERVER_ROOT, "data");
  const file = join(dir, `${name}.key`);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, randomBytes(bytes).toString("hex"), { mode: 0o600 });
  const value = readFileSync(file, "utf8").trim();
  cache.set(name, value);
  return value;
}
