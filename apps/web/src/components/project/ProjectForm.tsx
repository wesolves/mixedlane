import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  DEFAULT_STATUSES,
  ITEM_TYPES,
  formatItemKey,
  type ItemType,
  type Project,
  type StatusDef,
  type WorkItemSummary,
} from "@mixedlane/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProjectIcon } from "@/components/common";
import { ColorPicker, IconPicker } from "@/components/project/AppearancePickers";
import { ItemTypesEditor, StatusesEditor, slug, uniqueId } from "@/components/project/WorkflowEditors";
import { useCreateProject, useDeleteProject, useUpdateProject } from "@/hooks/queries";
import { paths } from "@/lib/project";
import { cn } from "@/lib/utils";

const CODE = /^[A-Z][A-Z0-9]{1,4}$/;

const suggestCode = (name: string) => {
  const words = name.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const code = words.length === 1 ? words[0].slice(0, 3) : words.map((w) => w[0]).join("").slice(0, 5);
  return /^[A-Z]/.test(code) ? code : `P${code}`.slice(0, 5);
};

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b py-8 last:border-b-0 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/**
 * Statuses that already exist keep their id (items reference it); new ones get an id
 * derived from their final name, e.g. "Code Review" → code_review.
 */
function finalizeStatuses(statuses: StatusDef[], saved: StatusDef[]): StatusDef[] {
  const savedIds = new Set(saved.map((s) => s.id));
  const taken = new Set(statuses.filter((s) => savedIds.has(s.id)).map((s) => s.id));
  return statuses.map((s) => {
    const name = s.name.trim();
    if (savedIds.has(s.id)) return { ...s, name };
    const id = uniqueId(slug(name), taken);
    taken.add(id);
    return { ...s, id, name };
  });
}

