import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AI_PROVIDERS, type MixdiSettings, type MixdiSettingsInput } from "@mixedlane/shared";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function MixdiSettingsTab() {
  const { org, can } = useOrg();
  const settings = useQuery({ queryKey: ["mixdi-settings", org?.id], queryFn: api.mixdi.settings, enabled: can("org.manage") });
  if (!can("org.manage")) return <p>Only organization admins can manage Mixdi.</p>;
  if (settings.isError) return <p role="alert">{settings.error.message}</p>;
  if (!settings.data) return <p>Loading Mixdi settings…</p>;
  return <SettingsForm key={org?.id} initial={settings.data} />;
}

function SettingsForm({ initial }: { initial: MixdiSettings }) {
  const { org } = useOrg();
  const cache = useQueryClient();
  const [value, setValue] = useState<MixdiSettingsInput>(() => ({ ...initial, providers: Object.fromEntries(AI_PROVIDERS.map((p) => [p, { model: initial.providers[p]?.model ?? "", ...(p === "custom" ? { url: initial.providers[p]?.url ?? "" } : {}) }])) as MixdiSettingsInput["providers"] }));
  const [saving, setSaving] = useState(false);
  const members = useQuery({ queryKey: ["mixdi-members", org?.id], queryFn: api.orgs.members });
  const projects = useQuery({ queryKey: ["mixdi-projects", org?.id], queryFn: api.projects.list });
  const spaces = useQuery({ queryKey: ["mixdi-spaces", org?.id], queryFn: api.docs.spaces });
  const toggle = (field: "userIds" | "projectIds" | "spaceIds", id: string) => setValue((s) => ({ ...s, [field]: s[field].includes(id) ? s[field].filter((x) => x !== id) : [...s[field], id] }));
  const check = (label: string, field: "enabled" | "createTickets" | "createDocuments") => <label className="flex items-center gap-2"><input type="checkbox" checked={value[field]} onChange={(e) => setValue({ ...value, [field]: e.target.checked })} />{label}</label>;
  async function save() {
    setSaving(true);
    try {
      await api.mixdi.save(value);
      setValue((v) => ({ ...v, providers: Object.fromEntries(AI_PROVIDERS.map((p) => { const { apiKey: _, ...rest } = v.providers[p]; return [p, rest]; })) as MixdiSettingsInput["providers"] }));
      await cache.invalidateQueries({ queryKey: ["mixdi-access"] });
      toast.success("Mixdi settings saved");
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  }
  return <div className="max-w-3xl space-y-6">
    <div><h2 className="text-lg font-semibold">Mixdi</h2><p className="text-sm text-muted-foreground">Control who can chat with Mixdi and where it can create tickets and documents. Every action also requires the user's existing access.</p></div>
    {check("Enable Mixdi", "enabled")}
    <section className="space-y-3 rounded-xl border p-5"><h3 className="font-medium">AI provider</h3>
      <label className="block text-sm">Provider source<select className="mt-1 block w-full rounded-md border bg-background p-2" value={value.providerMode} onChange={(e) => setValue({ ...value, providerMode: e.target.value as "shared" | "dedicated" })}><option value="shared">Reuse WhatsApp AI providers</option><option value="dedicated">Dedicated Mixdi providers</option></select></label>
      {value.providerMode === "shared" ? <p className="text-sm text-muted-foreground">Uses the providers configured in Integrations → WhatsApp, including their fallback order.</p> : AI_PROVIDERS.map((p) => <fieldset key={p} className="space-y-2 border-t pt-3"><legend className="text-sm font-medium capitalize">{p}</legend>
        <label className="block text-sm">Model<Input value={value.providers[p].model} onChange={(e) => setValue({ ...value, providers: { ...value.providers, [p]: { ...value.providers[p], model: e.target.value } } })} /></label>
        <label className="block text-sm">API key<Input type="password" autoComplete="new-password" placeholder="Leave unchanged; blank preserves saved key" value={value.providers[p].apiKey ?? ""} onChange={(e) => setValue({ ...value, providers: { ...value.providers, [p]: { ...value.providers[p], apiKey: e.target.value || undefined } } })} /></label>
        {p === "custom" && <label className="block text-sm">Chat completions URL<Input value={value.providers.custom.url ?? ""} onChange={(e) => setValue({ ...value, providers: { ...value.providers, custom: { ...value.providers.custom, url: e.target.value } } })} /></label>}
        <Button variant="outline" size="sm" onClick={() => setValue({ ...value, providers: { ...value.providers, [p]: { model: "", apiKey: "", ...(p === "custom" ? { url: "" } : {}) } } })}>Remove {p} configuration</Button>
      </fieldset>)}
    </section>
    <section className="space-y-3 rounded-xl border p-5"><h3 className="font-medium">Allowed actions</h3>{check("Create tickets", "createTickets")}{check("Create documents", "createDocuments")}</section>
    <section className="space-y-3 rounded-xl border p-5"><h3 className="font-medium">Users with Mixdi access</h3><p className="text-sm text-muted-foreground">Access is opt-in, including admins.</p>{members.data?.map((m) => <label key={m.userId} className="flex items-center gap-2"><input type="checkbox" checked={value.userIds.includes(m.userId)} onChange={() => toggle("userIds", m.userId)} />{m.name} · {m.email}</label>)}</section>
    <section className="space-y-3 rounded-xl border p-5"><h3 className="font-medium">Allowed destinations</h3><p className="text-sm text-muted-foreground">Select projects for tickets and spaces for documents. An empty selection allows none.</p>
      {projects.data?.map((p) => <label key={p.id} className="flex items-center gap-2"><input type="checkbox" checked={value.projectIds.includes(p.id)} onChange={() => toggle("projectIds", p.id)} />Project: {p.name}</label>)}
      {spaces.data?.map((s) => <label key={s.id} className="flex items-center gap-2"><input type="checkbox" checked={value.spaceIds.includes(s.id)} onChange={() => toggle("spaceIds", s.id)} />Space: {s.name}</label>)}
    </section>
    <Button disabled={saving} onClick={save}>{saving ? "Saving…" : "Save Mixdi settings"}</Button>
  </div>;
}
