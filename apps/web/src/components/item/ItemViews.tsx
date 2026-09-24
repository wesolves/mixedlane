import { useState } from "react";
import { format, isPast, parseISO } from "date-fns";
import { CalendarDays, MessageSquare, Plus } from "lucide-react";
import { TYPE_LABELS, type ItemType, type WorkItemSummary } from "@flowboard/shared";
import { Input } from "@/components/ui/input";
import { PriorityIcon, ProgressBar, StatusPill, TypeIcon, UserAvatar } from "@/components/common";
import { StatusPicker } from "@/components/pickers";
import { useCreateItem, useUpdateItem } from "@/hooks/queries";
import { cn } from "@/lib/utils";
import { useProjectScope } from "@/lib/project";

export type OpenItem = (item: { key: string; type: ItemType }) => void;

export function DueDate({ date, done, className }: { date: string; done?: boolean; className?: string }) {
  const d = parseISO(date);
  const overdue = !done && isPast(d);
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", overdue ? "text-red-500" : "text-muted-foreground", className)}>
      <CalendarDays className="size-3.5" />
      {format(d, "MMM d")}
    </span>
  );
}

/** Compact one-line row used in child lists. */
export function ItemRow({ item, onOpen }: { item: WorkItemSummary; onOpen: OpenItem }) {
  const update = useUpdateItem();
  const done = useProjectScope().statusById(item.status).category === "done";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(item)}
      className="group flex h-11 cursor-pointer items-center gap-3 px-3 text-sm transition-colors hover:bg-muted/50"
    >
      <TypeIcon type={item.type} />
      <span className="w-24 shrink-0 font-mono text-xs font-medium text-muted-foreground">{item.key}</span>
      <span className={cn("min-w-0 flex-1 truncate", done && "text-muted-foreground line-through")}>
        {item.title}
      </span>
      {item.progress.total > 0 && <ProgressBar progress={item.progress} showLabel className="hidden w-28 sm:flex" />}
      {item.commentCount > 0 && (
        <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
          <MessageSquare className="size-3.5" /> {item.commentCount}
        </span>
      )}
      {item.dueDate && <DueDate date={item.dueDate} done={done} />}
      <PriorityIcon priority={item.priority} />
      <div onClick={(e) => e.stopPropagation()}>
        <StatusPicker value={item.status} onChange={(status) => update.mutate({ id: item.id, patch: { status } })} />
      </div>
      {item.assignee ? <UserAvatar name={item.assignee} /> : <span className="size-6 rounded-full border border-dashed" />}
    </div>
  );
}

/** Larger card used for epics and milestones. */
export function ItemCard({ item, onOpen }: { item: WorkItemSummary; onOpen: OpenItem }) {
  const status = useProjectScope().statusById(item.status);
  const pct = item.progress.total ? Math.round((item.progress.done / item.progress.total) * 100) : 0;
  return (
    <button
      onClick={() => onOpen(item)}
      className="group flex flex-col rounded-xl border bg-card p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      <div className="flex items-center gap-2">
        <TypeIcon type={item.type} boxed />
        <span className="font-mono text-xs font-medium text-muted-foreground">{item.key}</span>
        <StatusPill status={status} className="ml-auto" />
      </div>
      <h3 className="mt-3 line-clamp-2 font-semibold leading-snug group-hover:text-primary">{item.title}</h3>
      <div className="mt-auto pt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {item.childCount} {item.childCount === 1 ? "item" : "items"}
          </span>
          <span className="font-medium tabular-nums text-foreground">{pct}%</span>
        </div>
        <ProgressBar progress={item.progress} />
        <div className="mt-3 flex items-center gap-2">
          <PriorityIcon priority={item.priority} />
          {item.dueDate && <DueDate date={item.dueDate} done={status.category === "done"} />}
          {item.assignee && <UserAvatar name={item.assignee} className="ml-auto" />}
        </div>
      </div>
    </button>
  );
}

/** Inline "type and press Enter" creator. */
export function QuickAdd({
  projectId,
  parentId,
  type,
  className,
}: {
  projectId: string;
  parentId: string | null;
  type: ItemType;
  className?: string;
}) {
  const [active, setActive] = useState(false);
  const [title, setTitle] = useState("");
  const create = useCreateItem();
  const { can } = useProjectScope();

  const submit = async () => {
    if (!title.trim()) return;
    await create.mutateAsync({ projectId, parentId, type, title: title.trim() });
    setTitle("");
  };

  if (!can("item.create")) return null;
  if (!active) {
    return (
      <button
        onClick={() => setActive(true)}
        className={cn("flex h-10 w-full items-center gap-2 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground", className)}
      >
        <Plus className="size-4" /> Add {TYPE_LABELS[type].toLowerCase()}
      </button>
    );
  }
  return (
    <div className={cn("flex items-center gap-2 px-2 py-1.5", className)}>
      <TypeIcon type={type} className="ml-1" />
      <Input
        autoFocus
        value={title}
        disabled={create.isPending}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setActive(false);
        }}
        onBlur={() => !title && setActive(false)}
        placeholder={`${TYPE_LABELS[type]} title — Enter to add, Esc to close`}
        className="h-8 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
