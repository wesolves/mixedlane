import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Comment } from "@mixedlane/shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RichEditor, RichText, isEmptyHtml } from "@/components/editor/RichEditor";
import { ActorAvatar, ActorName, UserAvatar } from "@/components/common";
import { useAddComment, useComments, useDeleteComment, useUpdateComment } from "@/hooks/queries";
import { useAuth } from "@/lib/auth";
import { useProjectScope } from "@/lib/project";

export function Comments({ itemId }: { itemId: string }) {
  const { data: comments = [], isLoading } = useComments(itemId);
  const { can } = useProjectScope();
  const { user } = useAuth();
  const add = useAddComment(itemId);
  const [draft, setDraft] = useState("");
  const [composerKey, setComposerKey] = useState(0);
  const reset = () => {
    setDraft("");
    setComposerKey((k) => k + 1);
  };

  const submit = async () => {
    if (isEmptyHtml(draft)) return;
    await add.mutateAsync(draft);
    reset();
  };

  return (
    <div className="space-y-5">
      {can("comment.create") && (
      <div className="flex gap-3">
        <UserAvatar name={user?.name ?? "You"} className="mt-1 size-7" />
        <div className="flex-1 space-y-2">
          <RichEditor key={composerKey} value="" onChange={setDraft} placeholder="Add a comment… (Ctrl+Enter to send)" onSubmit={submit} compact />
          {!isEmptyHtml(draft) && (
            <div className="flex gap-2">
              <Button size="sm" onClick={submit} disabled={add.isPending}>Comment</Button>
              <Button size="sm" variant="ghost" onClick={reset}>Discard</Button>
            </div>
          )}
        </div>
      </div>
      )}

      {!isLoading && comments.length === 0 && (
        <p className="flex items-center gap-2 pl-10 text-sm text-muted-foreground">
          <MessageSquare className="size-4" /> No comments yet — start the conversation.
        </p>
      )}

      <ScrollToHash ready={!isLoading} />
      <ol className="space-y-5">
        {[...comments].reverse().map((c) => (
          <CommentRow key={c.id} comment={c} itemId={itemId} />
        ))}
      </ol>
    </div>
  );
}

/** Notification links point at #comment-<id>: scroll there once comments have loaded. */
function ScrollToHash({ ready }: { ready: boolean }) {
  useEffect(() => {
    if (!ready || !location.hash.startsWith("#comment-")) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [ready]);
  return null;
}

function CommentRow({ comment, itemId }: { comment: Comment; itemId: string }) {
  const { can } = useProjectScope();
  const { user } = useAuth();
  // Authors change their own comments; project admins can moderate any.
  const mine = comment.authorType === "user" && !!user && comment.authorId === user.id;
  const canChange = mine || can("comment.moderate");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const update = useUpdateComment(itemId);
  const remove = useDeleteComment(itemId);
  const edited = comment.updatedAt !== comment.createdAt;
  const editRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing) editRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [editing]);

  const save = async () => {
    if (isEmptyHtml(draft)) return;
    await update.mutateAsync({ id: comment.id, body: draft });
    setEditing(false);
  };

  return (
    <li id={`comment-${comment.id}`} className="group flex scroll-mt-6 gap-3 rounded-lg target:bg-primary/5 target:ring-8 target:ring-primary/5">
      <ActorAvatar name={comment.author} type={comment.authorType} className="mt-0.5 size-7" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <ActorName name={comment.author} type={comment.authorType} />
          <span className="text-xs text-muted-foreground" title={new Date(comment.createdAt).toLocaleString()}>
            {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
            {edited && " · edited"}
          </span>
          {!editing && canChange && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-auto rounded p-1 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 data-[state=open]:opacity-100" aria-label="Comment actions">
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => { setDraft(comment.body); setEditing(true); }}>
                  <Pencil /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate(comment.id)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {editing ? (
          <div ref={editRef} className="mt-2 scroll-mt-4 space-y-2">
            <RichEditor value={draft} onChange={setDraft} autofocus onSubmit={save} onCancel={() => setEditing(false)} fill="screen" fillOffset="5.5rem" />
            <div className="flex gap-2">
              <Button size="sm" onClick={save}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="mt-1 rounded-lg rounded-tl-none bg-muted/50 px-3 py-2">
            <RichText html={comment.body} />
          </div>
        )}
      </div>
    </li>
  );
}
