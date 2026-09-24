import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Search, X } from "lucide-react";
import { PRIORITIES, PRIORITY_LABELS, TYPE_PLURALS, boardTypes, type ItemType, type WorkItemSummary } from "@flowboard/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KanbanBoard } from "@/components/board/KanbanBoard";
import { PriorityIcon, TypeIcon, UserAvatar } from "@/components/common";
import { cn } from "@/lib/utils";
import type { ProjectOutletContext } from "./ProjectLayout";

const ALL = "all";

function ancestorOfType(item: WorkItemSummary, type: ItemType, byId: Map<string, WorkItemSummary>) {
  let cur = item.parentId ? byId.get(item.parentId) : undefined;
  while (cur) {
    if (cur.type === type) return cur;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return undefined;
}

export function BoardPage() {
  const { project, tree } = useOutletContext<ProjectOutletContext>();
  const [q, setQ] = useState("");
  const types = useMemo(() => boardTypes(project.itemTypes), [project.itemTypes]);
  const [type, setType] = useState<string>(ALL);
  const hasEpics = project.itemTypes.includes("epic");
  const hasMilestones = project.itemTypes.includes("milestone");
  const [epic, setEpic] = useState(ALL);
  const [milestone, setMilestone] = useState(ALL);
  const [assignee, setAssignee] = useState(ALL);
  const [priority, setPriority] = useState(ALL);

  const byId = useMemo(() => new Map(tree.map((i) => [i.id, i])), [tree]);
  const epics = tree.filter((i) => i.type === "epic");
  const milestones = tree.filter((i) => i.type === "milestone" && (epic === ALL || i.parentId === epic));
  const assignees = [...new Set(tree.map((i) => i.assignee).filter(Boolean) as string[])].sort();

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tree.filter((i) => {
      if (!types.includes(i.type)) return false;
      if (type !== ALL && i.type !== type) return false;
      if (epic !== ALL && ancestorOfType(i, "epic", byId)?.id !== epic) return false;
      if (milestone !== ALL && ancestorOfType(i, "milestone", byId)?.id !== milestone) return false;
      if (assignee !== ALL && (i.assignee ?? "") !== (assignee === "none" ? "" : assignee)) return false;
      if (priority !== ALL && i.priority !== priority) return false;
      if (needle && !i.title.toLowerCase().includes(needle) && !i.key.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [tree, byId, q, type, epic, milestone, assignee, priority, types]);

  const contextOf = (item: WorkItemSummary) => {
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    return parent ? `${parent.key} · ${parent.title}` : undefined;
  };

  const filtered = q || type !== ALL || epic !== ALL || milestone !== ALL || assignee !== ALL || priority !== ALL;
  const reset = () => {
    setQ("");
    setType(ALL);
    setEpic(ALL);
    setMilestone(ALL);
    setAssignee(ALL);
    setPriority(ALL);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter cards…" className="h-8 w-52 pl-8" />
        </div>

        {types.length > 1 && (
        <div className="flex h-8 items-center rounded-md border p-0.5">
          {([ALL, ...types] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cn(
                "flex h-full items-center gap-1.5 rounded px-2.5 text-xs font-medium text-muted-foreground transition-colors",
                type === t && "bg-muted text-foreground",
              )}
            >
              {t !== ALL && <TypeIcon type={t as ItemType} className="size-3.5" />}
              {t === ALL ? "All" : TYPE_PLURALS[t as ItemType]}
            </button>
          ))}
        </div>
        )}

        {hasEpics && (
        <FilterSelect value={epic} onChange={(v) => { setEpic(v); setMilestone(ALL); }} placeholder="All epics">
          {epics.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              <TypeIcon type="epic" /> {e.title}
            </SelectItem>
          ))}
        </FilterSelect>
        )}
        {hasMilestones && (
        <FilterSelect value={milestone} onChange={setMilestone} placeholder="All milestones">
          {milestones.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              <TypeIcon type="milestone" /> {m.title}
            </SelectItem>
          ))}
        </FilterSelect>
        )}
        <FilterSelect value={assignee} onChange={setAssignee} placeholder="Anyone">
          <SelectItem value="none">Unassigned</SelectItem>
          {assignees.map((a) => (
            <SelectItem key={a} value={a}>
              <UserAvatar name={a} className="size-5 text-[9px]" /> {a}
            </SelectItem>
          ))}
        </FilterSelect>
        <FilterSelect value={priority} onChange={setPriority} placeholder="Any priority">
          {[...PRIORITIES].reverse().map((p) => (
            <SelectItem key={p} value={p}>
              <PriorityIcon priority={p} /> {PRIORITY_LABELS[p]}
            </SelectItem>
          ))}
        </FilterSelect>

        {filtered && (
          <Button variant="ghost" size="sm" onClick={reset} className="h-8">
            <X className="size-4" /> Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{items.length} cards</span>
      </div>

      <div className="min-h-0 flex-1">
        <KanbanBoard projectKey={project.key} items={items} contextOf={contextOf} createType={types.includes("task") ? "task" : types[0]} />
      </div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className={cn("max-w-48", value !== ALL && "border-primary/50 bg-primary/5")}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {children}
      </SelectContent>
    </Select>
  );
}
