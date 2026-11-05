import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, ChevronDown, FlaskConical, KeyRound, Loader2, Search, Settings2, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AI_PROVIDERS, type MixdiModelTestResult, type MixdiSettings, type MixdiSettingsInput } from "@mixedlane/shared";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Provider = typeof AI_PROVIDERS[number];
const providerNames: Record<Provider, string> = { ollama: "Ollama Cloud", gemini: "Google Gemini", grok: "Grok · xAI", openai: "OpenAI", custom: "Custom provider" };
function formValue(settings: MixdiSettings): MixdiSettingsInput {
  const { providers, sharedProviders: _, ...config } = settings;
  return { ...config, providers: Object.fromEntries(AI_PROVIDERS.map((p) => [p, { model: providers[p]?.model ?? "", ...(p === "custom" ? { url: providers[p]?.url ?? "" } : {}) }])) as MixdiSettingsInput["providers"] };
}

export function MixdiSettingsTab() {
  const { org, can } = useOrg();
  const settings = useQuery({ queryKey: ["mixdi-settings", org?.id], queryFn: api.mixdi.settings, enabled: can("org.manage") });
  if (!can("org.manage")) return <div className="rounded-xl border p-6 text-sm text-muted-foreground">Only organization admins can manage Mixdi.</div>;
  if (settings.isError) return <div role="alert" className="rounded-xl border p-5 text-sm text-destructive">{settings.error.message}<Button className="ml-3" variant="outline" size="sm" onClick={() => settings.refetch()}>Retry</Button></div>;
  if (!settings.data) return <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /></div>;
  return <SettingsForm key={org?.id} initial={settings.data} />;
}

