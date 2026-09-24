import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { SERVER_ROOT, config } from "../config";
import * as schema from "./schema";

/** Both drivers expose the same Drizzle Postgres API; type against node-postgres. */
export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the db or an open transaction. */
export type Executor = Db | Tx;

export const DB = Symbol("DB");

const MIGRATIONS = join(SERVER_ROOT, "drizzle");

export interface DatabaseHandle {
  db: Db;
  driver: "pglite" | "postgres";
  close: () => Promise<void>;
}

/** Opens the database and applies pending migrations. */
export async function openDatabase(opts: { url?: string; pgliteDir?: string } = {}): Promise<DatabaseHandle> {
  const url = opts.url ?? config().DATABASE_URL;
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: config().DB_POOL_MAX });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder: MIGRATIONS });
    return { db, driver: "postgres", close: () => pool.end() };
  }

  const dir = opts.pgliteDir ?? config().PGLITE_DIR;
  const release = dir.startsWith("memory://") ? () => {} : lockDir(dir);
  const client = new PGlite(dir);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  await migratePglite(db as never, { migrationsFolder: MIGRATIONS });
  return {
    db,
    driver: "pglite",
    close: async () => {
      await client.close();
      release();
    },
  };
}

/**
 * PGlite is single-process: two processes opening the same directory corrupt it.
 * A PID lock file turns that into a clear error (e.g. running a script while the dev server is up).
 */
function lockDir(dir: string): () => void {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, "flowboard.lock");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    let alive = false;
    try {
      alive = pid > 0 && pid !== process.pid && process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (alive) throw new Error(`The database at ${dir} is in use by process ${pid}. Stop the dev server first (or use the /api/dev endpoints).`);
  }
  writeFileSync(lock, String(process.pid));
  const release = () => rmSync(lock, { force: true });
  process.once("exit", release);
  return release;
}
