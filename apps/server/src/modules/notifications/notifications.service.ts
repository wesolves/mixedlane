import { Controller, Get, HttpCode, Inject, Injectable, Module, Param, Post, Query, type OnModuleInit } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { Notification } from "@flowboard/shared";
import { Ctx, type Actor, type RequestContext } from "../../core/context";
import { DB, type Db } from "../../core/database/database";
import { notifications, projects, spaces } from "../../core/database/schema";
import { EventBus, type CommentChanged, type ItemChanged, type PageChanged } from "../../core/events";
import { excerpt, extractMentionIds } from "../../core/html";
import { notFound } from "../../core/http";
import { AccessService } from "../access/access.service";
import { DocsModule } from "../docs/docs.controller";
import { DocsService } from "../docs/docs.service";

type NotificationRow = typeof notifications.$inferSelect;
type Kind = Notification["type"];

export const toNotificationDto = (n: NotificationRow): Notification => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  link: n.link,
  actorName: n.actorName,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

const isSelf = (actor: Actor, userId: string) => actor.type === "user" && actor.id === userId;

/**
 * In-app inbox. Listens to domain events and notifies:
 *   - assigned        — you were made the assignee
 *   - mentioned       — someone @mentioned you in a description, comment or page
 *   - commented       — a new comment on an item assigned to you
 *   - status_changed  — someone else moved an item assigned to you
 * Nobody is notified about their own actions, or about things they can't read.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly events: EventBus,
    private readonly access: AccessService,
    private readonly docs: DocsService,
  ) {}

  onModuleInit() {
    this.events.on("item", (e) => this.onItem(e));
    this.events.on("comment", (e) => this.onComment(e));
    this.events.on("page", (e) => this.onPage(e));
  }

  /* ---------- Inbox ---------- */

  async list(ctx: RequestContext, unreadOnly = false) {
    if (!ctx.userId) return { items: [], unread: 0 }; // agents have no inbox
    const mine = and(eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.userId!));
    const [rows, [{ n }]] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(unreadOnly ? and(mine, isNull(notifications.readAt)) : mine)
        .orderBy(desc(notifications.createdAt))
        .limit(50),
      this.db.select({ n: count() }).from(notifications).where(and(mine, isNull(notifications.readAt))),
    ]);
    return { items: rows.map(toNotificationDto), unread: Number(n) };
  }

  async markRead(ctx: RequestContext, id: string) {
    if (!ctx.userId) throw notFound("Notification");
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.userId!)))
      .returning();
    if (!row) throw notFound("Notification");
    return toNotificationDto(row);
  }

  async markAllRead(ctx: RequestContext) {
    if (!ctx.userId) return { ok: true };
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.orgId, ctx.orgId), eq(notifications.userId, ctx.userId!), isNull(notifications.readAt)));
    return { ok: true };
  }

  private async notify(orgId: string, userId: string, actor: Actor, n: { type: Kind; title: string; body: string; link: string }) {
    const [row] = await this.db.insert(notifications).values({ orgId, userId, actorName: actor.name, ...n }).returning();
    this.events.emit("notification", { notification: row });
  }

  /* ---------- Triggers ---------- */

  /** Recipients who can read the project, minus the actor. */
  private async readers(orgId: string, projectId: string, userIds: string[], actor: Actor) {
    const out: string[] = [];
    for (const id of new Set(userIds)) {
      if (isSelf(actor, id)) continue;
      const ctx = await this.access.contextFor(orgId, id);
      if (ctx && (await this.access.canRead(ctx, projectId))) out.push(id);
    }
    return out;
  }

  private async itemContext(e: { orgId: string; item: ItemChanged["item"] }) {
    const [project] = await this.db.select().from(projects).where(eq(projects.id, e.item.projectId));
    if (!project) return null;
    return {
      link: `/projects/${project.key}/${e.item.type}/${e.item.key}`,
      statusName: (id: string) => project.statuses.find((s) => s.id === id)?.name ?? id,
    };
  }

  private async onItem(e: ItemChanged) {
    if (e.action === "deleted") return;
    const info = await this.itemContext(e);
    if (!info) return;
    const { item, prev, actor } = e;
    const label = `${item.key}: ${item.title}`;

    // Mentions added to the description.
    const before = new Set(prev ? extractMentionIds(prev.description) : []);
    const mentioned = extractMentionIds(item.description).filter((id) => !before.has(id));
    for (const userId of await this.readers(e.orgId, item.projectId, mentioned, actor)) {
      await this.notify(e.orgId, userId, actor, { type: "mentioned", title: `${actor.name} mentioned you in ${item.key}`, body: item.title, link: info.link });
    }

    const assignee = item.assigneeId;
    if (!assignee || mentioned.includes(assignee)) return;
    const [recipient] = await this.readers(e.orgId, item.projectId, [assignee], actor);
    if (!recipient) return;

    if (assignee !== prev?.assigneeId) {
      await this.notify(e.orgId, recipient, actor, { type: "assigned", title: `${actor.name} assigned you ${item.key}`, body: item.title, link: info.link });
    } else if (prev && prev.status !== item.status) {
      await this.notify(e.orgId, recipient, actor, {
        type: "status_changed",
        title: `${actor.name} moved ${item.key} to ${info.statusName(item.status)}`,
        body: label,
        link: info.link,
      });
    }
  }

  private async onComment(e: CommentChanged) {
    if (e.action === "deleted") return;
    const info = await this.itemContext(e);
    if (!info) return;
    const { item, comment, actor } = e;
    const before = new Set(e.prevBody ? extractMentionIds(e.prevBody) : []);
    const mentioned = extractMentionIds(comment.body).filter((id) => !before.has(id));
    const body = excerpt(comment.body);
    const link = `${info.link}#comment-${comment.id}`;
    for (const userId of await this.readers(e.orgId, item.projectId, mentioned, actor)) {
      await this.notify(e.orgId, userId, actor, { type: "mentioned", title: `${actor.name} mentioned you on ${item.key}`, body, link });
    }
    if (e.action !== "created" || !item.assigneeId || mentioned.includes(item.assigneeId)) return;
    const [recipient] = await this.readers(e.orgId, item.projectId, [item.assigneeId], actor);
    if (recipient) await this.notify(e.orgId, recipient, actor, { type: "commented", title: `${actor.name} commented on ${item.key}`, body, link });
  }

  private async onPage(e: PageChanged) {
    if (e.action !== "created" && e.action !== "updated") return;
    const before = new Set(e.prevHtml ? extractMentionIds(e.prevHtml) : []);
    const mentioned = extractMentionIds(e.page.contentHtml).filter((id) => !before.has(id) && !isSelf(e.actor, id));
    if (!mentioned.length) return;
    const [space] = await this.db.select().from(spaces).where(eq(spaces.id, e.page.spaceId));
    if (!space) return;
    for (const userId of mentioned) {
      const ctx = await this.access.contextFor(e.orgId, userId);
      if (!ctx) continue;
      const perms = (await this.docs.permsFor(ctx, [space])).get(space.id);
      if (!perms?.read) continue;
      await this.notify(e.orgId, userId, e.actor, {
        type: "mentioned",
        title: `${e.actor.name} mentioned you in “${e.page.title}”`,
        body: space.name,
        link: `/docs/${space.key}/${e.page.id}`,
      });
    }
  }
}

@ApiTags("Notifications")
@ApiBearerAuth()
@ApiHeader({ name: "X-Org", description: "Organization slug or id", required: true })
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Ctx() ctx: RequestContext, @Query("unread") unread?: string) {
    return this.notifications.list(ctx, unread === "true" || unread === "1");
  }

  @Post("read-all")
  @HttpCode(200)
  readAll(@Ctx() ctx: RequestContext) {
    return this.notifications.markAllRead(ctx);
  }

  @Post(":id/read")
  @HttpCode(200)
  read(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Notification");
    return this.notifications.markRead(ctx, id);
  }
}

@Module({
  imports: [DocsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
