import { Check, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { PRIORITIES, PRIORITY_LABELS, TYPE_LABELS, type ItemType, type Priority, type StatusDef } from "@mixedlane/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PriorityIcon, StatusIcon, StatusPill, TypeIcon, UserAvatar } from "@/components/common";
import { api } from "@/lib/api";
import { PRIORITY_META } from "@/lib/meta";
import { useProjectScope } from "@/lib/project";
import { cn } from "@/lib/utils";

function Option({ selected, children, onSelect }: { selected: boolean; children: ReactNode; onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="gap-2">
      {children}
      <Check className={cn("ml-auto size-4", selected ? "opacity-100" : "opacity-0")} />
    </DropdownMenuItem>
  );
}

/** Status dropdown for items inside a <ProjectScope>. */
/** Status dropdown for items inside a <ProjectScope>; read-only without `item.move`. */
export function StatusPicker(props: { value: string; onChange: (s: string) => void; trigger?: ReactNode }) {
  const { project, statusById, can } = useProjectScope();
  const current = statusById(props.value);
  if (!can("item.move")) return <StatusPill status={current} />;
  return <StatusPickerFor {...props} statuses={project.statuses} current={current} />;
}

export function StatusPickerFor({
  value,
  statuses,
  current,
  onChange,
  trigger,
}: {
  value: string;
  statuses: StatusDef[];
  current?: StatusDef;
  onChange: (s: string) => void;
  trigger?: ReactNode;
}) {
  const selected = current ?? statuses.find((s) => s.id === value) ?? statuses[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <button type="button" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {selected && <StatusPill status={selected} />}
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44" onClick={(e) => e.stopPropagation()}>
        {statuses.map((s) => (
          <Option key={s.id} selected={s.id === value} onSelect={() => onChange(s.id)}>
            <StatusIcon status={s} />
            {s.name}
          </Option>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PriorityPicker({ value, onChange, disabled }: { value: Priority; onChange: (p: Priority) => void; disabled?: boolean }) {
  const { icon: Icon, color } = PRIORITY_META[value];
  if (disabled) {
    return (
      <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 text-sm">
        <Icon className={cn("size-4", color)} strokeWidth={2.6} />
        {PRIORITY_LABELS[value]}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className={cn("size-4", color)} strokeWidth={2.6} />
          {PRIORITY_LABELS[value]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        {[...PRIORITIES].reverse().map((p) => (
          <Option key={p} selected={p === value} onSelect={() => onChange(p)}>
            <PriorityIcon priority={p} />
            {PRIORITY_LABELS[p]}
          </Option>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TypePicker({
  value,
  options,
  onChange,
}: {
  value: ItemType;
  options: ItemType[];
  onChange: (t: ItemType) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-sm hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <TypeIcon type={value} />
          {TYPE_LABELS[value]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {options.map((t) => (
          <Option key={t} selected={t === value} onSelect={() => onChange(t)}>
            <TypeIcon type={t} />
            {TYPE_LABELS[t]}
          </Option>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Org members, cached for pickers and @mentions. */
export const useMembers = () => useQuery({ queryKey: ["org", "members"], queryFn: api.orgs.members, staleTime: 60_000 });

/** Pick an org member as assignee (or clear it). Shows legacy free-text assignees too. */
export function AssigneePicker({
  assignee,
  assigneeId,
  onChange,
  disabled,
}: {
  assignee: string | null;
  assigneeId: string | null | undefined;
  onChange: (assigneeId: string | null) => void;
  disabled?: boolean;
}) {
  const { data: members = [] } = useMembers();
  const [open, setOpen] = useState(false);
  const label = (
    <span className="flex min-w-0 items-center gap-1.5">
      {assignee ? <UserAvatar name={assignee} /> : <UserRound className="size-4 text-muted-foreground" />}
      <span className={cn("truncate", !assignee && "text-muted-foreground")}>{assignee ?? "Unassigned"}</span>
    </span>
  );
  if (disabled) return <span className="flex px-1.5">{label}</span>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-7 w-full items-center rounded-md px-1.5 text-left hover:bg-muted">
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Assign to…" />
          <CommandList>
            <CommandEmpty>No members found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="unassigned"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <UserRound className="size-4 text-muted-foreground" /> Unassigned
                <Check className={cn("ml-auto size-4", !assignee ? "opacity-100" : "opacity-0")} />
              </CommandItem>
              {members.map((m) => (
                <CommandItem
                  key={m.userId}
                  value={`${m.name} ${m.email}`}
                  onSelect={() => {
                    onChange(m.userId);
                    setOpen(false);
                  }}
                >
                  <UserAvatar name={m.name} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <Check className={cn("size-4", m.userId === assigneeId ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
