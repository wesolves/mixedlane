import { useState } from "react";
import { Link, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowLeft, FileText, FolderKanban, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { EmptyState, ProjectIcon } from "@/components/common";
import { NewPageDialog } from "@/components/docs/NewPageDialog";
import { PageTree } from "@/components/docs/PageTree";
import { useDeleteSpace, usePageTree, useSpace, useUpdateSpace } from "@/hooks/docs";
import { paths } from "@/lib/project";

export interface SpaceOutlet {
  /** Opens the new-page dialog (null = top level). */
  newPage: (parentId: string | null) => void;
}
export const useSpaceOutlet = () => useOutletContext<SpaceOutlet>();

/** A space: the page tree on the left, the selected page (or the space overview) on the right. */
export function SpaceLayout() {
  const { spaceKey = "", pageId } = useParams();
  const { data: space, error } = useSpace(spaceKey);
  const { data: pages = [] } = usePageTree(spaceKey);
  const [newParent, setNewParent] = useState<string | null | undefined>(undefined);

  if (error) {
    return (
      <div className="p-10">
        <EmptyState icon={<FileText className="size-5" />} title="Space not found" description={error.message} action={<Button asChild variant="outline"><Link to={paths.docs()}>All spaces</Link></Button>} />
      </div>
    );
  }

  const newPage = (parentId: string | null) => setNewParent(parentId);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col border-r bg-muted/20">
        <div className="border-b p-3">
          <Link to={paths.docs()} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3" /> All spaces
          </Link>
          {space ? (
            <div className="flex items-center gap-2">
              <ProjectIcon icon={space.icon} color={space.color} size="sm" />
              <Link to={paths.space(space.key)} className="min-w-0 flex-1 truncate font-semibold hover:underline">
                {space.name}
              </Link>
              {space.canAdmin && <SpaceMenu spaceKey={space.key} name={space.name} description={space.description} />}
            </div>
          ) : (
            <Skeleton className="h-6 w-40" />
          )}
        </div>
        <div className="flex items-center justify-between px-3 pt-3 pb-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Pages
          {space?.canWrite && (
            <button onClick={() => newPage(null)} className="rounded p-0.5 hover:bg-muted" aria-label="New page">
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4 scroll-thin">
          {pages.length ? (
            <PageTree spaceKey={spaceKey} pages={pages} activeId={pageId} canWrite={!!space?.canWrite} onAddChild={newPage} />
          ) : (
            <p className="px-2 py-3 text-xs text-muted-foreground">No pages yet.</p>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto scroll-thin">
        <Outlet context={{ newPage } satisfies SpaceOutlet} />
      </div>

      <NewPageDialog
        spaceKey={spaceKey}
        parentId={newParent ?? null}
        parentTitle={pages.find((p) => p.id === newParent)?.title}
        open={newParent !== undefined}
        onOpenChange={(o) => !o && setNewParent(undefined)}
      />
    </div>
  );
}

function SpaceMenu({ spaceKey, name, description }: { spaceKey: string; name: string; description: string }) {
  const navigate = useNavigate();
  const update = useUpdateSpace(spaceKey);
  const remove = useDeleteSpace();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [draft, setDraft] = useState({ name, description });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label="Space settings">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setDraft({ name, description });
              setEditing(true);
            }}
          >
            <Pencil /> Edit details
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
            <Trash2 /> Delete space
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit space</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              await update.mutateAsync({ name: draft.name.trim(), description: draft.description });
              setEditing(false);
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="sp-name">Name</Label>
              <Input id="sp-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sp-desc">Description</Label>
              <Textarea id="sp-desc" rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!draft.name.trim() || update.isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
            <AlertDialogDescription>Every page in this space and its history will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                await remove.mutateAsync(spaceKey);
                toast.success(`${name} deleted`);
                navigate(paths.docs());
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Space index: description and the most recently updated pages. */
export function SpaceHome() {
  const { spaceKey = "" } = useParams();
  const { data: space } = useSpace(spaceKey);
  const { data: pages = [] } = usePageTree(spaceKey);
  const { newPage } = useSpaceOutlet();
  if (!space) return null;
  const recent = [...pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-10">
      <div className="flex items-start gap-4">
        <ProjectIcon icon={space.icon} color={space.color} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{space.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{space.description || "No description."}</p>
          {space.projectKey && (
            <Link to={paths.project(space.projectKey)} className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <FolderKanban className="size-3.5" /> Shares access with project {space.projectKey}
            </Link>
          )}
        </div>
        {space.canWrite && (
          <Button onClick={() => newPage(null)}>
            <Plus className="size-4" /> New page
          </Button>
        )}
      </div>

      <h2 className="mt-10 mb-3 text-sm font-semibold">Recently updated</h2>
      {recent.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-5" />}
          title="This space is empty"
          description="Start with a blank page or a template: PRD, tech spec, meeting notes or retro."
          action={space.canWrite && <Button onClick={() => newPage(null)}>Create the first page</Button>}
        />
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {recent.map((p) => (
            <Link key={p.id} to={paths.page(space.key, p.id)} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50">
              <FileText className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
              <span className="text-xs text-muted-foreground">{formatDistanceToNowStrict(new Date(p.updatedAt), { addSuffix: true })}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
