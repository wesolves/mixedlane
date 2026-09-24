import { Injectable, Logger } from "@nestjs/common";
import { extractItemKeys, type DeploySource, type GitTrigger, type PrState } from "@flowboard/shared";
import type { Actor } from "../../core/context";
import { CommentsService } from "../work/comments.service";
import { ItemsService, type ItemRow } from "../work/items.service";
import { ProjectsService, type ProjectRow } from "../work/projects.service";
import { GithubStore, type EntityRow, type OrgRepo } from "./github.store";

/**
 * One processor for everything GitHub tells us, whether it arrives by webhook or by polling.
 * Each entity's last known state is stored, so an automation fires only on a real transition
 * (open → merged, pending → success, first sighting of a branch…) and never twice.
 */
export interface Ctx {
  /** Backfill (first sync of a repo): record links but don't run automations. */
  silent: boolean;
}

export interface NormalizedPR {
  number: number;
  title: string;
  body: string | null;
  state: PrState;
  draft: boolean;
  author: string | null;
  authorAvatar: string | null;
  htmlUrl: string;
  headRef: string;
  baseRef: string;
  headSha: string | null;
  mergeSha: string | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
}

/** Shape shared by the REST API and webhook payloads. */
export interface GhPull {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  draft?: boolean;
  merged?: boolean;
  merged_at: string | null;
  merge_commit_sha: string | null;
  html_url: string;
  user: { login: string; avatar_url: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  created_at: string;
  updated_at: string;
}

export const normalizePull = (p: GhPull): NormalizedPR => ({
  number: p.number,
  title: p.title,
  body: p.body,
  state: p.merged || p.merged_at ? "merged" : p.state,
  draft: !!p.draft,
  author: p.user?.login ?? null,
  authorAvatar: p.user?.avatar_url ?? null,
  htmlUrl: p.html_url,
  headRef: p.head.ref,
  baseRef: p.base.ref,
  headSha: p.head.sha,
  mergeSha: p.merged_at ? p.merge_commit_sha : null,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
  mergedAt: p.merged_at,
});

export interface NormalizedCommit {
  sha: string;
  message: string;
  author: string | null;
  htmlUrl: string;
  committedAt: string;
}

export interface NormalizedDeploy {
  source: DeploySource;
  externalId: string;
  /** Environment, workflow name or release tag. */
  name: string;
  state: string;
  sha: string | null;
  htmlUrl: string | null;
  at: string;
}

const PR_TRIGGER = { open: "prOpened", merged: "prMerged", closed: "prClosed" } as const;
const PR_VERB = { open: "opened", merged: "merged", closed: "closed" } as const;
const DEPLOY_LABEL: Record<DeploySource, (n: string) => string> = {
  deployment: (n) => `deployed to ${n}`,
  workflow: (n) => `workflow “${n}” succeeded`,
  release: (n) => `release ${n} published`,
};

const integration = (name: string): Actor => ({ type: "integration", id: null, name });
const globToRegex = (glob: string) =>
  new RegExp(`^${glob.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
const normalize = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "_");
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

@Injectable()
export class GithubEvents {
  private readonly logger = new Logger("GithubEvents");

  constructor(
    private readonly store: GithubStore,
    private readonly projects: ProjectsService,
    private readonly items: ItemsService,
    private readonly comments: CommentsService,
  ) {}

  /* ---------- Key → item resolution ---------- */

  async itemIdsFromText(repo: OrgRepo, texts: (string | null | undefined)[]): Promise<string[]> {
    const project = await this.projects.get(repo.orgId, repo.projectId);
    const keys = new Set<string>();
    for (const t of texts) for (const k of extractItemKeys(t ?? "", [project])) keys.add(k);
    return this.store.itemIdsByKeys(repo.orgId, project.id, [...keys]);
  }

  /* ---------- Pull requests ---------- */

  async handlePullRequest(repo: OrgRepo, pr: NormalizedPR, ctx: Ctx) {
    const { body: _body, ...data } = pr;
    const { entity, prevState } = await this.store.upsertEntity(repo, "pr", String(pr.number), pr.state, { ...data }, pr.createdAt);
    const newlyLinked = await this.store.linkEntity(entity.id, await this.itemIdsFromText(repo, [pr.title, pr.body, pr.headRef]));
    if (ctx.silent) return;
    // State changed → every linked item follows. Same state → only items that just got linked
    // (e.g. someone added "APP-0012" to the PR title later).
    const targets = prevState !== pr.state ? await this.store.linkedItemIds(entity.id) : newlyLinked;
    await this.applyTrigger(repo, targets, PR_TRIGGER[pr.state], `GitHub · PR #${pr.number} ${PR_VERB[pr.state]}`);
  }

