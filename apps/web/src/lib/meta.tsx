import {
  BookMarked,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  Circle,
  CircleCheck,
  CircleDot,
  Equal,
  Flag,
  ListChecks,
  SquareCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ItemType, Priority, StatusCategory } from "@mixedlane/shared";

export const TYPE_META: Record<ItemType, { icon: LucideIcon; color: string; bg: string }> = {
  epic: { icon: Zap, color: "text-violet-500", bg: "bg-violet-500/12" },
  milestone: { icon: Flag, color: "text-amber-500", bg: "bg-amber-500/12" },
  story: { icon: BookMarked, color: "text-emerald-500", bg: "bg-emerald-500/12" },
  task: { icon: SquareCheck, color: "text-sky-500", bg: "bg-sky-500/12" },
  subtask: { icon: ListChecks, color: "text-cyan-500", bg: "bg-cyan-500/12" },
};

export const CATEGORY_ICONS: Record<StatusCategory, LucideIcon> = {
  todo: Circle,
  in_progress: CircleDot,
  done: CircleCheck,
};

export const PRIORITY_META: Record<Priority, { icon: LucideIcon; color: string }> = {
  low: { icon: ChevronDown, color: "text-sky-500" },
  medium: { icon: Equal, color: "text-amber-500" },
  high: { icon: ChevronUp, color: "text-orange-500" },
  urgent: { icon: ChevronsUp, color: "text-red-500" },
};

/** Quick picks — any other color can be chosen with the picker or a hex value. */
export const SWATCHES = [
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e",
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e",
  "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#64748b",
];
