import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MessageSquare, Plus, Rocket } from "lucide-react";
import type { ItemType, StatusDef, WorkItemSummary } from "@flowboard/shared";
import { PriorityIcon, ProgressBar, StatusIcon, TypeIcon, UserAvatar } from "@/components/common";
import { DueDate } from "@/components/item/ItemViews";
import { PR_META } from "@/components/item/DevelopmentPanel";
import { useCreateItemDialog } from "@/components/create/CreateItemDialog";
import { useMoveItem } from "@/hooks/queries";
import { useItemSheet } from "@/hooks/ui";
import { cn } from "@/lib/utils";
import { useProjectScope } from "@/lib/project";

/** Status id → ordered card ids. */
type Columns = Record<string, string[]>;

function toColumns(items: WorkItemSummary[], statuses: StatusDef[]): Columns {
  const cols: Columns = Object.fromEntries(statuses.map((s) => [s.id, [] as string[]]));
  for (const it of [...items].sort((a, b) => a.sortOrder - b.sortOrder)) {
    // Unknown statuses (shouldn't happen) land in the first column rather than vanishing.
    (cols[it.status] ?? cols[statuses[0].id]).push(it.id);
  }
  return cols;
}

function findColumn(cols: Columns, id: string): string | undefined {
  if (id in cols) return id;
  return Object.keys(cols).find((s) => cols[s].includes(id));
}

export function KanbanBoard({
  projectKey,
  items,
  contextOf,
  createType,
}: {
  projectKey: string;
  items: WorkItemSummary[];
  /** Type created by a column's "+" button. */
  createType: ItemType;
  /** Short breadcrumb (e.g. milestone name) shown on each card. */
  contextOf: (item: WorkItemSummary) => string | undefined;
}) {
  const { project } = useProjectScope();
  const statuses = project.statuses;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [columns, setColumns] = useState<Columns>(() => toColumns(items, statuses));
  const [activeId, setActiveId] = useState<string | null>(null);
  const move = useMoveItem(projectKey);
  const { open } = useItemSheet();
  const openCreate = useCreateItemDialog();

  const dragging = useRef(false);
  dragging.current = activeId !== null;

  // Re-sync when server data changes, but never mid-drag. Not keyed on activeId so a
  // drop doesn't flash back to the pre-move order before the optimistic update lands.
  useEffect(() => {
    if (!dragging.current) setColumns(toColumns(items, statuses));
  }, [items, statuses]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id));

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = findColumn(columns, String(active.id));
    const to = findColumn(columns, String(over.id));
    if (!from || !to || from === to) return;
    setColumns((cols) => {
      const fromList = cols[from].filter((id) => id !== active.id);
      const overIndex = cols[to].indexOf(String(over.id));
      const toList = [...cols[to]];
      toList.splice(overIndex >= 0 ? overIndex : toList.length, 0, String(active.id));
      return { ...cols, [from]: fromList, [to]: toList };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    setActiveId(null);
    if (!over) return setColumns(toColumns(items, statuses));
    const col = findColumn(columns, id);
    if (!col) return;

    let list = columns[col];
    const oldIndex = list.indexOf(id);
    const overIndex = list.indexOf(String(over.id));
    if (overIndex >= 0 && overIndex !== oldIndex) {
      list = [...list];
      list.splice(oldIndex, 1);
      list.splice(overIndex, 0, id);
      setColumns((c) => ({ ...c, [col]: list }));
    }

    const idx = list.indexOf(id);
    const prev = byId.get(list[idx - 1])?.sortOrder;
    const next = byId.get(list[idx + 1])?.sortOrder;
    const sortOrder =
      prev !== undefined && next !== undefined ? (prev + next) / 2 : prev !== undefined ? prev + 1000 : next !== undefined ? next - 1000 : 1000;

    const item = byId.get(id)!;
    if (item.status === col && list.join() === toColumns(items, statuses)[col].join()) return;
    move.mutate({ id, move: { status: col, sortOrder } });
  };

  const active = activeId ? byId.get(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setColumns(toColumns(items, statuses));
      }}
    >
      <div className="flex h-full gap-3 overflow-x-auto px-6 pb-4 scroll-thin">
        {statuses.map((status) => (
          <Column
            key={status.id}
            status={status}
            ids={columns[status.id] ?? []}
            byId={byId}
            contextOf={contextOf}
            onOpen={open}
            onAdd={() => openCreate({ projectKey, status: status.id, type: createType })}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {active && <CardBody item={active} context={contextOf(active)} overlay />}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  ids,
  byId,
  contextOf,
  onOpen,
  onAdd,
}: {
  status: StatusDef;
  ids: string[];
  byId: Map<string, WorkItemSummary>;
  contextOf: (item: WorkItemSummary) => string | undefined;
  onOpen: (key: string) => void;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
  const canCreate = useProjectScope().can("item.create");
  const points = ids.reduce((sum, id) => sum + (byId.get(id)?.estimate ?? 0), 0);
  return (
    <div className="flex h-full w-72 shrink-0 flex-col rounded-xl bg-muted dark:bg-card">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <StatusIcon status={status} />
        <h3 className="truncate text-sm font-semibold">{status.name}</h3>
        <span className="rounded-full bg-background px-1.5 text-xs font-medium tabular-nums text-muted-foreground">{ids.length}</span>
        {points > 0 && <span className="text-xs text-muted-foreground">{points} pts</span>}
        {canCreate && <button onClick={onAdd} className="ml-auto rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" aria-label={`Add to ${status.name}`}>
          <Plus className="size-4" />
        </button>}
      </div>
      <SortableContext id={status.id} items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn("flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 scroll-thin transition-colors", isOver && "bg-primary/5")}
        >
          {ids.map((id) => {
            const item = byId.get(id);
            return item ? <SortableCard key={id} item={item} context={contextOf(item)} onOpen={onOpen} /> : null;
          })}
          {ids.length === 0 && (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/80 py-8 text-xs text-muted-foreground">
              Drop here
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableCard({ item, context, onOpen }: { item: WorkItemSummary; context?: string; onOpen: (key: string) => void }) {
  // Without item.move cards are static (click still opens them).
  const canMove = useProjectScope().can("item.move");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !canMove });
  // dnd-kit marks disabled sortables aria-disabled; a read-only card is still a working button.
  const dragProps = canMove ? { ...attributes, ...listeners } : { role: "button", tabIndex: 0 };
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...dragProps}
      onClick={() => onOpen(item.key)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(item.key);
        listeners?.onKeyDown?.(e);
      }}
      className={cn("outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg", isDragging && "opacity-40")}
    >
      <CardBody item={item} context={context} />
    </div>
  );
}

