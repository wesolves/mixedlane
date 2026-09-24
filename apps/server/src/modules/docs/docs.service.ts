import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  extractItemKeys,
  type DocSearchHit,
  type LinkedPage,
  type PageDetail,
  type PageNode,
  type PageVersion,
  type PageVersionSummary,
  type Space,
} from "@flowboard/shared";
import type { z } from "zod";
import type { pageCreateSchema, pageMoveSchema, pageUpdateSchema, spaceCreateSchema, spaceUpdateSchema } from "@flowboard/shared";
import type { RequestContext } from "../../core/context";
import { DB, type Db, type Executor } from "../../core/database/database";
import { pageItemLinks, pageVersions, pages, projects, spaces, workItems } from "../../core/database/schema";
import { EventBus } from "../../core/events";
import { htmlToText } from "../../core/html";
import { AppError, notFound } from "../../core/http";
import { AccessService } from "../access/access.service";

export type SpaceRow = typeof spaces.$inferSelect;
export type PageRow = typeof pages.$inferSelect;

type SpaceCreate = z.output<typeof spaceCreateSchema>;
type SpaceUpdate = z.output<typeof spaceUpdateSchema>;
type PageCreate = z.output<typeof pageCreateSchema>;
type PageUpdate = z.output<typeof pageUpdateSchema>;
type PageMove = z.output<typeof pageMoveSchema>;

export interface DocPerms {
  read: boolean;
  write: boolean;
  admin: boolean;
}
type Need = keyof DocPerms;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONE: DocPerms = { read: false, write: false, admin: false };
const iso = (d: Date) => d.toISOString();

/**
 * Confluence-style docs: spaces → page tree → versions.
 *
 * Access:
 *   - A project-linked space follows the project: doc.read / doc.write / doc.admin.
 *   - A standalone space is open to the org: owners/admins administer, members write, guests see nothing.
 * Spaces you can't read are reported as 404.
 */
