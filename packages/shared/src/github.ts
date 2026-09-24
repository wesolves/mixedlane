import { z } from "zod";
import type { StatusDef } from "./hierarchy";

/* ---------- Automation config (stored per project) ---------- */

export const DEPLOY_SOURCES = ["deployment", "workflow", "release"] as const;
export type DeploySource = (typeof DEPLOY_SOURCES)[number];

export const DEPLOY_SOURCE_LABELS: Record<DeploySource, string> = {
  deployment: "GitHub Deployment succeeds",
  workflow: "Actions workflow succeeds",
  release: "Release is published",
};

export interface DeployRule {
  id: string;
  source: DeploySource;
  /** Environment name / workflow name / "" for any (releases: "" or "prerelease" to include pre-releases). */
  match: string;
  status: string;
}

export interface GitAutomation {
  enabled: boolean;
  branchCreated: string | null;
  commitPushed: string | null;
  prOpened: string | null;
  prMerged: string | null;
  prClosed: string | null;
  deployRules: DeployRule[];
  /** "APP-0012 #done" / "#comment text" in commit messages. */
  smartCommits: boolean;
  /** Never move an item to a status earlier in the workflow than its current one. */
  onlyForward: boolean;
}

export type GitTrigger = "branchCreated" | "commitPushed" | "prOpened" | "prMerged" | "prClosed";

export const GIT_TRIGGER_LABELS: Record<GitTrigger, string> = {
  branchCreated: "Branch created",
  commitPushed: "Commit pushed",
  prOpened: "Pull request opened",
  prMerged: "Pull request merged",
  prClosed: "Pull request closed without merging",
};

/** Sensible defaults derived from a project's workflow. */
export function defaultAutomation(statuses: StatusDef[]): GitAutomation {
  const inProgress = statuses.filter((s) => s.category === "in_progress");
  const review = inProgress.find((s) => /review|pr/i.test(s.name)) ?? null;
  const done = statuses.find((s) => s.category === "done") ?? null;
  return {
    enabled: true,
    branchCreated: inProgress[0]?.id ?? null,
    commitPushed: null,
    prOpened: review?.id ?? inProgress[0]?.id ?? null,
    prMerged: done?.id ?? null,
    prClosed: null,
    deployRules: [],
    smartCommits: true,
    onlyForward: true,
  };
}

const statusRef = z.string().max(40).nullable();

export const gitAutomationSchema = z.object({
  enabled: z.boolean(),
  branchCreated: statusRef,
  commitPushed: statusRef,
  prOpened: statusRef,
  prMerged: statusRef,
  prClosed: statusRef,
  deployRules: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        source: z.enum(DEPLOY_SOURCES),
        match: z.string().trim().max(100),
        status: z.string().min(1).max(40),
      }),
    )
    .max(20),
  smartCommits: z.boolean(),
  onlyForward: z.boolean(),
});

/* ---------- Connection ---------- */

export const githubConnectSchema = z.object({
  token: z.string().trim().min(10, "Paste a GitHub personal access token"),
  apiUrl: z.string().trim().url().optional(),
  publicUrl: z.string().trim().url().or(z.literal("")).optional(),
  pollSeconds: z.number().int().min(30).max(3600).optional(),
});

export const githubSettingsSchema = z.object({
  publicUrl: z.string().trim().url().or(z.literal("")).optional(),
  pollSeconds: z.number().int().min(30).max(3600).optional(),
});

export const linkRepoSchema = z.object({
  fullName: z.string().trim().regex(/^[\w.-]+\/[\w.-]+$/, "Use owner/repo"),
});

export const createBranchSchema = z.object({
  repoId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  from: z.string().trim().max(200).optional(),
});

export interface GitHubConnectionInfo {
  connected: boolean;
  login: string | null;
  avatarUrl: string | null;
  apiUrl: string;
  /** Public base URL of this Flowboard server, if reachable from GitHub. */
  publicUrl: string;
  /** Full webhook URL to register in GitHub (empty if no public URL). */
  webhookUrl: string;
  webhookSecret: string | null;
  pollSeconds: number;
  scopes: string | null;
  lastError: string | null;
}

export interface GitHubRepoOption {
  fullName: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  htmlUrl: string;
}

export interface LinkedRepo {
  id: string;
  projectId: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  webhookId: number | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface ProjectGitHub {
  repos: LinkedRepo[];
  automation: GitAutomation;
}

/* ---------- Development info shown on items ---------- */

export type PrState = "open" | "closed" | "merged";

export interface DevPullRequest {
  id: string;
  repo: string;
  number: number;
  title: string;
  state: PrState;
  draft: boolean;
  author: string | null;
  authorAvatar: string | null;
  htmlUrl: string;
  headRef: string;
  baseRef: string;
  updatedAt: string;
}

export interface DevBranch {
  id: string;
  repo: string;
  name: string;
  htmlUrl: string;
  createdAt: string;
}

export interface DevCommit {
  id: string;
  repo: string;
  sha: string;
  message: string;
  author: string | null;
  htmlUrl: string;
  committedAt: string;
}

export interface DevDeployment {
  id: string;
  repo: string;
  source: DeploySource;
  /** Environment, workflow name or release tag. */
  name: string;
  state: string;
  htmlUrl: string | null;
  sha: string | null;
  at: string;
}

export interface DevelopmentInfo {
  repos: { id: string; fullName: string; defaultBranch: string; htmlUrl: string }[];
  branches: DevBranch[];
  commits: DevCommit[];
  pullRequests: DevPullRequest[];
  deployments: DevDeployment[];
  suggestedBranch: string;
}

/** Compact counts shown on cards. */
export interface DevSummary {
  prs: number;
  openPrs: number;
  mergedPrs: number;
  branches: number;
  commits: number;
  deployed: boolean;
}

/* ---------- Key detection ---------- */

/**
 * Find work-item keys in free text (branch names, PR titles, commit messages).
 * Accepts un-padded numbers ("APP-12", "app-12") and normalizes to the project's format ("APP-0012").
 */
export function extractItemKeys(text: string, projects: { key: string; keyDigits: number }[]): string[] {
  if (!text || projects.length === 0) return [];
  const byKey = new Map(projects.map((p) => [p.key.toUpperCase(), p.keyDigits]));
  const alternation = [...byKey.keys()].sort((a, b) => b.length - a.length).join("|");
  const re = new RegExp(`(?<![A-Za-z0-9])(${alternation})-(\\d{1,6})(?![0-9])`, "gi");
  const found = new Set<string>();
  for (const m of text.matchAll(re)) {
    const key = m[1].toUpperCase();
    const n = Number(m[2]);
    const digits = byKey.get(key)!;
    if (n > 0 && n < 10 ** digits) found.add(`${key}-${String(n).padStart(digits, "0")}`);
  }
  return [...found];
}

/** Jira-style branch name: APP-0012-add-google-login */
export function branchNameFor(key: string, title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug ? `${key}-${slug}` : key;
}
