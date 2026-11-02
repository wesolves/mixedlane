import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  allowedParentTypes,
  canHaveParent,
  formatItemKey,
  TYPE_LABELS,
  TYPE_PLURALS,
  type Breadcrumb,
  type DevSummary,
  type ItemCreate,
  type ItemMove,
  type ItemType,
  type ItemUpdate,
  type Progress,
  type WorkItemDetail,
  type WorkItemSummary,
} from "@mixedlane/shared";
import { DB, type Db, type Executor, type Tx } from "../../core/database/database";
import { comments, ghEntities, ghLinks, orgMembers, projects, users, workItems } from "../../core/database/schema";
import { AppError, notFound } from "../../core/http";
import type { Actor, RequestContext } from "../../core/context";
import { EventBus } from "../../core/events";
import { ActivityService } from "./activity.service";
import { ProjectsService, categoryOf, isUuid, type ProjectRow } from "./projects.service";

export type ItemRow = typeof workItems.$inferSelect;

const TRACKED_FIELDS: (keyof ItemUpdate)[] = [
  "parentId",
  "title",
  "description",
  "status",
  "priority",
  "assignee",
  "assigneeId",
  "labels",
  "startDate",
  "dueDate",
  "estimate",
];

/** API shape (matches the shared WorkItem type). */
export function toItemDto(i: ItemRow) {
  const { orgId: _o, ...rest } = i;
  return rest;
}

