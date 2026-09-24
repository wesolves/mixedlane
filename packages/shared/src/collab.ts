import { z } from "zod";
import type { ItemType } from "./hierarchy";

/* ================= Realtime ================= */

export interface LiveActor {
  type: "user" | "agent" | "system" | "integration";
  id: string | null;
  name: string;
}

/**
 * Events pushed over the socket. They carry only identifiers and a short summary — clients
 * refetch details through the permission-checked REST API.
 */
export type LiveEvent =
  | {
      type: "item";
      action: "created" | "updated" | "moved" | "deleted";
      projectId: string;
      itemId: string;
      key: string;
      itemType: ItemType;
      title: string;
      /** For moves: the new status id. */
      status?: string;
      actor: LiveActor;
    }
  | { type: "comment"; action: "created" | "updated" | "deleted"; projectId: string; itemId: string; key: string; actor: LiveActor }
  | { type: "project"; action: "updated" | "deleted" | "access"; projectId: string; actor: LiveActor }
  | { type: "page"; action: "created" | "updated" | "moved" | "deleted"; spaceId: string; pageId: string; title: string; version: number; actor: LiveActor }
  | { type: "space"; action: "created" | "updated" | "deleted"; spaceId: string; actor: LiveActor }
  | { type: "notification"; notification: Notification };

/** Something that can have viewers: an item or a page. */
export type PresenceResource = `item:${string}` | `page:${string}`;

export interface PresenceUser {
  userId: string;
  name: string;
  mode: "viewing" | "editing";
}

/* ================= Notifications ================= */

export interface Notification {
  id: string;
  type: "assigned" | "mentioned" | "commented" | "status_changed";
  title: string;
  body: string;
  /** Path inside the org, e.g. /projects/APP/task/APP-0012 */
  link: string;
  actorName: string;
  readAt: string | null;
  createdAt: string;
}

/* ================= Docs ================= */

const spaceKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, "Space key must be 2-10 letters/digits, starting with a letter");

export const spaceCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  key: spaceKey,
  description: z.string().max(2000).optional().default(""),
  icon: z.string().max(64).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Link to a project: the space then follows that project's access. */
  projectId: z.string().uuid().nullable().optional(),
});
export const spaceUpdateSchema = spaceCreateSchema.omit({ key: true, projectId: true }).partial();

export const pageCreateSchema = z.object({
  title: z.string().trim().min(1).max(300).default("Untitled"),
  parentId: z.string().uuid().nullable().optional(),
  contentHtml: z.string().max(2_000_000).optional().default(""),
});

export const pageUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  contentHtml: z.string().max(2_000_000).optional(),
  /** The version the editor started from — a mismatch means someone else saved (409). */
  baseVersion: z.number().int().min(1),
});

export const pageMoveSchema = z.object({
  parentId: z.string().uuid().nullable(),
  /** Place before this sibling (null = at the end). */
  beforeId: z.string().uuid().nullable().optional(),
});

export interface Space {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  projectId: string | null;
  projectKey: string | null;
  pageCount: number;
  /** Caller's permissions in this space. */
  canWrite: boolean;
  canAdmin: boolean;
  updatedAt: string;
}

export interface PageNode {
  id: string;
  parentId: string | null;
  title: string;
  position: number;
  updatedAt: string;
}

export interface PageLinkedItem {
  id: string;
  key: string;
  title: string;
  type: ItemType;
  status: string;
  projectKey: string;
}

export interface PageDetail {
  id: string;
  spaceId: string;
  spaceKey: string;
  parentId: string | null;
  title: string;
  contentHtml: string;
  version: number;
  updatedAt: string;
  updatedByName: string;
  createdAt: string;
  breadcrumbs: { id: string; title: string }[];
  linkedItems: PageLinkedItem[];
  canWrite: boolean;
}

export interface PageVersionSummary {
  version: number;
  title: string;
  authorName: string;
  createdAt: string;
}

export interface PageVersion extends PageVersionSummary {
  contentHtml: string;
  contentText: string;
}

export interface DocSearchHit {
  pageId: string;
  spaceKey: string;
  spaceName: string;
  title: string;
  /** Plain-text excerpt with matches wrapped in «» */
  snippet: string;
}

export interface LinkedPage {
  id: string;
  title: string;
  spaceKey: string;
  spaceName: string;
}