function CardBody({ item, context, overlay }: { item: WorkItemSummary; context?: string; overlay?: boolean }) {
  const done = useProjectScope().statusById(item.status).category === "done";
  return (
    <div
      className={cn(
        "cursor-grab rounded-lg border bg-card p-3 shadow-xs transition-shadow hover:border-primary/30 hover:shadow-sm active:cursor-grabbing",
        overlay && "rotate-2 cursor-grabbing shadow-xl ring-1 ring-primary/30",
      )}
    >
      {context && <p className="mb-1 truncate text-[11px] font-medium text-muted-foreground">{context}</p>}
      <p className="text-sm leading-snug font-medium">{item.title}</p>
      {item.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.labels.map((l) => (
            <span key={l} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {l}
            </span>
          ))}
        </div>
      )}
      {item.progress.total > 0 && <ProgressBar progress={item.progress} showLabel className="mt-2.5" />}
      <div className="mt-3 flex items-center gap-2">
        <TypeIcon type={item.type} className="size-3.5" />
        <span className="font-mono text-xs font-medium text-muted-foreground">{item.key}</span>
        <PriorityIcon priority={item.priority} className="size-3.5" />
        {item.commentCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
            <MessageSquare className="size-3" /> {item.commentCount}
          </span>
        )}
        {item.dev && item.dev.prs > 0 && <PrBadge dev={item.dev} />}
        {item.dev?.deployed && <Rocket className="size-3.5 text-emerald-500" aria-label="Deployed" />}
        {item.estimate != null && (
          <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">{item.estimate}</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {item.dueDate && <DueDate date={item.dueDate} done={done} />}
          {item.assignee && <UserAvatar name={item.assignee} className="size-5 text-[9px]" />}
        </span>
      </div>
    </div>
  );
}

function PrBadge({ dev }: { dev: NonNullable<WorkItemSummary["dev"]> }) {
  const meta = PR_META[dev.openPrs > 0 ? "open" : dev.mergedPrs > 0 ? "merged" : "closed"];
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs", meta.color)}
      title={`${dev.prs} pull request${dev.prs > 1 ? "s" : ""} (${dev.openPrs} open, ${dev.mergedPrs} merged)`}
    >
      <meta.icon className="size-3.5" />
      {dev.prs > 1 && dev.prs}
    </span>
  );
}
