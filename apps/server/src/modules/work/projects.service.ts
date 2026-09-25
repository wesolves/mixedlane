import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  DEFAULT_STATUSES,
  ITEM_TYPES,
  TYPE_PLURALS,
  sortTypes,
  type ProjectCreate,
  type ProjectUpdate,
  type StatusDef,
} from "@mixedlane/shared";
import type { RequestContext } from "../../core/context";
import { DB, type Db } from "../../core/database/database";
import { EventBus } from "../../core/events";
import { AccessService, requireOrg } from "../access/access.service";
import { projects, workItems } from "../../core/database/schema";
import { AppError, notFound } from "../../core/http";

export type ProjectRow = typeof projects.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

export const categoryOf = (statuses: StatusDef[], id: string) => statuses.find((s) => s.id === id)?.category ?? "todo";

/** API shape: internal columns stay internal. */
export function toProjectDto(p: ProjectRow) {
  const { gitAutomation: _g, orgId: _o, ...rest } = p;
  return rest;
}

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AccessService,
    private readonly events: EventBus,
  ) {}

  /**
   * Creates a project on behalf of the caller (person or agent): checks project.create, gives the
   * creator access (people: admin; agents: every agent permission) and tells connected clients.
   */
  async createFor(ctx: RequestContext, input: ProjectCreate): Promise<ProjectRow> {
    requireOrg(ctx, "project.create");
    const project = await this.create(ctx.orgId, input);
    if (ctx.userId) await this.access.grantCreator(project.id, ctx.userId);
    if (ctx.agent) await this.access.grantAgentCreator(project.id, ctx.agent.id);
    ctx.accessCache?.delete(project.id);
    this.events.emit("project", { orgId: ctx.orgId, projectId: project.id, action: "updated", actor: ctx.actor });
    return project;
  }

  async list(orgId: string) {
    const all = await this.db.select().from(projects).where(eq(projects.orgId, orgId)).orderBy(asc(projects.createdAt));
    if (!all.length) return [];
    const items = await this.db
      .select({ projectId: workItems.projectId, type: workItems.type, status: workItems.status })
      .from(workItems)
      .where(eq(workItems.orgId, orgId));
    return all.map((p) => {
      // Progress counts work below the top level of the hierarchy (or everything if flat).
      const top = sortTypes(p.itemTypes)[0];
      const mine = items.filter((i) => i.projectId === p.id);
      const work = p.itemTypes.length > 1 ? mine.filter((i) => i.type !== top) : mine;
      const cat = (s: string) => categoryOf(p.statuses, s);
      return {
        ...toProjectDto(p),
        stats: {
          total: work.length,
          done: work.filter((i) => cat(i.status) === "done").length,
          inProgress: work.filter((i) => cat(i.status) === "in_progress").length,
        },
      };
    });
  }

  /** Accepts either the project id or its key (e.g. "APP"). */
  async get(orgId: string, idOrKey: string): Promise<ProjectRow> {
    const match = isUuid(idOrKey) ? eq(projects.id, idOrKey) : eq(projects.key, idOrKey.toUpperCase());
    const [p] = await this.db.select().from(projects).where(and(eq(projects.orgId, orgId), match));
    if (!p) throw notFound("Project");
    return p;
  }

  async create(orgId: string, input: ProjectCreate): Promise<ProjectRow> {
    const key = input.key.toUpperCase();
    const [clash] = await this.db.select({ id: projects.id }).from(projects).where(and(eq(projects.orgId, orgId), eq(projects.key, key)));
    if (clash) throw new AppError(409, `Project code "${key}" is already used`);
    const [row] = await this.db
      .insert(projects)
      .values({
        orgId,
        key,
        name: input.name,
        description: input.description ?? "",
        color: input.color ?? "#6366f1",
        icon: input.icon ?? "lucide:rocket",
        keyDigits: input.keyDigits ?? 4,
        itemTypes: sortTypes(input.itemTypes ?? [...ITEM_TYPES]),
        statuses: input.statuses ?? DEFAULT_STATUSES,
      })
      .returning();
    return row;
  }

  async update(orgId: string, idOrKey: string, patch: ProjectUpdate): Promise<ProjectRow> {
    const current = await this.get(orgId, idOrKey);
    return this.db.transaction(async (tx) => {
      const changes: Partial<ProjectRow> = { ...(patch as Partial<ProjectRow>) };

      if (patch.itemTypes) {
        const removed = current.itemTypes.filter((t) => !patch.itemTypes!.includes(t));
        if (removed.length) {
          const used = await tx
            .select({ type: workItems.type, n: sql<number>`count(*)::int` })
            .from(workItems)
            .where(and(eq(workItems.projectId, current.id), inArray(workItems.type, removed)))
            .groupBy(workItems.type);
          if (used.length) {
            const list = used.map((u) => `${u.n} ${TYPE_PLURALS[u.type].toLowerCase()}`).join(", ");
            throw new AppError(409, `Can't disable types that are in use (${list}). Delete or move those items first.`);
          }
        }
        changes.itemTypes = sortTypes(patch.itemTypes);
      }

      if (patch.statuses) {
        // Items in a removed status move to the first remaining status of the same category.
        const next = patch.statuses;
        for (const old of current.statuses) {
          if (next.some((s) => s.id === old.id)) continue;
          const target = next.find((s) => s.category === old.category) ?? next[0];
          await tx
            .update(workItems)
            .set({ status: target.id })
            .where(and(eq(workItems.projectId, current.id), eq(workItems.status, old.id)));
        }
      }

      const [row] = await tx
        .update(projects)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(projects.id, current.id))
        .returning();
      return row;
    });
  }

  async remove(orgId: string, idOrKey: string) {
    const p = await this.get(orgId, idOrKey);
    await this.db.delete(projects).where(eq(projects.id, p.id));
  }
}
