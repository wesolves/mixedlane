import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { JobsService } from "../src/core/jobs/jobs.service";
import { DB, type Db } from "../src/core/database/database";
import { bootApp } from "./harness";

let ctx: Awaited<ReturnType<typeof bootApp>>;
let jobs: JobsService;
let db: Db;
beforeAll(async () => {
  ctx = await bootApp();
  jobs = ctx.app.get(JobsService);
  db = ctx.app.get(DB);
});
afterAll(async () => {
  await ctx.app.close();
});

const rows = async (name: string) =>
  (
    await db.execute<{ status: string; attempts: number; last_error: string | null }>(
      sql`SELECT status, attempts, last_error FROM jobs WHERE name = ${name} ORDER BY created_at`,
    )
  ).rows;

describe("DB job queue", () => {
  it("runs jobs and marks them done", async () => {
    const seen: unknown[] = [];
    jobs.register("t.ok", async (p) => void seen.push(p.n));
    await jobs.enqueue("t.ok", { n: 1 });
    await jobs.enqueue("t.ok", { n: 2 });
    expect(await jobs.drain()).toBe(2);
    expect(seen.sort()).toEqual([1, 2]);
    expect((await rows("t.ok")).every((r) => r.status === "done")).toBe(true);
  });

  it("retries with backoff, then goes dead", async () => {
    let calls = 0;
    jobs.register("t.fail", async () => {
      calls++;
      throw new Error("boom");
    });
    await jobs.enqueue("t.fail", {}, { maxAttempts: 2 });
    await jobs.drain();
    let [job] = await rows("t.fail");
    expect(job).toMatchObject({ status: "queued", attempts: 1, last_error: "boom" });
    // Backing off — not due yet, so nothing runs.
    expect(await jobs.drain()).toBe(0);
    await db.execute(sql`UPDATE jobs SET run_at = now() WHERE name = 't.fail'`);
    await jobs.drain();
    [job] = await rows("t.fail");
    expect(job).toMatchObject({ status: "dead", attempts: 2 });
    expect(calls).toBe(2);
  });

  it("dedupes by unique key while queued", async () => {
    jobs.register("t.dedupe", async () => {});
    await jobs.enqueue("t.dedupe", {}, { uniqueKey: "k1" });
    await jobs.enqueue("t.dedupe", {}, { uniqueKey: "k1" });
    expect((await rows("t.dedupe")).length).toBe(1);
    await jobs.drain();
    await jobs.enqueue("t.dedupe", {}, { uniqueKey: "k1" }); // allowed again once done
    expect((await rows("t.dedupe")).length).toBe(2);
  });
});
