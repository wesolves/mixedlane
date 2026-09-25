import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import {
  branchNameFor,
  type DevBranch,
  type DevCommit,
  type DevDeployment,
  type DevelopmentInfo,
  type DevPullRequest,
  type GitHubRepoOption,
} from "@mixedlane/shared";
import { AppError } from "../../core/http";
import { JobsService } from "../../core/jobs/jobs.service";
import { ItemsService } from "../work/items.service";
import { ProjectsService } from "../work/projects.service";
import { GitHubClient, GitHubError } from "./client";
import { verifySignature } from "./crypto";
import { GithubEvents, normalizePull, type Ctx, type GhPull, type NormalizedDeploy, type NormalizedPR } from "./github.events";
import { GithubStore, type OrgRepo } from "./github.store";

const WEBHOOK_EVENTS = ["pull_request", "push", "create", "deployment_status", "workflow_run", "release"];
// Look a little further back than the last sync to absorb clock skew and slow API indexing.
const OVERLAP_MS = 10 * 60 * 1000;
const LIVE: Ctx = { silent: false };

type Payload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Turns GitHub API failures into readable 4xx errors for the UI. */
async function gh<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GitHubError) throw new AppError(err.status === 404 ? 404 : 400, err.message);
    throw err;
  }
}

@Injectable()
export class GithubService implements OnModuleInit {
  private readonly logger = new Logger("GitHub");

  constructor(
    private readonly store: GithubStore,
    private readonly events: GithubEvents,
    private readonly jobs: JobsService,
    private readonly projects: ProjectsService,
    private readonly items: ItemsService,
  ) {}

  /** Polling runs as background jobs: a tick fans out one deduped sync job per due repo. */
  onModuleInit() {
    this.jobs.register("github.tick", () => this.tick());
    this.jobs.register("github.sync", async (p) => {
      const repo = await this.store.repo(String(p.repoId));
      if (repo) await this.syncRepo(repo);
    });
    this.jobs.register("github.webhook", async (p) => {
      await this.processWebhook(String(p.event), p.payload as Payload, p.repoIds as string[]);
    });
    this.jobs.every("github.tick", 15_000);
  }

  private async requireClient(orgId: string): Promise<GitHubClient> {
    const client = await this.store.client(orgId);
    if (!client) throw new AppError(400, "Connect GitHub first (Settings → Integrations)");
    return client;
  }

  /* ---------- Connection ---------- */

  connectionInfo(orgId: string) {
    return this.store.connectionInfo(orgId);
  }

  async connect(orgId: string, input: { token: string; apiUrl?: string; publicUrl?: string; pollSeconds?: number }) {
    const apiUrl = input.apiUrl ?? "https://api.github.com";
    const client = new GitHubClient(input.token, apiUrl);
    const { data: user, headers } = await gh(() => client.request<{ login: string; avatar_url: string }>("/user"));
    await this.store.saveConnection(orgId, {
      token: input.token,
      login: user.login,
      avatarUrl: user.avatar_url,
      // Classic tokens report scopes; fine-grained tokens don't.
      scopes: headers.get("x-oauth-scopes"),
      apiUrl,
      publicUrl: input.publicUrl,
      pollSeconds: input.pollSeconds,
    });
    return this.store.connectionInfo(orgId);
  }

  async updateSettings(orgId: string, patch: { publicUrl?: string; pollSeconds?: number }) {
    await this.store.updateSettings(orgId, patch);
    return this.store.connectionInfo(orgId);
  }

  async disconnect(orgId: string) {
    // Best effort: remove webhooks we created while we still have the token.
    const client = await this.store.client(orgId);
    if (client) {
      const removed = new Set<string>(); // a repo linked to several projects shares one hook
      for (const repo of await this.store.listRepos(orgId)) {
        const hookKey = `${repo.fullName.toLowerCase()}#${repo.webhookId}`;
        if (repo.webhookId && !removed.has(hookKey)) {
          removed.add(hookKey);
          await client.delete(`/repos/${repo.fullName}/hooks/${repo.webhookId}`).catch(() => {});
        }
        await this.store.updateRepo(repo.id, { webhookId: null });
      }
    }
    await this.store.deleteConnection(orgId);
  }

  async searchRepos(orgId: string, q: string): Promise<GitHubRepoOption[]> {
    const client = await this.requireClient(orgId);
    type R = { full_name: string; private: boolean; description: string | null; default_branch: string; html_url: string };
    const repos = await gh(() => client.paginate<R>("/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member", 3));
    const needle = q.trim().toLowerCase();
    return repos
      .filter((r) => !needle || r.full_name.toLowerCase().includes(needle))
      .slice(0, 50)
      .map((r) => ({ fullName: r.full_name, private: r.private, description: r.description, defaultBranch: r.default_branch, htmlUrl: r.html_url }));
  }

