import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { config } from "../config";
import { DB, type Db } from "../database/database";
import { jobs } from "../database/schema";

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export interface EnqueueOptions {
  /** Delay before the first attempt (ms). */
  delayMs?: number;
  maxAttempts?: number;
  /** At most one queued/running job per key; extra enqueues are ignored. */
  uniqueKey?: string;
}

interface Recurring {
  name: string;
  everyMs: number;
  payload: Record<string, unknown>;
}

/**
 * Durable job queue stored in Postgres (PGlite in dev). Workers claim jobs with
 * SELECT … FOR UPDATE SKIP LOCKED, so several server instances can share the table.
 * The API (enqueue/register/every) is what a BullMQ adapter would implement later.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Jobs");
  private readonly handlers = new Map<string, JobHandler>();
  private readonly recurring: Recurring[] = [];
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(@Inject(DB) private readonly db: Db) {}

  register(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
  }

  /** Runs `name` every `everyMs` (deduped so slow runs never pile up). */
  every(name: string, everyMs: number, payload: Record<string, unknown> = {}) {
    this.recurring.push({ name, everyMs, payload });
  }

  async enqueue(name: string, payload: Record<string, unknown> = {}, opts: EnqueueOptions = {}) {
    const runAt = new Date(Date.now() + (opts.delayMs ?? 0));
    await this.db
      .insert(jobs)
      .values({ name, payload, runAt, maxAttempts: opts.maxAttempts ?? 5, uniqueKey: opts.uniqueKey ?? null })
      .onConflictDoNothing();
    // Start due work right away instead of waiting for the next poll.
    if (!opts.delayMs && this.timer) setImmediate(() => void this.drain());
  }

  onApplicationBootstrap() {
    if (!config().WORKER_ENABLED) return;
    for (const r of this.recurring) void this.enqueue(r.name, r.payload, { uniqueKey: `recurring:${r.name}` });
    this.timer = setInterval(() => void this.drain(), 1000);
    this.timer.unref?.();
  }

  async onApplicationShutdown() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    // Let an in-flight job finish so the connection isn't closed underneath it.
    for (let i = 0; i < 50 && this.running; i++) await new Promise((r) => setTimeout(r, 100));
  }

  /** Processes due jobs until none are left. Exposed for tests. */
  async drain(): Promise<number> {
    if (this.running || this.stopped) return 0;
    this.running = true;
    let processed = 0;
    try {
      await this.recoverStale();
      for (;;) {
        const job = await this.claim();
        if (!job) break;
        await this.run(job);
        processed++;
        if (this.stopped) break;
      }
    } catch (err) {
      this.logger.error(`Worker loop failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
    return processed;
  }

  private async claim() {
    const result = await this.db.execute<{ id: string; name: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }>(sql`
      UPDATE jobs SET status = 'running', locked_at = now(), locked_by = ${this.workerId}, attempts = attempts + 1
      WHERE id = (
        SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now()
        ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1
      )
      RETURNING id, name, payload, attempts, max_attempts`);
    return result.rows[0] ?? null;
  }

  private async run(job: { id: string; name: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }) {
    const handler = this.handlers.get(job.name);
    const recurring = this.recurring.find((r) => r.name === job.name);
    try {
      if (!handler) throw new Error(`No handler registered for job "${job.name}"`);
      await handler(job.payload ?? {});
      await this.db.execute(sql`UPDATE jobs SET status = 'done', finished_at = now(), locked_at = NULL, last_error = NULL WHERE id = ${job.id}`);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      const dead = job.attempts >= job.max_attempts || !!recurring;
      // Exponential backoff: 5s, 10s, 20s, 40s… capped at 10 minutes.
      const backoffMs = Math.min(5000 * 2 ** (job.attempts - 1), 600_000);
      await this.db.execute(sql`
        UPDATE jobs SET status = ${dead ? "dead" : "queued"}, last_error = ${message}, locked_at = NULL,
          run_at = now() + ${backoffMs / 1000} * interval '1 second',
          finished_at = ${dead ? sql`now()` : sql`NULL`}
        WHERE id = ${job.id}`);
      this.logger.warn(`${job.name} failed (attempt ${job.attempts}/${job.max_attempts}): ${message}`);
    }
    // Recurring jobs reschedule themselves whether or not this run succeeded.
    if (recurring && !this.stopped) {
      await this.enqueue(recurring.name, recurring.payload, { delayMs: recurring.everyMs, uniqueKey: `recurring:${recurring.name}` });
    }
  }

  /** Jobs locked by a crashed worker go back to the queue after 5 minutes. */
  private async recoverStale() {
    await this.db.execute(sql`
      UPDATE jobs SET status = 'queued', locked_at = NULL
      WHERE status = 'running' AND locked_at < now() - interval '5 minutes'`);
  }
}
