import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  customType,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { GitAutomation, ItemType, Priority, StatusDef } from "@flowboard/shared";

const id = () => uuid("id").primaryKey().defaultRandom();
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ================= Identity & tenancy ================= */

export const users = pgTable("users", {
  id: id(),
  /** Always stored lower-cased. */
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  passwordHash: text("password_hash"),
  emailVerifiedAt: ts("email_verified_at"),
  /** "Stay signed in for": refresh-token lifetime in days, renewed on every refresh (sliding). */
  sessionDays: integer("session_days").notNull().default(30),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One row per refresh token; rotation keeps the family id so reuse can revoke the whole chain. */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_family_idx").on(t.familyId)],
);

export const authTokens = pgTable("auth_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").$type<"password_reset" | "email_verify">().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

export type OrgRole = "owner" | "admin" | "member" | "guest";

export const orgs = pgTable("orgs", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<OrgRole>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("org_members_user_idx").on(t.userId)],
);

export const teams = pgTable(
  "teams",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("teams_org_slug_idx").on(t.orgId, t.slug)],
);

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"lead" | "member">().notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const invites = pgTable("invites", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").$type<OrgRole>().notNull(),
  teamIds: jsonb("team_ids").$type<string[]>().notNull().default([]),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  createdAt: createdAt(),
});

/** AI agents are first-class principals with their own keys and permissions. */
export const agents = pgTable("agents", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** Access to org-wide doc spaces (project spaces follow the agent's project grants). */
  docAccess: text("doc_access").$type<"none" | "read" | "write">().notNull().default("read"),
  /** When it plans work: create Flowboard items right away, or propose them and wait for the user. */
  planningMode: text("planning_mode").$type<"auto" | "propose">().notNull().default("auto"),
  /** May create new projects (it then gets full agent access to them). */
  canCreateProjects: boolean("can_create_projects").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  disabledAt: ts("disabled_at"),
  createdAt: createdAt(),
});

export const apiKeys = pgTable("api_keys", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Public part shown in the UI and used for lookup. */
  prefix: text("prefix").notNull().unique(),
  keyHash: text("key_hash").notNull(),
  lastUsedAt: ts("last_used_at"),
  expiresAt: ts("expires_at"),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
});

/* ================= Projects & work ================= */

export type ProjectRole = "admin" | "editor" | "commenter" | "viewer";

export const projects = pgTable(
  "projects",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    color: text("color").notNull().default("#6366f1"),
    icon: text("icon").notNull().default("lucide:rocket"),
    keyDigits: integer("key_digits").notNull().default(4),
    itemTypes: jsonb("item_types").$type<ItemType[]>().notNull(),
    statuses: jsonb("statuses").$type<StatusDef[]>().notNull(),
    gitAutomation: jsonb("git_automation").$type<GitAutomation>(),
    visibility: text("visibility").$type<"org" | "private">().notNull().default("org"),
    defaultRole: text("default_role").$type<ProjectRole>().notNull().default("editor"),
    itemCounter: integer("item_counter").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("projects_org_key_idx").on(t.orgId, t.key)],
);

export const projectAccess = pgTable(
  "project_access",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    principalType: text("principal_type").$type<"team" | "user" | "agent">().notNull(),
    principalId: uuid("principal_id").notNull(),
    role: text("role").$type<ProjectRole>().notNull(),
    /** Optional allow-list narrowing the role (used for agent permission toggles). */
    permissions: jsonb("permissions").$type<string[] | null>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("project_access_principal_idx").on(t.projectId, t.principalType, t.principalId)],
);

export const workItems = pgTable(
  "work_items",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): any => workItems.id, { onDelete: "cascade" }), // eslint-disable-line @typescript-eslint/no-explicit-any
    type: text("type").$type<ItemType>().notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull(),
    priority: text("priority").$type<Priority>().notNull().default("medium"),
    /** Free-text assignee (kept for compatibility); assigneeId links a real member. */
    assignee: text("assignee"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    startDate: text("start_date"),
    dueDate: text("due_date"),
    estimate: real("estimate"),
    sortOrder: doublePrecision("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("work_items_org_key_idx").on(t.orgId, t.key),
    index("work_items_project_idx").on(t.projectId),
    index("work_items_parent_idx").on(t.parentId),
  ],
);

export type ActorType = "user" | "agent" | "system" | "integration";

export const comments = pgTable(
  "comments",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    authorType: text("author_type").$type<ActorType>().notNull().default("user"),
    authorId: uuid("author_id"),
    author: text("author").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("comments_item_idx").on(t.workItemId)],
);

export const activity = pgTable(
  "activity",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    actorType: text("actor_type").$type<ActorType>().notNull().default("user"),
    actorId: uuid("actor_id"),
    actor: text("actor").notNull(),
    action: text("action").$type<"created" | "updated" | "commented" | "moved" | "deleted">().notNull(),
    field: text("field"),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    createdAt: createdAt(),
  },
  (t) => [index("activity_item_idx").on(t.workItemId)],
);