  /* ---------- Repos ---------- */

  async projectGithub(orgId: string, projectIdOrKey: string) {
    const project = await this.projects.get(orgId, projectIdOrKey);
    const repos = (await this.store.listRepos(orgId, project.id)).map(({ orgId: _o, ...r }) => r);
    return { repos, automation: await this.store.automation(orgId, project.id) };
  }

  async linkRepo(orgId: string, projectIdOrKey: string, fullName: string) {
    const project = await this.projects.get(orgId, projectIdOrKey);
    const client = await this.requireClient(orgId);
    const repo = await gh(() => client.get<{ full_name: string; html_url: string; default_branch: string }>(`/repos/${fullName}`));
    if ((await this.store.listRepos(orgId, project.id)).some((r) => r.fullName.toLowerCase() === repo.full_name.toLowerCase())) {
      throw new AppError(409, `${repo.full_name} is already linked to this project`);
    }
    const linked = await this.store.insertRepo({ orgId, projectId: project.id, fullName: repo.full_name, htmlUrl: repo.html_url, defaultBranch: repo.default_branch });
    if ((await this.store.connectionInfo(orgId)).webhookUrl) await this.registerWebhook(orgId, linked.id).catch(() => {});
    // Backfill history in the background (silent: links only, no automations).
    await this.jobs.enqueue("github.sync", { repoId: linked.id }, { uniqueKey: `github.sync:${linked.id}` });
    const { orgId: _o, ...out } = (await this.store.repo(linked.id))!;
    return out;
  }

  private async ownRepo(orgId: string, repoId: string): Promise<OrgRepo> {
    const repo = await this.store.repo(repoId);
    if (!repo || repo.orgId !== orgId) throw new AppError(404, "Linked repository not found");
    return repo;
  }

  async unlinkRepo(orgId: string, repoId: string) {
    const repo = await this.ownRepo(orgId, repoId);
    // Keep the webhook if another project in this org still uses the same repo.
    const shared = (await this.store.reposByFullName(repo.fullName)).filter((r) => r.id !== repo.id && r.orgId === orgId);
    if (repo.webhookId && !shared.some((r) => r.webhookId === repo.webhookId)) {
      await (await this.store.client(orgId))?.delete(`/repos/${repo.fullName}/hooks/${repo.webhookId}`).catch(() => {});
    }
    await this.store.deleteRepo(repoId);
  }

  async registerWebhook(orgId: string, repoId: string) {
    const repo = await this.ownRepo(orgId, repoId);
    const info = await this.store.connectionInfo(orgId);
    if (!info.webhookUrl) throw new AppError(400, "Set a public URL in GitHub settings first — GitHub can't reach localhost");
    const client = await this.requireClient(orgId);
    // Reuse a hook that already points at us (e.g. same repo linked to another project).
    type Hook = { id: number; config: { url?: string } };
    const hooks = await gh(() => client.get<Hook[]>(`/repos/${repo.fullName}/hooks`));
    let hook = hooks.find((h) => h.config.url === info.webhookUrl);
    hook ??= await gh(() =>
      client.post<Hook>(`/repos/${repo.fullName}/hooks`, {
        name: "web",
        active: true,
        events: WEBHOOK_EVENTS,
        config: { url: info.webhookUrl, content_type: "json", secret: info.webhookSecret, insecure_ssl: "0" },
      }),
    );
    for (const r of await this.store.reposByFullName(repo.fullName)) if (r.orgId === orgId) await this.store.updateRepo(r.id, { webhookId: hook.id });
    const { orgId: _o, ...out } = (await this.store.repo(repoId))!;
    return out;
  }

  async syncProject(orgId: string, projectIdOrKey: string) {
    const project = await this.projects.get(orgId, projectIdOrKey);
    const results = [];
    for (const repo of await this.store.listRepos(orgId, project.id)) {
      try {
        await gh(() => this.syncRepo(repo));
        results.push({ repo: repo.fullName, ok: true });
      } catch (err) {
        results.push({ repo: repo.fullName, ok: false, error: (err as Error).message });
      }
    }
    return results;
  }

