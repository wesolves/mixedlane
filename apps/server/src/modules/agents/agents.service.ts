import { randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  AGENT_PERMISSIONS,
  type Agent,
  type AgentGrant,
  type AgentPermission,
  type ApiKeyInfo,
  type CreatedApiKey,
} from "@flowboard/shared";
import type { z } from "zod";
import type { agentCreateSchema, agentGrantSchema, agentUpdateSchema, apiKeyCreateSchema } from "@flowboard/shared";
import type { RequestContext } from "../../core/context";
import { DB, type Db } from "../../core/database/database";
import { activity, agents, apiKeys, orgs, projectAccess, projects, users, workItems } from "../../core/database/schema";
import { EventBus } from "../../core/events";
import { AppError, notFound } from "../../core/http";
import { sha256 } from "../auth/crypto";

type AgentRow = typeof agents.$inferSelect;
type KeyRow = typeof apiKeys.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** fb_<12 hex prefix>_<43 chars of base64url secret> */
const KEY_FORMAT = /^(fb_[0-9a-f]{12})_[A-Za-z0-9_-]{43}$/;
const TOUCH_EVERY_MS = 60_000;

const iso = (d: Date | null) => d?.toISOString() ?? null;

export const toKeyDto = (k: KeyRow): ApiKeyInfo => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  createdAt: k.createdAt.toISOString(),
  lastUsedAt: iso(k.lastUsedAt),
  expiresAt: iso(k.expiresAt),
  revokedAt: iso(k.revokedAt),
});

/** Is this bearer token an API key (as opposed to a session JWT)? */
export const isApiKey = (token: string) => token.startsWith("fb_");

/**
 * AI agents: org-scoped principals that authenticate with API keys. They see only projects they
 * were explicitly granted, limited to the permissions toggled on for them, and every change they
 * make is attributed to them (activity, comments, realtime toasts).
 */
