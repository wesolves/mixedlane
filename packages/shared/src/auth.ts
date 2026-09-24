import { z } from "zod";

/* ================= Roles & permissions ================= */

export const ORG_ROLES = ["owner", "admin", "member", "guest"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PROJECT_ROLES = ["admin", "editor", "commenter", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const ORG_ROLE_LABELS: Record<OrgRole, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };
export const ORG_ROLE_HINTS: Record<OrgRole, string> = {
  owner: "Full control, including deleting the organization",
  admin: "Manage members, teams, integrations and every project",
  member: "Sees org-visible projects and can create projects",
  guest: "Only sees projects they're explicitly added to",
};
export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = { admin: "Admin", editor: "Editor", commenter: "Commenter", viewer: "Viewer" };
export const PROJECT_ROLE_HINTS: Record<ProjectRole, string> = {
  admin: "Everything, including settings and access",
  editor: "Create, edit, move and delete work",
  commenter: "View and comment",
  viewer: "Read only",
};

export type OrgPermission =
  | "org.manage"
  | "org.delete"
  | "org.invite"
  | "team.manage"
  | "project.create"
  | "integration.manage"
  | "agent.manage";

export type ProjectPermission =
  | "project.read"
  | "project.admin"
  | "item.create"
  | "item.update"
  | "item.move"
  | "item.delete"
  | "comment.create"
  | "comment.moderate"
  | "doc.read"
  | "doc.write"
  | "doc.admin";

export const ORG_ROLE_PERMISSIONS: Record<OrgRole, OrgPermission[]> = {
  owner: ["org.manage", "org.delete", "org.invite", "team.manage", "project.create", "integration.manage", "agent.manage"],
  admin: ["org.manage", "org.invite", "team.manage", "project.create", "integration.manage", "agent.manage"],
  member: ["project.create"],
  guest: [],
};

const VIEWER: ProjectPermission[] = ["project.read", "doc.read"];
const COMMENTER: ProjectPermission[] = [...VIEWER, "comment.create"];
const EDITOR: ProjectPermission[] = [...COMMENTER, "item.create", "item.update", "item.move", "item.delete", "doc.write"];
const ADMIN: ProjectPermission[] = [...EDITOR, "project.admin", "comment.moderate", "doc.admin"];

export const PROJECT_ROLE_PERMISSIONS: Record<ProjectRole, ProjectPermission[]> = {
  viewer: VIEWER,
  commenter: COMMENTER,
  editor: EDITOR,
  admin: ADMIN,
};

/** Higher index = more access. */
export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, commenter: 1, editor: 2, admin: 3 };
export const ORG_ROLE_RANK: Record<OrgRole, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

/** The caller's effective access to one project (sent with project responses). */
export interface ProjectAccessInfo {
  role: ProjectRole;
  permissions: ProjectPermission[];
}

/* ================= Schemas ================= */

const email = z.string().trim().toLowerCase().email("Enter a valid email").max(200);
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Use letters and at least one number");
const personName = z.string().trim().min(1, "Name is required").max(120);
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, "Use 1–40 lowercase letters, digits or dashes");

export const registerSchema = z.object({
  name: personName,
  email,
  password,
  orgName: z.string().trim().min(1, "Organization name is required").max(120),
});
export const loginSchema = z.object({ email, password: z.string().min(1, "Password is required").max(200) });
export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token: z.string().min(10), password });
export const verifyEmailSchema = z.object({ token: z.string().min(10) });
/** "Stay signed in for" choices (days). The session renews on every use, so it only ends after this long idle. */
export const SESSION_DAY_OPTIONS = [30, 60, 90, 180, 365] as const;
export const updateProfileSchema = z.object({
  name: personName.optional(),
  avatarUrl: z.string().url().nullable().optional(),
  sessionDays: z
    .number()
    .int()
    .refine((d) => (SESSION_DAY_OPTIONS as readonly number[]).includes(d), "Choose 30, 60, 90, 180 or 365 days")
    .optional(),
});
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });

export const orgCreateSchema = z.object({ name: z.string().trim().min(1).max(120), slug: slugSchema.optional() });
export const orgUpdateSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), slug: slugSchema.optional() });

export const inviteCreateSchema = z.object({
  email,
  role: z.enum(ORG_ROLES).exclude(["owner"]).default("member"),
  teamIds: z.array(z.string().uuid()).max(50).default([]),
});
/** Accepting an invite either as the signed-in user, or by creating the account inline. */
export const inviteAcceptSchema = z.object({ name: personName.optional(), password: password.optional() });

export const memberUpdateSchema = z.object({ role: z.enum(ORG_ROLES) });

export const teamCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
});
export const teamUpdateSchema = teamCreateSchema.partial();
export const teamMemberSchema = z.object({ userId: z.string().uuid(), role: z.enum(["lead", "member"]).default("member") });

export const projectAccessGrantSchema = z.object({
  principalType: z.enum(["user", "team"]),
  principalId: z.string().uuid(),
  role: z.enum(PROJECT_ROLES),
});
export const projectAccessSettingsSchema = z.object({
  visibility: z.enum(["org", "private"]).optional(),
  defaultRole: z.enum(PROJECT_ROLES).optional(),
});

export type RegisterInput = z.input<typeof registerSchema>;
export type LoginInput = z.input<typeof loginSchema>;
export type InviteCreate = z.input<typeof inviteCreateSchema>;

/* ================= Response types ================= */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  /** How long this user stays signed in without activity (days). */
  sessionDays: number;
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
  permissions: OrgPermission[];
}

export interface AuthResponse {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: AuthUser;
  orgs: OrgSummary[];
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: OrgRole;
  joinedAt: string;
  teams: { id: string; name: string }[];
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  description: string;
  members: { userId: string; name: string; email: string; role: "lead" | "member" }[];
}

export interface Invite {
  id: string;
  email: string;
  role: OrgRole;
  teamIds: string[];
  expiresAt: string;
  createdAt: string;
  invitedBy: string | null;
}

export interface InvitePreview {
  orgName: string;
  orgSlug: string;
  email: string;
  role: OrgRole;
  invitedBy: string | null;
  /** True when an account with this email already exists (sign in instead of sign up). */
  accountExists: boolean;
}

export interface ProjectAccessEntry {
  id: string;
  principalType: "user" | "team" | "agent";
  principalId: string;
  name: string;
  detail: string;
  role: ProjectRole;
  /** Agents only: the allow-list of what the agent may do here. */
  permissions?: ProjectPermission[] | null;
}

export interface ProjectAccessOverview {
  visibility: "org" | "private";
  defaultRole: ProjectRole;
  grants: ProjectAccessEntry[];
}
