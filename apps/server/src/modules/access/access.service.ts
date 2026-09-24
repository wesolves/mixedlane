import { Global, Inject, Injectable, Module } from "@nestjs/common";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  AGENT_PERMISSIONS,
  ORG_ROLE_PERMISSIONS,
  PROJECT_ROLE_PERMISSIONS,
  PROJECT_ROLE_RANK,
  type OrgPermission,
  type ProjectAccessInfo,
  type ProjectAccessOverview,
  type ProjectPermission,
  type ProjectRole,
} from "@flowboard/shared";
import type { RequestContext } from "../../core/context";
import { DB, type Db } from "../../core/database/database";
import { agents, orgMembers, orgs, projectAccess, projects, teamMembers, teams, users, workItems } from "../../core/database/schema";
import { AppError, notFound } from "../../core/http";
import { EventBus } from "../../core/events";

type ProjectRow = typeof projects.$inferSelect;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tells agents exactly which setting would allow what they tried (instead of a bare "denied"). */
function agentHint(ctx: RequestContext, what: string) {
  return ctx.agent ? ` An org owner/admin can allow it in Flowboard → Settings → AI agents → ${ctx.agent.name} → ${what}.` : "";
}

export function requireOrg(ctx: RequestContext, permission: OrgPermission) {
  if (ctx.orgPermissions.includes(permission)) return;
  if (ctx.agent && permission === "project.create") {
    throw new AppError(403, `This agent isn't allowed to create projects.${agentHint(ctx, '"Can create projects"')}`);
  }
  throw new AppError(403, `You don't have permission to do that.${agentHint(ctx, "its settings")}`);
}

/**
 * Resolves what the caller may do in a project:
 *   - org owner/admin → project admin everywhere
 *   - otherwise the highest of: direct grant, grants to any of their teams, and — for members on
 *     org-visible projects — the project's default role. Guests only get explicit grants.
 * No access at all is reported as 404 so private projects can't be discovered.
 */
