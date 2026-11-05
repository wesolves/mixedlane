import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Send } from "lucide-react";
import type { MixdiChat, MixdiReply, MixdiResult } from "@mixedlane/shared";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function MixdiPage() {
  const { org } = useOrg();
  return <Chat key={org?.id} />;
}
function Chat() {
  const { org, can } = useOrg();
  const cache = useQueryClient();
  const access = useQuery({ queryKey: ["mixdi-access", org?.id], queryFn: api.mixdi.access });
  const projects = useQuery({ queryKey: ["mixdi-projects", org?.id], queryFn: api.projects.list, enabled: !!access.data?.allowed });
  const spaces = useQuery({ queryKey: ["mixdi-spaces", org?.id], queryFn: api.docs.spaces, enabled: !!access.data?.allowed });
  const [kind, setKind] = useState<"ticket" | "document">("ticket");
  const [destination, setDestination] = useState("");
  const [parentId, setParentId] = useState("");
  const [messages, setMessages] = useState<MixdiChat["messages"]>([]);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<MixdiReply | null>(null);
  const [previousDraftId, setPreviousDraftId] = useState<string>();
  const [result, setResult] = useState<MixdiResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const parents = useQuery<{ id: string; title: string }[]>({ queryKey: ["mixdi-parents", org?.id, kind, destination], queryFn: async () => kind === "ticket" ? await api.projects.tree(destination) : await api.docs.tree(destination), enabled: !!destination && !!access.data?.allowed });
  function reset() { setMessages([]); setReply(null); setPreviousDraftId(undefined); setResult(null); setError(""); setText(""); }
  async function send() {
    if (!text.trim() || !destination || busy) return;
    const next = [...messages, { role: "user" as const, content: text.trim() }];
    setBusy(true); setError(""); setReply(null);
    try {
      const response = await api.mixdi.chat({ kind, destination, parentId: parentId || null, previousDraftId, messages: next });
      if (response.draftId) setPreviousDraftId(response.draftId);
      setMessages([...next, { role: "assistant", content: response.message }]); setText(""); setReply(response);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function create() {
    if (!reply?.draftId || busy) return;
    setBusy(true); setError("");
    try { setResult(await api.mixdi.create(reply.draftId)); await cache.invalidateQueries(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const destinations = kind === "ticket" ? projects.data?.filter((p) => access.data?.projectIds.includes(p.id) && p.access.permissions.includes("item.create")) : spaces.data?.filter((s) => access.data?.spaceIds.includes(s.id) && s.canWrite);
  return <main className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-3xl space-y-5">
    <header className="flex items-center gap-3"><Bot className="size-8 text-primary" /><div><h1 className="text-xl font-semibold">Mixdi</h1><p className="text-sm text-muted-foreground">Turn a conversation into a ticket or document.</p></div></header>
    {access.isError ? <p role="alert">{access.error.message}</p> : !access.data ? <p>Loading Mixdi…</p> : !access.data.allowed ? <div className="rounded-xl border p-6"><p>Ask your admin to enable Mixdi and grant you access.</p>{can("org.manage") && <Link className="text-primary underline" to={`/${org?.slug}/settings/mixdi`}>Configure Mixdi</Link>}</div> : <>
      <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
        <label className="text-sm">Create<select disabled={busy} className="mt-1 block w-full rounded-md border bg-background p-2" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setDestination(""); setParentId(""); reset(); }}><option value="ticket" disabled={!access.data.createTickets}>Ticket</option><option value="document" disabled={!access.data.createDocuments}>Document</option></select></label>
        <label className="text-sm">{kind === "ticket" ? "Project" : "Document space"}<select disabled={busy} className="mt-1 block w-full rounded-md border bg-background p-2" value={destination} onChange={(e) => { setDestination(e.target.value); setParentId(""); reset(); }}><option value="">Choose a destination</option>{destinations?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        {destination && <label className="text-sm sm:col-span-2">Parent (optional)<select disabled={busy} className="mt-1 block w-full rounded-md border bg-background p-2" value={parentId} onChange={(e) => { setParentId(e.target.value); reset(); }}><option value="">Top level</option>{parents.data?.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>}
      </div>
      <div role="log" aria-label="Conversation" aria-live="polite" className="space-y-3">{!messages.length && <p className="py-8 text-center text-sm text-muted-foreground">Describe what you want to create. Mixdi will help shape a draft for your review.</p>}{messages.map((m, i) => <div key={i} className={`whitespace-pre-wrap rounded-xl p-4 text-sm ${m.role === "user" ? "ml-8 bg-primary/10" : "mr-8 border bg-card"}`}><p className="mb-1 font-medium">{m.role === "user" ? "You" : "Mixdi"}</p>{m.content}</div>)}</div>
      {reply?.draft && !result && <section className="space-y-3 rounded-xl border bg-card p-5"><h2 className="font-semibold">Review {kind} draft</h2><h3>{reply.draft.title}</h3>{kind === "ticket" && <p className="text-sm text-muted-foreground">{reply.draft.type} · {reply.draft.priority}</p>}<pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm">{reply.draft.description}</pre><p className="text-sm text-muted-foreground">Send another message to refine this draft, or create it below.</p><Button disabled={busy} onClick={create}>Create {kind}</Button></section>}
      {result && <div className="rounded-xl border p-5"><p>Created successfully.</p><Link className="text-primary underline" to={result.url}>{result.title}</Link><Button className="ml-3" variant="outline" onClick={reset}>Start a new chat</Button></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!result && <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void send(); }}><label htmlFor="mixdi-message" className="text-sm font-medium">Message Mixdi</label><Textarea id="mixdi-message" value={text} maxLength={8000} disabled={busy} onChange={(e) => setText(e.target.value)} placeholder="Create a task to…" /><div className="flex justify-between gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={reset}>New chat</Button><Button disabled={busy || !destination || !text.trim() || messages.length >= 28}><Send className="mr-2 size-4" />{busy ? "Working…" : "Send"}</Button></div>{messages.length >= 28 && <p className="text-sm">Start a new chat to continue.</p>}</form>}
    </>}
  </div></main>;
}