export const uploads = pgTable("uploads", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  /** File name in storage: <uuid>.<ext> — also the public URL segment. */
  storageKey: text("storage_key").notNull().unique(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  name: text("name").notNull(),
  uploadedBy: uuid("uploaded_by"),
  createdAt: createdAt(),
});

/* ================= GitHub ================= */

export const githubConnections = pgTable("github_connections", {
  orgId: uuid("org_id").primaryKey().references(() => orgs.id, { onDelete: "cascade" }),
  tokenEnc: text("token_enc").notNull(),
  login: text("login"),
  avatarUrl: text("avatar_url"),
  scopes: text("scopes"),
  apiUrl: text("api_url").notNull().default("https://api.github.com"),
  publicUrl: text("public_url").notNull().default(""),
  webhookSecret: text("webhook_secret").notNull(),
  pollSeconds: integer("poll_seconds").notNull().default(60),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const projectRepos = pgTable(
  "project_repos",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    htmlUrl: text("html_url").notNull(),
    defaultBranch: text("default_branch").notNull(),
    webhookId: integer("webhook_id"),
    lastSyncedAt: ts("last_synced_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("project_repos_unique_idx").on(t.projectId, t.fullName), index("project_repos_name_idx").on(sql`lower(${t.fullName})`)],
);

export const ghEntities = pgTable(
  "gh_entities",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id").notNull().references(() => projectRepos.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"pr" | "branch" | "commit" | "deployment">().notNull(),
    externalId: text("external_id").notNull(),
    state: text("state"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: ts("occurred_at").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("gh_entities_unique_idx").on(t.repoId, t.kind, t.externalId)],
);

export const ghLinks = pgTable(
  "gh_links",
  {
    entityId: uuid("entity_id").notNull().references(() => ghEntities.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.itemId] }), index("gh_links_item_idx").on(t.itemId)],
);

/* ================= Platform ================= */

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    name: text("name").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<"queued" | "running" | "done" | "dead">().notNull().default("queued"),
    runAt: ts("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    lockedAt: ts("locked_at"),
    lockedBy: text("locked_by"),
    /** Dedupe key: at most one queued/running job per key. */
    uniqueKey: text("unique_key"),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("jobs_pick_idx").on(t.status, t.runAt),
    uniqueIndex("jobs_unique_key_idx").on(t.uniqueKey).where(sql`${t.status} in ('queued', 'running')`),
  ],
);

/* ================= Notifications ================= */

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<"assigned" | "mentioned" | "commented" | "status_changed">().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    /** In-app path to open, relative to the org (e.g. /projects/APP/task/APP-0012). */
    link: text("link").notNull(),
    actorName: text("actor_name").notNull(),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.orgId, t.createdAt)],
);

/* ================= Docs ================= */

export const spaces = pgTable(
  "spaces",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    icon: text("icon").notNull().default("lucide:book-open"),
    color: text("color").notNull().default("#6366f1"),
    /** When set, the space follows that project's access. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("spaces_org_key_idx").on(t.orgId, t.key)],
);

export const pages = pgTable(
  "pages",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): any => pages.id, { onDelete: "cascade" }), // eslint-disable-line @typescript-eslint/no-explicit-any
    position: doublePrecision("position").notNull().default(0),
    title: text("title").notNull(),
    contentHtml: text("content_html").notNull().default(""),
    /** Plain text of the content, for search and item-key extraction. */
    contentText: text("content_text").notNull().default(""),
    version: integer("version").notNull().default(1),
    search: tsvector("search").generatedAlwaysAs(
      (): SQL => sql`setweight(to_tsvector('english', coalesce(${pages.title}, '')), 'A') || setweight(to_tsvector('english', coalesce(${pages.contentText}, '')), 'B')`,
    ),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    updatedByName: text("updated_by_name").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("pages_space_idx").on(t.spaceId, t.parentId, t.position),
    index("pages_search_idx").using("gin", t.search),
  ],
);

export const pageVersions = pgTable(
  "page_versions",
  {
    id: id(),
    pageId: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    contentHtml: text("content_html").notNull(),
    contentText: text("content_text").notNull(),
    authorId: uuid("author_id"),
    authorName: text("author_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("page_versions_idx").on(t.pageId, t.version)],
);

export const pageItemLinks = pgTable(
  "page_item_links",
  {
    pageId: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.itemId] }), index("page_item_links_item_idx").on(t.itemId)],
);

/* ================= OAuth for MCP clients ================= */

/** Clients registered through OAuth Dynamic Client Registration (RFC 7591), e.g. Copilot CLI. */
export const oauthClients = pgTable("oauth_clients", {
  id: id(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  createdAt: createdAt(),
});

/** Single-use authorization codes (PKCE), redeemed for an agent API key at the token endpoint. */
export const oauthCodes = pgTable(
  "oauth_codes",
  {
    id: id(),
    codeHash: text("code_hash").notNull().unique(),
    clientId: uuid("client_id").notNull().references(() => oauthClients.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    /** The existing agent to act as — or null when a new one is created on redemption. */
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    /** A new agent to create when (and only if) the client redeems the code. */
    newAgent: jsonb("new_agent").$type<{ name: string; projectIds: string[] } | null>(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("oauth_codes_client_idx").on(t.clientId)],
);
