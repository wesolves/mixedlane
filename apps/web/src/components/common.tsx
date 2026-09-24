import type { ReactNode } from "react";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";
import { Bot, Settings2 } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import type { ItemType, Priority, Progress, StatusDef } from "@flowboard/shared";
import { PRIORITY_LABELS, TYPE_LABELS } from "@flowboard/shared";
import { CATEGORY_ICONS, PRIORITY_META, TYPE_META } from "@/lib/meta";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function TypeIcon({ type, className, boxed }: { type: ItemType; className?: string; boxed?: boolean }) {
  const { icon: Icon, color, bg } = TYPE_META[type];
  if (boxed) {
    return (
      <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md", bg, className)}>
        <Icon className={cn("size-3.5", color)} strokeWidth={2.4} />
      </span>
    );
  }
  return <Icon className={cn("size-4 shrink-0", color, className)} strokeWidth={2.2} aria-label={TYPE_LABELS[type]} />;
}

export function StatusIcon({ status, className }: { status: StatusDef; className?: string }) {
  const Icon = CATEGORY_ICONS[status.category];
  return (
    <Icon className={cn("size-4 shrink-0", className)} style={{ color: status.color }} strokeWidth={2.2} aria-label={status.name} />
  );
}

export function StatusPill({ status, className }: { status: StatusDef; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", className)}
      style={{ backgroundColor: `color-mix(in oklab, ${status.color} 14%, transparent)`, color: `color-mix(in oklab, ${status.color} 70%, var(--foreground))` }}
    >
      <StatusIcon status={status} className="size-3.5" />
      {status.name}
    </span>
  );
}

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const { icon: Icon, color } = PRIORITY_META[priority];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Icon className={cn("size-4 shrink-0", color, className)} strokeWidth={2.6} />
      </TooltipTrigger>
      <TooltipContent>{PRIORITY_LABELS[priority]} priority</TooltipContent>
    </Tooltip>
  );
}

export function ProjectIcon({
  icon,
  color,
  className,
  size = "md",
}: {
  icon: string;
  color: string;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const box = { sm: "size-5 rounded-md", md: "size-8 rounded-lg", lg: "size-11 rounded-xl", xl: "size-16 rounded-2xl" }[size];
  const glyph = { sm: "size-3.5", md: "size-4.5", lg: "size-6", xl: "size-8" }[size];
  const emojiSize = { sm: "text-xs", md: "text-base", lg: "text-2xl", xl: "text-4xl" }[size];
  const [kind, value] = splitIcon(icon);
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center text-white shadow-sm", box, className)}
      style={{ backgroundColor: color }}
    >
      {kind === "emoji" ? (
        <span className={cn("leading-none", emojiSize)}>{value}</span>
      ) : (
        <DynamicIcon name={value as IconName} className={glyph} fallback={() => <span className={glyph} />} />
      )}
    </span>
  );
}

/** "lucide:rocket" → ["lucide", "rocket"]; "emoji:🚀" → ["emoji", "🚀"] */
export function splitIcon(icon: string): ["lucide" | "emoji", string] {
  const i = icon.indexOf(":");
  const kind = icon.slice(0, i);
  return [kind === "emoji" ? "emoji" : "lucide", i >= 0 ? icon.slice(i + 1) : icon];
}

export function ProgressBar({ progress, className, showLabel }: { progress: Progress; className?: string; showLabel?: boolean }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-emerald-500" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs tabular-nums text-muted-foreground">
          {progress.done}/{progress.total}
        </span>
      )}
    </div>
  );
}

const AVATAR_COLORS = ["bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-emerald-500", "bg-teal-500", "bg-sky-500", "bg-indigo-500", "bg-violet-500", "bg-fuchsia-500"];

export function UserAvatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      title={name}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
        AVATAR_COLORS[hash % AVATAR_COLORS.length],
        className,
      )}
    >
      {initials}
    </span>
  );
}

/** Avatar for whoever did something: a person, an AI agent (🤖), GitHub, or the system. */
export function ActorAvatar({ name, type, className }: { name: string; type?: "user" | "agent" | "system" | "integration"; className?: string }) {
  if (!type || type === "user") return <UserAvatar name={name} className={className} />;
  const Icon = type === "agent" ? Bot : type === "integration" ? FaGithub : Settings2;
  return (
    <span
      title={type === "agent" ? `${name} (AI agent)` : name}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-white",
        type === "agent" ? "bg-gradient-to-br from-violet-500 to-fuchsia-500" : "bg-zinc-700 dark:bg-zinc-600",
        className,
      )}
    >
      <Icon className="size-[60%]" strokeWidth={2.2} />
    </span>
  );
}

/** "Triage Bot" + a small AI badge for agents. */
export function ActorName({ name, type }: { name: string; type?: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium text-foreground">
      {name}
      {type === "agent" && <span className="rounded bg-violet-500/15 px-1 text-[10px] font-semibold tracking-wide text-violet-600 uppercase dark:text-violet-300">AI</span>}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center", className)}>
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="pointer-events-none inline-flex h-5 items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}
