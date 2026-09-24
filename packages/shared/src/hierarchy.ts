export const ITEM_TYPES = ["epic", "milestone", "story", "task", "subtask"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Statuses are defined per project; the category drives progress and icons. */
export const STATUS_CATEGORIES = ["todo", "in_progress", "done"] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export interface StatusDef {
  /** Stable id stored on work items; survives renames. */
  id: string;
  name: string;
  color: string;
  category: StatusCategory;
}

export const STATUS_CATEGORY_LABELS: Record<StatusCategory, string> = {
  todo: "To-do",
  in_progress: "In progress",
  done: "Done",
};

export const DEFAULT_STATUSES: StatusDef[] = [
  { id: "backlog", name: "Backlog", color: "#a1a1aa", category: "todo" },
  { id: "todo", name: "To Do", color: "#64748b", category: "todo" },
  { id: "in_progress", name: "In Progress", color: "#3b82f6", category: "in_progress" },
  { id: "in_review", name: "In Review", color: "#f59e0b", category: "in_progress" },
  { id: "done", name: "Done", color: "#10b981", category: "done" },
];

export const STATUS_PRESETS: { name: string; statuses: StatusDef[] }[] = [
  { name: "Default", statuses: DEFAULT_STATUSES },
  {
    name: "Simple",
    statuses: [
      { id: "todo", name: "To Do", color: "#64748b", category: "todo" },
      { id: "in_progress", name: "In Progress", color: "#3b82f6", category: "in_progress" },
      { id: "done", name: "Done", color: "#10b981", category: "done" },
    ],
  },
  {
    name: "Software",
    statuses: [
      { id: "backlog", name: "Backlog", color: "#a1a1aa", category: "todo" },
      { id: "todo", name: "Ready", color: "#64748b", category: "todo" },
      { id: "in_progress", name: "In Development", color: "#3b82f6", category: "in_progress" },
      { id: "code_review", name: "Code Review", color: "#8b5cf6", category: "in_progress" },
      { id: "qa", name: "QA", color: "#f59e0b", category: "in_progress" },
      { id: "done", name: "Released", color: "#10b981", category: "done" },
    ],
  },
];

export const TYPE_PRESETS: { name: string; types: ItemType[] }[] = [
  { name: "Full hierarchy", types: ["epic", "milestone", "story", "task", "subtask"] },
  { name: "Agile", types: ["epic", "story", "task", "subtask"] },
  { name: "Milestones", types: ["milestone", "task", "subtask"] },
  { name: "Simple tasks", types: ["task", "subtask"] },
];

export const TYPE_RANK: Record<ItemType, number> = { epic: 0, milestone: 1, story: 2, task: 3, subtask: 4 };

export const sortTypes = (types: readonly ItemType[]) => [...types].sort((a, b) => TYPE_RANK[a] - TYPE_RANK[b]);

/** Parent types an item may live under: any enabled type higher up the hierarchy. */
export function allowedParentTypes(type: ItemType, enabled: readonly ItemType[]): ItemType[] {
  return sortTypes(enabled.filter((t) => TYPE_RANK[t] < TYPE_RANK[type]));
}

/** Whether an item can sit directly under the project: the top type, and standalone tasks. */
export function canBeRoot(type: ItemType, enabled: readonly ItemType[]): boolean {
  const top = sortTypes(enabled)[0];
  return type === top || type === "task";
}

export function canHaveParent(type: ItemType, parentType: ItemType | null, enabled: readonly ItemType[]): boolean {
  if (!enabled.includes(type)) return false;
  if (parentType === null) return canBeRoot(type, enabled);
  return allowedParentTypes(type, enabled).includes(parentType);
}

/** The natural next level under a parent (null = project root). */
export function defaultChildType(parent: ItemType | null, enabled: readonly ItemType[]): ItemType | null {
  const sorted = sortTypes(enabled);
  if (parent === null) return sorted[0] ?? null;
  return sorted.find((t) => TYPE_RANK[t] > TYPE_RANK[parent]) ?? null;
}

export function childTypes(parent: ItemType, enabled: readonly ItemType[]): ItemType[] {
  return sortTypes(enabled.filter((t) => TYPE_RANK[t] > TYPE_RANK[parent]));
}

/** Types that appear as cards on the Kanban board. */
export function boardTypes(enabled: readonly ItemType[]): ItemType[] {
  const work = enabled.filter((t) => t === "story" || t === "task");
  if (work.length) return sortTypes(work);
  const rest = enabled.filter((t) => t !== "subtask");
  return sortTypes(rest.length ? rest : enabled);
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const TYPE_LABELS: Record<ItemType, string> = {
  epic: "Epic",
  milestone: "Milestone",
  story: "User Story",
  task: "Task",
  subtask: "Subtask",
};

export const TYPE_PLURALS: Record<ItemType, string> = {
  epic: "Epics",
  milestone: "Milestones",
  story: "User Stories",
  task: "Tasks",
  subtask: "Subtasks",
};

export const formatItemKey = (projectKey: string, n: number, digits: number) =>
  `${projectKey}-${String(n).padStart(digits, "0")}`;
