import { useEffect, useState } from "react";
import type { AI_PROVIDERS, AiModelOption } from "@mixedlane/shared";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProviderModelSelect({ id, provider, value, apiKey, hasSavedKey, source, disabled, onChange }: {
  id: string; provider: typeof AI_PROVIDERS[number]; value: string; apiKey?: string;
  hasSavedKey: boolean; source: "whatsapp" | "mixdi"; disabled?: boolean; onChange: (value: string) => void;
}) {
  const { org } = useOrg();
  const hasKey = !!apiKey?.trim() || hasSavedKey;
  const [models, setModels] = useState<AiModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setModels([]); setError("");
    if (!hasKey || provider === "custom") { setLoading(false); return; }
    setLoading(true);
    const controller = new AbortController();
    // Keep transient keys out of query keys, URLs, and persisted browser caches.
    const timer = setTimeout(async () => {
      try {
        const input = { provider, ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}) };
        const result = source === "whatsapp" ? await api.whatsapp.models(input, controller.signal)
          : await api.mixdi.models({ ...input, providerMode: "dedicated" }, controller.signal);
        if (!controller.signal.aborted) setModels(result);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not load models.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [org?.id, provider, apiKey, hasKey, hasSavedKey, source, attempt]);

  return <div className="space-y-1.5">
    <Label htmlFor={hasKey ? id : undefined}>Model</Label>
    {!hasKey ? <p className="text-xs text-muted-foreground">Add an API key to select a model.</p>
      : provider === "custom" ? <Input id={id} aria-label={`${provider} model`} value={value} disabled={disabled} placeholder="Enter the provider's model ID" onChange={(event) => onChange(event.target.value)} />
        : <>
          <div className="flex gap-2">
            <select id={id} aria-label={`${provider} model`} aria-busy={loading} disabled={disabled || loading || (!models.length && !value)} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm">
              <option value="">{loading ? "Loading models…" : "Select a model"}</option>
              {value && !models.some((model) => model.id === value) && <option value={value}>{value} (current selection)</option>}
              {models.map((model) => <option key={model.id} value={model.id}>{model.name === model.id ? model.id : `${model.name} · ${model.id}`}</option>)}
            </select>
            <Button type="button" variant="outline" size="sm" disabled={disabled || loading} onClick={() => setAttempt((current) => current + 1)}>{error ? "Retry" : "Refresh"}</Button>
          </div>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          {!loading && !error && !models.length && <p role="status" className="text-xs text-muted-foreground">No compatible models returned for this key.</p>}
        </>}
  </div>;
}
