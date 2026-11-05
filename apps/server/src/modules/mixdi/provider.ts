import { mixdiReplySchema, type AI_PROVIDERS, type MixdiChat, type MixdiModelTestCategory } from "@mixedlane/shared";
import { httpFailure, providerCode } from "../whatsapp/ai-diagnostics";

const guidance: Record<MixdiModelTestCategory, string> = {
  configuration: "Enter a model and API key. Custom providers also require a chat completions URL.",
  credentials: "Check the API key and its permission to use this model.",
  model: "Check the model name and that it is available to this account.",
  rate_limit: "The provider quota or rate limit was reached. Check usage or retry later.",
  timeout: "The provider timed out. Retry or choose another model.",
  network: "Could not reach the provider. Check the endpoint and server connectivity.",
  invalid_output: "The model did not return Mixdi's expected JSON response. Check JSON support or choose another model.",
  provider_error: "The provider rejected the request. Check its service status and model compatibility.",
};
export class MixdiProviderError extends Error {
  constructor(readonly category: MixdiModelTestCategory, readonly status?: number) { super(guidance[category]); }
}

/** Shared by model tests and the chat workflow so tests exercise the actual request format. */
export async function invokeMixdiProvider(provider: typeof AI_PROVIDERS[number], configuration: { apiKey?: string; model: string; url?: string }, system: string, messages: MixdiChat["messages"], options: { timeoutMs?: number; maxTokens?: number } = {}) {
  const { apiKey, model, url: customUrl } = configuration;
  if (!apiKey || !model || (provider === "custom" && !customUrl)) throw new MixdiProviderError("configuration");
  const maxTokens = options.maxTokens ?? 8192;
  let url: string, headers: Record<string, string>, body: unknown;
  if (provider === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers = { "x-goog-api-key": apiKey };
    body = { systemInstruction: { parts: [{ text: system }] }, contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })), generationConfig: { responseMimeType: "application/json", maxOutputTokens: maxTokens } };
  } else {
    url = provider === "ollama" ? "https://ollama.com/api/chat" : provider === "custom" ? customUrl! : provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.x.ai/v1/chat/completions";
    headers = { authorization: `Bearer ${apiKey}` };
    body = { model, stream: false, ...(provider === "ollama" ? { format: "json", options: { num_predict: maxTokens } } : { response_format: { type: "json_object" }, max_completion_tokens: maxTokens }), messages: [{ role: "system", content: system }, ...messages] };
  }
  let response: Response;
  try { response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(options.timeoutMs ?? 40000), redirect: "error" }); }
  catch (error) { throw new MixdiProviderError(error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "timeout" : "network"); }
  if (!response.ok) {
    const error = await response.json().catch(() => null) as any;
    const failure = httpFailure(response.status, providerCode(error?.error?.code ?? error?.error?.status));
    throw new MixdiProviderError(failure.category, response.status);
  }
  try {
    const data = await response.json() as any;
    const content = provider === "gemini" ? data.candidates?.[0]?.content?.parts?.filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join("") : provider === "ollama" ? data.message?.content : data.choices?.[0]?.message?.content;
    return mixdiReplySchema.parse(JSON.parse(content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")));
  } catch { throw new MixdiProviderError("invalid_output", response.status); }
}
