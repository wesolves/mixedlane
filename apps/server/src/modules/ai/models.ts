import { z } from "zod";
import type { AiModelListInput, AiModelOption } from "@mixedlane/shared";
import { AppError } from "../../core/http";
import { anthropicHeaders } from "./anthropic";

const endpoints: Record<AiModelListInput["provider"], string> = {
  ollama: "https://ollama.com/api/tags",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
  grok: "https://api.x.ai/v1/language-models",
  openai: "https://api.openai.com/v1/models",
  anthropic: "https://api.anthropic.com/v1/models",
};
const pageSchema = z.object({
  models: z.array(z.record(z.unknown())).optional(), data: z.array(z.record(z.unknown())).optional(),
  nextPageToken: z.string().max(4000).optional(), has_more: z.boolean().optional(), last_id: z.string().max(4000).nullable().optional(),
});
const nonChatModel = /(?:^|[-/])(embedding|image|audio|realtime|transcribe|tts|whisper|moderation|dall-e|sora)(?:[-/]|$)/i;

/** Fixed upstreams only. Keys stay in headers and are never persisted by discovery. */
export async function listProviderModels(provider: AiModelListInput["provider"], apiKey?: string): Promise<AiModelOption[]> {
  if (!apiKey) throw new AppError(400, "Enter or save an API key before loading models.");
  const headers: Record<string, string> = provider === "gemini" ? { "x-goog-api-key": apiKey }
    : provider === "anthropic" ? anthropicHeaders(apiKey) : { authorization: `Bearer ${apiKey}` };
  const models = new Map<string, AiModelOption>();
  const cursors = new Set<string>();
  const signal = AbortSignal.timeout(15000);
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const url = new URL(endpoints[provider]);
    if (provider === "gemini") { url.searchParams.set("pageSize", "1000"); if (cursor) url.searchParams.set("pageToken", cursor); }
    if (provider === "anthropic") { url.searchParams.set("limit", "1000"); if (cursor) url.searchParams.set("after_id", cursor); }
    let response: Response;
    try { response = await fetch(url, { headers, signal, redirect: "error" }); }
    catch (error) {
      throw new AppError(502, error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
        ? "Loading models timed out. Retry shortly."
        : "Could not reach the model provider. Check server connectivity and retry.");
    }
    if (!response.ok) {
      const guidance = [401, 403].includes(response.status) ? "Check the API key and its model-list permissions."
        : response.status === 429 ? "The provider rate limit was reached. Retry shortly." : "The model provider is unavailable. Retry shortly.";
      throw new AppError(502, `Could not load ${provider} models (HTTP ${response.status}). ${guidance}`);
    }
    let data: z.infer<typeof pageSchema>;
    try { data = pageSchema.parse(await response.json()); }
    catch { throw new AppError(502, "The model provider returned an invalid model list. Retry shortly."); }
    const rows = provider === "ollama" || provider === "gemini" || provider === "grok" ? data.models : data.data;
    if (!rows) throw new AppError(502, "The model provider returned an invalid model list. Retry shortly.");
    for (const row of rows) {
      if (provider === "gemini" && (!Array.isArray(row.supportedGenerationMethods) || !row.supportedGenerationMethods.includes("generateContent"))) continue;
      if (provider === "grok" && Array.isArray(row.output_modalities) && !row.output_modalities.includes("text")) continue;
      const rawId = provider === "ollama" ? row.model ?? row.name : provider === "gemini" ? row.name : row.id;
      if (typeof rawId !== "string") continue;
      const id = provider === "gemini" ? rawId.replace(/^models\//, "") : rawId;
      if (!/^[a-zA-Z0-9._:/-]{1,120}$/.test(id) || id.includes(apiKey)) continue;
      if (provider === "openai" && nonChatModel.test(id)) continue;
      if (row.lifecycle === "retired" || (typeof row.shutdown_date === "string" && row.shutdown_date <= new Date().toISOString().slice(0, 10))) continue;
      const label = row.displayName ?? row.display_name ?? id;
      models.set(id, { id, name: typeof label === "string" ? label.split(apiKey).join("[redacted]").slice(0, 160) : id });
    }
    const next = provider === "gemini" ? data.nextPageToken : provider === "anthropic" && data.has_more ? data.last_id : undefined;
    if (!next && !(provider === "anthropic" && data.has_more)) return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
    if (!next || cursors.has(next)) break;
    cursors.add(next); cursor = next;
  }
  throw new AppError(502, "The model provider returned incomplete pagination. Retry loading models.");
}
