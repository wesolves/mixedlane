import { z } from "zod";
import type { ProjectPermission } from "./auth";

/* ================= AI agents ================= */

/**
 * What an agent can be allowed to do in a project (the toggles in the UI). Agents never get
 * project administration, and they only see projects they were explicitly granted.
 */
export const AGENT_PERMISSIONS = [
  "project.read",
  "item.create",
  "item.update",
  "item.move",
  "item.delete",
  "comment.create",
  "doc.read",
  "doc.write",
] as const satisfies readonly ProjectPermission[];
export type AgentPermission = (typeof AGENT_PERMISSIONS)[number];

export const AGENT_PERMISSION_LABELS: Record<AgentPermission, { label: string; hint: string }> = {
  "project.read": { label: "Read", hint: "See the project, its items and comments" },
  "item.create": { label: "Create items", hint: "Add new work items" },
  "item.update": { label: "Edit fields", hint: "Change titles, descriptions, assignees, labels…" },
  "item.move": { label: "Change status", hint: "Move items across the workflow" },
  "item.delete": { label: "Delete items", hint: "Permanently delete work items" },
  "comment.create": { label: "Comment", hint: "Post comments on items" },
  "doc.read": { label: "Read docs", hint: "Read this project's doc spaces" },
  "doc.write": { label: "Write docs", hint: "Create and edit pages in this project's spaces" },
};

/** A sensible starting point: read, create, edit, move and comment — no deleting. */
export const DEFAULT_AGENT_PERMISSIONS: AgentPermission[] = ["project.read", "item.create", "item.update", "item.move", "comment.create", "doc.read"];

export const AGENT_PLANNING_MODES = ["auto", "propose"] as const;
export type AgentPlanningMode = (typeof AGENT_PLANNING_MODES)[number];
export const AGENT_PLANNING_MODE_LABELS: Record<AgentPlanningMode, { label: string; hint: string }> = {
  auto: { label: "Create items automatically", hint: "Right after it plans, the agent adds the epics, stories and tasks to Flowboard" },
  propose: { label: "Propose first, then create", hint: "The agent shows the breakdown and only creates items after you confirm" },
};

export const AGENT_DOC_ACCESS = ["none", "read", "write"] as const;
export type AgentDocAccess = (typeof AGENT_DOC_ACCESS)[number];

export const agentCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).default(""),
  docAccess: z.enum(AGENT_DOC_ACCESS).default("read"),
});
export const agentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  docAccess: z.enum(AGENT_DOC_ACCESS).optional(),
  planningMode: z.enum(AGENT_PLANNING_MODES).optional(),
  canCreateProjects: z.boolean().optional(),
  disabled: z.boolean().optional(),
});
export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(80).default("Default key"),
  /** Omit for a key that never expires. */
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});
/** Grant (or update) an agent's access to a project; an empty list removes it. */
export const agentGrantSchema = z.object({
  projectId: z.string().uuid(),
  permissions: z
    .array(z.enum(AGENT_PERMISSIONS))
    .max(AGENT_PERMISSIONS.length)
    .transform((p) => [...new Set(p.length ? ["project.read" as const, ...p] : [])]),
});

export type AgentCreate = z.input<typeof agentCreateSchema>;
export type AgentUpdate = z.input<typeof agentUpdateSchema>;

export interface ApiKeyInfo {
  id: string;
  name: string;
  /** Visible identifier, e.g. fb_3f9a1c2b7d4e */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface AgentGrant {
  projectId: string;
  projectKey: string;
  projectName: string;
  permissions: AgentPermission[];
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  docAccess: AgentDocAccess;
  planningMode: AgentPlanningMode;
  /** May create new projects (and gets full agent access to the ones it creates). */
  canCreateProjects: boolean;
  disabled: boolean;
  createdAt: string;
  createdByName: string | null;
  lastUsedAt: string | null;
  keys: ApiKeyInfo[];
  grants: AgentGrant[];
}

/** Returned once when a key is created: `secret` is the full key and is never shown again. */
export interface CreatedApiKey {
  key: ApiKeyInfo;
  secret: string;
}
