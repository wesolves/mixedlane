import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, ChevronRight, FilePlus2, History, Link2, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { PageDetail } from "@flowboard/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { EmptyState, TypeIcon } from "@/components/common";
import { RichEditor, RichText } from "@/components/editor/RichEditor";
import { HistorySheet } from "@/components/docs/HistorySheet";
import { TextDiff, htmlToText } from "@/components/docs/TextDiff";
import { PresenceAvatars } from "@/components/realtime/Presence";
import { dk, useDeletePage, usePage, useSavePage } from "@/hooks/docs";
import { useHotkey } from "@/hooks/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { paths } from "@/lib/project";
import { useLiveEvents, usePresence } from "@/lib/realtime";
import { copyText } from "@/lib/clipboard";
import { useSpaceOutlet } from "./SpaceLayout";

/** Remount per page so edit state never leaks between pages. */
export function PageRoute() {
  const { pageId } = useParams();
  return <PageView key={pageId} />;
}

interface Draft {
  title: string;
  html: string;
  /** The version (and content) editing started from. */
  baseVersion: number;
  baseHtml: string;
}

function PageView() {
  const { spaceKey = "", pageId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { newPage } = useSpaceOutlet();
  const { data: page, error, isLoading } = usePage(pageId);
  const save = useSavePage(pageId);
  const remove = useDeletePage(spaceKey);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [wantEdit, setWantEdit] = useState(!!(location.state as { edit?: boolean } | null)?.edit);
  const [remote, setRemote] = useState<{ name: string; version: number } | null>(null);
  const [conflict, setConflict] = useState<PageDetail | null>(null);
  const [history, setHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editing = !!draft;
  const viewers = usePresence(page ? `page:${page.id}` : null, editing ? "editing" : "viewing");

  const startEdit = (p: PageDetail) => {
    setDraft({ title: p.title, html: p.contentHtml, baseVersion: p.version, baseHtml: p.contentHtml });
    setRemote(null);
  };

  // Opened from "New page": jump straight into the editor.
  useEffect(() => {
    if (wantEdit && page?.canWrite) {
      startEdit(page);
      setWantEdit(false);
      navigate(".", { replace: true, state: null });
    }
  }, [wantEdit, page, navigate]);

  // Someone else saved/deleted this page.
  useLiveEvents((e) => {
    if (e.type !== "page" || e.pageId !== pageId || e.actor.id === user?.id) return;
    if (e.action === "deleted") {
      toast.warning(`${e.actor.name} deleted this page`);
      navigate(paths.space(spaceKey));
    } else if (e.action === "updated") {
      if (editing) setRemote({ name: e.actor.name, version: e.version });
      else void qc.invalidateQueries({ queryKey: dk.page(pageId) });
    }
  });

  // Unsaved edits: warn before closing the tab.
  const dirty = !!draft && (draft.title !== page?.title || draft.html !== draft.baseHtml);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const submit = async (baseVersion = draft?.baseVersion) => {
    if (!draft || baseVersion === undefined) return;
    try {
      const saved = await save.mutateAsync({ title: draft.title.trim() || "Untitled", contentHtml: draft.html, baseVersion });
      setDraft(null);
      setConflict(null);
      setRemote(null);
      toast.success(`Saved — version ${saved.version}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setConflict(await api.docs.page(pageId));
      else toast.error((err as Error).message);
    }
  };

  useHotkey("s", (e) => {
    if (!editing) return;
    e.preventDefault();
    void submit();
  }, { mod: true });

  if (isLoading) return <PageSkeleton />;
  if (error || !page) {
    return (
      <div className="p-10">
        <EmptyState icon={<AlertTriangle className="size-5" />} title="Page not found" description={error?.message ?? "It may have been deleted."} />
      </div>
    );
  }

  const url = `${window.location.origin}${paths.page(spaceKey, page.id)}`;

  return (
    <div className="mx-auto w-full max-w-5xl px-8 pt-6 pb-16">
      {/* Breadcrumbs + actions */}
      <div className="mb-4 flex items-center gap-2">
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <Link to={paths.space(spaceKey)} className="rounded px-1 py-0.5 hover:bg-muted hover:text-foreground">
            {spaceKey}
          </Link>
          {page.breadcrumbs.map((b) => (
            <span key={b.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5" />
              <Link to={paths.page(spaceKey, b.id)} className="max-w-48 truncate rounded px-1 py-0.5 hover:bg-muted hover:text-foreground">
                {b.title}
              </Link>
            </span>
          ))}
        </nav>
        <PresenceAvatars users={viewers} />
        {editing ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />} Save
            </Button>
          </>
        ) : (
          <>
            {page.canWrite && (
              <Button size="sm" variant="outline" onClick={() => startEdit(page)}>
                <Pencil className="size-4" /> Edit
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setHistory(true)}>
              <History className="size-4" /> History
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    void copyText(url).then((ok) => (ok ? toast.success("Link copied") : toast.error("Couldn't copy the link")));
                  }}
                >
                  <Link2 /> Copy link
                </DropdownMenuItem>
                {page.canWrite && (
                  <>
                    <DropdownMenuItem onSelect={() => newPage(page.id)}>
                      <FilePlus2 /> Add sub-page
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                      <Trash2 /> Delete page
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          {remote && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle className="size-4 shrink-0" />
              {remote.name} just saved version {remote.version}. Saving will ask how to combine your changes.
            </div>
          )}
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Page title"
            className="w-full bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
          />
          <RichEditor
            value={draft.baseHtml}
            onChange={(html) => setDraft((d) => (d ? { ...d, html } : d))}
            onSubmit={() => void submit()}
            onCancel={() => !dirty && setDraft(null)}
            placeholder="Write, paste Markdown, @mention people, reference work items like APP-0001…"
            fill="screen"
            fillOffset="13rem"
            autofocus
          />
          <p className="text-xs text-muted-foreground">Ctrl+S or Ctrl+Enter to save · Esc to cancel (when nothing changed)</p>
        </div>
      ) : (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>
          <p className="mt-1 mb-6 text-xs text-muted-foreground">
            Updated by {page.updatedByName || "someone"} {formatDistanceToNowStrict(new Date(page.updatedAt), { addSuffix: true })} · version {page.version}
          </p>
          {page.contentHtml ? (
            <RichText html={page.contentHtml} />
          ) : (
            <p className="text-sm text-muted-foreground italic">This page is empty.{page.canWrite && " Click Edit to start writing."}</p>
          )}

          {page.linkedItems.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Linked work items</h2>
              <div className="flex flex-wrap gap-2">
                {page.linkedItems.map((it) => (
                  <Link
                    key={it.id}
                    to={paths.item(it.projectKey, it)}
                    className="flex max-w-80 items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-sm hover:bg-muted/60"
                  >
                    <TypeIcon type={it.type} className="size-3.5" />
                    <span className="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">{it.key}</span>
                    <span className="truncate">{it.title}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <HistorySheet pageId={page.id} current={page.version} canWrite={page.canWrite} open={history} onOpenChange={setHistory} />

      {draft && conflict && (
        <ConflictDialog
          draft={draft}
          latest={conflict}
          saving={save.isPending}
          onOverwrite={() => void submit(conflict.version)}
          onDiscard={() => {
            qc.setQueryData(dk.page(pageId), conflict);
            setConflict(null);
            setDraft(null);
          }}
          onClose={() => setConflict(null)}
        />
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{page.title}”?</AlertDialogTitle>
            <AlertDialogDescription>The page, its sub-pages and their history will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                await remove.mutateAsync(page.id);
                toast.success("Page deleted");
                navigate(page.parentId ? paths.page(spaceKey, page.parentId) : paths.space(spaceKey));
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Someone saved while you were editing: show both sides and let the user choose. */
function ConflictDialog({
  draft,
  latest,
  saving,
  onOverwrite,
  onDiscard,
  onClose,
}: {
  draft: Draft;
  latest: PageDetail;
  saving: boolean;
  onOverwrite: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const base = htmlToText(draft.baseHtml);
  const theirs = htmlToText(latest.contentHtml);
  const mine = htmlToText(draft.html);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" /> This page changed while you were editing
          </DialogTitle>
          <DialogDescription>
            {latest.updatedByName || "Someone"} saved version {latest.version}. You started from version {draft.baseVersion}.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="theirs">
          <TabsList>
            <TabsTrigger value="theirs">Their changes</TabsTrigger>
            <TabsTrigger value="mine">Your version vs. theirs</TabsTrigger>
          </TabsList>
          <TabsContent value="theirs" className="pt-3">
            <TextDiff before={base} after={theirs} className="max-h-[45vh] overflow-y-auto" />
          </TabsContent>
          <TabsContent value="mine" className="pt-3">
            <TextDiff before={theirs} after={mine} className="max-h-[45vh] overflow-y-auto" />
          </TabsContent>
        </Tabs>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onClose}>
            Keep editing
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onDiscard}>
              Discard mine, load theirs
            </Button>
            <Button onClick={onOverwrite} disabled={saving}>
              Save mine anyway
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-8 py-8">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
