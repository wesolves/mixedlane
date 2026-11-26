import { afterEach, describe, expect, it, vi } from "vitest";
import { listProviderModels } from "../src/modules/ai/models";

afterEach(() => vi.restoreAllMocks());
const key = "PRIVATE-API-KEY";

describe("Provider model discovery", () => {
  it.each([
    ["ollama", "https://ollama.com/api/tags", { models: [{ name: "cloud-model:latest", model: "cloud-model" }] }, "cloud-model"],
    ["gemini", "https://generativelanguage.googleapis.com/v1beta/models", { models: [{ name: "models/gemini-test", displayName: "Gemini Test", supportedGenerationMethods: ["generateContent"] }, { name: "models/embed", supportedGenerationMethods: ["embedContent"] }] }, "gemini-test"],
    ["grok", "https://api.x.ai/v1/language-models", { models: [{ id: "grok-test", output_modalities: ["text"] }, { id: "image-generator", output_modalities: ["image"] }] }, "grok-test"],
    ["openai", "https://api.openai.com/v1/models", { data: [{ id: "gpt-test" }, { id: "text-embedding-3-small" }, { id: "gpt-image-test" }, { id: "retired-test", shutdown_date: "2020-01-01" }] }, "gpt-test"],
    ["anthropic", "https://api.anthropic.com/v1/models", { data: [{ id: "claude-test", display_name: "Claude Test" }], has_more: false }, "claude-test"],
  ] as const)("normalizes %s models using its fixed upstream and correct authentication", async (provider, endpoint, body, id) => {
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body));
    const models = await listProviderModels(provider, key);
    expect(models).toEqual([{ id, name: provider === "gemini" ? "Gemini Test" : provider === "anthropic" ? "Claude Test" : id }]);
    const [url, options] = mock.mock.calls[0];
    expect(String(url).split("?")[0]).toBe(endpoint);
    expect(String(url)).not.toContain(key);
    expect(options?.headers).toMatchObject(provider === "gemini" ? { "x-goog-api-key": key } : { authorization: `Bearer ${key}` });
    if (provider === "anthropic") expect(options?.headers).toHaveProperty("anthropic-version");
    expect(options?.redirect).toBe("error");
  });

  it("requires a key before making any request", async () => {
    const mock = vi.spyOn(globalThis, "fetch");
    await expect(listProviderModels("openai")).rejects.toMatchObject({ status: 400 });
    expect(mock).not.toHaveBeenCalled();
  });

  it.each(["gemini", "anthropic"] as const)("follows %s pagination and deduplicates model IDs", async (provider) => {
    const model = provider === "gemini" ? { name: "models/test", supportedGenerationMethods: ["generateContent"] } : { id: "test" };
    const first = provider === "gemini" ? { models: [model], nextPageToken: "next&token" } : { data: [model], has_more: true, last_id: "next&token" };
    const last = provider === "gemini" ? { models: [model] } : { data: [model], has_more: false };
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(last));
    expect(await listProviderModels(provider, key)).toEqual([{ id: "test", name: "test" }]);
    expect(new URL(String(mock.mock.calls[1][0])).searchParams.get(provider === "gemini" ? "pageToken" : "after_id")).toBe("next&token");
  });

  it("fails safely on repeated pagination cursors", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ models: [], nextPageToken: "loop" }));
    await expect(listProviderModels("gemini", key)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("pagination") });
  });

  it.each([401, 403, 429, 500])("returns safe errors for HTTP %s", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: { message: key } }, { status }));
    const error = await listProviderModels("openai", key).catch((failure) => failure);
    expect(error).toMatchObject({ status: 502, message: expect.stringContaining(`HTTP ${status}`) });
    expect(error.message).not.toContain(key);
  });

  it.each(["TimeoutError", "TypeError"])("handles %s without leaking raw errors", async (name) => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(Object.assign(new Error(key), { name }));
    const error = await listProviderModels("openai", key).catch((failure) => failure);
    expect(error.status).toBe(502);
    expect(error.message).not.toContain(key);
  });

  it.each(["<html>login</html>", '{"unexpected":[]}'])("rejects malformed or incompatible responses", async (body) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));
    await expect(listProviderModels("openai", key)).rejects.toMatchObject({ status: 502 });
  });

  it("returns an empty list when no compatible models are available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [] }));
    expect(await listProviderModels("openai", key)).toEqual([]);
  });
});
