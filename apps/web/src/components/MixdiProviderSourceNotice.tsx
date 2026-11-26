import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeProviderOrder } from "@mixedlane/shared";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { providerNames } from "./ProviderFallbackOrder";

/** Read the same saved provider mode consumed by chat; never infer it from integration fields. */
export function MixdiProviderSourceNotice({ allowSwitch = false }: { allowSwitch?: boolean }) {
  const { org, can } = useOrg();
  const cache = useQueryClient();
  const key = ["mixdi-settings", org?.id];
  const settings = useQuery({ queryKey: key, queryFn: api.mixdi.settings, enabled: can("org.manage") });
  const switchSource = useMutation({ mutationFn: () => api.mixdi.setProviderSource({ providerMode: "shared" }), onSuccess: (saved) => {
    cache.setQueryData(key, saved);
    void cache.invalidateQueries({ queryKey: ["mixdi-access"] });
    toast.success("Mixdi now uses the saved integration providers");
  } });
  if (!can("org.manage")) return null;
  if (settings.isError) return <p role="alert" className="text-sm text-destructive">Could not verify Mixdi’s active provider source: {settings.error.message}</p>;
  if (!settings.data) return <p className="text-xs text-muted-foreground">Checking Mixdi’s active provider source…</p>;
  const saved = settings.data;
  const shared = saved.providerMode === "shared";
  const providers = shared ? saved.sharedProviders : saved.providers;
  const order = normalizeProviderOrder(shared ? saved.sharedProviderOrder : saved.providerOrder);
  const active = order.filter((provider) => providers[provider]?.configured && providers[provider]?.model);
  const canUseShared = Object.entries(saved.sharedProviders).some(([provider, info]) => info.configured && info.model && (provider !== "custom" || info.url));
  return <div className={`space-y-2 rounded-lg border p-3 text-sm ${shared ? "bg-muted/30" : "border-amber-500/40 bg-amber-500/5"}`}>
    <p className="font-medium">Mixdi uses {shared ? "these shared integration providers" : "separate dedicated providers"}.</p>
    <p className="break-words text-xs text-muted-foreground">Saved default and fallbacks: {active.length ? active.map((provider) => `${providerNames[provider]} (${providers[provider].model})`).join(" → ") : "No configured models"}.</p>
    {!shared && allowSwitch && <><p className="text-xs text-muted-foreground">Apply the saved integration models and fallback order to Mixdi. Existing dedicated credentials and access settings are retained.</p><Button type="button" size="sm" variant="outline" disabled={switchSource.isPending || !canUseShared} onClick={() => switchSource.mutate()}>{switchSource.isPending ? "Applying…" : "Use saved integration providers in Mixdi"}</Button>{!canUseShared && <p className="text-xs text-muted-foreground">Save an integration provider key and model first.</p>}</>}
    {switchSource.error && <p role="alert" className="text-xs text-destructive">{switchSource.error.message}</p>}
    <p><Link className="text-xs text-primary underline" to={`/${org?.slug}/settings/mixdi`}>Manage Mixdi provider settings</Link></p>
  </div>;
}
