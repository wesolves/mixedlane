import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PRIORITIES, TYPE_LABELS, type ItemType, type MixdiConversation, type MixdiEditDraft } from "@mixedlane/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MixdiMarkdown } from "@/components/layout/MixdiMarkdown";

export function MixdiTicketEditor({ conversationId, created, types, disabled, onSaved, onEditing }: {
  conversationId: string; created: boolean; types: ItemType[]; disabled: boolean;
  onSaved: (conversation: MixdiConversation) => void;
  onEditing: (editing: boolean) => void;
}) {
  const cache = useQueryClient();
  const ticket = useQuery({ queryKey: ["mixdi-ticket", conversationId], queryFn: () => api.mixdi.ticket(conversationId), enabled: created });
  const [editing, setEditing] = useState<MixdiConversation | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState(false);
  const locked = disabled || busy;
  const isEditing = created ? description !== null : editing !== null;
  useEffect(() => { onEditing(isEditing || busy); return () => onEditing(false); }, [isEditing, busy, onEditing]);
  async function edit() {
    setBusy(true); setError(""); setSaved(false); setPreview(false);
    try {
      if (created) {
        const current = await api.mixdi.ticket(conversationId);
        cache.setQueryData(["mixdi-ticket", conversationId], current);
        if (!current.canEdit) throw new Error("You do not have permission to edit this ticket.");
        setDescription(current.description); setUpdatedAt(current.updatedAt);
      } else {
        const current = await api.mixdi.conversation(conversationId);
        if (current.result || !current.reply?.draft) throw new Error("This draft changed. Reopen the chat.");
        setEditing(current);
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError("");
    try {
      if (created && description !== null) {
        cache.setQueryData(["mixdi-ticket", conversationId], await api.mixdi.editTicket(conversationId, { description, updatedAt }));
        setDescription(null);
      } else if (editing?.reply?.draft) {
        onSaved(await api.mixdi.editDraft(conversationId, { version: editing.version, draft: editing.reply.draft }));
        setEditing(null);
      }
      setSaved(true); await cache.invalidateQueries();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function change(patch: Partial<MixdiEditDraft["draft"]>) {
    setEditing((current) => current?.reply?.draft ? { ...current, reply: { ...current.reply, draft: { ...current.reply.draft, ...patch } } } : current);
  }
  const draft = editing?.reply?.draft;
  return <section aria-label={created ? "Created ticket description" : "Edit ticket draft"} className="space-y-3 rounded-xl border bg-card p-4">
    {created && <><h3 className="text-sm font-semibold">Current ticket description</h3>{ticket.isPending ? <p role="status" className="text-sm">Loading description…</p> : ticket.isError ? <p role="alert" className="text-sm text-destructive">{ticket.error.message} <button className="underline" onClick={() => ticket.refetch()}>Retry</button></p> : !isEditing && <div className="max-h-80 overflow-y-auto"><MixdiMarkdown content={ticket.data.description || "No description yet."} /></div>}</>}
    {isEditing ? <div className="space-y-3">
      {draft && <><label className="block text-sm">Title<Input disabled={locked} maxLength={300} value={draft.title} onChange={(e) => change({ title: e.target.value })} /></label><div className="flex flex-wrap gap-3"><label className="text-sm">Type<select className="ml-2 rounded border bg-background p-2" disabled={locked} value={draft.type} onChange={(e) => change({ type: e.target.value as ItemType })}>{types.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}</select></label><label className="text-sm">Priority<select className="ml-2 rounded border bg-background p-2" disabled={locked} value={draft.priority} onChange={(e) => change({ priority: e.target.value as typeof draft.priority })}>{PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</select></label></div></>}
      <label className="block text-sm">Description (Markdown)<Textarea className="mt-1 min-h-48" disabled={locked} maxLength={created ? 200000 : 30000} value={created ? description ?? "" : draft?.description ?? ""} onChange={(e) => created ? setDescription(e.target.value) : change({ description: e.target.value })} /></label>
      <Button variant="ghost" size="sm" onClick={() => setPreview(!preview)}>{preview ? "Hide preview" : "Preview description"}</Button>
      {preview && <div className="max-h-80 overflow-y-auto rounded border p-3"><MixdiMarkdown content={created ? description ?? "" : draft?.description ?? ""} /></div>}
      <div className="flex gap-2"><Button disabled={locked || (!created && !draft?.title.trim())} onClick={save}>Save {created ? "description" : "draft"}</Button><Button variant="outline" disabled={locked} onClick={() => { setEditing(null); setDescription(null); setError(""); }}>Cancel</Button></div>
      {!created && <p className="text-xs text-muted-foreground">Save your draft before creating the ticket. Ask Mixdi for further changes after saving.</p>}
    </div> : <Button variant="outline" size="sm" disabled={locked || (created && !ticket.data?.canEdit)} onClick={edit}>{created ? "Edit description" : "Edit draft"}</Button>}
    {busy && <p role="status" className="text-sm">Saving or loading ticket…</p>}
    {saved && <p role="status" className="text-sm text-emerald-600">{created ? "Description saved." : "Draft saved. Ready to create."}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error} Your edits are kept here; cancel and edit again to load the latest version.</p>}
  </section>;
}