  /* ---------- Branches ---------- */

  async handleBranch(repo: OrgRepo, name: string, sha: string | null, ctx: Ctx) {
    const itemIds = await this.itemIdsFromText(repo, [name]);
    if (!itemIds.length) return; // only track branches that mention an item
    const htmlUrl = `${repo.htmlUrl}/tree/${encodeURIComponent(name).replace(/%2F/g, "/")}`;
    const { entity, prevState } = await this.store.upsertEntity(repo, "branch", name, "active", { name, sha, htmlUrl }, new Date().toISOString());
    const newlyLinked = await this.store.linkEntity(entity.id, itemIds);
    if (ctx.silent) return;
    const targets = prevState === undefined ? itemIds : newlyLinked;
    await this.applyTrigger(repo, targets, "branchCreated", `GitHub · branch ${name}`);
  }

  /* ---------- Commits ---------- */

  async handleCommit(repo: OrgRepo, c: NormalizedCommit, ctx: Ctx) {
    const itemIds = await this.itemIdsFromText(repo, [c.message]);
    if (!itemIds.length) return;
    if (await this.store.findEntity(repo.id, "commit", c.sha)) return; // commits are immutable; process once
    const { entity } = await this.store.upsertEntity(repo, "commit", c.sha, null, { ...c }, c.committedAt);
    await this.store.linkEntity(entity.id, itemIds);
    if (ctx.silent) return;
    const label = `GitHub · commit ${c.sha.slice(0, 7)}`;
    await this.applyTrigger(repo, itemIds, "commitPushed", label);
    await this.applySmartCommit(repo, itemIds, c.message, c.author ?? "GitHub", label);
  }

  /* ---------- Deploys (deployments, workflow runs, releases) ---------- */

  async handleDeploy(repo: OrgRepo, d: NormalizedDeploy, ctx: Ctx) {
    const { entity, prevState } = await this.store.upsertEntity(repo, "deployment", `${d.source}:${d.externalId}`, d.state, { ...d }, d.at);
    if (d.state !== "success" || prevState === "success" || !d.sha) return;
    const itemIds = await this.itemsIncludedIn(repo, entity, d);
    await this.store.linkEntity(entity.id, itemIds);
    if (ctx.silent) return;
    await this.applyDeployRules(repo, itemIds, d.source, d.name, `GitHub · ${DEPLOY_LABEL[d.source](d.name)}`);
  }

  /**
   * Which items shipped in this deploy? Everything between the previous successful deploy of the
   * same environment/workflow/release line and this SHA. With no previous deploy, fall back to
   * merged PRs whose merge commit is an ancestor of this SHA.
   */
  private async itemsIncludedIn(repo: OrgRepo, entity: EntityRow, d: NormalizedDeploy): Promise<string[]> {
    const client = await this.store.client(repo.orgId);
    const sameLine = (await this.store.previousEntities(repo.id, "deployment", entity.occurredAt)).filter((e) => {
      const data = e.data as unknown as NormalizedDeploy;
      return e.id !== entity.id && e.state === "success" && data.source === d.source && (d.source === "release" || data.name === d.name) && data.sha;
    });
    const prevSha = sameLine.length ? (sameLine[0].data as unknown as NormalizedDeploy).sha : null;

    const shas = new Set<string>([d.sha!]);
    const messages: string[] = [];
    if (client && prevSha && prevSha !== d.sha) {
      try {
        const cmp = await client.get<{ commits: { sha: string; commit: { message: string } }[] }>(`/repos/${repo.fullName}/compare/${prevSha}...${d.sha}`);
        for (const c of cmp.commits) {
          shas.add(c.sha);
          messages.push(c.commit.message);
        }
      } catch {
        /* fall through with just the head SHA */
      }
    } else if (client && !prevSha) {
      const merged = (await this.store.previousEntities(repo.id, "pr", new Date(Date.now() + 1000)))
        .map((e) => e.data as unknown as NormalizedPR)
        .filter((p) => p.state === "merged" && p.mergeSha)
        .slice(0, 25);
      for (const pr of merged) {
        try {
          const cmp = await client.get<{ status: string }>(`/repos/${repo.fullName}/compare/${pr.mergeSha}...${d.sha}`);
          if (cmp.status === "ahead" || cmp.status === "identical") shas.add(pr.mergeSha!);
        } catch {
          /* unknown commit (e.g. force-pushed away) — skip */
        }
      }
    }
    return [...new Set([...(await this.store.itemsForShas(repo.id, [...shas])), ...(await this.itemIdsFromText(repo, messages))])];
  }

