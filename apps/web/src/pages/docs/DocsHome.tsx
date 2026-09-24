import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatDistanceToNowStrict } from "date-fns";
import { BookOpen, FileText, FolderKanban, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ProjectIcon } from "@/components/common";
import { ColorPicker, IconPicker } from "@/components/project/AppearancePickers";
import { useCreateSpace, useDocSearch, useSpaces } from "@/hooks/docs";
import { useProjects } from "@/hooks/queries";
import { useOrg } from "@/lib/auth";
import { paths } from "@/lib/project";

/** «match» markers from the server → <mark>. */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("«") ? (
          <mark key={i} className="rounded bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-500/30">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function DocsHome() {
  const { data: spaces, isLoading } = useSpaces();
  const { org } = useOrg();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim());
  const { data: hits, isFetching } = useDocSearch(query);
  const canCreate = org?.role !== "guest";

  return (
    <div className="flex-1 overflow-y-auto scroll-thin">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Docs</h1>
            <p className="text-sm text-muted-foreground">Specs, decisions, runbooks and meeting notes — linked to the work they describe.</p>
          </div>
          {canCreate && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New space
            </Button>
          )}
        </div>

        <div className="relative mb-8">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all pages…" className="h-10 pl-9" />
          {query.length > 1 && (
            <div className="mt-2 overflow-hidden rounded-xl border bg-card">
              {isFetching && !hits ? (
                <p className="p-4 text-sm text-muted-foreground">Searching…</p>
              ) : hits?.length ? (
                hits.map((h) => (
                  <Link key={h.pageId} to={paths.page(h.spaceKey, h.pageId)} className="block border-b px-4 py-3 last:border-0 hover:bg-muted/50">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <FileText className="size-4 text-muted-foreground" />
                      {h.title}
                      <span className="text-xs font-normal text-muted-foreground">in {h.spaceName}</span>
                    </span>
                    {h.snippet && (
                      <span className="mt-1 line-clamp-2 block pl-6 text-xs text-muted-foreground">
                        <Snippet text={h.snippet} />
                      </span>
                    )}
                  </Link>
                ))
              ) : (
                <p className="p-4 text-sm text-muted-foreground">No pages match “{query}”.</p>
              )}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        ) : !spaces?.length ? (
          <EmptyState
            icon={<BookOpen className="size-5" />}
            title="No spaces yet"
            description="A space groups related pages — one per team, product area or project."
            action={canCreate && <Button onClick={() => setCreating(true)}>Create a space</Button>}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {spaces.map((s) => (
              <Link key={s.id} to={paths.space(s.key)} className="group flex flex-col rounded-xl border bg-card p-4 transition-shadow hover:shadow-md">
                <div className="flex items-start gap-3">
                  <ProjectIcon icon={s.icon} color={s.color} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold group-hover:text-primary">{s.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{s.key}</p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 min-h-10 text-sm text-muted-foreground">{s.description || "No description"}</p>
                <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <FileText className="size-3.5" /> {s.pageCount} {s.pageCount === 1 ? "page" : "pages"}
                  </span>
                  {s.projectKey && (
                    <span className="flex items-center gap-1">
                      <FolderKanban className="size-3.5" /> {s.projectKey}
                    </span>
                  )}
                  <span className="ml-auto">{formatDistanceToNowStrict(new Date(s.updatedAt), { addSuffix: true })}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <CreateSpaceDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

const keyFrom = (name: string) =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w, _i, all) => (all.length > 1 ? w[0] : w.slice(0, 4)))
    .join("")
    .replace(/^[0-9]+/, "")
    .slice(0, 10);

const NO_PROJECT = "none";

function CreateSpaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const create = useCreateSpace();
  const { data: projects = [] } = useProjects();
  const adminProjects = projects.filter((p) => p.access.permissions.includes("project.admin"));
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [icon, setIcon] = useState("lucide:book-open");
  const [projectId, setProjectId] = useState(NO_PROJECT);

  useEffect(() => {
    if (!open) return;
    setName("");
    setKey("");
    setKeyTouched(false);
    setDescription("");
    setProjectId(NO_PROJECT);
  }, [open]);

  const effectiveKey = keyTouched ? key : keyFrom(name);
  const valid = name.trim() && /^[A-Z][A-Z0-9]{1,9}$/.test(effectiveKey);

  const submit = async () => {
    const space = await create.mutateAsync({
      name: name.trim(),
      key: effectiveKey,
      description,
      color,
      icon,
      projectId: projectId === NO_PROJECT ? null : projectId,
    });
    onOpenChange(false);
    navigate(paths.space(space.key));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New space</DialogTitle>
          <DialogDescription>Spaces hold a tree of pages. Link one to a project to share that project's access.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) void submit();
          }}
        >
          <div className="flex items-end gap-3">
            <IconPicker value={icon} color={color} onChange={setIcon} />
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="space-name">Name</Label>
              <Input id="space-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering" />
            </div>
            <div className="grid w-28 gap-1.5">
              <Label htmlFor="space-key">Key</Label>
              <Input
                id="space-key"
                value={effectiveKey}
                onChange={(e) => {
                  setKeyTouched(true);
                  setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10));
                }}
                className="font-mono uppercase"
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Color</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="space-desc">Description</Label>
            <Textarea id="space-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What lives here?" />
          </div>
          <div className="grid gap-1.5">
            <Label>Access</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue>
                  {projectId === NO_PROJECT ? "Whole organization (members can edit)" : `Same as project ${projects.find((p) => p.id === projectId)?.key}`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT}>Whole organization (members can edit)</SelectItem>
                {adminProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    Same as project {p.key} — {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              Create space
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
