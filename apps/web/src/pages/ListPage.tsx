import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Search } from "lucide-react";
import { TYPE_LABELS, defaultChildType, type WorkItemSummary } from "@mixedlane/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, PriorityIcon, ProgressBar, TypeIcon, UserAvatar } from "@/components/common";
import { StatusPicker } from "@/components/pickers";
import { DueDate, QuickAdd } from "@/components/item/ItemViews";
import { useUpdateItem } from "@/hooks/queries";
import { useItemSheet } from "@/hooks/ui";
import { cn } from "@/lib/utils";
import { useProjectScope } from "@/lib/project";
import type { ProjectOutletContext } from "./ProjectLayout";

export function ListPage() {
  const { project, tree } = useOutletContext<ProjectOutletContext>();
  const { open } = useItemSheet();
  const update = useUpdateItem();
  const { statusById } = useProjectScope();
  const topType = defaultChildType(null, project.itemTypes)!;
  const childOf = (t: WorkItemSummary["type"]) => defaultChildType(t, project.itemTypes);
  const [q, setQ] = useState("");
  // Epics and milestones start expanded.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(tree.filter((i) => i.type === "epic" || i.type === "milestone").map((i) => i.id)),
  );

  const children = useMemo(() => {
    const map = new Map<string | null, WorkItemSummary[]>();
    for (const it of tree) {
      const list = map.get(it.parentId) ?? [];
      list.push(it);
      map.set(it.parentId, list);
    }
    return map;
  }, [tree]);

  // When filtering, show matches plus their ancestors, fully expanded.
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    const byId = new Map(tree.map((i) => [i.id, i]));
    const keep = new Set<string>();
    for (const it of tree) {
      if (!it.title.toLowerCase().includes(needle) && !it.key.toLowerCase().includes(needle)) continue;
      let cur: WorkItemSummary | undefined = it;
      while (cur && !keep.has(cur.id)) {
        keep.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    return keep;
  }, [q, tree]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows: { item: WorkItemSummary; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const it of children.get(parentId) ?? []) {
      if (visible && !visible.has(it.id)) continue;
      rows.push({ item: it, depth });
      if (visible || expanded.has(it.id)) walk(it.id, depth + 1);
    }
  };
  walk(null, 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-3">
        <div className="mb-3 flex items-center gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title or key…" className="h-8 w-64 pl-8" />
          </div>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set(tree.map((i) => i.id)))}>
            <ChevronsUpDown className="size-4" /> Expand all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set())}>
            <ChevronsDownUp className="size-4" /> Collapse all
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">{tree.length} items</span>
        </div>

        {tree.length === 0 ? (
          <EmptyState icon={<TypeIcon type={topType} />} title="Nothing here yet" description={`Add a ${TYPE_LABELS[topType].toLowerCase()} to get started.`} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="grid grid-cols-[minmax(0,1fr)_130px_140px_80px_70px_36px] items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>Title</span>
              <span>Status</span>
              <span>Progress</span>
              <span>Due</span>
              <span>Priority</span>
              <span />
            </div>
            <div className="divide-y">
              {rows.map(({ item, depth }) => {
                const hasKids = item.childCount > 0;
                const isOpen = !!visible || expanded.has(item.id);
                const done = statusById(item.status).category === "done";
                const childType = childOf(item.type);
                return (
                  <div key={item.id}>
                    <div
                      onClick={() => open(item.key)}
                      className="grid h-10 cursor-pointer grid-cols-[minmax(0,1fr)_130px_140px_80px_70px_36px] items-center gap-3 px-3 text-sm hover:bg-muted/40"
                    >
                      <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 20 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(item.id);
                          }}
                          className={cn("rounded p-0.5 text-muted-foreground hover:bg-muted", !hasKids && "invisible")}
                          aria-label={isOpen ? "Collapse" : "Expand"}
                        >
                          <ChevronRight className={cn("size-4 transition-transform", isOpen && "rotate-90")} />
                        </button>
                        <TypeIcon type={item.type} />
                        <span className="shrink-0 font-mono text-xs font-medium text-muted-foreground">{item.key}</span>
                        <span
                          className={cn(
                            "truncate",
                            (item.type === "epic" || item.type === "milestone") && "font-medium",
                            done && "text-muted-foreground line-through",
                          )}
                        >
                          {item.title}
                        </span>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <StatusPicker value={item.status} onChange={(status) => update.mutate({ id: item.id, patch: { status } })} />
                      </div>
                      <div>{item.progress.total > 0 && <ProgressBar progress={item.progress} showLabel />}</div>
                      <div>{item.dueDate && <DueDate date={item.dueDate} done={done} />}</div>
                      <div>
                        <PriorityIcon priority={item.priority} />
                      </div>
                      <div>{item.assignee && <UserAvatar name={item.assignee} />}</div>
                    </div>
                    {isOpen && !visible && childType && (item.type === "epic" || item.type === "milestone") && (
                      <div style={{ paddingLeft: (depth + 1) * 20 + 22 }} className="border-t border-dashed">
                        <QuickAdd projectId={project.id} parentId={item.id} type={childType} className="h-8" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {!visible && <QuickAdd projectId={project.id} parentId={null} type={topType} className="border-t" />}
          </div>
        )}
      </div>
    </div>
  );
}
