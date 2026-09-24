import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DB, type Db, type Executor } from "../../core/database/database";
import { activity } from "../../core/database/schema";
import type { Actor } from "../../core/context";

type Action = "created" | "updated" | "commented" | "moved" | "deleted";

function stringify(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

@Injectable()
export class ActivityService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async log(
    tx: Executor,
    orgId: string,
    workItemId: string,
    actor: Actor,
    action: Action,
    change?: { field: string; from?: unknown; to?: unknown },
  ) {
    await tx.insert(activity).values({
      orgId,
      workItemId,
      actorType: actor.type,
      actorId: actor.id,
      actor: actor.name,
      action,
      field: change?.field ?? null,
      fromValue: stringify(change?.from),
      toValue: stringify(change?.to),
    });
  }

  list(orgId: string, workItemId: string) {
    return this.db
      .select()
      .from(activity)
      .where(and(eq(activity.orgId, orgId), eq(activity.workItemId, workItemId)))
      .orderBy(desc(activity.createdAt));
  }
}
