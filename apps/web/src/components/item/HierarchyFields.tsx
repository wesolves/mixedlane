import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { TYPE_LABELS, allowedParentTypes, canBeRoot, type Breadcrumb, type ItemUpdate, type WorkItemDetail } from "@mixedlane/shared";
import { TypeIcon } from "@/components/common";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useProjectTree } from "@/hooks/queries";
import { useProjectScope } from "@/lib/project";

type ContainerType = "epic" | "milestone";
type Save = (patch: ItemUpdate) => Promise<unknown> | void;

/** These fields reflect ancestors, not independent links to unrelated containers. */
export function HierarchyFields({ item, onSave }: { item: WorkItemDetail; onSave: Save }) {
  const { project, can } = useProjectScope();
  const canEdit = can("item.update");
  const allowed = allowedParentTypes(item.type, project.itemTypes);
  const visible = (["epic", "milestone"] as const).filter((type) => allowed.includes(type));
  const tree = useProjectTree(canEdit && visible.length ? project.key : undefined);
  const [saving, setSaving] = useState(false);
  const epic = item.ancestors.find((a) => a.type === "epic");
  const parent = item.ancestors.at(-1);

  const move = async (parentId: string | null) => {
    if (saving || !canEdit || parentId === item.parentId) return;
    setSaving(true);
    try { await onSave({ parentId }); }
    finally { setSaving(false); }
  };

  return visible.map((type) => {
    const current = item.ancestors.find((a) => a.type === type);
    // Removing a milestone keeps the epic; removing an epic clears the whole chain.
    const clearParent = type === "milestone" ? epic?.id ?? null : null;
    const canClear = clearParent !== null || canBeRoot(item.type, project.itemTypes);
    return (
      <div key={type} className="grid grid-cols-[96px_1fr] items-start gap-2 py-1.5 text-sm">
        <span className="pt-1 text-muted-foreground">{TYPE_LABELS[type]}</span>
        <div className="min-w-0">
          <HierarchyPicker
            key={`${item.id}:${type}`}
            type={type}
            current={current}
            options={(tree.data ?? []).filter((candidate) => candidate.projectId === item.projectId && candidate.type === type && candidate.id !== item.id).map((candidate) => ({
              ...candidate,
              epicKey: type === "milestone" ? tree.data?.find((ancestor) => ancestor.id === candidate.parentId && ancestor.type === "epic")?.key : undefined,
            }))}
            disabled={!canEdit || saving}
            loading={tree.isLoading}
            error={tree.error?.message}
            clearLabel={type === "milestone" && epic ? `No milestone · keep ${epic.key}` : `No ${type} · project root`}
            canClear={canClear}
            onSelect={(id) => move(id ?? clearParent)}
          />
          {current && parent && current.id !== parent.id && <p className="mt-0.5 px-1.5 text-xs text-muted-foreground">Via {parent.key}</p>}
        </div>
      </div>
    );
  });
}

function HierarchyPicker({ type, current, options, disabled, loading, error, clearLabel, canClear, onSelect }: {
  type: ContainerType;
  current?: Breadcrumb;
  options: (Breadcrumb & { epicKey?: string })[];
  disabled: boolean;
  loading: boolean;
  error?: string;
  clearLabel: string;
  canClear: boolean;
  onSelect: (id: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const label = (
    <>
      <TypeIcon type={type} className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {current ? <><span className="block font-mono text-xs text-muted-foreground">{current.key}</span><span className="block truncate">{current.title}</span></> : <span className="text-muted-foreground">No {type}</span>}
      </span>
    </>
  );
  if (disabled) return <div className="flex gap-1.5 px-1.5 py-0.5" title={current ? `${current.key}: ${current.title}` : undefined}>{label}</div>;
  const select = async (id: string | null) => {
    try {
      await onSelect(id);
      setOpen(false);
    } catch { /* The mutation displays the error; keep the current relationship. */ }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Change ${type}`} title={current ? `${current.key}: ${current.title}` : undefined} className="flex w-full items-start gap-1.5 rounded-md px-1.5 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          {label}<ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <Command>
          <CommandInput aria-label={`Search ${type}s`} placeholder={`Search ${type}s by key or title…`} />
          <CommandList>
            {loading ? <p className="p-4 text-sm text-muted-foreground">Loading {type}s…</p> : error ? <p role="alert" className="p-4 text-sm text-destructive">{error}</p> : <>
              <CommandEmpty>No {type}s found.</CommandEmpty>
              <CommandGroup>
                {current && canClear && <CommandItem value={clearLabel} onSelect={() => void select(null)}>{clearLabel}</CommandItem>}
                {options.map((option) => <CommandItem key={option.id} value={`${option.key} ${option.title} ${option.epicKey ?? ""}`} onSelect={() => void select(option.id)}>
                  <TypeIcon type={type} />
                  <span className="min-w-0 flex-1"><span className="block font-mono text-xs text-muted-foreground">{option.key}{option.epicKey && ` · ${option.epicKey}`}</span><span className="block truncate">{option.title}</span></span>
                  {current?.id === option.id && <Check className="size-4" />}
                </CommandItem>)}
              </CommandGroup>
            </>}
          </CommandList>
        </Command>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">Choosing {type === "epic" ? "an epic" : "a milestone"} moves this ticket directly into it{type === "epic" ? ", leaving its current milestone or story" : ", leaving its current story"}.</p>
      </PopoverContent>
    </Popover>
  );
}
