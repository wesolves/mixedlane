import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = resolve(here, "../..");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3001),
  /** Public base URL of this server (webhooks). */
  PUBLIC_URL: z.string().url().optional(),
  /** Where the web app lives — used for links in emails. */
  APP_URL: z.string().url().default("http://localhost:5173"),
  /** HS256 signing secret for access tokens (>= 32 chars). Generated in dev when unset. */
  JWT_SECRET: z.string().min(32).optional(),
  /** Short-lived access tokens; the web app refreshes them in the background a minute before expiry. */
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(5 * 60),
  /** Default "Stay signed in for" (days) — each user can change theirs in Account settings. */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  /** e.g. smtps://user:pass@smtp.example.com:465 — when unset, emails are printed to the console. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("Flowboard <no-reply@flowboard.local>"),
  /** Requests per minute per IP on sensitive auth endpoints. */
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(20),
  /** Postgres connection string. When unset, an embedded PGlite database is used. */
  DATABASE_URL: z.string().optional(),
  /**
   * PGlite data directory. Defaults to the user's home folder because PGlite needs a filesystem
   * with POSIX semantics (FAT32/exFAT drives fail). Use "memory://" for throwaway databases.
   */
  PGLITE_DIR: z.string().default(join(homedir(), ".flowboard", "pgdata")),
  UPLOAD_DIR: z.string().default(join(SERVER_ROOT, "data", "uploads")),
  /** 64 hex chars; encrypts stored secrets (e.g. GitHub tokens). Generated on first run in dev. */
  SECRET_KEY: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  /** Interface to listen on ("0.0.0.0" = every network interface, e.g. for LAN access). */
  HOST: z.string().default("0.0.0.0"),
  /** Extra browser origins allowed to call the API (comma-separated), besides APP_URL. */
  CORS_ORIGINS: z.string().default(""),
  /** Requests per minute per client (API key, else IP) across the whole API. */
  API_RATE_LIMIT: z.coerce.number().int().min(1).default(600),
  /** Express "trust proxy" setting: "loopback" (default), a hop count like "1", or "true" behind a load balancer. */
  TRUST_PROXY: z.string().default("loopback"),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
  /** Built web app to serve from this server (single-container deployments). Unset = API only. */
  WEB_DIST: z.string().optional(),
  /** Where uploads are stored. */
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  /** For S3-compatible services (MinIO, R2, Spaces…). */
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Key prefix inside the bucket. */
  S3_PREFIX: z.string().default("uploads/"),
  WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  // Empty values (e.g. `PUBLIC_URL=` in an .env file) count as unset.
  const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production") {
    for (const key of ["DATABASE_URL", "JWT_SECRET", "SECRET_KEY"] as const) {
      if (!parsed.data[key]) throw new Error(`${key} is required in production`);
    }
  }
  if (parsed.data.STORAGE_DRIVER === "s3" && !parsed.data.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
  cached = parsed.data;
  return cached;
}

/**
 * Browser origins allowed for CORS and the realtime socket: APP_URL and CORS_ORIGINS. In
 * development any origin is accepted (e.g. the app opened via a LAN IP) — auth never relies on
 * ambient credentials for writes (bearer tokens; the refresh cookie also needs X-Requested-With).
 */
export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const cfg = config();
  if (cfg.NODE_ENV === "development") return true;
  const allowed = [cfg.APP_URL, ...cfg.CORS_ORIGINS.split(",")].map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
  return allowed.includes(origin.replace(/\/$/, ""));
}

/** Cookies get the Secure flag whenever the app is served over HTTPS. */
export const secureCookies = () => config().APP_URL.startsWith("https://");

/** For tests: override env and reset the cache. */
export function resetConfig(overrides: Record<string, string> = {}) {
  Object.assign(process.env, overrides);
  cached = null;
}