@Injectable()
export class ItemsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly projects: ProjectsService,
    private readonly activity: ActivityService,
    private readonly events: EventBus,
  ) {}

  /**
   * Normalizes assignee fields: `assigneeId` must be an org member and also sets the display name;
   * a free-text `assignee` without an id clears the link.
   */
  private async resolveAssignee(orgId: string, input: { assignee?: string | null; assigneeId?: string | null }, executor: Executor = this.db) {
    if (input.assigneeId === undefined) {
      return input.assignee === undefined ? {} : { assignee: input.assignee, assigneeId: null };
    }
    if (input.assigneeId === null) return { assignee: input.assignee ?? null, assigneeId: null };
    const [member] = await executor
      .select({ name: users.name })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, input.assigneeId)));
    if (!member) throw new AppError(400, "The assignee must be a member of this organization");
    return { assignee: member.name, assigneeId: input.assigneeId };
  }

  async get(orgId: string, id: string, tx: Executor = this.db): Promise<ItemRow> {
    if (!isUuid(id)) throw notFound("Work item");
    const [item] = await tx.select().from(workItems).where(and(eq(workItems.orgId, orgId), eq(workItems.id, id)));
    if (!item) throw notFound("Work item");
    return item;
  }

  async idByKey(orgId: string, key: string): Promise<string> {
    const [row] = await this.db
      .select({ id: workItems.id })
      .from(workItems)
      .where(and(eq(workItems.orgId, orgId), eq(workItems.key, key.toUpperCase())));
    if (!row) throw new AppError(404, `No work item with key ${key}`);
    return row.id;
  }

  private async assertParent(orgId: string, project: ProjectRow, type: ItemType, parentId: string | null | undefined, tx: Executor) {
    if (!project.itemTypes.includes(type)) throw new AppError(400, `${TYPE_PLURALS[type]} are not enabled in this project`);
    if (!parentId) {
      if (!canHaveParent(type, null, project.itemTypes)) {
        const parents = allowedParentTypes(type, project.itemTypes).map((t) => TYPE_LABELS[t]);
        throw new AppError(400, `A ${TYPE_LABELS[type]} must belong to a ${parents.join(" or ")}`);
      }
      return;
    }
    const parent = await this.get(orgId, parentId, tx);
    if (parent.projectId !== project.id) throw new AppError(400, "Parent belongs to another project");
    if (!canHaveParent(type, parent.type, project.itemTypes)) {
      throw new AppError(400, `A ${TYPE_LABELS[type]} cannot be placed under a ${TYPE_LABELS[parent.type]}`);
    }
  }

  private assertStatus(project: ProjectRow, status: string) {
    if (!project.statuses.some((s) => s.id === status)) {
      throw new AppError(400, `Unknown status "${status}" for project ${project.key}`);
    }
  }

  async create(orgId: string, input: ItemCreate, actor: Actor, transaction?: Tx): Promise<ItemRow> {
    const project = transaction
      ? (await transaction.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, input.projectId))))[0]
      : await this.projects.get(orgId, input.projectId);
    if (!project) throw notFound("Project");
    const status = input.status ?? project.statuses[0].id;
    this.assertStatus(project, status);
    const who = await this.resolveAssignee(orgId, input, transaction ?? this.db);

    const insert = async (tx: Executor) => {
      // Atomic counter bump — safe under concurrent creates.
      const [{ counter }] = await tx
        .update(projects)
        .set({ itemCounter: sql`${projects.itemCounter} + 1` })
        .where(eq(projects.id, project.id))
        .returning({ counter: projects.itemCounter });
      if (counter >= 10 ** project.keyDigits) {
        throw new AppError(409, `Project ${project.key} has used all ${project.keyDigits}-digit item numbers`);
      }
      // Validate after taking the project counter lock: a concurrent transfer may have moved the parent.
      await this.assertParent(orgId, project, input.type, input.parentId, tx);
      const [{ max }] = await tx
        .select({ max: sql<number>`coalesce(max(${workItems.sortOrder}), 0)` })
        .from(workItems)
        .where(and(eq(workItems.projectId, project.id), eq(workItems.status, status)));
      const [item] = await tx
        .insert(workItems)
        .values({
          orgId,
          createdByAgentId: actor.type === "agent" ? actor.id : null,
          projectId: project.id,
          parentId: input.parentId ?? null,
          type: input.type,
          key: formatItemKey(project.key, counter, project.keyDigits),
          title: input.title,
          description: input.description ?? "",
          status,
          priority: input.priority ?? "medium",
          assignee: who.assignee ?? null,
          assigneeId: who.assigneeId ?? null,
          labels: input.labels ?? [],
          startDate: input.startDate ?? null,
          dueDate: input.dueDate ?? null,
          estimate: input.estimate ?? null,
          sortOrder: Number(max) + 1000,
        })
        .returning();
      await this.activity.log(tx, orgId, item.id, actor, "created");
      return item;
    };
    const created = transaction ? await insert(transaction) : await this.db.transaction(insert);
    if (!transaction) this.events.emit("item", { orgId, action: "created", item: created, actor });
    return created;
  }

  async update(orgId: string, id: string, patch: ItemUpdate, actor: Actor): Promise<ItemRow> {
    const current = await this.get(orgId, id);
    const project = await this.projects.get(orgId, current.projectId);
    if (patch.status !== undefined) this.assertStatus(project, patch.status);
    patch = { ...patch, ...(await this.resolveAssignee(orgId, patch)) };

    const updated = await this.db.transaction(async (tx) => {
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, project.id)).for("update");
      const fresh = await this.get(orgId, id, tx);
      if (fresh.projectId !== current.projectId) throw new AppError(409, "This ticket moved to another project. Reload before editing it.");
      if (patch.parentId !== undefined && patch.parentId !== current.parentId) {
        if (patch.parentId === id) throw new AppError(400, "An item cannot be its own parent");
        if (patch.parentId && (await this.isDescendant(tx, patch.parentId, id))) {
          throw new AppError(400, "Cannot move an item under its own descendant");
        }
        await this.assertParent(orgId, project, current.type, patch.parentId, tx);
      }
      const changes: Record<string, unknown> = {};
      for (const field of TRACKED_FIELDS) {
        const next = patch[field];
        if (next === undefined) continue;
        const prev = current[field as keyof ItemRow];
        if (JSON.stringify(prev) === JSON.stringify(next)) continue;
        changes[field] = next;
        // The id travels with the name; the "assignee" entry already tells the story.
        if (field === "assigneeId") continue;
        // Descriptions are large — log that it changed, not the full text.
        const isLong = field === "description";
        await this.activity.log(tx, orgId, id, actor, "updated", {
          field,
          from: isLong ? undefined : prev,
          to: isLong ? undefined : next,
        });
      }
      if (Object.keys(changes).length === 0) return current;
      const [row] = await tx
        .update(workItems)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(workItems.id, id))
        .returning();
      return row;
    });
    if (updated !== current) this.events.emit("item", { orgId, action: "updated", item: updated, prev: current, actor });
    return updated;
  }

  async move(orgId: string, id: string, move: ItemMove, actor: Actor): Promise<ItemRow> {
    const current = await this.get(orgId, id);
    this.assertStatus(await this.projects.get(orgId, current.projectId), move.status);
    const moved = await this.db.transaction(async (tx) => {
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, current.projectId)).for("update");
      const fresh = await this.get(orgId, id, tx);
      if (fresh.projectId !== current.projectId) throw new AppError(409, "This ticket moved to another project. Reload before changing its status.");
      const [row] = await tx
        .update(workItems)
        .set({ status: move.status, sortOrder: move.sortOrder, updatedAt: new Date() })
        .where(eq(workItems.id, id))
        .returning();
      if (current.status !== move.status) {
        await this.activity.log(tx, orgId, id, actor, "moved", { field: "status", from: current.status, to: move.status });
      }
      return row;
    });
    this.events.emit("item", { orgId, action: "moved", item: moved, prev: current, actor });
    return moved;
  }

  async remove(orgId: string, id: string, actor: Actor) {
    const item = await this.get(orgId, id);
    // parent_id has ON DELETE CASCADE, so descendants go too.
    await this.db.delete(workItems).where(eq(workItems.id, id));
    this.events.emit("item", { orgId, action: "deleted", item, actor });
  }

  async transfer(orgId: string, id: string, input: { projectId: string; parentId: string | null }, actor: Actor) {
    const changes = await this.db.transaction(async (tx) => {
      // Lock projects consistently so transfers cannot race destination counters/configuration.
      const allProjects = await tx.select().from(projects).where(eq(projects.orgId, orgId)).orderBy(asc(projects.id)).for("update");
      const target = allProjects.find((p) => p.id === input.projectId);
      if (!target) throw notFound("Project");
      const allItems = await tx.select().from(workItems).where(eq(workItems.orgId, orgId)).orderBy(asc(workItems.id)).for("update");
      const root = allItems.find((i) => i.id === id);
      if (!root) throw notFound("Work item");
      if (root.projectId === target.id) throw new AppError(400, "Choose a different project");
      const source = allProjects.find((p) => p.id === root.projectId)!;
      const moving = [root];
      const ids = new Set([root.id]);
      for (let n = 0; n < moving.length; n++) {
        for (const child of allItems.filter((i) => i.parentId === moving[n].id && !ids.has(i.id))) { ids.add(child.id); moving.push(child); }
      }
      await this.assertParent(orgId, target, root.type, input.parentId, tx);
      for (const item of moving) {
        const parent = item.id === id ? null : moving.find((i) => i.id === item.parentId);
        if (!target.itemTypes.includes(item.type) || (parent && !canHaveParent(item.type, parent.type, target.itemTypes))) throw new AppError(400, `The destination project does not support the ${item.type} hierarchy`);
      }
      if (target.itemCounter + moving.length >= 10 ** target.keyDigits) throw new AppError(409, "The destination project has no available ticket numbers");
      const result: { prev: ItemRow; item: ItemRow }[] = [];
      for (const [n, prev] of moving.entries()) {
        const oldStatus = source.statuses.find((s) => s.id === prev.status);
        const status = target.statuses.find((s) => s.id === prev.status && s.category === oldStatus?.category) ?? target.statuses.find((s) => s.category === oldStatus?.category);
        if (!status) throw new AppError(400, `The destination workflow has no status for ${oldStatus?.category ?? prev.status}`);
        const [item] = await tx.update(workItems).set({ projectId: target.id, key: formatItemKey(target.key, target.itemCounter + n + 1, target.keyDigits), parentId: prev.id === id ? input.parentId : prev.parentId, status: status.id, updatedAt: new Date() }).where(eq(workItems.id, prev.id)).returning();
        await this.activity.log(tx, orgId, item.id, actor, "moved", { field: "project", from: `${source.key} · ${prev.key}`, to: `${target.key} · ${item.key}` });
        result.push({ prev, item });
      }
      await tx.update(projects).set({ itemCounter: target.itemCounter + moving.length }).where(eq(projects.id, target.id));
      return result;
    });
    for (const { prev, item } of changes) {
      this.events.emit("item", { orgId, action: "deleted", item: prev, actor });
      this.events.emit("item", { orgId, action: "moved", prev, item, actor });
    }
    return changes[0].item;
  }

  private async isDescendant(tx: Executor, candidateId: string, ancestorId: string): Promise<boolean> {
    const result = await tx.execute<{ hit: boolean }>(sql`
      WITH RECURSIVE up(id, parent_id) AS (
        SELECT id, parent_id FROM work_items WHERE id = ${candidateId}
        UNION SELECT w.id, w.parent_id FROM work_items w JOIN up ON w.id = up.parent_id
      )
      SELECT EXISTS (SELECT 1 FROM up WHERE id = ${ancestorId}) AS hit`);
    return !!result.rows[0]?.hit;
  }

  /* ---------- Read models ---------- */

  /** Summaries for every item in a project, with leaf-level progress roll-ups and badges. */
  async summarize(orgId: string, projectId: string, ctx: RequestContext): Promise<Map<string, WorkItemSummary>> {
    const project = await this.projects.get(orgId, projectId);
    const [all, counts, dev] = await Promise.all([
      this.db.select().from(workItems).where(and(eq(workItems.projectId, project.id), ctx?.agent && ctx.agent.itemScope !== "all" ? eq(workItems.createdByAgentId, ctx.agent.id) : undefined)).orderBy(asc(workItems.sortOrder)),
      this.commentCounts(project.id),
      this.devSummaries(project.id),
    ]);
    const isDone = (it: ItemRow) => categoryOf(project.statuses, it.status) === "done";
    const children = new Map<string, ItemRow[]>();
    for (const it of all) {
      if (!it.parentId) continue;
      const list = children.get(it.parentId) ?? [];
      list.push(it);
      children.set(it.parentId, list);
    }

    const progressCache = new Map<string, Progress>();
    const progressOf = (item: ItemRow): Progress => {
      const cached = progressCache.get(item.id);
      if (cached) return cached;
      const p: Progress = { total: 0, done: 0 };
      for (const kid of children.get(item.id) ?? []) {
        const kp = progressOf(kid);
        if (kp.total === 0) {
          p.total += 1;
          if (isDone(kid)) p.done += 1;
        } else {
          p.total += kp.total;
          p.done += kp.done;
        }
      }
      progressCache.set(item.id, p);
      return p;
    };

    const out = new Map<string, WorkItemSummary>();
    for (const it of all) {
      out.set(it.id, {
        ...(toItemDto(it) as unknown as WorkItemSummary),
        parentId: it.parentId && all.some((p) => p.id === it.parentId) ? it.parentId : null,
        childCount: children.get(it.id)?.length ?? 0,
        progress: progressOf(it),
        commentCount: counts.get(it.id) ?? 0,
        dev: dev.get(it.id),
      });
    }
    return out;
  }

  async list(orgId: string, projectId: string, filters: { type?: string[]; parentId?: string | null; status?: string[]; q?: string }, ctx: RequestContext) {
    let items = [...(await this.summarize(orgId, projectId, ctx)).values()];
    if (filters.type?.length) items = items.filter((i) => filters.type!.includes(i.type));
    if (filters.status?.length) items = items.filter((i) => filters.status!.includes(i.status));
    if (filters.parentId !== undefined) items = items.filter((i) => i.parentId === filters.parentId);
    if (filters.q) {
      const q = filters.q.toLowerCase();
      items = items.filter((i) => i.title.toLowerCase().includes(q) || i.key.toLowerCase().includes(q));
    }
    return items;
  }

  async detail(orgId: string, id: string, ctx: RequestContext): Promise<WorkItemDetail> {
    const item = await this.get(orgId, id);
    const summaries = await this.summarize(orgId, item.projectId, ctx);
    const self = summaries.get(id);
    if (!self) throw notFound("Work item");
    const ancestors: Breadcrumb[] = [];
    let cursor = self.parentId ? summaries.get(self.parentId) : undefined;
    while (cursor) {
      ancestors.unshift({ id: cursor.id, key: cursor.key, title: cursor.title, type: cursor.type });
      cursor = cursor.parentId ? summaries.get(cursor.parentId) : undefined;
    }
    const children = [...summaries.values()].filter((s) => s.parentId === id);
    return { ...self, ancestors, children };
  }

  /** Search limited to the given (readable) projects. */
  async search(orgId: string, q: string, projectIds: string[], limit: number, ctx: RequestContext) {
    if (!projectIds.length) return [];
    const pattern = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    const rows = await this.db
      .select({ item: workItems, projectKey: projects.key })
      .from(workItems)
      .innerJoin(projects, eq(projects.id, workItems.projectId))
      .where(and(eq(workItems.orgId, orgId), inArray(workItems.projectId, projectIds), ctx?.agent && ctx.agent.itemScope !== "all" ? eq(workItems.createdByAgentId, ctx.agent.id) : undefined, or(ilike(workItems.title, pattern), ilike(workItems.key, pattern))))
      .limit(limit);
    return rows.map((r) => ({ ...toItemDto(r.item), projectKey: r.projectKey }));
  }

  private async commentCounts(projectId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ id: comments.workItemId, n: sql<number>`count(*)::int` })
      .from(comments)
      .innerJoin(workItems, eq(workItems.id, comments.workItemId))
      .where(eq(workItems.projectId, projectId))
      .groupBy(comments.workItemId);
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  /** GitHub badge counts per item (PRs, branches, commits, deployed). */
  private async devSummaries(projectId: string): Promise<Map<string, DevSummary>> {
    const rows = await this.db
      .select({ itemId: ghLinks.itemId, kind: ghEntities.kind, state: ghEntities.state, n: sql<number>`count(*)::int` })
      .from(ghLinks)
      .innerJoin(ghEntities, eq(ghEntities.id, ghLinks.entityId))
      .innerJoin(workItems, eq(workItems.id, ghLinks.itemId))
      .where(eq(workItems.projectId, projectId))
      .groupBy(ghLinks.itemId, ghEntities.kind, ghEntities.state);
    const out = new Map<string, DevSummary>();
    for (const row of rows) {
      const s = out.get(row.itemId) ?? { prs: 0, openPrs: 0, mergedPrs: 0, branches: 0, commits: 0, deployed: false };
      if (row.kind === "pr") {
        s.prs += row.n;
        if (row.state === "open") s.openPrs += row.n;
        if (row.state === "merged") s.mergedPrs += row.n;
      } else if (row.kind === "branch") s.branches += row.n;
      else if (row.kind === "commit") s.commits += row.n;
      else if (row.kind === "deployment" && row.state === "success") s.deployed = true;
      out.set(row.itemId, s);
    }
    return out;
  }
}
