import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeMixdiProvider } from "../src/modules/mixdi/provider";

afterEach(() => vi.restoreAllMocks());
const configuration = { model: "test-model", apiKey: "PRIVATE-KEY", url: "https://custom.test/chat/completions" };
const messages = [{ role: "user" as const, content: "Synthetic model test" }];
const reply = JSON.stringify({ message: "Ready", draft: null });

describe("Mixdi provider requests", () => {
  it.each(["ollama", "gemini", "grok", "openai", "anthropic", "custom"] as const)("uses %s request and response formats", async (provider) => {
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(provider === "anthropic" ? { content: [{ type: "thinking", thinking: "ignore reasoning" }, { type: "text", text: reply }] } : provider === "ollama" ? { message: { content: reply } } : provider === "gemini" ? { candidates: [{ content: { parts: [{ thought: true, text: "ignore reasoning" }, { text: reply }] } }] } : { choices: [{ message: { content: reply } }] }));
    expect(await invokeMixdiProvider(provider, configuration, "System prompt", messages)).toEqual({ message: "Ready", draft: null });
    const [url, request] = mock.mock.calls[0];
    const body = JSON.parse(request!.body as string);
    expect(request!.redirect).toBe("error");
    expect(body.model ?? String(url).includes("test-model")).toBeTruthy();
    if (provider === "custom") expect(url).toBe(configuration.url);
    if (provider === "anthropic") {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(request!.headers).toHaveProperty("anthropic-version");
      expect(body).toMatchObject({ system: "System prompt", max_tokens: 8192, messages });
      expect(body.response_format).toBeUndefined();
    }
    if (provider === "gemini") expect((request!.headers as any)["x-goog-api-key"]).toBe("PRIVATE-KEY");
    else expect((request!.headers as any).authorization).toBe("Bearer PRIVATE-KEY");
  });
  it.each([[401, "credentials"], [403, "credentials"], [404, "model"], [429, "rate_limit"], [504, "timeout"], [500, "provider_error"]])("returns safe guidance for HTTP %s", async (status, category) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: { message: "PRIVATE-KEY raw private response" } }, { status: status as number }));
    await expect(invokeMixdiProvider("openai", configuration, "System", messages)).rejects.toMatchObject({ category, status });
    await expect(invokeMixdiProvider("openai", configuration, "System", messages)).rejects.not.toThrow("PRIVATE-KEY");
  });
  it.each(["TimeoutError", "AbortError", "TypeError"])("classifies %s without exposing the exception", async (name) => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(Object.assign(new Error("PRIVATE-KEY"), { name }));
    await expect(invokeMixdiProvider("openai", configuration, "System", messages)).rejects.toMatchObject({ category: name === "TypeError" ? "network" : "timeout" });
  });
  it("validates output and classifies invalid JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "PRIVATE-KEY not JSON" } }] }));
    await expect(invokeMixdiProvider("openai", configuration, "System", messages)).rejects.toMatchObject({ category: "invalid_output" });
  });
});
