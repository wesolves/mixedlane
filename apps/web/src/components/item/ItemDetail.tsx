import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight, Expand, Link2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { TYPE_LABELS, TYPE_PLURALS, childTypes, defaultChildType, type ItemUpdate, type Project, type WorkItemDetail } from "@mixedlane/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { ProgressBar, ProjectIcon, TypeIcon } from "@/components/common";
import { useCreateItemDialog } from "@/components/create/CreateItemDialog";
import { Description } from "@/components/item/Description";
import { Comments } from "@/components/item/Comments";
import { ActivityFeed } from "@/components/item/ActivityFeed";
import { FieldsPanel } from "@/components/item/FieldsPanel";
import { DevelopmentPanel } from "@/components/item/DevelopmentPanel";
import { LinkedPages } from "@/components/item/LinkedPages";
import { PresenceAvatars } from "@/components/realtime/Presence";
import { usePresence } from "@/lib/realtime";
import { ItemCard, ItemRow, QuickAdd, type OpenItem } from "@/components/item/ItemViews";
import { useDeleteItem, useItem, useProject, useUpdateItem } from "@/hooks/queries";
import { cn } from "@/lib/utils";
import { ProjectScope, paths } from "@/lib/project";
import { copyText } from "@/lib/clipboard";

interface Props {
  projectKey: string;
  itemKey: string;
  variant: "page" | "sheet";
  /** How to open another item (navigate on the page, swap in the sheet). */
  onOpenItem: OpenItem;
  onDeleted?: () => void;
}

export function ItemDetail({ projectKey, itemKey, variant, onOpenItem, onDeleted }: Props) {
  const { data: item, isLoading, error } = useItem(itemKey);
  const { data: project } = useProject(projectKey);
  const update = useUpdateItem();

  if (isLoading) return <DetailSkeleton />;
  if (error || !item || !project) {
    return <div className="p-8 text-sm text-muted-foreground">{error?.message ?? "Item not found."}</div>;
  }

  const save = (patch: ItemUpdate) => update.mutateAsync({ id: item.id, patch });
  const isPage = variant === "page";
  const canEdit = !!project.access?.permissions.includes("item.update");

  return (
    <ProjectScope project={project}>
    <div className={cn("w-full", isPage ? "px-6 py-6" : "px-6 py-5")}>
      <Header item={item} project={project} variant={variant} onOpenItem={onOpenItem} onDeleted={onDeleted} />

      <Title key={item.id} value={item.title} onSave={(title) => save({ title })} large={isPage} readOnly={!canEdit} />

      <div className={cn("mt-6 grid gap-8", isPage && "lg:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_360px]")}>
        <div className="min-w-0 space-y-8">
          {!isPage && (
            <div className="rounded-xl border bg-card px-4 py-2">
              <FieldsPanel item={item} onSave={save} />
            </div>
          )}
          {!isPage && (
            <div className="rounded-xl border bg-card px-4 py-3">
              <DevelopmentPanel itemId={item.id} />
            </div>
          )}
          {!isPage && (
            <div className="rounded-xl border bg-card px-4 py-3">
              <LinkedPages itemId={item.id} />
            </div>
          )}

          <section>
            <SectionTitle>Description</SectionTitle>
            <Description key={item.id} value={item.description} onSave={(description) => save({ description })} readOnly={!canEdit} />
          </section>

          <Children item={item} project={project} onOpenItem={onOpenItem} />

          <section>
            <Tabs defaultValue="comments">
              <TabsList>
                <TabsTrigger value="comments">Comments{item.commentCount > 0 && ` (${item.commentCount})`}</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>
              <TabsContent value="comments" className="pt-4">
                <Comments itemId={item.id} />
              </TabsContent>
              <TabsContent value="activity" className="pt-4">
                <ActivityFeed itemId={item.id} />
              </TabsContent>
            </Tabs>
          </section>
        </div>

        {isPage && (
          <aside className="h-fit space-y-4 lg:sticky lg:top-6">
            <div className="rounded-xl border bg-card px-4 py-3">
              <h3 className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Details</h3>
              <FieldsPanel item={item} onSave={save} />
            </div>
            <div className="rounded-xl border bg-card px-4 py-3">
              <DevelopmentPanel itemId={item.id} />
            </div>
            <div className="rounded-xl border bg-card px-4 py-3">
              <LinkedPages itemId={item.id} />
            </div>
          </aside>
        )}
      </div>
    </div>
    </ProjectScope>
  );
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-3">
      <h2 className="text-sm font-semibold">{children}</h2>
      {right}
    </div>
  );
}

