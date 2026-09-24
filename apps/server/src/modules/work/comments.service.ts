import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DB, type Db } from "../../core/database/database";
import { comments } from "../../core/database/schema";
import { notFound } from "../../core/http";
import type { Actor } from "../../core/context";
import { EventBus } from "../../core/events";
import { ActivityService } from "./activity.service";
import { ItemsService } from "./items.service";
import { isUuid } from "./projects.service";

export type CommentRow = typeof comments.$inferSelect;

export const toCommentDto = (c: CommentRow) => {
  const { orgId: _o, ...rest } = c;
  return rest;
};

@Injectable()
export class CommentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly items: ItemsService,
    private readonly activity: ActivityService,
    private readonly events: EventBus,
  ) {}

  async list(orgId: string, workItemId: string) {
    const rows = await this.db
      .select()
      .from(comments)
      .where(and(eq(comments.orgId, orgId), eq(comments.workItemId, workItemId)))
      .orderBy(asc(comments.createdAt));
    return rows.map(toCommentDto);
  }

  async add(orgId: string, workItemId: string, body: string, actor: Actor) {
    const item = await this.items.get(orgId, workItemId);
    const comment = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(comments)
        .values({ orgId, workItemId, body, authorType: actor.type, authorId: actor.id, author: actor.name })
        .returning();
      await this.activity.log(tx, orgId, workItemId, actor, "commented");
      return row;
    });
    this.events.emit("comment", { orgId, action: "created", item, comment, actor });
    return toCommentDto(comment);
  }

  async get(orgId: string, id: string): Promise<CommentRow> {
    if (!isUuid(id)) throw notFound("Comment");
    const [c] = await this.db.select().from(comments).where(and(eq(comments.orgId, orgId), eq(comments.id, id)));
    if (!c) throw notFound("Comment");
    return c;
  }

  async update(orgId: string, id: string, body: string, actor: Actor) {
    const prev = await this.get(orgId, id);
    const [row] = await this.db.update(comments).set({ body, updatedAt: new Date() }).where(eq(comments.id, id)).returning();
    const item = await this.items.get(orgId, row.workItemId);
    this.events.emit("comment", { orgId, action: "updated", item, comment: row, prevBody: prev.body, actor });
    return toCommentDto(row);
  }

  async remove(orgId: string, id: string, actor: Actor) {
    const comment = await this.get(orgId, id);
    const item = await this.items.get(orgId, comment.workItemId);
    await this.db.delete(comments).where(eq(comments.id, id));
    this.events.emit("comment", { orgId, action: "deleted", item, comment, actor });
  }
}