  async saveAutomation(orgId: string, projectIdOrKey: string, automation: Parameters<GithubStore["saveAutomation"]>[2]) {
    const project = await this.projects.get(orgId, projectIdOrKey);
    const ids = new Set(project.statuses.map((s) => s.id));
    const refs = [automation.branchCreated, automation.commitPushed, automation.prOpened, automation.prMerged, automation.prClosed, ...automation.deployRules.map((r) => r.status)];
    const bad = refs.find((s) => s && !ids.has(s));
    if (bad) throw new AppError(400, `Unknown status "${bad}"`);
    await this.store.saveAutomation(orgId, project.id, automation);
    return this.store.automation(orgId, project.id);
  }

  /* ---------- Webhooks ---------- */

  /**
   * Verifies the delivery against the secret of every org that linked this repo, then queues it.
   * Returns quickly so GitHub doesn't time out; processing happens in a job.
   */
  async receiveWebhook(event: string, raw: string, signature: string | undefined) {
    let payload: Payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new AppError(400, "Body must be JSON (set content type to application/json)");
    }
    const fullName: string | undefined = payload.repository?.full_name;
    if (!fullName) return { handled: false, repos: 0 };

    const candidates = await this.store.reposByFullName(fullName);
    const verified: string[] = [];
    const orgOk = new Map<string, boolean>();
    for (const repo of candidates) {
      if (!orgOk.has(repo.orgId)) {
        const secret = (await this.store.connectionRow(repo.orgId))?.webhookSecret;
        orgOk.set(repo.orgId, !!secret && verifySignature(secret, raw, signature));
      }
      if (orgOk.get(repo.orgId)) verified.push(repo.id);
    }
    // Always verify before doing anything — including answering pings.
    if (candidates.length && !verified.length) throw new AppError(401, "Invalid signature");
    if (event === "ping") return { handled: true, repos: verified.length };
    if (verified.length) await this.jobs.enqueue("github.webhook", { event, payload, repoIds: verified }, { maxAttempts: 3 });
    return { handled: true, repos: verified.length };
  }

  /** Exposed for tests and the job handler. */
  async processWebhook(event: string, p: Payload, repoIds: string[]) {
    for (const id of repoIds) {
      const repo = await this.store.repo(id);
      if (repo) await this.dispatch(repo, event, p);
    }
  }

  private async dispatch(repo: OrgRepo, event: string, p: Payload) {
    switch (event) {
      case "pull_request":
        return this.events.handlePullRequest(repo, normalizePull(p.pull_request as GhPull), LIVE);
      case "create":
        if (p.ref_type === "branch") await this.events.handleBranch(repo, p.ref, null, LIVE);
        return;
      case "push": {
        const ref: string = p.ref ?? "";
        if (!ref.startsWith("refs/heads/")) return;
        if (p.created) await this.events.handleBranch(repo, ref.slice("refs/heads/".length), p.after ?? null, LIVE);
        for (const c of p.commits ?? []) {
          await this.events.handleCommit(
            repo,
            { sha: c.id, message: c.message, author: c.author?.username ?? c.author?.name ?? null, htmlUrl: c.url, committedAt: c.timestamp },
            LIVE,
          );
        }
        return;
      }
      case "deployment_status": {
        const dep = p.deployment;
        return this.events.handleDeploy(
          repo,
          {
            source: "deployment",
            externalId: String(dep.id),
            name: dep.environment,
            state: p.deployment_status.state,
            sha: dep.sha,
            htmlUrl: p.deployment_status.environment_url || p.deployment_status.target_url || null,
            at: p.deployment_status.created_at ?? dep.created_at,
          },
          LIVE,
        );
      }
      case "workflow_run": {
        const run = p.workflow_run;
        if (p.action !== "completed" || run.head_branch !== repo.defaultBranch) return;
        return this.events.handleDeploy(
          repo,
          {
            source: "workflow",
            externalId: String(run.id),
            name: run.name,
            state: run.conclusion === "success" ? "success" : (run.conclusion ?? "failure"),
            sha: run.head_sha,
            htmlUrl: run.html_url,
            at: run.updated_at ?? run.created_at,
          },
          LIVE,
        );
      }
      case "release": {
        const rel = p.release;
        if (!["published", "released"].includes(p.action) || rel.draft || rel.prerelease) return;
        return this.events.handleDeploy(repo, await this.releaseDeploy(repo, rel), LIVE);
      }
    }
  }

  /** Releases carry a tag, not a SHA — resolve it. */
  private async releaseDeploy(
    repo: OrgRepo,
    rel: { id: number; tag_name: string; html_url: string; published_at: string | null; created_at: string },
  ): Promise<NormalizedDeploy> {
    let sha: string | null = null;
    try {
      const client = await this.store.client(repo.orgId);
      sha = (await client?.get<{ sha: string }>(`/repos/${repo.fullName}/commits/${encodeURIComponent(rel.tag_name)}`))?.sha ?? null;
    } catch {
      sha = null;
    }
    return { source: "release", externalId: String(rel.id), name: rel.tag_name, state: "success", sha, htmlUrl: rel.html_url, at: rel.published_at ?? rel.created_at };
  }

  /* ---------- Polling ---------- */

  /** Enqueues a sync for every repo whose poll interval has elapsed. */
  private async tick() {
    for (const { orgId, pollSeconds } of await this.store.connectedOrgs()) {
      for (const repo of await this.store.listRepos(orgId)) {
        const due = !repo.lastSyncedAt || Date.now() - Date.parse(repo.lastSyncedAt) >= pollSeconds * 1000;
        if (due) await this.jobs.enqueue("github.sync", { repoId: repo.id }, { uniqueKey: `github.sync:${repo.id}`, maxAttempts: 1 });
      }
    }
  }

  async syncRepo(repo: OrgRepo): Promise<void> {
    const client = await this.store.client(repo.orgId);
    if (!client) throw new AppError(400, "GitHub is not connected");
    const ctx: Ctx = { silent: repo.lastSyncedAt === null };
    const since = repo.lastSyncedAt ? new Date(Date.parse(repo.lastSyncedAt) - OVERLAP_MS) : null;
    const startedAt = new Date();
    try {
      await this.syncPulls(client, repo, since, ctx);
      await this.syncBranches(client, repo, ctx);
      await this.syncCommits(client, repo, since, ctx);
      await this.syncDeploys(client, repo, since, ctx);
      await this.store.updateRepo(repo.id, { lastSyncedAt: startedAt, lastError: null });
      await this.store.setConnectionError(repo.orgId, null);
    } catch (err) {
      const msg = (err as Error).message;
      await this.store.updateRepo(repo.id, { lastError: msg });
      if (/401/.test(msg)) await this.store.setConnectionError(repo.orgId, msg);
      throw err;
    }
  }

  private async syncPulls(client: GitHubClient, repo: OrgRepo, since: Date | null, ctx: Ctx) {
    const pulls = await client.paginate<GhPull>(`/repos/${repo.fullName}/pulls?state=all&sort=updated&direction=desc&per_page=50`, since ? 2 : 1);
    for (const p of pulls.reverse()) {
      if (since && Date.parse(p.updated_at) < since.getTime()) continue;
      await this.events.handlePullRequest(repo, normalizePull(p), ctx);
    }
  }

  private async syncBranches(client: GitHubClient, repo: OrgRepo, ctx: Ctx) {
    const branches = await client.paginate<{ name: string; commit: { sha: string } }>(`/repos/${repo.fullName}/branches?per_page=100`, 3);
    for (const b of branches) await this.events.handleBranch(repo, b.name, b.commit.sha, ctx);
  }

  private async syncCommits(client: GitHubClient, repo: OrgRepo, since: Date | null, ctx: Ctx) {
    type C = { sha: string; html_url: string; author: { login: string } | null; commit: { message: string; author: { name: string; date: string } | null } };
    const sinceParam = since ? `&since=${since.toISOString()}` : "";
    const commits = await client.get<C[]>(`/repos/${repo.fullName}/commits?sha=${encodeURIComponent(repo.defaultBranch)}&per_page=${since ? 100 : 30}${sinceParam}`);
    for (const c of commits.reverse()) {
      await this.events.handleCommit(
        repo,
        { sha: c.sha, message: c.commit.message, author: c.author?.login ?? c.commit.author?.name ?? null, htmlUrl: c.html_url, committedAt: c.commit.author?.date ?? new Date().toISOString() },
        ctx,
      );
    }
  }

  private async syncDeploys(client: GitHubClient, repo: OrgRepo, since: Date | null, ctx: Ctx) {
    // Only spend API calls on sources that some rule cares about.
    const rules = (await this.store.automation(repo.orgId, repo.projectId)).deployRules;
    const wants = (s: string) => rules.some((r) => r.source === s);

    if (wants("deployment")) {
      const deps = await client.get<{ id: number; sha: string; environment: string; created_at: string }[]>(`/repos/${repo.fullName}/deployments?per_page=20`);
      for (const dep of deps.reverse()) {
        const known = await this.store.findEntity(repo.id, "deployment", `deployment:${dep.id}`);
        if (known?.state === "success") continue;
        if (since && !known && Date.parse(dep.created_at) < since.getTime()) continue;
        const [latest] = await client.get<{ state: string; environment_url?: string; target_url?: string; created_at: string }[]>(
          `/repos/${repo.fullName}/deployments/${dep.id}/statuses?per_page=1`,
        );
        if (!latest) continue;
        await this.events.handleDeploy(
          repo,
          { source: "deployment", externalId: String(dep.id), name: dep.environment, state: latest.state, sha: dep.sha, htmlUrl: latest.environment_url || latest.target_url || null, at: latest.created_at },
          ctx,
        );
      }
    }

    if (wants("workflow")) {
      const created = since ? `&created=%3E%3D${since.toISOString()}` : "";
      const { workflow_runs: runs } = await client.get<{
        workflow_runs: { id: number; name: string; head_sha: string; conclusion: string | null; html_url: string; updated_at: string }[];
      }>(`/repos/${repo.fullName}/actions/runs?branch=${encodeURIComponent(repo.defaultBranch)}&status=completed&per_page=30${created}`);
      for (const run of runs.reverse()) {
        await this.events.handleDeploy(
          repo,
          { source: "workflow", externalId: String(run.id), name: run.name, state: run.conclusion === "success" ? "success" : (run.conclusion ?? "failure"), sha: run.head_sha, htmlUrl: run.html_url, at: run.updated_at },
          ctx,
        );
      }
    }

    if (wants("release")) {
      const releases = await client.get<
        { id: number; tag_name: string; html_url: string; draft: boolean; prerelease: boolean; published_at: string | null; created_at: string }[]
      >(`/repos/${repo.fullName}/releases?per_page=10`);
      for (const rel of releases.reverse()) {
        if (rel.draft || rel.prerelease) continue;
        if (await this.store.findEntity(repo.id, "deployment", `release:${rel.id}`)) continue;
        await this.events.handleDeploy(repo, await this.releaseDeploy(repo, rel), ctx);
      }
    }
  }

  /* ---------- Items ---------- */

  async developmentInfo(orgId: string, itemId: string): Promise<DevelopmentInfo> {
    const item = await this.items.get(orgId, itemId);
    const repos = (await this.store.listRepos(orgId, item.projectId)).map((r) => ({ id: r.id, fullName: r.fullName, defaultBranch: r.defaultBranch, htmlUrl: r.htmlUrl }));
    const info: DevelopmentInfo = { repos, branches: [], commits: [], pullRequests: [], deployments: [], suggestedBranch: branchNameFor(item.key, item.title) };
    for (const { entity: e, fullName } of await this.store.entitiesForItem(orgId, itemId)) {
      const data = e.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (e.kind === "pr") {
        const pr = data as NormalizedPR;
        info.pullRequests.push({
          id: e.id, repo: fullName, number: pr.number, title: pr.title, state: pr.state, draft: pr.draft,
          author: pr.author, authorAvatar: pr.authorAvatar, htmlUrl: pr.htmlUrl, headRef: pr.headRef, baseRef: pr.baseRef, updatedAt: pr.updatedAt,
        } satisfies DevPullRequest);
      } else if (e.kind === "branch") {
        info.branches.push({ id: e.id, repo: fullName, name: data.name, htmlUrl: data.htmlUrl, createdAt: e.occurredAt.toISOString() } satisfies DevBranch);
      } else if (e.kind === "commit") {
        info.commits.push({ id: e.id, repo: fullName, sha: data.sha, message: data.message, author: data.author, htmlUrl: data.htmlUrl, committedAt: data.committedAt } satisfies DevCommit);
      } else if (e.kind === "deployment") {
        const d = data as NormalizedDeploy;
        info.deployments.push({ id: e.id, repo: fullName, source: d.source, name: d.name, state: e.state ?? "", htmlUrl: d.htmlUrl, sha: d.sha, at: d.at } satisfies DevDeployment);
      }
    }
    return info;
  }

  async createBranch(orgId: string, itemId: string, input: { repoId: string; name: string; from?: string }) {
    const item = await this.items.get(orgId, itemId);
    const repo = await this.store.repo(input.repoId);
    if (!repo || repo.orgId !== orgId || repo.projectId !== item.projectId) throw new AppError(404, "Repository is not linked to this project");
    const client = await this.requireClient(orgId);
    const from = input.from || repo.defaultBranch;
    const base = await gh(() => client.get<{ object: { sha: string } }>(`/repos/${repo.fullName}/git/ref/heads/${encodeURIComponent(from)}`));
    await gh(() => client.post(`/repos/${repo.fullName}/git/refs`, { ref: `refs/heads/${input.name}`, sha: base.object.sha }));
    // Process right away so the item moves without waiting for a webhook or poll.
    await this.events.handleBranch(repo, input.name, base.object.sha, LIVE);
    return this.developmentInfo(orgId, itemId);
  }
}
