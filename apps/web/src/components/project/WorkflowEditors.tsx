import { ArrowDown, ArrowUp, ChevronRight, Plus, Trash2 } from "lucide-react";
import {
  ITEM_TYPES,
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABELS,
  STATUS_PRESETS,
  TYPE_LABELS,
  TYPE_PRESETS,
  sortTypes,
  type ItemType,
  type StatusCategory,
  type StatusDef,
} from "@flowboard/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusIcon, TypeIcon } from "@/components/common";
import { cn } from "@/lib/utils";

function PresetChips<T>({ presets, isActive, onPick }: { presets: { name: string; value: T }[]; isActive: (v: T) => boolean; onPick: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-muted-foreground">Presets:</span>
      {presets.map((p) => (
        <button
          key={p.name}
          type="button"
          onClick={() => onPick(p.value)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted",
            isActive(p.value) && "border-primary bg-primary/10 text-primary",
          )}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}

const TYPE_HINTS: Record<ItemType, string> = {
  epic: "Big goals that span weeks or months",
  milestone: "Checkpoints with a target date",
  story: "User-facing features (“As a user I can…”)",
  task: "Concrete pieces of work",
  subtask: "Small steps inside a task",
};

export function ItemTypesEditor({
  value,
  onChange,
  locked,
}: {
  value: ItemType[];
  onChange: (t: ItemType[]) => void;
  /** Types that can't be switched off because items of that type exist. */
  locked?: Partial<Record<ItemType, number>>;
}) {
  const sorted = sortTypes(value);
  const toggle = (t: ItemType) => {
    if (value.includes(t)) {
      if (value.length > 1) onChange(value.filter((x) => x !== t));
    } else onChange(sortTypes([...value, t]));
  };
  return (
    <div className="space-y-3">
      <PresetChips
        presets={TYPE_PRESETS.map((p) => ({ name: p.name, value: p.types }))}
        isActive={(v) => v.join() === sorted.join()}
        onPick={(v) => onChange(v)}
      />
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {ITEM_TYPES.map((t) => {
          const on = value.includes(t);
          const inUse = locked?.[t] ?? 0;
          const disabled = (on && value.length === 1) || (on && inUse > 0);
          return (
            <button
              key={t}
              type="button"
              onClick={() => !disabled && toggle(t)}
              aria-pressed={on}
              title={inUse > 0 && on ? `${inUse} in use — can't be turned off` : undefined}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                on ? "border-primary/60 bg-primary/5" : "opacity-70 hover:bg-muted/50 hover:opacity-100",
                disabled && "cursor-not-allowed",
              )}
            >
              <TypeIcon type={t} boxed />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{TYPE_LABELS[t]}</span>
                <span className="block text-xs text-muted-foreground">
                  {inUse > 0 && on ? `${inUse} in use` : TYPE_HINTS[t]}
                </span>
              </span>
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                  on ? "bg-primary" : "bg-muted-foreground/30",
                )}
              >
                <span className={cn("size-4 rounded-full bg-white shadow transition-transform", on && "translate-x-4")} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-sm">
        <span className="mr-1 text-xs text-muted-foreground">Hierarchy:</span>
        <span className="font-medium">Project</span>
        {sorted.map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <ChevronRight className="size-3.5 text-muted-foreground" />
            <TypeIcon type={t} className="size-3.5" /> {TYPE_LABELS[t]}
          </span>
        ))}
      </div>
    </div>
  );
}

export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 30) || "status";

export function uniqueId(base: string, taken: Set<string>) {
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  return id;
}

const NEW_COLORS: Record<StatusCategory, string> = { todo: "#64748b", in_progress: "#3b82f6", done: "#10b981" };

export function StatusesEditor({ value, onChange }: { value: StatusDef[]; onChange: (s: StatusDef[]) => void }) {
  const update = (i: number, patch: Partial<StatusDef>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const add = () => {
    const taken = new Set(value.map((s) => s.id));
    const name = uniqueName("New status", value);
    onChange([...value, { id: uniqueId(slug(name), taken), name, color: NEW_COLORS.in_progress, category: "in_progress" }]);
  };
  const hasDone = value.some((s) => s.category === "done");

  return (
    <div className="space-y-3">
      <PresetChips
        presets={STATUS_PRESETS.map((p) => ({ name: p.name, value: p.statuses }))}
        isActive={(v) => v.map((s) => s.id + s.name).join() === value.map((s) => s.id + s.name).join()}
        onPick={(v) => onChange(v.map((s) => ({ ...s })))}
      />
      <div className="divide-y overflow-hidden rounded-lg border">
        <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_10rem_5rem] items-center gap-2 bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <span>Color</span>
          <span>Name (board column)</span>
          <span>Counts as</span>
          <span />
        </div>
        {value.map((s, i) => (
          <div key={s.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)_10rem_5rem] items-center gap-2 px-3 py-2">
            <label className="relative size-7 cursor-pointer overflow-hidden rounded-full border shadow-xs" style={{ backgroundColor: s.color }} title="Status color">
              <input type="color" value={s.color} onChange={(e) => update(i, { color: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            <div className="flex items-center gap-2">
              <StatusIcon status={s} />
              <Input
                value={s.name}
                onChange={(e) => update(i, { name: e.target.value })}
                aria-invalid={!s.name.trim() || value.some((o, j) => j !== i && o.name.trim().toLowerCase() === s.name.trim().toLowerCase())}
                className="h-8"
                maxLength={40}
              />
            </div>
            <Select value={s.category} onValueChange={(c) => update(i, { category: c as StatusCategory })}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {STATUS_CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-0.5">
              <IconBtn label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></IconBtn>
              <IconBtn label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}><ArrowDown /></IconBtn>
              <IconBtn label="Remove" disabled={value.length === 1} onClick={() => onChange(value.filter((_, j) => j !== i))} danger><Trash2 /></IconBtn>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={value.length >= 20}>
          <Plus className="size-4" /> Add status
        </Button>
        <p className="text-xs text-muted-foreground">
          New items start in the first status. “Done” statuses count toward progress.
          {!hasDone && <span className="ml-1 font-medium text-amber-600">Tip: add a Done status so progress can be tracked.</span>}
        </p>
      </div>
    </div>
  );
}

function uniqueName(base: string, statuses: StatusDef[]) {
  const names = new Set(statuses.map((s) => s.name.toLowerCase()));
  let name = base;
  for (let i = 2; names.has(name.toLowerCase()); i++) name = `${base} ${i}`;
  return name;
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-4",
        danger && "hover:bg-destructive/10 hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}