  /* ---------- Automations ---------- */

  /** Moves one item on behalf of GitHub; respects "only forward" unless `force` (smart commits). */
  private async moveTo(repo: OrgRepo, project: ProjectRow, item: ItemRow, statusId: string, actor: string, force = false) {
    if (item.status === statusId) return false;
    const order = project.statuses.map((s) => s.id);
    const target = order.indexOf(statusId);
    if (target < 0) return false;
    if (!force && (await this.store.automation(repo.orgId, project.id)).onlyForward && target < order.indexOf(item.status)) return false;
    await this.items.update(repo.orgId, item.id, { status: statusId }, integration(actor));
    return true;
  }

  private async loadItems(orgId: string, ids: string[]): Promise<ItemRow[]> {
    const out: ItemRow[] = [];
    for (const id of ids) {
      try {
        out.push(await this.items.get(orgId, id));
      } catch {
        /* deleted meanwhile */
      }
    }
    return out;
  }

  private async applyTrigger(repo: OrgRepo, itemIds: string[], trigger: GitTrigger, actor: string) {
    if (!itemIds.length) return;
    const automation = await this.store.automation(repo.orgId, repo.projectId);
    const target = automation[trigger];
    if (!automation.enabled || !target) return;
    const project = await this.projects.get(repo.orgId, repo.projectId);
    for (const item of await this.loadItems(repo.orgId, itemIds)) await this.moveTo(repo, project, item, target, actor);
  }

  private async applyDeployRules(repo: OrgRepo, itemIds: string[], source: DeploySource, name: string, actor: string) {
    if (!itemIds.length) return;
    const automation = await this.store.automation(repo.orgId, repo.projectId);
    if (!automation.enabled) return;
    const project = await this.projects.get(repo.orgId, repo.projectId);
    for (const rule of automation.deployRules) {
      if (rule.source !== source) continue;
      if (rule.match && !globToRegex(rule.match).test(name)) continue;
      // Re-read items each rule so chained rules see the latest status.
      for (const item of await this.loadItems(repo.orgId, itemIds)) await this.moveTo(repo, project, item, rule.status, actor);
    }
  }

  /** "APP-0012 #comment Fixed it #done": comments and explicit moves (may go backwards). */
  private async applySmartCommit(repo: OrgRepo, itemIds: string[], message: string, author: string, actor: string) {
    if (!itemIds.length || !message.includes("#")) return;
    const automation = await this.store.automation(repo.orgId, repo.projectId);
    if (!automation.enabled || !automation.smartCommits) return;
    const project = await this.projects.get(repo.orgId, repo.projectId);
    const commands = [...message.matchAll(/#([a-z][\w-]*)([^#\n]*)/gi)].map((m) => ({ cmd: m[1], arg: m[2].trim() }));
    for (const { cmd, arg } of commands) {
      if (cmd.toLowerCase() === "comment") {
        if (!arg) continue;
        for (const id of itemIds) await this.comments.add(repo.orgId, id, `<p>${escapeHtml(arg)}</p>`, integration(author));
        continue;
      }
      const status = project.statuses.find((s) => normalize(s.id) === normalize(cmd) || normalize(s.name) === normalize(cmd));
      if (!status) continue;
      for (const item of await this.loadItems(repo.orgId, itemIds)) await this.moveTo(repo, project, item, status.id, actor, true);
    }
  }
}
