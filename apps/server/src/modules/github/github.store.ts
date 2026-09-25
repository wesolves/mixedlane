import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { defaultAutomation, type GitAutomation, type GitHubConnectionInfo, type LinkedRepo } from "@mixedlane/shared";
import { DB, type Db } from "../../core/database/database";
import { ghEntities, ghLinks, githubConnections, projectRepos, projects, workItems } from "../../core/database/schema";
import { GitHubClient } from "./client";
import { decrypt, encrypt, randomSecret } from "./crypto";

export const WEBHOOK_PATH = "/api/github/webhook";

export type EntityKind = "pr" | "branch" | "commit" | "deployment";
export type EntityRow = typeof ghEntities.$inferSelect;
type RepoRow = typeof projectRepos.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const toLinkedRepo = (r: RepoRow): LinkedRepo => ({
  id: r.id,
  projectId: r.projectId,
  fullName: r.fullName,
  htmlUrl: r.htmlUrl,
  defaultBranch: r.defaultBranch,
  webhookId: r.webhookId,
  lastSyncedAt: iso(r.lastSyncedAt),
  lastError: r.lastError,
  createdAt: r.createdAt.toISOString(),
});

/** Linked repos carry their org so event processing is always tenant-scoped. */
export type OrgRepo = LinkedRepo & { orgId: string };
const toOrgRepo = (r: RepoRow): OrgRepo => ({ ...toLinkedRepo(r), orgId: r.orgId });

/** All GitHub persistence. Every read/write is scoped by org. */
@Injectable()
export class GithubStore {
  constructor(@Inject(DB) private readonly db: Db) {}

  /* ---------- Connection (one per org) ---------- */

  async connectionRow(orgId: string) {
    const [row] = await this.db.select().from(githubConnections).where(eq(githubConnections.orgId, orgId));
    return row;
  }

  async connectionInfo(orgId: string): Promise<GitHubConnectionInfo> {
    const row = await this.connectionRow(orgId);
    const publicUrl = row?.publicUrl ?? "";
    return {
      connected: !!row,
      login: row?.login ?? null,
      avatarUrl: row?.avatarUrl ?? null,
      apiUrl: row?.apiUrl ?? "https://api.github.com",
      publicUrl,
      webhookUrl: publicUrl ? `${publicUrl.replace(/\/$/, "")}${WEBHOOK_PATH}` : "",
      webhookSecret: row?.webhookSecret ?? null,
      pollSeconds: row?.pollSeconds ?? 60,
      scopes: row?.scopes ?? null,
      lastError: row?.lastError ?? null,
    };
  }

  async saveConnection(
    orgId: string,
    input: { token: string; login: string; avatarUrl: string | null; scopes: string | null; apiUrl: string; publicUrl?: string; pollSeconds?: number },
  ) {
    const existing = await this.connectionRow(orgId);
    const values = {
      tokenEnc: encrypt(input.token),
      login: input.login,
      avatarUrl: input.avatarUrl,
      scopes: input.scopes,
      apiUrl: input.apiUrl,
      publicUrl: input.publicUrl ?? existing?.publicUrl ?? "",
      pollSeconds: input.pollSeconds ?? existing?.pollSeconds ?? 60,
      lastError: null,
      updatedAt: new Date(),
    };
    await this.db
      .insert(githubConnections)
      .values({ orgId, webhookSecret: existing?.webhookSecret ?? randomSecret(), ...values })
      .onConflictDoUpdate({ target: githubConnections.orgId, set: values });
  }

  async updateSettings(orgId: string, patch: { publicUrl?: string; pollSeconds?: number }) {
    const set: Partial<typeof githubConnections.$inferInsert> = { updatedAt: new Date() };
    if (patch.publicUrl !== undefined) set.publicUrl = patch.publicUrl;
    if (patch.pollSeconds !== undefined) set.pollSeconds = patch.pollSeconds;
    await this.db.update(githubConnections).set(set).where(eq(githubConnections.orgId, orgId));
  }