/** Create a project, or edit one (settings) when `project` is passed. */
export function ProjectForm({ project, tree }: { project?: Project; tree?: WorkItemSummary[] }) {
  const navigate = useNavigate();
  const editing = !!project;
  const [name, setName] = useState(project?.name ?? "");
  const [code, setCode] = useState(project?.key ?? "");
  const [codeTouched, setCodeTouched] = useState(editing);
  const [description, setDescription] = useState(project?.description ?? "");
  const [digits, setDigits] = useState(project?.keyDigits ?? 4);
  const [color, setColor] = useState(project?.color ?? "#6366f1");
  const [icon, setIcon] = useState(project?.icon ?? "lucide:rocket");
  const [itemTypes, setItemTypes] = useState<ItemType[]>(project?.itemTypes ?? [...ITEM_TYPES]);
  const [statuses, setStatuses] = useState<StatusDef[]>(project?.statuses ?? DEFAULT_STATUSES.map((s) => ({ ...s })));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const create = useCreateProject();
  const update = useUpdateProject();
  const remove = useDeleteProject();
  const pending = create.isPending || update.isPending;

  const inUse = useMemo(() => {
    const counts: Partial<Record<ItemType, number>> = {};
    for (const it of tree ?? []) counts[it.type] = (counts[it.type] ?? 0) + 1;
    return counts;
  }, [tree]);

  const statusError = useMemo(() => {
    if (statuses.some((s) => !s.name.trim())) return "Every status needs a name";
    const names = statuses.map((s) => s.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) return "Status names must be unique";
    return null;
  }, [statuses]);
  const codeValid = CODE.test(code);
  const canSubmit = name.trim() && codeValid && !statusError && itemTypes.length > 0 && !pending;

  const submit = async () => {
    if (!canSubmit) return;
    const body = {
      name: name.trim(),
      description,
      color,
      icon,
      itemTypes,
      statuses: finalizeStatuses(statuses, project?.statuses ?? []),
    };
    if (project) {
      await update.mutateAsync({ id: project.id, patch: body });
      toast.success("Project settings saved");
    } else {
      const p = await create.mutateAsync({ ...body, key: code, keyDigits: digits });
      toast.success(`${p.name} created`);
      navigate(paths.project(p.key));
    }
  };

  return (
    <form
      className="px-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="max-w-5xl">
        <Section title="Basics" description="The name and code identify the project. Every item key starts with the code.">
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <div className="grid gap-1.5">
                <Label htmlFor="pname">Project name</Label>
                <Input
                  id="pname"
                  autoFocus={!editing}
                  value={name}
                  placeholder="e.g. Mobile App"
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!codeTouched) setCode(suggestCode(e.target.value));
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pcode">Project code</Label>
                <Input
                  id="pcode"
                  value={code}
                  disabled={editing}
                  maxLength={5}
                  aria-invalid={!!code && !codeValid}
                  onChange={(e) => {
                    setCodeTouched(true);
                    setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                  }}
                  className="font-mono uppercase"
                />
              </div>
            </div>
            <p className={cn("-mt-2 text-xs", code && !codeValid ? "text-destructive" : "text-muted-foreground")}>
              {editing ? "The code can't be changed after creation — links would break." : "2–5 letters or digits, starting with a letter."}
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="pdesc">Description</Label>
              <Textarea id="pdesc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this project about?" rows={3} />
            </div>
            <div className="grid gap-1.5">
              <Label>Item number length</Label>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-9 items-center rounded-md border p-0.5">
                  {[4, 5, 6].map((d) => (
                    <button
                      key={d}
                      type="button"
                      disabled={editing}
                      onClick={() => setDigits(d)}
                      className={cn(
                        "h-full rounded px-3 text-sm font-medium text-muted-foreground transition-colors disabled:cursor-not-allowed",
                        digits === d && "bg-muted text-foreground",
                      )}
                    >
                      {d} digits
                    </button>
                  ))}
                </div>
                <span className="text-sm text-muted-foreground">
                  Keys look like{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{formatItemKey(code || "APP", 1, digits)}</code>
                  {" "}— up to {(10 ** digits - 1).toLocaleString()} items.
                </span>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Appearance" description="Any color, any icon or emoji — it shows in the sidebar and on project cards.">
          <div className="grid gap-6">
            <div className="flex items-center gap-4 rounded-xl border bg-card p-4">
              <ProjectIcon icon={icon} color={color} size="xl" />
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">{name || "Project name"}</p>
                <p className="text-sm text-muted-foreground">{code || "CODE"} · Preview</p>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Color</Label>
              <ColorPicker value={color} onChange={setColor} />
            </div>
            <div className="grid gap-2">
              <Label>Icon</Label>
              <IconPicker value={icon} color={color} onChange={setIcon} />
            </div>
          </div>
        </Section>

        <Section
          title="Work item types"
          description="Only use the levels you need — e.g. just Tasks and Subtasks for a small project. You can change this later."
        >
          <ItemTypesEditor value={itemTypes} onChange={setItemTypes} locked={editing ? inUse : undefined} />
        </Section>

        <Section
          title="Workflow"
          description="Statuses become the board columns, in this order. Removing a status moves its items to another status of the same kind."
        >
          <StatusesEditor value={statuses} onChange={setStatuses} />
          {statusError && <p className="mt-2 text-sm text-destructive">{statusError}</p>}
        </Section>

        {project && (
          <Section title="Danger zone" description="Deleting a project removes all of its work items, comments and history.">
            <Button type="button" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" /> Delete project
            </Button>
          </Section>
        )}
      </div>

      <div className="sticky bottom-0 -mx-6 flex items-center justify-end gap-2 border-t bg-background/90 px-6 py-3 backdrop-blur">
        <Button type="button" variant="ghost" onClick={() => navigate(project ? paths.project(project.key) : paths.projects())}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {editing ? "Save changes" : "Create project"}
        </Button>
      </div>

      {project && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the project and all {tree?.length ?? 0} work items, comments and history in it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={async () => {
                  await remove.mutateAsync(project.id);
                  toast.success("Project deleted");
                  navigate(paths.projects());
                }}
              >
                Delete project
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </form>
  );
}