@Injectable()
export class DocsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AccessService,
    private readonly events: EventBus,
  ) {}

  /* ---------- Access ---------- */

  async permsFor(ctx: RequestContext, list: SpaceRow[]): Promise<Map<string, DocPerms>> {
    const out = new Map<string, DocPerms>();
    const projectIds = [...new Set(list.map((s) => s.projectId).filter((x): x is string => !!x))];
    const projectRows = projectIds.length ? await this.db.select().from(projects).where(inArray(projects.id, projectIds)) : [];
    const projectAccess = await this.access.resolveMany(ctx, projectRows);
    const elevated = ctx.orgRole === "owner" || ctx.orgRole === "admin";
    for (const s of list) {
      if (s.projectId) {
        const perms = projectAccess.get(s.projectId)?.permissions ?? [];
        out.set(s.id, { read: perms.includes("doc.read"), write: perms.includes("doc.write"), admin: perms.includes("doc.admin") });
      } else if (ctx.agent) {
        // Agents: org-wide spaces per the agent's docs setting; never admin.
        out.set(s.id, { read: ctx.agent.docAccess !== "none", write: ctx.agent.docAccess === "write", admin: false });
      } else if (elevated) out.set(s.id, { read: true, write: true, admin: true });
      else if (ctx.orgRole === "member") out.set(s.id, { read: true, write: true, admin: false });
      else out.set(s.id, NONE);
    }
    return out;
  }

  /** Loads a space by key or id and asserts access. */
  async space(ctx: RequestContext, keyOrId: string, need: Need = "read") {
    const match = UUID.test(keyOrId) ? eq(spaces.id, keyOrId) : eq(spaces.key, keyOrId.toUpperCase());
    const [space] = await this.db.select().from(spaces).where(and(eq(spaces.orgId, ctx.orgId), match));
    if (!space) throw notFound("Space");
    const perms = (await this.permsFor(ctx, [space])).get(space.id)!;
    if (!perms.read) throw notFound("Space");
    if (!perms[need]) throw new AppError(403, "You don't have permission to do that in this space");
    return { space, perms };
  }

  /** Loads a page and asserts access to its space. */
  async page(ctx: RequestContext, id: string, need: Need = "read") {
    if (!UUID.test(id)) throw notFound("Page");
    const [page] = await this.db.select().from(pages).where(and(eq(pages.orgId, ctx.orgId), eq(pages.id, id)));
    if (!page) throw notFound("Page");
    try {
      return { page, ...(await this.space(ctx, page.spaceId, need)) };
    } catch (err) {
      if (err instanceof AppError && err.status === 404) throw notFound("Page");
      throw err;
    }
  }

  /** Ids of the spaces the caller can read. */
  async readableSpaceIds(ctx: RequestContext): Promise<string[]> {
    const all = await this.db.select().from(spaces).where(eq(spaces.orgId, ctx.orgId));
    const perms = await this.permsFor(ctx, all);
    return all.filter((s) => perms.get(s.id)?.read).map((s) => s.id);
  }

  /* ---------- Spaces ---------- */

  private async toSpaceDto(list: SpaceRow[], perms: Map<string, DocPerms>): Promise<Space[]> {
    if (!list.length) return [];
    const ids = list.map((s) => s.id);
    const counts = await this.db
      .select({ spaceId: pages.spaceId, n: sql<number>`count(*)::int` })
      .from(pages)
      .where(inArray(pages.spaceId, ids))
      .groupBy(pages.spaceId);
    const projectIds = list.map((s) => s.projectId).filter((x): x is string => !!x);
    const keys = projectIds.length ? await this.db.select({ id: projects.id, key: projects.key }).from(projects).where(inArray(projects.id, projectIds)) : [];
    return list.map((s) => ({
      id: s.id,
      key: s.key,
      name: s.name,
      description: s.description,
      icon: s.icon,
      color: s.color,
      projectId: s.projectId,
      projectKey: keys.find((k) => k.id === s.projectId)?.key ?? null,
      pageCount: counts.find((c) => c.spaceId === s.id)?.n ?? 0,
      canWrite: !!perms.get(s.id)?.write,
      canAdmin: !!perms.get(s.id)?.admin,
      updatedAt: iso(s.updatedAt),
    }));
  }

  async listSpaces(ctx: RequestContext): Promise<Space[]> {
    const all = await this.db.select().from(spaces).where(eq(spaces.orgId, ctx.orgId)).orderBy(asc(spaces.name));
    const perms = await this.permsFor(ctx, all);
    return this.toSpaceDto(
      all.filter((s) => perms.get(s.id)?.read),
      perms,
    );
  }

  async getSpace(ctx: RequestContext, keyOrId: string): Promise<Space> {
    const { space, perms } = await this.space(ctx, keyOrId);
    return (await this.toSpaceDto([space], new Map([[space.id, perms]])))[0];
  }

  async createSpace(ctx: RequestContext, input: SpaceCreate): Promise<Space> {
    if (input.projectId) {
      // Linking a space to a project is a project-admin decision.
      await this.access.project(ctx, input.projectId, "project.admin");
    } else if (ctx.orgRole === "guest") {
      throw new AppError(403, ctx.agent ? "Agents can't create spaces" : "Guests can't create spaces");
    }
    const [clash] = await this.db.select({ id: spaces.id }).from(spaces).where(and(eq(spaces.orgId, ctx.orgId), eq(spaces.key, input.key)));
    if (clash) throw new AppError(409, `Space key "${input.key}" is already used`);
    const [space] = await this.db
      .insert(spaces)
      .values({
        orgId: ctx.orgId,
        key: input.key,
        name: input.name,
        description: input.description ?? "",
        ...(input.icon ? { icon: input.icon } : {}),
        ...(input.color ? { color: input.color } : {}),
        projectId: input.projectId ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    this.events.emit("space", { orgId: ctx.orgId, spaceId: space.id, action: "created", actor: ctx.actor });
    return this.getSpace(ctx, space.id);
  }

  async updateSpace(ctx: RequestContext, keyOrId: string, patch: SpaceUpdate): Promise<Space> {
    const { space } = await this.space(ctx, keyOrId, "admin");
    await this.db.update(spaces).set({ ...patch, updatedAt: new Date() }).where(eq(spaces.id, space.id));
    this.events.emit("space", { orgId: ctx.orgId, spaceId: space.id, action: "updated", actor: ctx.actor });
    return this.getSpace(ctx, space.id);
  }

  async deleteSpace(ctx: RequestContext, keyOrId: string) {
    const { space } = await this.space(ctx, keyOrId, "admin");
    await this.db.delete(spaces).where(eq(spaces.id, space.id));
    this.events.emit("space", { orgId: ctx.orgId, spaceId: space.id, action: "deleted", actor: ctx.actor });
  }

  /* ---------- Pages ---------- */

  async tree(ctx: RequestContext, spaceKey: string): Promise<PageNode[]> {
    const { space } = await this.space(ctx, spaceKey);
    const rows = await this.db
      .select({ id: pages.id, parentId: pages.parentId, title: pages.title, position: pages.position, updatedAt: pages.updatedAt })
      .from(pages)
      .where(eq(pages.spaceId, space.id))
      .orderBy(asc(pages.position), asc(pages.createdAt));
    return rows.map((r) => ({ ...r, updatedAt: iso(r.updatedAt) }));
  }

  private async assertParent(spaceId: string, parentId: string) {
    if (!UUID.test(parentId)) throw notFound("Parent page");
    const [parent] = await this.db.select({ spaceId: pages.spaceId }).from(pages).where(eq(pages.id, parentId));
    if (!parent || parent.spaceId !== spaceId) throw new AppError(400, "The parent page must be in the same space");
  }

  async createPage(ctx: RequestContext, spaceKey: string, input: PageCreate): Promise<PageDetail> {
    const { space } = await this.space(ctx, spaceKey, "write");
    if (input.parentId) await this.assertParent(space.id, input.parentId);
    const [{ max }] = await this.db
      .select({ max: sql<number>`coalesce(max(${pages.position}), 0)` })
      .from(pages)
      .where(and(eq(pages.spaceId, space.id), input.parentId ? eq(pages.parentId, input.parentId) : isNull(pages.parentId)));
    const contentHtml = input.contentHtml ?? "";
    const contentText = htmlToText(contentHtml);
    const linkIds = await this.linkedItemIds(ctx.orgId, `${input.title}\n${contentText}`);
    const author = { id: ctx.userId, name: ctx.actor.name };

    const page = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(pages)
        .values({
          orgId: ctx.orgId,
          spaceId: space.id,
          parentId: input.parentId ?? null,
          position: Number(max) + 1000,
          title: input.title,
          contentHtml,
          contentText,
          createdBy: author.id,
          updatedBy: author.id,
          updatedByName: author.name,
        })
        .returning();
      await this.saveVersion(tx, row, author);
      await this.setLinks(tx, row.id, linkIds);
      await tx.update(spaces).set({ updatedAt: new Date() }).where(eq(spaces.id, space.id));
      return row;
    });
    this.events.emit("page", { orgId: ctx.orgId, action: "created", page, actor: ctx.actor });
    return this.detail(ctx, page.id);
  }

  async detail(ctx: RequestContext, id: string): Promise<PageDetail> {
    const { page, space, perms } = await this.page(ctx, id);
    // Breadcrumbs: walk up the tree (bounded, pages are shallow).
    const crumbs: { id: string; title: string }[] = [];
    const all = await this.db.select({ id: pages.id, parentId: pages.parentId, title: pages.title }).from(pages).where(eq(pages.spaceId, space.id));
    const byId = new Map(all.map((p) => [p.id, p]));
    for (let cur = page.parentId ? byId.get(page.parentId) : undefined; cur && crumbs.length < 50; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      crumbs.unshift({ id: cur.id, title: cur.title });
    }
    return {
      id: page.id,
      spaceId: space.id,
      spaceKey: space.key,
      parentId: page.parentId,
      title: page.title,
      contentHtml: page.contentHtml,
      version: page.version,
      updatedAt: iso(page.updatedAt),
      updatedByName: page.updatedByName,
      createdAt: iso(page.createdAt),
      breadcrumbs: crumbs,
      linkedItems: await this.linkedItems(ctx, page.id),
      canWrite: perms.write,
    };
  }

  /**
   * Saves a new version. `baseVersion` is the version the editor loaded: if someone saved in the
   * meantime the update matches no row and we answer 409 so the client can show the conflict.
   */
  async updatePage(ctx: RequestContext, id: string, input: PageUpdate): Promise<PageDetail> {
    const { page: current } = await this.page(ctx, id, "write");
    if (current.version !== input.baseVersion) throw this.conflict(current);
    const title = input.title ?? current.title;
    const contentHtml = input.contentHtml ?? current.contentHtml;
    if (title === current.title && contentHtml === current.contentHtml) return this.detail(ctx, id);
    const contentText = htmlToText(contentHtml);
    const linkIds = await this.linkedItemIds(ctx.orgId, `${title}\n${contentText}`);
    const author = { id: ctx.userId, name: ctx.actor.name };

    const page = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(pages)
        .set({ title, contentHtml, contentText, version: sql`${pages.version} + 1`, updatedBy: author.id, updatedByName: author.name, updatedAt: new Date() })
        .where(and(eq(pages.id, id), eq(pages.version, input.baseVersion)))
        .returning();
      if (!row) return null;
      await this.saveVersion(tx, row, author);
      await this.setLinks(tx, row.id, linkIds);
      await tx.update(spaces).set({ updatedAt: new Date() }).where(eq(spaces.id, row.spaceId));
      return row;
    });
    if (!page) throw this.conflict((await this.page(ctx, id)).page);
    this.events.emit("page", { orgId: ctx.orgId, action: "updated", page, prevHtml: current.contentHtml, actor: ctx.actor });
    return this.detail(ctx, id);
  }

  private conflict(page: PageRow) {
    return new AppError(409, `${page.updatedByName || "Someone"} saved a newer version (v${page.version}) while you were editing`);
  }

  async movePage(ctx: RequestContext, id: string, input: PageMove): Promise<PageNode[]> {
    const { page, space } = await this.page(ctx, id, "write");
    const parentId = input.parentId ?? null;
    if (parentId) {
      if (parentId === id) throw new AppError(400, "A page cannot be its own parent");
      await this.assertParent(space.id, parentId);
      if (await this.isDescendant(parentId, id)) throw new AppError(400, "Cannot move a page under its own sub-page");
    }
    const siblings = await this.db
      .select({ id: pages.id, position: pages.position })
      .from(pages)
      .where(and(eq(pages.spaceId, space.id), parentId ? eq(pages.parentId, parentId) : isNull(pages.parentId)))
      .orderBy(asc(pages.position), asc(pages.createdAt));
    const others = siblings.filter((s) => s.id !== id);
    let position: number;
    const idx = input.beforeId ? others.findIndex((s) => s.id === input.beforeId) : -1;
    if (idx === -1) position = (others.at(-1)?.position ?? 0) + 1000;
    else if (idx === 0) position = others[0].position - 1000;
    else position = (others[idx - 1].position + others[idx].position) / 2;

    const [moved] = await this.db.update(pages).set({ parentId, position }).where(eq(pages.id, page.id)).returning();
    this.events.emit("page", { orgId: ctx.orgId, action: "moved", page: moved, actor: ctx.actor });
    return this.tree(ctx, space.id);
  }

  private async isDescendant(candidateId: string, ancestorId: string): Promise<boolean> {
    const result = await this.db.execute<{ hit: boolean }>(sql`
      WITH RECURSIVE up(id, parent_id) AS (
        SELECT id, parent_id FROM pages WHERE id = ${candidateId}
        UNION SELECT p.id, p.parent_id FROM pages p JOIN up ON p.id = up.parent_id
      )
      SELECT EXISTS (SELECT 1 FROM up WHERE id = ${ancestorId}) AS hit`);
    return !!result.rows[0]?.hit;
  }

  async deletePage(ctx: RequestContext, id: string) {
    const { page } = await this.page(ctx, id, "write");
    // parent_id cascades: sub-pages go too.
    await this.db.delete(pages).where(eq(pages.id, page.id));
    this.events.emit("page", { orgId: ctx.orgId, action: "deleted", page, actor: ctx.actor });
  }

  /* ---------- Versions ---------- */

  private async saveVersion(tx: Executor, page: PageRow, author: { id: string | null; name: string }) {
    await tx.insert(pageVersions).values({
      pageId: page.id,
      version: page.version,
      title: page.title,
      contentHtml: page.contentHtml,
      contentText: page.contentText,
      authorId: author.id,
      authorName: author.name,
    });
  }

  async versions(ctx: RequestContext, id: string): Promise<PageVersionSummary[]> {
    await this.page(ctx, id);
    const rows = await this.db
      .select({ version: pageVersions.version, title: pageVersions.title, authorName: pageVersions.authorName, createdAt: pageVersions.createdAt })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, id))
      .orderBy(desc(pageVersions.version));
    return rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) }));
  }

  async version(ctx: RequestContext, id: string, version: number): Promise<PageVersion> {
    await this.page(ctx, id);
    const [row] = await this.db
      .select()
      .from(pageVersions)
      .where(and(eq(pageVersions.pageId, id), eq(pageVersions.version, version)));
    if (!row) throw notFound("Version");
    return {
      version: row.version,
      title: row.title,
      authorName: row.authorName,
      createdAt: iso(row.createdAt),
      contentHtml: row.contentHtml,
      contentText: row.contentText,
    };
  }

  /** Restoring saves the old content as a new version (history is never rewritten). */
  async restore(ctx: RequestContext, id: string, version: number): Promise<PageDetail> {
    const { page } = await this.page(ctx, id, "write");
    const old = await this.version(ctx, id, version);
    return this.updatePage(ctx, id, { title: old.title, contentHtml: old.contentHtml, baseVersion: page.version });
  }

  /* ---------- Item links ---------- */

  private async linkedItemIds(orgId: string, text: string): Promise<string[]> {
    const projectRows = await this.db.select({ key: projects.key, keyDigits: projects.keyDigits }).from(projects).where(eq(projects.orgId, orgId));
    const keys = extractItemKeys(text, projectRows).slice(0, 200);
    if (!keys.length) return [];
    const rows = await this.db
      .select({ id: workItems.id })
      .from(workItems)
      .where(and(eq(workItems.orgId, orgId), inArray(workItems.key, keys)));
    return rows.map((r) => r.id);
  }

  private async setLinks(tx: Executor, pageId: string, itemIds: string[]) {
    await tx.delete(pageItemLinks).where(eq(pageItemLinks.pageId, pageId));
    if (itemIds.length) await tx.insert(pageItemLinks).values(itemIds.map((itemId) => ({ pageId, itemId }))).onConflictDoNothing();
  }

  /** Items referenced by a page — only those in projects the caller can read. */
  private async linkedItems(ctx: RequestContext, pageId: string) {
    const rows = await this.db
      .select({ item: workItems, projectKey: projects.key, projectId: projects.id })
      .from(pageItemLinks)
      .innerJoin(workItems, eq(workItems.id, pageItemLinks.itemId))
      .innerJoin(projects, eq(projects.id, workItems.projectId))
      .where(eq(pageItemLinks.pageId, pageId))
      .orderBy(asc(workItems.key));
    if (!rows.length) return [];
    const readable = new Set(await this.access.readableProjectIds(ctx));
    return rows
      .filter((r) => readable.has(r.projectId))
      .map((r) => ({ id: r.item.id, key: r.item.key, title: r.item.title, type: r.item.type, status: r.item.status, projectKey: r.projectKey }));
  }

  /** Pages (in readable spaces) that mention an item. */
  async pagesForItem(ctx: RequestContext, itemId: string): Promise<LinkedPage[]> {
    await this.access.item(ctx, itemId, "project.read");
    const readable = await this.readableSpaceIds(ctx);
    if (!readable.length) return [];
    return this.db
      .select({ id: pages.id, title: pages.title, spaceKey: spaces.key, spaceName: spaces.name })
      .from(pageItemLinks)
      .innerJoin(pages, eq(pages.id, pageItemLinks.pageId))
      .innerJoin(spaces, eq(spaces.id, pages.spaceId))
      .where(and(eq(pageItemLinks.itemId, itemId), inArray(pages.spaceId, readable)))
      .orderBy(asc(pages.title));
  }

  /* ---------- Search ---------- */

  async search(ctx: RequestContext, q: string, limit = 20): Promise<DocSearchHit[]> {
    const needle = q.trim().slice(0, 200);
    if (!needle) return [];
    const readable = await this.readableSpaceIds(ctx);
    if (!readable.length) return [];
    const pattern = `%${needle.replace(/[%_\\]/g, "\\$&")}%`;
    const result = await this.db.execute<{ page_id: string; space_key: string; space_name: string; title: string; snippet: string }>(sql`
      SELECT p.id AS page_id, s.key AS space_key, s.name AS space_name, p.title,
             ts_headline('english', p.content_text, q, 'StartSel=«, StopSel=», MaxWords=30, MinWords=12, MaxFragments=1') AS snippet
      FROM pages p
      JOIN spaces s ON s.id = p.space_id,
           websearch_to_tsquery('english', ${needle}) q
      WHERE p.org_id = ${ctx.orgId}
        AND p.space_id IN (${sql.join(readable.map((id) => sql`${id}`), sql`, `)})
        AND (p.search @@ q OR p.title ILIKE ${pattern})
      ORDER BY (p.title ILIKE ${pattern}) DESC, ts_rank(p.search, q) DESC, p.updated_at DESC
      LIMIT ${limit}`);
    return result.rows.map((r) => ({ pageId: r.page_id, spaceKey: r.space_key, spaceName: r.space_name, title: r.title, snippet: r.snippet }));
  }
}
