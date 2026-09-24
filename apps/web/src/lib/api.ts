import type {
  Activity,
  Agent,
  AgentCreate,
  AgentPermission,
  AgentUpdate,
  ApiKeyInfo,
  CreatedApiKey,
  AuthResponse,
  AuthUser,
  Comment,
  DevelopmentInfo,
  DocSearchHit,
  LinkedPage,
  Notification,
  PageDetail,
  PageNode,
  PageVersion,
  PageVersionSummary,
  Space,
  GitAutomation,
  GitHubConnectionInfo,
  GitHubRepoOption,
  Invite,
  InvitePreview,
  ItemCreate,
  ItemMove,
  ItemUpdate,
  LinkedRepo,
  Member,
  OrgRole,
  OrgSummary,
  Project,
  ProjectAccessInfo,
  ProjectAccessOverview,
  ProjectCreate,
  ProjectGitHub,
  ProjectRole,
  ProjectUpdate,
  ProjectWithStats,
  SearchResult,
  Team,
  WorkItem,
  WorkItemDetail,
  WorkItemSummary,
} from "@flowboard/shared";
import { getAccessToken, getCurrentOrg, refreshSession } from "./session";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Auth + org headers for every API call (also used by uploads). */
export function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const token = getAccessToken();
  const org = getCurrentOrg();
  if (token) h.authorization = `Bearer ${token}`;
  if (org) h["x-org"] = org;
  return h;
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...authHeaders(), ...init?.headers },
  });
  // Access tokens are short-lived: refresh once and retry transparently.
  if (res.status === 401 && !retried && !path.startsWith("/auth/")) {
    if (await refreshSession()) return request<T>(path, init, true);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export type ProjectWithAccess = Project & { access: ProjectAccessInfo };

export const api = {
  auth: {
    login: (email: string, password: string) => request<AuthResponse>("/auth/login", json("POST", { email, password })),
    register: (input: { name: string; email: string; password: string; orgName: string }) =>
      request<AuthResponse>("/auth/register", json("POST", input)),
    logout: () => request<void>("/auth/logout", { method: "POST" }),
    logoutAll: () => request<void>("/auth/logout-all", { method: "POST" }),
    me: () => request<{ user: AuthUser; orgs: OrgSummary[] }>("/auth/me"),
    updateMe: (patch: { name?: string; sessionDays?: number }) => request<AuthUser>("/auth/me", json("PATCH", patch)),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<void>("/auth/change-password", json("POST", { currentPassword, newPassword })),
    forgot: (email: string) => request<void>("/auth/forgot-password", json("POST", { email })),
    reset: (token: string, password: string) => request<void>("/auth/reset-password", json("POST", { token, password })),
    verifyEmail: (token: string) => request<void>("/auth/verify-email", json("POST", { token })),
    resendVerification: () => request<void>("/auth/resend-verification", { method: "POST" }),
  },
  invites: {
    preview: (token: string) => request<InvitePreview>(`/invites/${token}`),
    accept: (token: string, body: { name?: string; password?: string }) =>
      request<Partial<AuthResponse> & { orgs: OrgSummary[] }>(`/invites/${token}/accept`, json("POST", body)),
  },
  orgs: {
    mine: () => request<OrgSummary[]>("/orgs"),
    create: (name: string, slug?: string) => request<OrgSummary>("/orgs", json("POST", { name, slug })),
    current: () => request<OrgSummary>("/org"),
    update: (patch: { name?: string; slug?: string }) => request<OrgSummary>("/org", json("PATCH", patch)),
    remove: () => request<void>("/org", { method: "DELETE" }),
    members: () => request<Member[]>("/org/members"),
    setRole: (userId: string, role: OrgRole) => request<void>(`/org/members/${userId}`, json("PATCH", { role })),
    removeMember: (userId: string) => request<void>(`/org/members/${userId}`, { method: "DELETE" }),
    teams: () => request<Team[]>("/org/teams"),
    createTeam: (name: string, description = "") => request<Team>("/org/teams", json("POST", { name, description })),
    updateTeam: (id: string, patch: { name?: string; description?: string }) => request<Team>(`/org/teams/${id}`, json("PATCH", patch)),
    deleteTeam: (id: string) => request<void>(`/org/teams/${id}`, { method: "DELETE" }),
    addTeamMember: (teamId: string, userId: string, role: "lead" | "member" = "member") =>
      request<void>(`/org/teams/${teamId}/members`, json("POST", { userId, role })),
    removeTeamMember: (teamId: string, userId: string) => request<void>(`/org/teams/${teamId}/members/${userId}`, { method: "DELETE" }),
    invites: () => request<Invite[]>("/org/invites"),
    invite: (email: string, role: OrgRole, teamIds: string[]) =>
      request<{ invite: Invite; url: string }>("/org/invites", json("POST", { email, role, teamIds })),
    revokeInvite: (id: string) => request<void>(`/org/invites/${id}`, { method: "DELETE" }),
  },
  access: {
    get: (projectKey: string) => request<ProjectAccessOverview>(`/projects/${projectKey}/access`),
    settings: (projectKey: string, patch: { visibility?: "org" | "private"; defaultRole?: ProjectRole }) =>
      request<ProjectAccessOverview>(`/projects/${projectKey}/access`, json("PATCH", patch)),
    grant: (projectKey: string, grant: { principalType: "user" | "team"; principalId: string; role: ProjectRole }) =>
      request<ProjectAccessOverview>(`/projects/${projectKey}/access`, json("POST", grant)),
    revoke: (projectKey: string, grantId: string) => request<ProjectAccessOverview>(`/projects/${projectKey}/access/${grantId}`, { method: "DELETE" }),
  },
  projects: {
    list: () => request<(ProjectWithStats & { access: ProjectAccessInfo })[]>("/projects"),
    get: (idOrKey: string) => request<ProjectWithAccess>(`/projects/${idOrKey}`),
    create: (input: ProjectCreate) => request<ProjectWithAccess>("/projects", json("POST", input)),
    update: (id: string, patch: ProjectUpdate) => request<ProjectWithAccess>(`/projects/${id}`, json("PATCH", patch)),
    remove: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),
    tree: (idOrKey: string) => request<WorkItemSummary[]>(`/projects/${idOrKey}/tree`),
  },
  items: {
    get: (id: string) => request<WorkItemDetail>(`/items/${id}`),
    byKey: (key: string) => request<WorkItemDetail>(`/items/by-key/${key}`),
    create: (input: ItemCreate) => request<WorkItem>("/items", json("POST", input)),
    update: (id: string, patch: ItemUpdate) => request<WorkItem>(`/items/${id}`, json("PATCH", patch)),
    move: (id: string, move: ItemMove) => request<WorkItem>(`/items/${id}/move`, json("PATCH", move)),
    remove: (id: string) => request<void>(`/items/${id}`, { method: "DELETE" }),
    activity: (id: string) => request<Activity[]>(`/items/${id}/activity`),
    comments: (id: string) => request<Comment[]>(`/items/${id}/comments`),
    addComment: (id: string, body: string) => request<Comment>(`/items/${id}/comments`, json("POST", { body })),
  },
  comments: {
    update: (id: string, body: string) => request<Comment>(`/comments/${id}`, json("PATCH", { body })),
    remove: (id: string) => request<void>(`/comments/${id}`, { method: "DELETE" }),
  },
  search: (q: string) => request<SearchResult>(`/search?q=${encodeURIComponent(q)}`),
  agents: {
    list: () => request<Agent[]>("/agents"),
    get: (id: string) => request<Agent>(`/agents/${id}`),
    create: (input: AgentCreate) => request<{ agent: Agent; key: CreatedApiKey }>("/agents", json("POST", input)),
    update: (id: string, patch: AgentUpdate) => request<Agent>(`/agents/${id}`, json("PATCH", patch)),
    remove: (id: string) => request<void>(`/agents/${id}`, { method: "DELETE" }),
    createKey: (id: string, input: { name: string; expiresInDays?: number }) => request<CreatedApiKey>(`/agents/${id}/keys`, json("POST", input)),
    revokeKey: (id: string, keyId: string) => request<ApiKeyInfo>(`/agents/${id}/keys/${keyId}`, { method: "DELETE" }),
    setGrant: (id: string, projectId: string, permissions: AgentPermission[]) =>
      request<Agent>(`/agents/${id}/grants`, json("PUT", { projectId, permissions })),
    activity: (id: string) =>
      request<
        {
          id: string;
          action: string;
          field: string | null;
          from: string | null;
          to: string | null;
          createdAt: string;
          item: { key: string; type: WorkItem["type"]; title: string; projectKey: string };
        }[]
      >(`/agents/${id}/activity`),
  },
  plugins: {
    list: () =>
      request<
        { id: string; name: string; includes: string[]; after: string; download: string; install: { bash: string; powershell: string } }[]
      >("/plugins"),
  },
  oauth: {
    client: (id: string, codeChallenge: string) =>
      request<{ id: string; name: string; redirectUris: string[]; linkUsed: boolean }>(`/oauth/clients/${id}?code_challenge=${encodeURIComponent(codeChallenge)}`),
    approve: (input: {
      clientId: string;
      redirectUri: string;
      codeChallenge: string;
      codeChallengeMethod?: string;
      state?: string;
      agentId?: string;
      newAgent?: { name: string; projectIds: string[] };
    }) => request<{ redirect: string; agentId: string | null }>("/oauth/authorize", json("POST", input)),
  },
  notifications: {
    list: (unread = false) => request<{ items: Notification[]; unread: number }>(`/notifications${unread ? "?unread=true" : ""}`),
    read: (id: string) => request<Notification>(`/notifications/${id}/read`, { method: "POST" }),
    readAll: () => request<void>("/notifications/read-all", { method: "POST" }),
  },
  docs: {
    spaces: () => request<Space[]>("/spaces"),
    space: (key: string) => request<Space>(`/spaces/${key}`),
    createSpace: (input: { name: string; key: string; description?: string; icon?: string; color?: string; projectId?: string | null }) =>
      request<Space>("/spaces", json("POST", input)),
    updateSpace: (key: string, patch: { name?: string; description?: string; icon?: string; color?: string }) =>
      request<Space>(`/spaces/${key}`, json("PATCH", patch)),
    deleteSpace: (key: string) => request<void>(`/spaces/${key}`, { method: "DELETE" }),
    tree: (spaceKey: string) => request<PageNode[]>(`/spaces/${spaceKey}/pages`),
    createPage: (spaceKey: string, input: { title: string; parentId?: string | null; contentHtml?: string }) =>
      request<PageDetail>(`/spaces/${spaceKey}/pages`, json("POST", input)),
    page: (id: string) => request<PageDetail>(`/pages/${id}`),
    updatePage: (id: string, input: { title?: string; contentHtml?: string; baseVersion: number }) =>
      request<PageDetail>(`/pages/${id}`, json("PATCH", input)),
    movePage: (id: string, input: { parentId: string | null; beforeId?: string | null }) =>
      request<PageNode[]>(`/pages/${id}/move`, json("POST", input)),
    deletePage: (id: string) => request<void>(`/pages/${id}`, { method: "DELETE" }),
    versions: (id: string) => request<PageVersionSummary[]>(`/pages/${id}/versions`),
    version: (id: string, v: number) => request<PageVersion>(`/pages/${id}/versions/${v}`),
    restore: (id: string, v: number) => request<PageDetail>(`/pages/${id}/versions/${v}/restore`, { method: "POST" }),
    search: (q: string) => request<DocSearchHit[]>(`/docs/search?q=${encodeURIComponent(q)}`),
    pagesForItem: (itemId: string) => request<LinkedPage[]>(`/items/${itemId}/pages`),
  },
  github: {
    connection: () => request<GitHubConnectionInfo>("/github/connection"),
    connect: (input: { token: string; apiUrl?: string; publicUrl?: string; pollSeconds?: number }) =>
      request<GitHubConnectionInfo>("/github/connection", json("PUT", input)),
    updateSettings: (patch: { publicUrl?: string; pollSeconds?: number }) =>
      request<GitHubConnectionInfo>("/github/connection", json("PATCH", patch)),
    disconnect: () => request<void>("/github/connection", { method: "DELETE" }),
    searchRepos: (q: string) => request<GitHubRepoOption[]>(`/github/repos?q=${encodeURIComponent(q)}`),
    project: (projectKey: string) => request<ProjectGitHub>(`/projects/${projectKey}/github`),
    linkRepo: (projectKey: string, fullName: string) => request<LinkedRepo>(`/projects/${projectKey}/github/repos`, json("POST", { fullName })),
    unlinkRepo: (projectKey: string, repoId: string) => request<void>(`/projects/${projectKey}/github/repos/${repoId}`, { method: "DELETE" }),
    registerWebhook: (projectKey: string, repoId: string) =>
      request<LinkedRepo>(`/projects/${projectKey}/github/repos/${repoId}/webhook`, { method: "POST" }),
    sync: (projectKey: string) =>
      request<{ repo: string; ok: boolean; error?: string }[]>(`/projects/${projectKey}/github/sync`, { method: "POST" }),
    saveAutomation: (projectKey: string, automation: GitAutomation) =>
      request<GitAutomation>(`/projects/${projectKey}/github/automation`, json("PUT", automation)),
    development: (itemId: string) => request<DevelopmentInfo>(`/items/${itemId}/development`),
    createBranch: (itemId: string, input: { repoId: string; name: string; from?: string }) =>
      request<DevelopmentInfo>(`/items/${itemId}/github/branch`, json("POST", input)),
  },
};