@Injectable()
export class AgentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly events: EventBus,
  ) {}

  /* ---------- Authentication ---------- */

  /**
   * Verifies an API key and builds the agent's RequestContext. Keys are stored as SHA-256 hashes
   * (they're high-entropy random secrets, so a fast hash is appropriate) and compared in constant time.
   */
  async authenticate(token: string): Promise<RequestContext | null> {
    const prefix = KEY_FORMAT.exec(token)?.[1];
    if (!prefix) return null;
    const [row] = await this.db
      .select({ key: apiKeys, agent: agents, orgSlug: orgs.slug })
      .from(apiKeys)
      .innerJoin(agents, eq(agents.id, apiKeys.agentId))
      .innerJoin(orgs, eq(orgs.id, apiKeys.orgId))
      .where(eq(apiKeys.prefix, prefix));
    if (!row) return null;
    const expected = Buffer.from(row.key.keyHash, "hex");
    const actual = Buffer.from(sha256(token), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const now = new Date();
    if (row.key.revokedAt || (row.key.expiresAt && row.key.expiresAt <= now) || row.agent.disabledAt) return null;

    // Record usage, at most once a minute per key.
    if (!row.key.lastUsedAt || now.getTime() - row.key.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      await this.db
        .update(apiKeys)
        .set({ lastUsedAt: now })
        .where(and(eq(apiKeys.id, row.key.id), or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, new Date(now.getTime() - TOUCH_EVERY_MS)))));
    }
    return {
      orgId: row.agent.orgId,
      orgSlug: row.orgSlug,
      // Agents hold no org-level permissions except, when allowed, creating projects;
      // everything else comes from project grants.
      orgRole: "guest",
      orgPermissions: row.agent.canCreateProjects ? ["project.create"] : [],
      userId: null,
      agent: {
        id: row.agent.id,
        keyId: row.key.id,
        name: row.agent.name,
        docAccess: row.agent.docAccess,
        planningMode: row.agent.planningMode,
        canCreateProjects: row.agent.canCreateProjects,
      },
      actor: { type: "agent", id: row.agent.id, name: row.agent.name },
    };
  }

  /* ---------- Management ---------- */

  private async row(ctx: RequestContext, id: string): Promise<AgentRow> {
    if (!UUID.test(id)) throw notFound("Agent");
    const [a] = await this.db.select().from(agents).where(and(eq(agents.orgId, ctx.orgId), eq(agents.id, id)));
    if (!a) throw notFound("Agent");
    return a;
  }

  private async toDtos(list: AgentRow[]): Promise<Agent[]> {
    if (!list.length) return [];
    const ids = list.map((a) => a.id);
    const creatorIds = list.map((a) => a.createdBy).filter((x): x is string => !!x);
    const [keys, grants, creators] = await Promise.all([
      this.db.select().from(apiKeys).where(inArray(apiKeys.agentId, ids)).orderBy(desc(apiKeys.createdAt)),
      this.db
        .select({ agentId: projectAccess.principalId, projectId: projects.id, projectKey: projects.key, projectName: projects.name, permissions: projectAccess.permissions })
        .from(projectAccess)
        .innerJoin(projects, eq(projects.id, projectAccess.projectId))
        .where(and(eq(projectAccess.principalType, "agent"), inArray(projectAccess.principalId, ids))),
      creatorIds.length ? this.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, creatorIds)) : [],
    ]);
    return list.map((a) => {
      const mine = keys.filter((k) => k.agentId === a.id);
      const used = mine.map((k) => k.lastUsedAt).filter((d): d is Date => !!d);
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        docAccess: a.docAccess,
        planningMode: a.planningMode,
        canCreateProjects: a.canCreateProjects,
        disabled: !!a.disabledAt,
        createdAt: a.createdAt.toISOString(),
        createdByName: creators.find((c) => c.id === a.createdBy)?.name ?? null,
        lastUsedAt: used.length ? new Date(Math.max(...used.map((d) => d.getTime()))).toISOString() : null,
        keys: mine.map(toKeyDto),
        grants: grants
          .filter((g) => g.agentId === a.id)
          .map<AgentGrant>((g) => ({
            projectId: g.projectId,
            projectKey: g.projectKey,
            projectName: g.projectName,
            permissions: (g.permissions ?? [...AGENT_PERMISSIONS]).filter((p): p is AgentPermission => (AGENT_PERMISSIONS as readonly string[]).includes(p)),
          }))
          .sort((x, y) => x.projectKey.localeCompare(y.projectKey)),
      };
    });
  }

  async list(ctx: RequestContext): Promise<Agent[]> {
    return this.toDtos(await this.db.select().from(agents).where(eq(agents.orgId, ctx.orgId)).orderBy(agents.name));
  }

  async get(ctx: RequestContext, id: string): Promise<Agent> {
    return (await this.toDtos([await this.row(ctx, id)]))[0];
  }

  async create(ctx: RequestContext, input: z.output<typeof agentCreateSchema>, reuseSecret?: string): Promise<{ agent: Agent; key: CreatedApiKey }> {
    const [a] = await this.db
      .insert(agents)
      .values({ orgId: ctx.orgId, name: input.name, description: input.description, docAccess: input.docAccess, createdBy: ctx.userId })
      .returning();
    const key = await this.createKey(ctx, a.id, { name: "Default key" }, reuseSecret);
    return { agent: await this.get(ctx, a.id), key };
  }

  async update(ctx: RequestContext, id: string, patch: z.output<typeof agentUpdateSchema>): Promise<Agent> {
    const a = await this.row(ctx, id);
    const { disabled, ...rest } = patch;
    await this.db
      .update(agents)
      .set({ ...rest, ...(disabled === undefined ? {} : { disabledAt: disabled ? (a.disabledAt ?? new Date()) : null }) })
      .where(eq(agents.id, id));
    return this.get(ctx, id);
  }

  async remove(ctx: RequestContext, id: string) {
    await this.row(ctx, id);
    // Grants aren't foreign-keyed (principal ids are polymorphic), so clear them explicitly.
    const granted = await this.db
      .delete(projectAccess)
      .where(and(eq(projectAccess.principalType, "agent"), eq(projectAccess.principalId, id)))
      .returning({ projectId: projectAccess.projectId });
    await this.db.delete(agents).where(eq(agents.id, id));
    for (const g of granted) this.events.emit("project", { orgId: ctx.orgId, projectId: g.projectId, action: "access", actor: ctx.actor });
  }

  /* ---------- Keys ---------- */

  /**
   * Issues a new key. `reuseSecret` is for development seeding only: it keeps the demo agent's key
   * stable across resets so MCP client configs keep working.
   */
  async createKey(ctx: RequestContext, agentId: string, input: z.output<typeof apiKeyCreateSchema>, reuseSecret?: string): Promise<CreatedApiKey> {
    await this.row(ctx, agentId);
    const reused = reuseSecret ? KEY_FORMAT.exec(reuseSecret) : null;
    const prefix = reused?.[1] ?? `fb_${randomBytes(6).toString("hex")}`;
    const secret = reused ? reuseSecret! : `${prefix}_${randomBytes(32).toString("base64url")}`;
    const [k] = await this.db
      .insert(apiKeys)
      .values({
        orgId: ctx.orgId,
        agentId,
        name: input.name,
        prefix,
        keyHash: sha256(secret),
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
      })
      .returning();
    return { key: toKeyDto(k), secret };
  }

  async revokeKey(ctx: RequestContext, agentId: string, keyId: string) {
    await this.row(ctx, agentId);
    if (!UUID.test(keyId)) throw notFound("Key");
    const [k] = await this.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.agentId, agentId), isNull(apiKeys.revokedAt)))
      .returning();
    if (!k) throw notFound("Key");
    return toKeyDto(k);
  }

  /* ---------- Project access ---------- */

  /** Sets what the agent may do in a project (an empty list removes its access). */
  async setGrant(ctx: RequestContext, agentId: string, input: z.output<typeof agentGrantSchema>): Promise<Agent> {
    await this.row(ctx, agentId);
    const [project] = await this.db.select({ id: projects.id }).from(projects).where(and(eq(projects.orgId, ctx.orgId), eq(projects.id, input.projectId)));
    if (!project) throw notFound("Project");
    if (!input.permissions.length) {
      await this.db
        .delete(projectAccess)
        .where(and(eq(projectAccess.projectId, project.id), eq(projectAccess.principalType, "agent"), eq(projectAccess.principalId, agentId)));
    } else {
      // Base role "editor" (never admin); the permission list narrows it.
      await this.db
        .insert(projectAccess)
        .values({ projectId: project.id, principalType: "agent", principalId: agentId, role: "editor", permissions: input.permissions })
        .onConflictDoUpdate({
          target: [projectAccess.projectId, projectAccess.principalType, projectAccess.principalId],
          set: { role: "editor", permissions: input.permissions },
        });
    }
    this.events.emit("project", { orgId: ctx.orgId, projectId: project.id, action: "access", actor: ctx.actor });
    return this.get(ctx, agentId);
  }

  /** What the agent has done recently (for its settings page). */
  async activity(ctx: RequestContext, agentId: string, limit = 50) {
    await this.row(ctx, agentId);
    const rows = await this.db
      .select({ a: activity, key: workItems.key, type: workItems.type, title: workItems.title, projectKey: projects.key })
      .from(activity)
      .innerJoin(workItems, eq(workItems.id, activity.workItemId))
      .innerJoin(projects, eq(projects.id, workItems.projectId))
      .where(and(eq(activity.orgId, ctx.orgId), eq(activity.actorType, "agent"), eq(activity.actorId, agentId)))
      .orderBy(desc(activity.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.a.id,
      action: r.a.action,
      field: r.a.field ?? null,
      from: r.a.fromValue ?? null,
      to: r.a.toValue ?? null,
      createdAt: r.a.createdAt.toISOString(),
      item: { key: r.key, type: r.type, title: r.title, projectKey: r.projectKey },
    }));
  }

  /** Key still valid? (used by the socket gateway's periodic recheck) */
  async keyActive(keyId: string): Promise<boolean> {
    const [k] = await this.db
      .select({ revokedAt: apiKeys.revokedAt, expiresAt: apiKeys.expiresAt, disabledAt: agents.disabledAt })
      .from(apiKeys)
      .innerJoin(agents, eq(agents.id, apiKeys.agentId))
      .where(eq(apiKeys.id, keyId));
    return !!k && !k.revokedAt && !k.disabledAt && (!k.expiresAt || k.expiresAt > new Date());
  }

  assertManageable(ctx: RequestContext) {
    if (!ctx.orgPermissions.includes("agent.manage")) throw new AppError(403, "Only organization admins can manage AI agents");
  }
}
