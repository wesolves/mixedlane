import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Bot, Check, ChevronDown, History, MessageSquare, Plus, Sparkles, Trash2 } from "lucide-react";
import { TYPE_LABELS, childTypes, sortTypes, type ItemType, type MixdiChat, type MixdiReply, type MixdiResult } from "@mixedlane/shared";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MixdiMarkdown } from "@/components/layout/MixdiMarkdown";

export interface MixdiContext { destination?: string; parentId?: string; parentType?: ItemType; parentLabel?: string }
type Parent = { id: string; title: string; key?: string; type?: ItemType };
const selectClass = "mt-1 block w-full rounded-lg border bg-background p-2 text-sm";

export function MixdiPage() {
  const { org } = useOrg();
  return <MixdiChatView key={org?.id} />;
}

export function MixdiChatView({ initial = {}, compact = false, onNavigate }: { initial?: MixdiContext; compact?: boolean; onNavigate?: () => void }) {
  const { org, can } = useOrg();
  const cache = useQueryClient();
  const composerId = useId();
  const bottom = useRef<HTMLDivElement>(null);
  const access = useQuery({ queryKey: ["mixdi-access", org?.id], queryFn: api.mixdi.access });
  const projects = useQuery({ queryKey: ["mixdi-projects", org?.id], queryFn: api.projects.list, enabled: !!access.data?.allowed });
  const spaces = useQuery({ queryKey: ["mixdi-spaces", org?.id], queryFn: api.docs.spaces, enabled: !!access.data?.allowed });
  const history = useQuery({ queryKey: ["mixdi-history", org?.id], queryFn: api.mixdi.history, enabled: !!access.data?.allowed });
  const [kind, setKind] = useState<"ticket" | "document">("ticket");
  const [destination, setDestination] = useState(initial.destination ?? "");
  const [parentType, setParentType] = useState<ItemType | "">(initial.parentType ?? "");
  const [parentId, setParentId] = useState(initial.parentId ?? "");
  const [messages, setMessages] = useState<MixdiChat["messages"]>([]);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<MixdiReply | null>(null);
  const [previousDraftId, setPreviousDraftId] = useState<string>();
  const [conversationId, setConversationId] = useState<string>();
  const [result, setResult] = useState<MixdiResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showContext, setShowContext] = useState(!initial.destination);
  const parents = useQuery<Parent[]>({ queryKey: ["mixdi-parents", org?.id, kind, destination], queryFn: async () => kind === "ticket" ? await api.projects.tree(destination) : await api.docs.tree(destination), enabled: !!destination && !!access.data?.allowed });
  const project = projects.data?.find((p) => p.id === destination);
  const enabledTypes = project?.itemTypes ?? [];
  const parentTypes = sortTypes(enabledTypes.filter((t) => childTypes(t, enabledTypes).length > 0));
  const selectedParent = parents.data?.find((p) => p.id === parentId);
  const effectiveParentType = parentType || selectedParent?.type || "";
  const filteredParents = kind === "ticket" ? parents.data?.filter((p) => p.type === effectiveParentType) : parents.data;
  const destinations = kind === "ticket" ? projects.data?.filter((p) => access.data?.projectIds.includes(p.id) && p.access.permissions.includes("item.create")) : spaces.data?.filter((s) => access.data?.spaceIds.includes(s.id) && s.canWrite);
  const destinationName = destinations?.find((d) => d.id === destination)?.name;
  const invalidParent = kind === "ticket" && !!parentId && !!project && !!selectedParent?.type && !childTypes(selectedParent.type, enabledTypes).length;
  const contextReady = !!destinationName && !parents.isPending && !parents.isError && !invalidParent && (!parentId || !!selectedParent) && !(kind === "ticket" && effectiveParentType && !parentId);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, reply, busy]);
  useEffect(() => { if (!initial.destination && !destination && !access.data?.createTickets && access.data?.createDocuments) setKind("document"); }, [access.data, destination, initial.destination]);

  function reset() { setMessages([]); setReply(null); setPreviousDraftId(undefined); setConversationId(undefined); setResult(null); setError(""); setText(""); }
  function newChat() { reset(); setShowHistory(false); }
  async function openHistory(id: string) {
    setBusy(true); setError("");
    try {
      const saved = await api.mixdi.conversation(id);
      setKind(saved.kind); setDestination(saved.destination); setParentId(saved.parentId ?? ""); setParentType("");
      setMessages(saved.messages); setReply(saved.reply); setPreviousDraftId(saved.reply?.draftId); setConversationId(saved.id); setResult(saved.result); setText(""); setShowHistory(false); setShowContext(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function removeHistory(id: string) {
    setBusy(true); setError("");
    try { await api.mixdi.removeConversation(id); if (conversationId === id) reset(); await cache.invalidateQueries({ queryKey: ["mixdi-history"] }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function send() {
    if (!text.trim() || !contextReady || busy) return;
    const message = { role: "user" as const, content: text.trim() };
    setBusy(true); setError("");
    try {
      const response = await api.mixdi.chat({ kind, destination, parentId: parentId || null, previousDraftId, conversationId, messages: [message] });
      if (response.draftId) setPreviousDraftId(response.draftId);
      setConversationId(response.conversationId); setMessages([...messages, message, { role: "assistant", content: response.message }]); setText(""); setReply(response); setShowContext(false);
      await cache.invalidateQueries({ queryKey: ["mixdi-history"] });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function create() {
    if (!reply?.draftId || busy) return;
    setBusy(true); setError("");
    try { setResult(await api.mixdi.create(reply.draftId)); await cache.invalidateQueries(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (!access.data?.allowed) return <div className="flex min-h-60 flex-1 items-center justify-center p-8"><div className="max-w-sm space-y-3 text-center"><Bot className="mx-auto size-10 text-primary" /><h2 className="font-semibold">Your workspace assistant</h2><p role={access.isError ? "alert" : undefined} className="text-sm text-muted-foreground">{access.isError ? access.error.message : !access.data ? "Loading Mixdi…" : "Ask your admin to enable Mixdi and grant you access."}</p>{can("org.manage") && <Link onClick={onNavigate} className="text-sm text-primary underline" to={`/${org?.slug}/settings/mixdi`}>Configure Mixdi</Link>}</div></div>;
  return <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
    <aside aria-label="Chat history" className={cn("shrink-0 flex-col border-r bg-muted/20", compact ? "w-full" : "w-60", showHistory ? "flex" : compact ? "hidden" : "hidden lg:flex")}>
      <div className="flex items-center justify-between border-b p-4"><h2 className="text-sm font-semibold">Your chats</h2><Button aria-label="New Mixdi chat" variant="ghost" size="icon" disabled={busy} onClick={newChat}><Plus className="size-4" /></Button></div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {history.isPending ? <p className="p-3 text-sm text-muted-foreground">Loading chats…</p> : history.isError ? <p role="alert" className="p-3 text-sm text-destructive">Could not load your chats. <button className="underline" onClick={() => history.refetch()}>Retry</button></p> : !history.data?.length ? <p className="p-3 text-sm leading-relaxed text-muted-foreground">Your conversations will appear here after your first message.</p> : history.data.map((chat) => <div key={chat.id} className={cn("group flex rounded-lg hover:bg-muted", conversationId === chat.id && "bg-muted")}><button disabled={busy} onClick={() => openHistory(chat.id)} className="min-w-0 flex-1 p-3 text-left"><span className="block truncate text-sm font-medium">{chat.title}</span><span className="mt-1 block text-xs text-muted-foreground">{chat.kind === "ticket" ? "Ticket" : "Document"} · {new Date(chat.updatedAt).toLocaleDateString()}</span></button><button disabled={busy} className="mr-2 self-center rounded p-1.5 text-muted-foreground hover:bg-background hover:text-destructive focus-visible:ring-2" aria-label={`Delete chat: ${chat.title}`} onClick={() => removeHistory(chat.id)}><Trash2 className="size-3.5" /></button></div>)}
      </div>
      {showHistory && <Button variant="outline" className="m-3" onClick={() => setShowHistory(false)}>Back to chat</Button>}
      <p className="border-t p-4 text-xs leading-relaxed text-muted-foreground">Private to you in {org?.name}. Saved chats sync between this panel and the Mixdi page.</p>
    </aside>
    <section aria-label="Mixdi chat" className={cn("flex min-h-0 min-w-0 flex-1 flex-col", showHistory && (compact ? "hidden" : "hidden lg:flex"))}>
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6"><span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Sparkles className="size-5" /></span><div className="min-w-0 flex-1"><h1 className="text-sm font-semibold">Mixdi</h1><p className="truncate text-xs text-muted-foreground">Create together. Keep the conversation.</p></div><Button variant="ghost" size="icon" className={compact ? "" : "lg:hidden"} aria-label="Show chat history" disabled={busy} onClick={() => setShowHistory(true)}><History className="size-4" /></Button><Button variant="outline" size="sm" disabled={busy} onClick={newChat}><Plus className="mr-1 size-3.5" />New chat</Button></header>
      <div className="shrink-0 border-b bg-muted/15 px-4 py-3 sm:px-6">
        <button className="flex w-full items-center gap-2 text-left text-xs text-muted-foreground" aria-expanded={showContext} onClick={() => setShowContext(!showContext)}><span className="min-w-0 flex-1 truncate"><span className="font-medium text-foreground">{kind === "ticket" ? "Ticket" : "Document"}</span> · {destinationName ?? "Choose a destination"}{parentId ? ` / ${selectedParent?.key ?? ""} ${selectedParent?.title ?? initial.parentLabel ?? "Loading parent…"}` : " / Top level"}</span><ChevronDown className={cn("size-4 shrink-0 transition-transform", showContext && "rotate-180")} /></button>
        {showContext && <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium">Create<select disabled={busy} className={selectClass} value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setDestination(""); setParentId(""); setParentType(""); reset(); }}><option value="ticket" disabled={!access.data.createTickets}>Ticket</option><option value="document" disabled={!access.data.createDocuments}>Document</option></select></label>
          <label className="text-xs font-medium">{kind === "ticket" ? "Project" : "Document space"}<select disabled={busy} className={selectClass} value={destination} onChange={(e) => { setDestination(e.target.value); setParentId(""); setParentType(""); reset(); }}><option value="">Choose a destination</option>{destinations?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          {destination && kind === "ticket" && <label className="text-xs font-medium">Parent level<select disabled={busy || projects.isPending} className={selectClass} value={effectiveParentType} onChange={(e) => { setParentType(e.target.value as ItemType | ""); setParentId(""); reset(); }}><option value="">Top level (no parent)</option>{parentTypes.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}{effectiveParentType && !parentTypes.includes(effectiveParentType) && <option value={effectiveParentType} disabled>{TYPE_LABELS[effectiveParentType]} (cannot have children)</option>}</select></label>}
          {destination && (kind === "document" || effectiveParentType) && <label className="text-xs font-medium">{kind === "ticket" && effectiveParentType ? `Parent ${TYPE_LABELS[effectiveParentType]}` : "Parent page"}<select disabled={busy || parents.isPending} className={selectClass} value={parentId} onChange={(e) => { setParentId(e.target.value); reset(); }}><option value="">{kind === "document" ? "Top level (no parent)" : `Choose ${effectiveParentType ? TYPE_LABELS[effectiveParentType].toLowerCase() : "parent"}`}</option>{filteredParents?.map((p) => <option key={p.id} value={p.id}>{p.key ? `${p.key} · ` : ""}{p.title}</option>)}</select>{!parents.isPending && !filteredParents?.length && <span className="mt-1 block font-normal text-muted-foreground">No matching parents in this project.</span>}</label>}
          {messages.length > 0 && <p className="text-xs text-muted-foreground sm:col-span-2">Changing the destination or parent starts a new chat. This conversation stays in history.</p>}
        </div>}
        {invalidParent && <p role="alert" className="mt-2 text-xs text-destructive">This ticket cannot have children in this project's hierarchy. Choose another parent level.</p>}
        {destination && !destinationName && !projects.isPending && !spaces.isPending && <p role="alert" className="mt-2 text-xs text-destructive">Mixdi cannot create in this destination. Choose an allowed project or space.</p>}
        {parents.isError && <p role="alert" className="mt-2 text-xs text-destructive">Could not load parents. <button className="underline" onClick={() => parents.refetch()}>Retry</button></p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin px-4 py-6 sm:px-6"><div className="mx-auto max-w-3xl space-y-6">
        {!messages.length && <div className="mx-auto max-w-lg py-8 text-center"><span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="size-7" /></span><h2 className="text-xl font-semibold tracking-tight">What are we creating?</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Describe the work in your own words. I'll help shape a draft, and you decide when to create it.</p><div className="mt-6 grid gap-2 text-left sm:grid-cols-2">{["Create a task to fix a bug", "Draft a user story for a new feature", "Help me write a project document", "Break down the acceptance criteria"].map((prompt) => <button key={prompt} disabled={busy} onClick={() => setText(prompt)} className="rounded-xl border bg-card p-3 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"><MessageSquare className="mb-2 size-4 text-primary" />{prompt}</button>)}</div></div>}
        <div role="log" aria-label="Conversation" aria-live="polite" className="space-y-5">{messages.map((m, i) => <article key={i} className={cn("flex gap-3", m.role === "user" && "justify-end")}>{m.role === "assistant" && <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Sparkles className="size-4" /></span>}<div className={cn("min-w-0 max-w-[90%] rounded-2xl px-4 py-3", m.role === "user" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted/60")}><p className="mb-1 text-[11px] font-semibold opacity-65">{m.role === "user" ? "You" : "Mixdi"}</p>{m.role === "assistant" ? <MixdiMarkdown content={m.content} /> : <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.content}</p>}</div></article>)}</div>
        {busy && <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><span className="size-2 animate-pulse rounded-full bg-primary" />Mixdi is working…</div>}
        {reply?.draft && !result && <section className="overflow-hidden rounded-2xl border bg-card shadow-sm"><div className="flex items-center justify-between border-b bg-muted/30 px-5 py-3"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Draft · {kind}</span>{kind === "ticket" && <span className="rounded-md border bg-background px-2 py-1 text-xs">{TYPE_LABELS[reply.draft.type]} · {reply.draft.priority}</span>}</div><div className="space-y-3 p-5"><h2 className="text-base font-semibold">{reply.draft.title}</h2><div className="max-h-80 overflow-y-auto text-sm leading-relaxed"><MixdiMarkdown content={reply.draft.description} /></div></div><div className="flex flex-wrap items-center justify-between gap-3 border-t p-4"><p className="text-xs text-muted-foreground">Ask for changes, or create when ready.</p><Button disabled={busy} onClick={create}><Plus className="mr-1.5 size-4" />Create {kind}</Button></div></section>}
        {result && <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><Check className="size-4 text-emerald-600" />Created successfully</div><Link onClick={onNavigate} className="text-sm text-primary underline" to={result.url}>{result.title}</Link><Button className="mt-4 block" variant="outline" size="sm" onClick={newChat}>Start another chat</Button></div>}
        {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
        <div ref={bottom} />
      </div></div>
      {!result && <footer className="shrink-0 border-t bg-background px-4 py-3 sm:px-6"><form className="mx-auto max-w-3xl" onSubmit={(e) => { e.preventDefault(); void send(); }}><div className="rounded-2xl border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-primary/20"><label htmlFor={composerId} className="sr-only">Message Mixdi</label><Textarea id={composerId} value={text} maxLength={8000} disabled={busy} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} className="min-h-16 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0" placeholder={destination ? "Describe what you want to create…" : "Choose a destination above to get started…"} /><div className="flex items-center justify-between px-2 pb-1"><span className="text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line</span><Button type="submit" size="icon" className="size-8 rounded-xl" aria-label="Send message" disabled={busy || !contextReady || !text.trim() || messages.length >= 198}><ArrowUp className="size-4" /></Button></div></div><p className="mt-2 text-center text-[11px] text-muted-foreground">Chats are saved privately. Review AI drafts before creating.</p></form></footer>}
    </section>
  </div>;
}