function Header({
  item,
  project,
  variant,
  onOpenItem,
  onDeleted,
}: {
  item: WorkItemDetail;
  project: Project;
  variant: Props["variant"];
  onOpenItem: OpenItem;
  onDeleted?: () => void;
}) {
  const projectKey = project.key;
  const navigate = useNavigate();
  const remove = useDeleteItem();
  const [confirm, setConfirm] = useState(false);
  const viewers = usePresence(`item:${item.id}`);
  const url = `${location.origin}${paths.item(projectKey, item)}`;

  const doDelete = async () => {
    await remove.mutateAsync(item.id);
    toast.success(`${item.key} deleted`);
    const parent = item.ancestors.at(-1);
    onDeleted?.();
    if (variant === "page") navigate(parent ? paths.item(projectKey, parent) : paths.project(projectKey));
  };

  return (
    <div className="mb-3 flex items-center gap-2">
      <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link to={paths.project(projectKey)} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted hover:text-foreground">
          <ProjectIcon icon={project.icon} color={project.color} size="sm" />
          <span className="max-w-40 truncate">{project.name}</span>
        </Link>
        {item.ancestors.map((a) => (
          <span key={a.id} className="flex items-center gap-1">
            <ChevronRight className="size-3.5" />
            <button onClick={() => onOpenItem(a)} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted hover:text-foreground" title={a.title}>
              <TypeIcon type={a.type} className="size-3.5" />
              <span className="max-w-44 truncate">{a.title}</span>
            </button>
          </span>
        ))}
        <ChevronRight className="size-3.5" />
        <span className="flex items-center gap-1.5 px-1 font-medium text-foreground">
          <TypeIcon type={item.type} className="size-3.5" />
          <span className="font-mono">{item.key}</span>
        </span>
      </nav>

      <PresenceAvatars users={viewers} />
      {variant === "sheet" && (
        <Button variant="ghost" size="sm" asChild>
          <Link to={paths.item(projectKey, item)}>
            <Expand className="size-4" /> Open
          </Link>
        </Button>
      )}
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
          {!!project.access?.permissions.includes("item.delete") && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
                <Trash2 /> Delete {TYPE_LABELS[item.type].toLowerCase()}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {item.key}?</AlertDialogTitle>
            <AlertDialogDescription>
              “{item.title}”
              {item.progress.total > 0 && ` and everything inside it (${item.progress.total} items)`} will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-destructive text-white hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Title({ value, onSave, large, readOnly }: { value: string; onSave: (v: string) => void; large?: boolean; readOnly?: boolean }) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const v = draft.trim();
    if (!v) setDraft(value);
    else if (v !== value) onSave(v);
  };
  return (
    <textarea
      readOnly={readOnly}
      value={draft}
      rows={1}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "-mx-2 w-full resize-none rounded-lg bg-transparent px-2 py-1 font-semibold tracking-tight outline-none [field-sizing:content] hover:bg-muted/50 focus:bg-muted/50",
        large ? "text-2xl" : "text-xl",
      )}
    />
  );
}

function Children({ item, project, onOpenItem }: { item: WorkItemDetail; project: Project; onOpenItem: OpenItem }) {
  const openCreate = useCreateItemDialog();
  const childType = defaultChildType(item.type, project.itemTypes);
  if (!childType && item.children.length === 0) return null;
  const types = childTypes(item.type, project.itemTypes);
  // Containers (epics, milestones) read best as cards; work items as rows.
  const asCards = item.children.length > 0 && item.children.every((c) => c.type === "epic" || c.type === "milestone");
  // Name the section after what's actually there (e.g. stories under an epic that skips milestones).
  const childKinds = [...new Set(item.children.map((c) => c.type))];
  const label = childKinds.length === 1 ? TYPE_PLURALS[childKinds[0]] : childKinds.length > 1 ? "Child items" : childType ? TYPE_PLURALS[childType] : "Child items";

  return (
    <section>
      <SectionTitle
        right={
          <>
            {item.progress.total > 0 && <ProgressBar progress={item.progress} showLabel className="w-40" />}
            {childType && !!project.access?.permissions.includes("item.create") && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7"
                onClick={() => openCreate({ projectKey: project.key, parentId: item.id, type: childType })}
              >
                <Plus className="size-4" /> {types.length > 1 ? "Add item" : `Add ${TYPE_LABELS[childType].toLowerCase()}`}
              </Button>
            )}
          </>
        }
      >
        {label}
      </SectionTitle>

      {asCards ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {item.children.map((c) => (
            <ItemCard key={c.id} item={c} onOpen={onOpenItem} />
          ))}
          {childType && (
            <div className="flex min-h-32 flex-col justify-center rounded-xl border border-dashed">
              <QuickAdd projectId={item.projectId} parentId={item.id} type={childType} />
            </div>
          )}
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {item.children.map((c) => (
            <ItemRow key={c.id} item={c} onOpen={onOpenItem} />
          ))}
          {childType && <QuickAdd projectId={item.projectId} parentId={item.id} type={childType} />}
        </div>
      )}
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 p-8">
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