  async setConnectionError(orgId: string, message: string | null) {
    await this.db.update(githubConnections).set({ lastError: message }).where(eq(githubConnections.orgId, orgId));
  }

  async deleteConnection(orgId: string) {
    await this.db.delete(githubConnections).where(eq(githubConnections.orgId, orgId));
  }

  async client(orgId: string): Promise<GitHubClient | null> {
    const row = await this.connectionRow(orgId);
    return row ? new GitHubClient(decrypt(row.tokenEnc), row.apiUrl) : null;
  }

  async connectedOrgs() {
    return this.db.select({ orgId: githubConnections.orgId, pollSeconds: githubConnections.pollSeconds }).from(githubConnections);
  }

  /* ---------- Linked repos ---------- */

  async listRepos(orgId: string, projectId?: string): Promise<OrgRepo[]> {
    const where = projectId ? and(eq(projectRepos.orgId, orgId), eq(projectRepos.projectId, projectId)) : eq(projectRepos.orgId, orgId);
    return (await this.db.select().from(projectRepos).where(where).orderBy(asc(projectRepos.createdAt))).map(toOrgRepo);
  }

  /** Across all orgs — webhooks identify the repo before the org is known. */
  async reposByFullName(fullName: string): Promise<OrgRepo[]> {
    const rows = await this.db.select().from(projectRepos).where(sql`lower(${projectRepos.fullName}) = lower(${fullName})`);
    return rows.map(toOrgRepo);
  }

  async repo(id: string): Promise<OrgRepo | null> {
    const [row] = await this.db.select().from(projectRepos).where(eq(projectRepos.id, id));
    return row ? toOrgRepo(row) : null;
  }

  async insertRepo(input: { orgId: string; projectId: string; fullName: string; htmlUrl: string; defaultBranch: string }) {
    const [row] = await this.db.insert(projectRepos).values(input).returning();
    return toOrgRepo(row);
  }

  async updateRepo(id: string, patch: { webhookId?: number | null; lastSyncedAt?: Date; lastError?: string | null }) {
    await this.db.update(projectRepos).set(patch).where(eq(projectRepos.id, id));
  }

  async deleteRepo(id: string) {
    await this.db.delete(projectRepos).where(eq(projectRepos.id, id));
  }

  /* ---------- Automation config ---------- */