@Injectable()
export class AccessService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly events: EventBus,
  ) {}

  /**
   * A RequestContext for an arbitrary org member (sockets, notification recipients).
   * Returns null when the user isn't a member of the org.
   */
  async contextFor(orgId: string, userId: string): Promise<RequestContext | null> {
    const [row] = await this.db
      .select({ role: orgMembers.role, slug: orgs.slug, name: users.name })
      .from(orgMembers)
      .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
    if (!row) return null;
    return {
      orgId,
      orgSlug: row.slug,
      orgRole: row.role,
      orgPermissions: ORG_ROLE_PERMISSIONS[row.role],
      userId,
      actor: { type: "user", id: userId, name: row.name },
    };
  }

  /** Can `ctx` read this project? (no throw) */
  async canRead(ctx: RequestContext, projectId: string): Promise<boolean> {
    try {
      await this.project(ctx, projectId, "project.read");
      return true;
    } catch {
      return false;
    }
  }

  private async teamIds(ctx: RequestContext): Promise<string[]> {
    if (!ctx.userId) return [];
    const rows = await this.db
      .select({ id: teams.id })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teams.orgId, ctx.orgId), eq(teamMembers.userId, ctx.userId)));
    return rows.map((r) => r.id);
  }

  /** Effective access for many projects at once (used by list endpoints). */
  async resolveMany(ctx: RequestContext, list: ProjectRow[]): Promise<Map<string, ProjectAccessInfo | null>> {
    const out = new Map<string, ProjectAccessInfo | null>();
    const cache = (ctx.accessCache ??= new Map());
    const todo = list.filter((p) => !cache.has(p.id));

    if (todo.length) {
      const elevated = ctx.orgRole === "owner" || ctx.orgRole === "admin";
      const teamIds = elevated ? [] : await this.teamIds(ctx);
      const principals = [
        ...(ctx.agent ? [and(eq(projectAccess.principalType, "agent"), eq(projectAccess.principalId, ctx.agent.id))] : []),
        ...(ctx.userId ? [and(eq(projectAccess.principalType, "user"), eq(projectAccess.principalId, ctx.userId))] : []),
        ...(teamIds.length ? [and(eq(projectAccess.principalType, "team"), inArray(projectAccess.principalId, teamIds))] : []),
      ];
      const grants =
        elevated || !principals.length
          ? []
          : await this.db
              .select({ projectId: projectAccess.projectId, role: projectAccess.role, permissions: projectAccess.permissions })
              .from(projectAccess)
              .where(and(inArray(projectAccess.projectId, todo.map((p) => p.id)), or(...principals)));

      for (const p of todo) {
        // Agents: only explicit grants, narrowed to the permissions toggled on for them.
        if (ctx.agent) {
          const g = grants.find((x) => x.projectId === p.id);
          const allowed = g ? PROJECT_ROLE_PERMISSIONS[g.role].filter((perm) => !g.permissions || g.permissions.includes(perm)) : [];
          cache.set(p.id, g && allowed.includes("project.read") ? { role: g.role, permissions: allowed } : null);
          continue;
        }
        let role: ProjectRole | null = elevated ? "admin" : null;
        const consider = (r: ProjectRole) => {
          if (!role || PROJECT_ROLE_RANK[r] > PROJECT_ROLE_RANK[role]) role = r;
        };
        if (!elevated) {
          if (ctx.orgRole === "member" && p.visibility === "org") consider(p.defaultRole);
          for (const g of grants) if (g.projectId === p.id) consider(g.role);
        }
        cache.set(p.id, role ? { role, permissions: PROJECT_ROLE_PERMISSIONS[role] } : null);
      }
    }
    for (const p of list) out.set(p.id, cache.get(p.id) ?? null);
    return out;
  }

  async resolve(ctx: RequestContext, project: ProjectRow): Promise<ProjectAccessInfo | null> {
    return (await this.resolveMany(ctx, [project])).get(project.id) ?? null;
  }

  /** Loads a project by id or key and asserts a permission. */
  async project(ctx: RequestContext, idOrKey: string, permission: ProjectPermission = "project.read") {
    const match = UUID.test(idOrKey) ? eq(projects.id, idOrKey) : eq(projects.key, idOrKey.toUpperCase());
    const [project] = await this.db.select().from(projects).where(and(eq(projects.orgId, ctx.orgId), match));
    if (!project) {
      // Agents planning a new initiative often reference a project that doesn't exist yet: say how to fix it.
      if (ctx.agent && !UUID.test(idOrKey)) {
        throw new AppError(
          404,
          ctx.agent.canCreateProjects
            ? `Project "${idOrKey.toUpperCase()}" doesn't exist. Create it with the create_project tool, then retry (if your tool list has no create_project, reconnect the Flowboard MCP server to refresh its tools).`
            : `Project "${idOrKey.toUpperCase()}" doesn't exist, and this agent isn't allowed to create projects.${agentHint(ctx, '"Can create projects"')}`,
        );
      }
      throw notFound("Project");
    }
    const access = await this.resolve(ctx, project);
    if (!access) throw notFound("Project");
    if (!access.permissions.includes(permission)) {
      throw new AppError(403, `You don't have permission to do that in project ${project.key} (needs ${permission}).${agentHint(ctx, `Project access → ${project.key}`)}`);
    }
    return { project, access };
  }

  /** Asserts a permission on the project that owns an item. */
  async item(ctx: RequestContext, itemId: string, permission: ProjectPermission) {
    if (!UUID.test(itemId)) throw notFound("Work item");
    const [row] = await this.db
      .select({ projectId: workItems.projectId })
      .from(workItems)
      .where(and(eq(workItems.orgId, ctx.orgId), eq(workItems.id, itemId)));
    if (!row) throw notFound("Work item");
    try {
      return await this.project(ctx, row.projectId, permission);
    } catch (err) {
      // Don't reveal that an item exists in a project you can't see.
      if (err instanceof AppError && err.status === 404) throw notFound("Work item");
      throw err;
    }
  }

  /** Ids of every project the caller can read (for search and lists). */
  async readableProjectIds(ctx: RequestContext): Promise<string[]> {
    const all = await this.db.select().from(projects).where(eq(projects.orgId, ctx.orgId));
    const access = await this.resolveMany(ctx, all);
    return all.filter((p) => access.get(p.id)).map((p) => p.id);
  }

  /* ---------- Managing grants ---------- */

  async overview(ctx: RequestContext, projectId: string): Promise<ProjectAccessOverview> {
    const { project } = await this.project(ctx, projectId, "project.read");
    const grants = await this.db.select().from(projectAccess).where(eq(projectAccess.projectId, project.id)).orderBy(asc(projectAccess.createdAt));
    const userIds = grants.filter((g) => g.principalType === "user").map((g) => g.principalId);
    const teamIdList = grants.filter((g) => g.principalType === "team").map((g) => g.principalId);
    const agentIds = grants.filter((g) => g.principalType === "agent").map((g) => g.principalId);
    const [userRows, teamRows, agentRows] = await Promise.all([
      userIds.length ? this.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds)) : [],
      teamIdList.length ? this.db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIdList)) : [],
      agentIds.length ? this.db.select({ id: agents.id, name: agents.name }).from(agents).where(inArray(agents.id, agentIds)) : [],
    ]);
    return {
      visibility: project.visibility,
      defaultRole: project.defaultRole,
      grants: grants.map((g) => {
        const u = userRows.find((x) => x.id === g.principalId);
        const t = teamRows.find((x) => x.id === g.principalId);
        const a = agentRows.find((x) => x.id === g.principalId);
        return {
          id: g.id,
          principalType: g.principalType,
          principalId: g.principalId,
          role: g.role,
          name: u?.name ?? t?.name ?? a?.name ?? "Unknown",
          detail: u?.email ?? (t ? "Team" : a ? "AI agent" : g.principalType),
          ...(a ? { permissions: (g.permissions ?? null) as ProjectPermission[] | null } : {}),
        };
      }),
    };
  }

  async updateSettings(ctx: RequestContext, projectId: string, patch: { visibility?: "org" | "private"; defaultRole?: ProjectRole }) {
    const { project } = await this.project(ctx, projectId, "project.admin");
    await this.db.update(projects).set(patch).where(eq(projects.id, project.id));
    ctx.accessCache?.delete(project.id);
    this.events.emit("project", { orgId: ctx.orgId, projectId: project.id, action: "access", actor: ctx.actor });
    return this.overview(ctx, project.id);
  }

  async grant(ctx: RequestContext, projectId: string, input: { principalType: "user" | "team"; principalId: string; role: ProjectRole }) {
    const { project } = await this.project(ctx, projectId, "project.admin");
    // The principal must belong to this org.
    if (input.principalType === "team") {
      const [t] = await this.db.select({ id: teams.id }).from(teams).where(and(eq(teams.orgId, ctx.orgId), eq(teams.id, input.principalId)));
      if (!t) throw notFound("Team");
    } else {
      const [m] = await this.db
        .select({ id: orgMembers.userId })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, ctx.orgId), eq(orgMembers.userId, input.principalId)));
      if (!m) throw notFound("Member");
    }
    await this.db
      .insert(projectAccess)
      .values({ projectId: project.id, ...input })
      .onConflictDoUpdate({ target: [projectAccess.projectId, projectAccess.principalType, projectAccess.principalId], set: { role: input.role } });
    this.events.emit("project", { orgId: ctx.orgId, projectId: project.id, action: "access", actor: ctx.actor });
    return this.overview(ctx, project.id);
  }

  async revoke(ctx: RequestContext, projectId: string, grantId: string) {
    const { project } = await this.project(ctx, projectId, "project.admin");
    if (!UUID.test(grantId)) throw notFound("Grant");
    await this.db.delete(projectAccess).where(and(eq(projectAccess.projectId, project.id), eq(projectAccess.id, grantId)));
    this.events.emit("project", { orgId: ctx.orgId, projectId: project.id, action: "access", actor: ctx.actor });
    return this.overview(ctx, project.id);
  }

  /** An agent that creates a project gets every agent permission in it. */
  async grantAgentCreator(projectId: string, agentId: string) {
    await this.db
      .insert(projectAccess)
      .values({ projectId, principalType: "agent", principalId: agentId, role: "editor", permissions: [...AGENT_PERMISSIONS] })
      .onConflictDoNothing();
  }

  /** The creator of a project always keeps admin access to it (even if it's private). */
  async grantCreator(projectId: string, userId: string) {
    await this.db
      .insert(projectAccess)
      .values({ projectId, principalType: "user", principalId: userId, role: "admin" })
      .onConflictDoNothing();
  }
}

@Global()
@Module({ providers: [AccessService], exports: [AccessService] })
export class AccessModule {}
