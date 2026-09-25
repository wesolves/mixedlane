import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  TYPE_LABELS,
  allowedParentTypes,
  canBeRoot,
  childTypes,
  sortTypes,
  type ItemType,
  type Priority,
  type ProjectWithStats,
} from "@mixedlane/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AssigneePicker, useMembers, PriorityPicker, StatusPickerFor, TypePicker } from "@/components/pickers";
import { ProjectIcon, TypeIcon } from "@/components/common";
import { RichEditor } from "@/components/editor/RichEditor";
import { useCreateItem, useProjects, useProjectTree } from "@/hooks/queries";
import { paths } from "@/lib/project";

export interface CreateItemOptions {
  projectKey?: string;
  parentId?: string | null;
  type?: ItemType;
  status?: string;
}

const CreateItemContext = createContext<(opts?: CreateItemOptions) => void>(() => {});
export const useCreateItemDialog = () => useContext(CreateItemContext);

const NO_PARENT = "__none__";

export function CreateItemProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<CreateItemOptions | null>(null);
  const open = useCallback((o?: CreateItemOptions) => setOpts(o ?? {}), []);
  return (
    <CreateItemContext.Provider value={open}>
      {children}
      {opts && <CreateItemDialog initial={opts} onClose={() => setOpts(null)} />}
    </CreateItemContext.Provider>
  );
}

/** A sensible starting type for a project: the requested one if enabled, else task, else the top level. */
function initialType(project: ProjectWithStats | undefined, wanted?: ItemType): ItemType {
  const enabled = project?.itemTypes ?? [];
  if (wanted && enabled.includes(wanted)) return wanted;
  if (enabled.includes("task")) return "task";
  return sortTypes(enabled)[0] ?? "task";
}