  async automation(orgId: string, projectId: string): Promise<GitAutomation> {
    const [project] = await this.db.select().from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)));
    if (!project) return defaultAutomation([]);
    const fallback = defaultAutomation(project.statuses);
    const saved = project.gitAutomation;
    if (!saved) return fallback;
    // Drop references to statuses that no longer exist.
    const ids = new Set(project.statuses.map((s) => s.id));
    const valid = (s: string | null | undefined) => (s && ids.has(s) ? s : null);
    return {
      ...fallback,
      ...saved,
      branchCreated: valid(saved.branchCreated),
      commitPushed: valid(saved.commitPushed),
      prOpened: valid(saved.prOpened),
      prMerged: valid(saved.prMerged),
      prClosed: valid(saved.prClosed),
      deployRules: (saved.deployRules ?? []).filter((r) => ids.has(r.status)),
    };
  }

  async saveAutomation(orgId: string, projectId: string, automation: GitAutomation) {
    await this.db.update(projects).set({ gitAutomation: automation }).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)));
  }

  /* ---------- Entities & links ---------- */

  async findEntity(repoId: string, kind: EntityKind, externalId: string): Promise<EntityRow | undefined> {
    const [row] = await this.db
      .select()
      .from(ghEntities)
      .where(and(eq(ghEntities.repoId, repoId), eq(ghEntities.kind, kind), eq(ghEntities.externalId, externalId)));
    return row;
  }

  /** Insert or update; returns the stored row plus the previous state (undefined = new). */
  async upsertEntity(
    repo: OrgRepo,
    kind: EntityKind,
    externalId: string,
    state: string | null,
    data: Record<string, unknown>,
    occurredAt: string,
  ): Promise<{ entity: EntityRow; prevState: string | null | undefined }> {
    // Webhooks, polling and user actions can process the same entity concurrently. Insert-or-lock
    // in one transaction so exactly one caller observes each state transition.
    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(ghEntities)
        .values({ orgId: repo.orgId, repoId: repo.id, kind, externalId, state, data, occurredAt: new Date(occurredAt) })
        .onConflictDoNothing()
        .returning();
      if (inserted) return { entity: inserted, prevState: undefined };

      const [prev] = await tx
        .select()
        .from(ghEntities)
        .where(and(eq(ghEntities.repoId, repo.id), eq(ghEntities.kind, kind), eq(ghEntities.externalId, externalId)))
        .for("update");
      const [entity] = await tx
        .update(ghEntities)
        .set({ state, data, updatedAt: new Date() })
        .where(eq(ghEntities.id, prev.id))
        .returning();
      return { entity, prevState: prev.state };
    });
  }

  /** Links an entity to items; returns only the item ids that were newly linked. */
  async linkEntity(entityId: string, itemIds: string[]): Promise<string[]> {
    if (!itemIds.length) return [];
    const rows = await this.db
      .insert(ghLinks)
      .values(itemIds.map((itemId) => ({ entityId, itemId })))
      .onConflictDoNothing()
      .returning({ itemId: ghLinks.itemId });
    return rows.map((r) => r.itemId);
  }

  async linkedItemIds(entityId: string): Promise<string[]> {
    const rows = await this.db.select({ itemId: ghLinks.itemId }).from(ghLinks).where(eq(ghLinks.entityId, entityId));
    return rows.map((r) => r.itemId);
  }

  async entitiesForItem(orgId: string, itemId: string) {
    return this.db
      .select({ entity: ghEntities, fullName: projectRepos.fullName })
      .from(ghEntities)
      .innerJoin(ghLinks, eq(ghLinks.entityId, ghEntities.id))
      .innerJoin(projectRepos, eq(projectRepos.id, ghEntities.repoId))
      .where(and(eq(ghEntities.orgId, orgId), eq(ghLinks.itemId, itemId)))
      .orderBy(desc(ghEntities.occurredAt));
  }

  async previousEntities(repoId: string, kind: EntityKind, before: Date): Promise<EntityRow[]> {
    return this.db
      .select()
      .from(ghEntities)
      .where(and(eq(ghEntities.repoId, repoId), eq(ghEntities.kind, kind), lt(ghEntities.occurredAt, before)))
      .orderBy(desc(ghEntities.occurredAt))
      .limit(50);
  }

  /** Items linked to commits, or to PRs whose merge/head commit is among the SHAs. */
  async itemsForShas(repoId: string, shas: string[]): Promise<string[]> {
    if (!shas.length) return [];
    const lower = shas.map((s) => s.toLowerCase());
    const rows = await this.db
      .select({ itemId: ghLinks.itemId })
      .from(ghEntities)
      .innerJoin(ghLinks, eq(ghLinks.entityId, ghEntities.id))
      .where(
        and(
          eq(ghEntities.repoId, repoId),
          or(
            and(eq(ghEntities.kind, "commit"), inArray(sql`lower(${ghEntities.externalId})`, lower)),
            and(
              eq(ghEntities.kind, "pr"),
              or(
                inArray(sql`lower(${ghEntities.data}->>'mergeSha')`, lower),
                inArray(sql`lower(${ghEntities.data}->>'headSha')`, lower),
              ),
            ),
          ),
        ),
      );
    return [...new Set(rows.map((r) => r.itemId))];
  }

  async itemIdsByKeys(orgId: string, projectId: string, keys: string[]) {
    if (!keys.length) return [];
    const rows = await this.db
      .select({ id: workItems.id })
      .from(workItems)
      .where(and(eq(workItems.orgId, orgId), eq(workItems.projectId, projectId), inArray(workItems.key, keys)));
    return rows.map((r) => r.id);
  }
}
