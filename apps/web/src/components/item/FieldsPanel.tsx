import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import { X } from "lucide-react";
import { TYPE_LABELS, type ItemUpdate, type WorkItemDetail } from "@flowboard/shared";
import { Input } from "@/components/ui/input";
import { AssigneePicker, PriorityPicker, StatusPicker } from "@/components/pickers";
import { TypeIcon } from "@/components/common";
import { useProjectScope } from "@/lib/project";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-center gap-2 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Text input that saves on blur / Enter, looking like plain text until focused. */
function InlineInput({
  value,
  onSave,
  placeholder,
  type = "text",
  prefix,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  type?: string;
  prefix?: ReactNode;
}) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  const commit = () => draft !== value && onSave(draft);
  return (
    <div className="flex items-center gap-1.5">
      {prefix}
      <Input
        type={type}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="h-7 border-transparent bg-transparent px-1.5 shadow-none hover:border-input focus-visible:border-input dark:bg-transparent"
      />
    </div>
  );
}

function Labels({ labels, onChange }: { labels: string[]; onChange: (l: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const l = draft.trim().toLowerCase();
    if (l && !labels.includes(l)) onChange([...labels, l]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {labels.map((l) => (
        <span key={l} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
          {l}
          <button onClick={() => onChange(labels.filter((x) => x !== l))} aria-label={`Remove ${l}`} className="rounded hover:bg-primary/20">
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder={labels.length ? "+" : "Add label"}
        className="h-6 min-w-12 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export function FieldsPanel({ item, onSave }: { item: WorkItemDetail; onSave: (patch: ItemUpdate) => void }) {
  // Without item.update every field below is read-only (a disabled fieldset disables them all).
  const canEdit = useProjectScope().can("item.update");
  return (
    <fieldset disabled={!canEdit} className="divide-y disabled:[&_input]:cursor-default">
      <div className="pb-2">
        <Field label="Status">
          <StatusPicker value={item.status} onChange={(status) => onSave({ status })} />
        </Field>
        <Field label="Priority">
          <PriorityPicker value={item.priority} disabled={!canEdit} onChange={(priority) => onSave({ priority })} />
        </Field>
        <Field label="Assignee">
          <AssigneePicker assignee={item.assignee} assigneeId={item.assigneeId} disabled={!canEdit} onChange={(assigneeId) => onSave({ assigneeId })} />
        </Field>
        <Field label="Type">
          <span className="inline-flex items-center gap-1.5 px-1.5">
            <TypeIcon type={item.type} /> {TYPE_LABELS[item.type]}
          </span>
        </Field>
        <Field label="Labels">
          <Labels labels={item.labels} onChange={(labels) => onSave({ labels })} />
        </Field>
      </div>
      <div className="py-2">
        <Field label="Start date">
          <InlineInput type="date" value={item.startDate ?? ""} onSave={(v) => onSave({ startDate: v || null })} />
        </Field>
        <Field label="Due date">
          <InlineInput type="date" value={item.dueDate ?? ""} onSave={(v) => onSave({ dueDate: v || null })} />
        </Field>
        <Field label="Estimate">
          <InlineInput
            type="number"
            value={item.estimate?.toString() ?? ""}
            placeholder="Story points"
            onSave={(v) => onSave({ estimate: v === "" ? null : Number(v) })}
          />
        </Field>
      </div>
      <div className="space-y-1 pt-3 text-xs text-muted-foreground">
        <p>Created {format(new Date(item.createdAt), "MMM d, yyyy 'at' HH:mm")}</p>
        <p>Updated {format(new Date(item.updatedAt), "MMM d, yyyy 'at' HH:mm")}</p>
      </div>
    </fieldset>
  );
}
