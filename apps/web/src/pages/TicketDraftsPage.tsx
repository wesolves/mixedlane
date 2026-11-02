import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateItemDialog } from "@/components/create/CreateItemDialog";
import { paths } from "@/lib/project";

const statuses = ["select_project", "generating", "review", "created", "cancelled", "failed"];
const pageSize = 20;

export function TicketDraftsPage() {
  const { org, can } = useOrg();
  const openCreate = useCreateItemDialog();
  const [params, setParams] = useSearchParams();
  const selectedDraft = params.get("draft");
  const qc = useQueryClient();
  const key = ["whatsapp", org?.id];
  const drafts = useQuery({ queryKey: [...key, "drafts"], queryFn: api.whatsapp.drafts, refetchInterval: 8000 });
  const projects = useQuery({ queryKey: ["projects"], queryFn: api.projects.list });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [project, setProject] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(0);
  const filtered = (drafts.data ?? []).filter((d) =>
    (!selectedDraft || d.id === selectedDraft) &&
    (!status || d.status === status) && (!project || (project === "unassigned" ? !d.projectId : d.projectId === project)) &&
    (d.proposal?.title ?? d.report).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  ).sort((a, b) => {
    const title = (d: typeof a) => d.proposal?.title ?? d.report;
    const order = sort === "title" ? title(a).localeCompare(title(b)) : sort === "oldest" ? Date.parse(a.createdAt) - Date.parse(b.createdAt) : Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return order || b.id.localeCompare(a.id);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const pageDrafts = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  useEffect(() => { setSearch(""); setStatus(""); setProject(""); setSort("newest"); setPage(0); }, [org?.id]);
  const action = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: () => { void qc.invalidateQueries({ queryKey: key }); }, onError: (e: Error) => toast.error(e.message) });
  const selectClass = "h-9 rounded-md border bg-background px-3 text-sm";
  return <div role="region" aria-label="Ticket drafts" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
    <Link className="text-sm text-muted-foreground hover:underline" to={`/${org?.slug}/settings/integrations`}>Back to integrations</Link>
    <div className="flex items-center justify-between gap-3"><h1 className="text-xl font-semibold">Ticket drafts</h1><Button variant="outline" size="sm" onClick={() => void drafts.refetch()}><RefreshCw className="size-4" />Refresh</Button></div>
    <p className="text-sm text-muted-foreground">{can("integration.manage") ? "All organization drafts. The sender or an admin can review drafts." : "Your drafts. You can review reports you created."}</p>
    {selectedDraft && <Button variant="outline" onClick={() => setParams({})}>Show all drafts</Button>}
    <div className="flex flex-wrap gap-2">
      <Input className="min-w-48 flex-1" aria-label="Search draft titles" placeholder="Search draft titles..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
      <select className={selectClass} aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select>
      <select className={selectClass} aria-label="Filter by project" value={project} onChange={(e) => { setProject(e.target.value); setPage(0); }}><option value="">All projects</option><option value="unassigned">Awaiting project</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <select className={selectClass} aria-label="Sort drafts" value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Title A-Z</option></select>
      <Button variant="ghost" onClick={() => { setSearch(""); setStatus(""); setProject(""); setSort("newest"); setPage(0); }}>Reset filters</Button>
    </div>
    {drafts.isLoading && <p role="status">Loading ticket drafts...</p>}
    {drafts.error && <p role="alert" className="text-sm text-destructive">{drafts.error.message}</p>}
    {!drafts.isLoading && !drafts.error && !filtered.length && <p className="rounded-lg border p-6 text-sm text-muted-foreground">{drafts.data?.length ? "No drafts match your filters." : "No ticket drafts yet."}</p>}
    <p className="text-xs text-muted-foreground" aria-live="polite">{filtered.length} matching drafts</p>
        {pageDrafts.map((d) => <article key={d.id} className="space-y-3 rounded-lg border p-4 [overflow-wrap:anywhere]"><div className="flex flex-wrap items-start justify-between gap-3"><h2 className="min-w-0 flex-1 text-sm font-medium">{d.proposal?.title ?? d.report.slice(0, 140)}</h2><span className="rounded-full bg-muted px-2 py-1 text-xs">{d.status.replaceAll("_", " ")}</span></div><p className="text-xs text-muted-foreground">{d.chatId.split("@")[0]} · {new Date(d.createdAt).toLocaleString()}{d.provider ? ` · ${d.provider}` : ""}</p>
          <details><summary className="cursor-pointer text-xs text-muted-foreground">Original report</summary><p className="mt-2 whitespace-pre-wrap text-sm">{d.report}</p></details>
          {d.item && <Button asChild variant="outline" size="sm"><Link to={paths.item(d.item.projectKey, d.item)}>Open {d.item.key}</Link></Button>}
          {d.proposal && <><p className="text-xs font-medium">{d.proposal.type} · {d.proposal.category} · {d.proposal.priority}{d.proposal.parentId ? ` · Parent: ${d.proposal.parentId}` : ""}</p><p className="whitespace-pre-wrap text-sm">{d.proposal.description}</p><p className="text-xs text-muted-foreground">{d.proposal.reason}</p>{d.proposal.duplicateId && <p className="text-xs text-amber-600">Possible duplicate: {d.proposal.duplicateId}. Ask the sender to revise the report before creating a ticket.</p>}</>}
          {d.error && <p className="text-sm text-destructive">{d.error}</p>}
          {d.status === "review" && <div className="flex gap-2"><Button size="sm" disabled={action.isPending || !!d.proposal?.duplicateId} onClick={() => action.mutate(() => api.whatsapp.review(d.id, "approve"))}>Create ticket</Button><Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate(() => api.whatsapp.review(d.id, "cancel"))}>Cancel</Button></div>}
          {d.status === "failed" && <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate(() => api.whatsapp.review(d.id, "retry"))}>Retry AI</Button>}
          {["failed", "select_project"].includes(d.status) && (!d.projectId || projects.data?.some((p) => p.id === d.projectId && p.access.permissions.includes("item.create"))) && <Button size="sm" className="ml-2" onClick={() => openCreate({ draftId: d.id, projectKey: projects.data?.find((p) => p.id === d.projectId)?.key, title: d.report.split("\n")[0].slice(0, 300), description: `<p>${d.report.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>` })}>Create ticket manually</Button>}
        </article>)}
    <nav className="flex items-center justify-between" aria-label="Draft pages"><Button variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="text-sm">Page {currentPage + 1} of {pages}</span><Button variant="outline" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>Next</Button></nav>
    </div>
  </div>;
}