function CreateItemDialog({ initial, onClose }: { initial: CreateItemOptions; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: allProjects = [] } = useProjects();
  // Only projects the user may create items in.
  const projects = allProjects.filter((p) => p.access.permissions.includes("item.create"));
  const [projectKey, setProjectKey] = useState(initial.projectKey ?? "");
  const project = projects.find((p) => p.key === projectKey);
  const { data: tree = [] } = useProjectTree(projectKey || undefined);
  const parentItem = tree.find((i) => i.id === initial.parentId);
  const enabled = project?.itemTypes ?? [];

  const [type, setType] = useState<ItemType>(initial.type ?? "task");
  const [parentId, setParentId] = useState<string>(initial.parentId ?? NO_PARENT);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [status, setStatus] = useState(initial.status ?? "");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const { data: members = [] } = useMembers();
  const [dueDate, setDueDate] = useState("");
  const [createMore, setCreateMore] = useState(false);
  const create = useCreateItem();

  useEffect(() => {
    if (!projectKey && projects.length) setProjectKey(projects[0].key);
  }, [projectKey, projects]);

  // When the project (or its config) loads/changes, snap type and status to valid values.
  useEffect(() => {
    if (!project) return;
    setType((t) => (project.itemTypes.includes(t) ? t : initialType(project, initial.type)));
    setStatus((s) => (project.statuses.some((x) => x.id === s) ? s : project.statuses[0].id));
  }, [project, initial.type]);

  const typeOptions = useMemo(
    () => (parentItem ? childTypes(parentItem.type, enabled) : sortTypes(enabled)),
    [parentItem, enabled],
  );
  const parentOptions = useMemo(() => {
    const allowed = allowedParentTypes(type, enabled);
    return tree.filter((i) => allowed.includes(i.type));
  }, [tree, type, enabled]);
  const rootAllowed = enabled.length > 0 && canBeRoot(type, enabled);

  // Keep the chosen parent valid for the chosen type.
  useEffect(() => {
    if (parentItem) return;
    if (parentId === NO_PARENT) {
      if (!rootAllowed && parentOptions.length) setParentId(parentOptions[0].id);
      return;
    }
    if (tree.length && !parentOptions.some((p) => p.id === parentId)) {
      setParentId(rootAllowed ? NO_PARENT : (parentOptions[0]?.id ?? NO_PARENT));
    }
  }, [type, parentOptions, parentId, rootAllowed, tree.length, parentItem]);

  const needsParent = !parentItem && !rootAllowed && parentId === NO_PARENT;
  const missingParentTypes = allowedParentTypes(type, enabled).map((t) => TYPE_LABELS[t]).join(" or ");

  const submit = async () => {
    if (!project || !title.trim() || needsParent || !enabled.includes(type)) return;
    const item = await create.mutateAsync({
      projectId: project.id,
      parentId: parentId === NO_PARENT ? null : parentId,
      type,
      title: title.trim(),
      description,
      status: status || undefined,
      priority,
      assigneeId,
      dueDate: dueDate || null,
    });
    toast.success(`${item.key} created`, {
      description: item.title,
      action: { label: "Open", onClick: () => navigate(paths.item(project.key, item)) },
    });
    if (createMore) {
      setTitle("");
      setDescription("");
      setEditorKey((k) => k + 1);
    } else {
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex h-[92dvh] max-h-[92dvh] flex-col gap-5 sm:max-w-3xl"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TypeIcon type={type} boxed />
            New {TYPE_LABELS[type].toLowerCase()}
          </DialogTitle>
          <DialogDescription>
            {parentItem ? (
              <>
                Inside <span className="font-medium text-foreground">{parentItem.key} · {parentItem.title}</span>
              </>
            ) : (
              "Pick where it lives, give it a title — everything else is optional."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {!initial.projectKey && (
              <Select value={projectKey} onValueChange={(v) => { setProjectKey(v); setParentId(NO_PARENT); }}>
                <SelectTrigger size="sm" className="w-auto min-w-40">
                  <SelectValue placeholder="Project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.key}>
                      <ProjectIcon icon={p.icon} color={p.color} size="sm" />
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {typeOptions.length > 0 && <TypePicker value={type} options={typeOptions} onChange={setType} />}
            {!parentItem && (rootAllowed ? parentOptions.length > 0 : true) && (
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger size="sm" className="w-auto max-w-80 min-w-48" aria-invalid={needsParent}>
                  <SelectValue placeholder="Parent" />
                </SelectTrigger>
                <SelectContent>
                  {rootAllowed && <SelectItem value={NO_PARENT}>No parent (project level)</SelectItem>}
                  {parentOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <TypeIcon type={p.type} />
                      <span className="font-mono text-muted-foreground">{p.key}</span>
                      <span className="truncate">{p.title}</span>
                    </SelectItem>
                  ))}
                  {!rootAllowed && parentOptions.length === 0 && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">Create a {missingParentTypes} first</div>
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          <Input
            autoFocus
            placeholder={`${TYPE_LABELS[type]} title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submit())}
            className="h-11 text-base font-medium"
          />

          <RichEditor key={editorKey} value="" onChange={setDescription} placeholder="Add a description… (optional) — Markdown, paste or drop images and videos" fill="parent" />

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
            {project && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Status</span>
                <StatusPickerFor value={status} statuses={project.statuses} onChange={setStatus} />
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Priority</span>
              <PriorityPicker value={priority} onChange={setPriority} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Assignee</span>
              <div className="w-40 rounded-md border">
                <AssigneePicker assignee={members.find((m) => m.userId === assigneeId)?.name ?? null} assigneeId={assigneeId} onChange={setAssigneeId} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="due" className="font-normal text-muted-foreground">Due</Label>
              <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-8 w-38" />
            </div>
          </div>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={createMore} onChange={(e) => setCreateMore(e.target.checked)} className="accent-primary" />
            Create another
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={!title.trim() || !project || needsParent || create.isPending}>
              Create {TYPE_LABELS[type].toLowerCase()}
              <span className="ml-1 text-xs opacity-70">Ctrl ↵</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