function SettingsForm({ initial }: { initial: MixdiSettings }) {
  const { org } = useOrg();
  const cache = useQueryClient();
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(() => formValue(initial));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<Provider | "all" | null>(null);
  const [results, setResults] = useState<Partial<Record<Provider, MixdiModelTestResult>>>({});
  const [testError, setTestError] = useState("");
  const [tab, setTab] = useState<"models" | "access">("models");
  const members = useQuery({ queryKey: ["mixdi-members", org?.id], queryFn: api.orgs.members });
  const projects = useQuery({ queryKey: ["mixdi-projects", org?.id], queryFn: api.projects.list });
  const spaces = useQuery({ queryKey: ["mixdi-spaces", org?.id], queryFn: api.docs.spaces });
  const locked = saving || testing !== null;
  useEffect(() => {
    if (!dirty && !locked && initial !== saved) { setSaved(initial); setValue(formValue(initial)); setResults({}); }
  }, [initial, saved, dirty, locked]);
  const shared = value.providerMode === "shared";
  const hasKey = (p: Provider) => shared ? !!saved.sharedProviders?.[p]?.configured : value.providers[p].apiKey === undefined ? !!saved.providers[p]?.configured : !!value.providers[p].apiKey;
  const modelFor = (p: Provider) => shared ? saved.sharedProviders?.[p]?.model ?? "" : value.providers[p].model;
  const configured = AI_PROVIDERS.filter((p) => hasKey(p));
  function change(patch: Partial<MixdiSettingsInput>) { setValue((v) => ({ ...v, ...patch })); setDirty(true); }
  function providerChange(p: Provider, patch: Partial<MixdiSettingsInput["providers"]["custom"]>) {
    change({ providers: { ...value.providers, [p]: { ...value.providers[p], ...patch } } });
    setResults((r) => ({ ...r, [p]: undefined })); setTestError("");
  }
  function toggle(field: "userIds" | "projectIds" | "spaceIds", id: string) { change({ [field]: value[field].includes(id) ? value[field].filter((x) => x !== id) : [...value[field], id] }); }
  async function save() {
    setSaving(true);
    try {
      const updated = await api.mixdi.save(value);
      setSaved(updated); setValue(formValue(updated)); setDirty(false);
      cache.setQueryData(["mixdi-settings", org?.id], updated);
      await Promise.all([cache.invalidateQueries({ queryKey: ["mixdi-access"] }), cache.invalidateQueries({ queryKey: ["mixdi-history"] })]);
      toast.success("Mixdi settings saved");
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  }
  async function test(provider?: Provider) {
    setTesting(provider ?? "all"); setTestError("");
    setResults((r) => provider ? { ...r, [provider]: undefined } : {});
    try {
      const tested = await api.mixdi.testModels({ providerMode: value.providerMode, ...(shared ? {} : { providers: value.providers }), ...(provider ? { provider } : {}) });
      setResults((r) => ({ ...r, ...Object.fromEntries(tested.map((result) => [result.provider, result])) }));
    } catch (e) { setTestError((e as Error).message); } finally { setTesting(null); }
  }
  return <div className="mx-auto max-w-6xl space-y-6 pb-8">
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-3"><span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="size-6" /></span><div><h2 className="text-lg font-semibold tracking-tight">Your Mixdi assistant</h2><p className="mt-1 text-sm text-muted-foreground">Models, capabilities and workspace access in one place.</p></div></div>
      <div className="flex items-center gap-3"><span role="status" className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : "All changes saved"}</span><Button disabled={locked || !dirty} onClick={save}>{saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}Save Mixdi settings</Button></div>
      <div className="flex w-full flex-wrap items-center justify-between gap-3 border-t pt-4"><div className="space-y-1"><h3 className="text-sm font-medium">Enable Mixdi for this workspace</h3><p className="text-xs text-muted-foreground">{value.userIds.length} selected users · {Number(value.createTickets) + Number(value.createDocuments)} allowed actions · {configured.length} configured models</p></div><label className="flex items-center gap-3 text-sm"><span>{value.enabled ? "Enabled" : "Disabled"}</span><input aria-label="Enable Mixdi" role="switch" type="checkbox" className="size-5 accent-primary" checked={value.enabled} disabled={locked} onChange={(e) => change({ enabled: e.target.checked })} /></label></div>
    </header>
    <div role="tablist" aria-label="Mixdi configuration" className="flex gap-1 border-b"><button id="mixdi-models-tab" role="tab" aria-selected={tab === "models"} aria-controls="mixdi-models-panel" onClick={() => setTab("models")} className={cn("flex items-center gap-2 border-b-2 px-4 py-3 text-sm", tab === "models" ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground")}><Settings2 className="size-4" />Models & testing</button><button id="mixdi-access-tab" role="tab" aria-selected={tab === "access"} aria-controls="mixdi-access-panel" onClick={() => setTab("access")} className={cn("flex items-center gap-2 border-b-2 px-4 py-3 text-sm", tab === "access" ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground")}><ShieldCheck className="size-4" />Access & capabilities</button></div>
    {tab === "models" ? <section role="tabpanel" id="mixdi-models-panel" aria-labelledby="mixdi-models-tab" className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">{(["shared", "dedicated"] as const).map((mode) => <label key={mode} className={cn("flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors", value.providerMode === mode && "border-primary bg-primary/5")}><input type="radio" name="mixdi-provider-source" className="mt-1 accent-primary" disabled={locked} checked={value.providerMode === mode} onChange={() => { change({ providerMode: mode }); setResults({}); setTestError(""); }} /><div><span className="text-sm font-semibold">{mode === "shared" ? "Reuse existing providers" : "Dedicated Mixdi providers"}</span><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{mode === "shared" ? "Use the models configured for WhatsApp, with the same fallback order." : "Choose separate models and credentials just for Mixdi."}</p></div></label>)}</div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{shared ? "Shared models" : "Provider configuration"}</h3><p className="mt-1 text-xs text-muted-foreground">Providers run in the order below. Tests validate connectivity and Mixdi JSON output.</p></div><Button variant="outline" disabled={locked || !configured.length} onClick={() => test()}>{testing === "all" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <FlaskConical className="mr-2 size-4" />}Test all configured</Button></div>
      <p className="rounded-lg bg-muted/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">Tests use a small synthetic prompt and may consume provider quota. Dedicated tests include your unsaved model edits; saved keys stay on the server. Testing never saves settings or creates tickets or documents.{shared && <> <Link className="text-primary underline" to={`/${org?.slug}/settings/integrations`}>Manage shared providers</Link>.</>}</p>
      {testError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{testError}</p>}
      {shared && !configured.length && <div className="rounded-xl border border-dashed p-8 text-center"><KeyRound className="mx-auto mb-3 size-6 text-muted-foreground" /><h4 className="text-sm font-medium">No shared providers configured</h4><p className="mt-2 text-sm text-muted-foreground">Configure a provider in WhatsApp settings or choose dedicated Mixdi providers above.</p></div>}
      <div className="space-y-3">{AI_PROVIDERS.filter((p) => !shared || configured.includes(p)).map((p, index) => {
        const result = results[p];
        const active = testing === "all" ? configured.includes(p) : testing === p;
        return <details key={`${value.providerMode}:${p}`} open={shared || hasKey(p) || !!modelFor(p)} className="group overflow-hidden rounded-xl border bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 sm:px-5"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-xs font-semibold text-muted-foreground">{index + 1}</span><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold">{providerNames[p]}</h4><p className="mt-0.5 truncate text-xs text-muted-foreground">{modelFor(p) || "Add a model to get started"}</p></div><span className={cn("rounded-full px-2 py-1 text-[11px] font-medium", hasKey(p) ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>{hasKey(p) ? "Key configured" : "Not configured"}</span><ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary>
          <div className="space-y-4 border-t p-4 sm:p-5">
            {shared ? <p className="text-sm text-muted-foreground">Uses the saved {providerNames[p]} configuration from WhatsApp.{p === "custom" && saved.sharedProviders?.[p]?.url && <span className="mt-1 block break-all font-mono text-xs">{saved.sharedProviders[p].url}</span>}</p> : <>
              <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-medium" htmlFor={`mixdi-${p}-model`}>Model name<Input id={`mixdi-${p}-model`} className="mt-1.5" disabled={locked} value={value.providers[p].model} placeholder="Enter the provider's model ID" onChange={(e) => providerChange(p, { model: e.target.value })} /></label><label className="text-xs font-medium" htmlFor={`mixdi-${p}-key`}>API key{saved.providers[p]?.configured && value.providers[p].apiKey === undefined && <span className="ml-2 font-normal text-emerald-600">Saved securely</span>}<Input id={`mixdi-${p}-key`} className="mt-1.5" type="password" autoComplete="new-password" disabled={locked} placeholder={saved.providers[p]?.configured ? "Leave blank to keep the saved key" : "Enter API key"} value={value.providers[p].apiKey ?? ""} onChange={(e) => providerChange(p, { apiKey: e.target.value || undefined })} /></label></div>
              {p === "custom" && <label className="block text-xs font-medium" htmlFor="mixdi-custom-url">Chat completions URL<Input id="mixdi-custom-url" className="mt-1.5" disabled={locked} placeholder="https://provider.example/v1/chat/completions" value={value.providers.custom.url ?? ""} onChange={(e) => providerChange(p, { url: e.target.value })} /></label>}
            </>}
            <div className="flex items-center justify-between gap-3"><Button variant="outline" size="sm" disabled={locked || !hasKey(p) || !modelFor(p)} onClick={() => test(p)}>{active ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : <FlaskConical className="mr-2 size-3.5" />}Test {providerNames[p]}</Button>{!shared && <button className="text-xs text-muted-foreground underline-offset-4 hover:text-destructive hover:underline" disabled={locked} onClick={() => providerChange(p, { model: "", apiKey: "", ...(p === "custom" ? { url: "" } : {}) })}>Clear configuration</button>}</div>
            {result && <div role="status" className={cn("flex gap-2 rounded-lg border p-3", result.ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-destructive/20 bg-destructive/5")}>{result.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}<div className="min-w-0"><p className="text-sm font-medium">{result.ok ? "Model ready" : "Test failed"}<span className="ml-2 text-xs font-normal text-muted-foreground">{result.durationMs.toLocaleString()} ms{result.status ? ` · HTTP ${result.status}` : ""}</span></p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{result.message}</p></div></div>}
          </div>
        </details>;
      })}</div>
    </section> : <section role="tabpanel" id="mixdi-access-panel" aria-labelledby="mixdi-access-tab" className="space-y-5">
      <div><h3 className="font-semibold">What Mixdi can do</h3><p className="mt-1 text-sm text-muted-foreground">Mixdi uses each person's existing access. These settings further limit its actions and destinations.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">{([['createTickets','Create tickets','Draft and create new work items in selected projects.'],['createDocuments','Create documents','Draft and create pages in selected document spaces.']] as const).map(([field,title,description]) => <label key={field} className={cn("flex gap-3 rounded-xl border p-4", value[field] && "border-primary/40 bg-primary/5")}><input type="checkbox" className="mt-1 size-4 accent-primary" disabled={locked} checked={value[field]} onChange={(e) => change({ [field]: e.target.checked })} /><div><span className="text-sm font-medium">{title}</span><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p></div></label>)}</div>
      <AccessList title="Who can use Mixdi" hint="Access is opt-in, including admins. An empty selection allows no users." items={members.data?.map((m) => ({ id: m.userId, name: m.name, detail: m.email }))} selected={value.userIds} loading={members.isPending} error={members.isError} retry={() => members.refetch()} disabled={locked} onToggle={(id) => toggle("userIds", id)} />
      <div className="grid gap-5 xl:grid-cols-2"><AccessList title="Ticket projects" hint="Select where Mixdi may create tickets." items={projects.data?.map((p) => ({ id: p.id, name: p.name, detail: p.key }))} selected={value.projectIds} loading={projects.isPending} error={projects.isError} retry={() => projects.refetch()} disabled={locked} onToggle={(id) => toggle("projectIds", id)} /><AccessList title="Document spaces" hint="Select where Mixdi may create documents." items={spaces.data?.map((s) => ({ id: s.id, name: s.name, detail: s.key }))} selected={value.spaceIds} loading={spaces.isPending} error={spaces.isError} retry={() => spaces.refetch()} disabled={locked} onToggle={(id) => toggle("spaceIds", id)} /></div>
    </section>}
  </div>;
}

function AccessList({ title, hint, items = [], selected, loading, error, retry, disabled, onToggle }: { title: string; hint: string; items?: { id: string; name: string; detail?: string }[]; selected: string[]; loading: boolean; error: boolean; retry: () => void; disabled: boolean; onToggle: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const filtered = items.filter((item) => `${item.name} ${item.detail ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="overflow-hidden rounded-xl border bg-card"><div className="border-b p-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{title}</h3><span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{selected.length} selected</span></div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p><div className="relative mt-3"><Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input aria-label={`Search ${title.toLowerCase()}`} className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" /></div></div><div className="max-h-64 divide-y overflow-y-auto">{loading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : error ? <p role="alert" className="p-4 text-sm text-destructive">Could not load this list. <button className="underline" onClick={retry}>Retry</button></p> : !filtered.length ? <p className="p-4 text-sm text-muted-foreground">{query ? "No matches." : "Nothing available yet."}</p> : filtered.map((item) => <label key={item.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/30"><input type="checkbox" className="size-4 shrink-0 accent-primary" checked={selected.includes(item.id)} disabled={disabled} onChange={() => onToggle(item.id)} /><span className="min-w-0"><span className="block truncate text-sm">{item.name}</span>{item.detail && <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>}</span></label>)}</div></section>;
}
