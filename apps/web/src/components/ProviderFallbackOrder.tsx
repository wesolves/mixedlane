import { normalizeProviderOrder, type AiProvider } from "@mixedlane/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const providerNames: Record<AiProvider, string> = { ollama: "Ollama Cloud", gemini: "Google Gemini", grok: "Grok · xAI", openai: "OpenAI", anthropic: "Anthropic · Claude", custom: "Custom provider" };

export function ProviderFallbackOrder({ id, order, configured, disabled, onChange }: {
  id: string; order?: readonly AiProvider[]; configured: AiProvider[]; disabled?: boolean; onChange: (order: AiProvider[]) => void;
}) {
  const all = normalizeProviderOrder(order);
  const active = all.filter((provider) => configured.includes(provider));
  const update = (next: AiProvider[]) => onChange([...next, ...all.filter((provider) => !next.includes(provider))]);
  const move = (index: number, offset: number) => {
    const next = [...active];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    update(next);
  };
  return <div className="space-y-3 rounded-lg border p-4">
    <div><h3 className="text-sm font-semibold">Default provider and fallbacks</h3><p className="mt-1 text-xs text-muted-foreground">Try the default first, then each fallback in order if a request fails. Unconfigured or removed providers are skipped.</p></div>
    {!active.length ? <p className="text-sm text-muted-foreground">Add a provider key and model to choose a default.</p> : <>
      <div className="space-y-1.5"><Label htmlFor={id}>Default provider</Label><select id={id} className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={active[0]} disabled={disabled} onChange={(event) => update([event.target.value as AiProvider, ...active.filter((provider) => provider !== event.target.value)])}>{active.map((provider) => <option key={provider} value={provider}>{providerNames[provider]}</option>)}</select></div>
      <ol className="space-y-2">{active.map((provider, index) => <li key={provider} className="flex items-center justify-between gap-3 text-sm"><span>{index === 0 ? "Default" : `Fallback ${index}`}: {providerNames[provider]}</span><div className="flex gap-1"><Button type="button" variant="outline" size="sm" aria-label={`Move ${providerNames[provider]} earlier`} disabled={disabled || index === 0} onClick={() => move(index, -1)}>↑</Button><Button type="button" variant="outline" size="sm" aria-label={`Move ${providerNames[provider]} later`} disabled={disabled || index === active.length - 1} onClick={() => move(index, 1)}>↓</Button></div></li>)}</ol>
    </>}
  </div>;
}
