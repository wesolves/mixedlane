import { useMemo, useState, type DragEvent } from "react";
import { NavLink } from "react-router-dom";
import { ChevronRight, FileText, Plus } from "lucide-react";
import type { PageNode } from "@flowboard/shared";
import { useMovePage } from "@/hooks/docs";
import { paths } from "@/lib/project";
import { cn } from "@/lib/utils";

type Drop = { id: string; zone: "before" | "inside" } | { id: "root"; zone: "end" };

interface Props {
  spaceKey: string;
  pages: PageNode[];
  activeId?: string;
  canWrite: boolean;
  onAddChild: (parentId: string | null) => void;
}

/**
 * Nested page tree. Drag a page onto the top edge of another to place it before that page, onto
 * the rest of the row to nest it inside, or onto the bottom area to move it to the top level.
 */
export function PageTree({ spaceKey, pages, activeId, canWrite, onAddChild }: Props) {
  const move = useMovePage(spaceKey);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  const children = useMemo(() => {
    const map = new Map<string | null, PageNode[]>();
    for (const p of pages) map.set(p.parentId, [...(map.get(p.parentId) ?? []), p]);
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [pages]);

  // A page can't be dropped into its own subtree.
  const blocked = useMemo(() => {
    const out = new Set<string>();
    if (!dragId) return out;
    const walk = (id: string) => {
      out.add(id);
      for (const c of children.get(id) ?? []) walk(c.id);
    };
    walk(dragId);
    return out;
  }, [dragId, children]);

  const finish = () => {
    if (dragId && drop) {
      if (drop.zone === "end") move.mutate({ id: dragId, parentId: null, beforeId: null });
      else {
        const target = pages.find((p) => p.id === drop.id)!;
        if (drop.zone === "before") move.mutate({ id: dragId, parentId: target.parentId, beforeId: target.id });
        else {
          move.mutate({ id: dragId, parentId: target.id, beforeId: null });
          setCollapsed((c) => new Set([...c].filter((x) => x !== target.id)));
        }
      }
    }
    setDragId(null);
    setDrop(null);
  };

  const over = (e: DragEvent, node: PageNode) => {
    if (!dragId || blocked.has(node.id)) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const zone = e.clientY - rect.top < rect.height * 0.3 ? "before" : "inside";
    if (drop?.id !== node.id || drop.zone !== zone) setDrop({ id: node.id, zone });
  };

  const render = (node: PageNode, depth: number) => {
    const kids = children.get(node.id) ?? [];
    const open = !collapsed.has(node.id);
    const isDrop = drop && drop.id === node.id;
    return (
      <li key={node.id}>
        <div
          draggable={canWrite}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", node.id);
            setDragId(node.id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDrop(null);
          }}
          onDragOver={(e) => over(e, node)}
          onDrop={(e) => {
            e.preventDefault();
            finish();
          }}
          className={cn(
            "group relative flex h-8 items-center gap-1 rounded-md pr-1 text-sm",
            isDrop && drop.zone === "inside" && "bg-primary/10 ring-1 ring-primary/40",
            dragId === node.id && "opacity-50",
          )}
          style={{ paddingLeft: depth * 14 }}
        >
          {isDrop && drop.zone === "before" && <span className="absolute -top-px right-1 left-1 h-0.5 rounded bg-primary" />}
          <button
            type="button"
            onClick={() => setCollapsed((c) => (c.has(node.id) ? new Set([...c].filter((x) => x !== node.id)) : new Set([...c, node.id])))}
            className={cn("flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted", !kids.length && "invisible")}
            aria-label={open ? "Collapse" : "Expand"}
          >
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
          <NavLink
            to={paths.page(spaceKey, node.id)}
            className={cn(
              "flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 hover:bg-muted",
              node.id === activeId && "bg-muted font-medium text-foreground",
            )}
          >
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{node.title}</span>
          </NavLink>
          {canWrite && (
            <button
              type="button"
              onClick={() => onAddChild(node.id)}
              className="flex size-6 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100"
              aria-label={`Add a page inside ${node.title}`}
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
        {open && kids.length > 0 && <ul>{kids.map((k) => render(k, depth + 1))}</ul>}
      </li>
    );
  };

  const roots = children.get(null) ?? [];
  return (
    <div>
      <ul>{roots.map((r) => render(r, 0))}</ul>
      {dragId && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (drop?.zone !== "end") setDrop({ id: "root", zone: "end" });
          }}
          onDrop={(e) => {
            e.preventDefault();
            finish();
          }}
          className={cn(
            "mt-2 rounded-md border border-dashed px-2 py-2 text-center text-xs text-muted-foreground",
            drop?.zone === "end" && "border-primary bg-primary/5 text-primary",
          )}
        >
          Move to top level
        </div>
      )}
    </div>
  );
}
