import type { ItemType, Priority, StatusDef } from "./hierarchy";
import type { DevSummary } from "./github";
import type { ProjectAccessInfo } from "./auth";

export interface Progress {
  total: number;
  done: number;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  color: string;
  /** "lucide:<name>" or "emoji:<char>" */
  icon: string;
  /** Digits in item numbers, e.g. 4 → APP-0001. */
  keyDigits: number;
  itemTypes: ItemType[];
  statuses: StatusDef[];
  itemCounter: number;
  visibility?: "org" | "private";
  defaultRole?: "admin" | "editor" | "commenter" | "viewer";
  /** The caller's effective access (present on authenticated responses). */
  access?: ProjectAccessInfo;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWithStats extends Project {
  stats: Progress & { inProgress: number };
}

export interface WorkItem {
  id: string;
  projectId: string;
  parentId: string | null;
  type: ItemType;
  key: string;
  title: string;
  description: string;
  /** Id of one of the project's statuses. */
  status: string;
  priority: Priority;
  assignee: string | null;
  /** Org member the item is assigned to (assignee holds their name). */
  assigneeId?: string | null;
  labels: string[];
  startDate: string | null;
  dueDate: string | null;
  estimate: number | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Work item plus rolled-up info used by lists and cards. */
export interface WorkItemSummary extends WorkItem {
  childCount: number;
  /** Progress of all descendants (leaf-level done / total). */
  progress: Progress;
  commentCount: number;
  /** Linked GitHub activity (absent when nothing is linked). */
  dev?: DevSummary;
}

export interface Breadcrumb {
  id: string;
  key: string;
  title: string;
  type: ItemType;
}

export interface WorkItemDetail extends WorkItemSummary {
  ancestors: Breadcrumb[];
  children: WorkItemSummary[];
}

export interface Comment {
  id: string;
  workItemId: string;
  /** Display name. */
  author: string;
  authorType?: "user" | "agent" | "system" | "integration";
  authorId?: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  workItemId: string;
  actor: string;
  actorType?: "user" | "agent" | "system" | "integration";
  action: "created" | "updated" | "commented" | "moved" | "deleted";
  field: string | null;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

export interface SearchResult {
  projects: Project[];
  items: (WorkItem & { projectKey: string })[];
}
