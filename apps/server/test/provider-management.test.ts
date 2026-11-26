import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { AI_PROVIDERS, normalizeProviderOrder, whatsappSettingsSchema } from "@mixedlane/shared";
import { resolveProviderConfig } from "../src/modules/ai/provider-config";
import { triage, type TriageInput } from "../src/modules/whatsapp/triage";
import { runMixdi } from "../src/modules/mixdi/workflow";

afterEach(() => vi.restoreAllMocks());
const previous = Object.fromEntries(AI_PROVIDERS.map((provider) => [provider, { model: "saved-model", apiKey: `${provider}-secret`, ...(provider === "custom" ? { url: "https://custom.test/chat" } : {}) }]));
const settings = { baseUrl: "https://gateway.test", callbackUrl: "https://mixedlane.test", providers: Object.fromEntries(AI_PROVIDERS.map((p) => [p, { model: "saved-model", apiKey: "", ...(p === "custom" ? { url: "https://custom.test/chat" } : {}) }])) };

describe("Provider management", () => {
  it.each(AI_PROVIDERS)("explicitly removes %s without model or URL validation and retains other keys", (provider) => {
    const input = whatsappSettingsSchema.parse({ ...settings, providers: { ...settings.providers, [provider]: { removeCredentials: true, model: "invalid model!", apiKey: "ignored-new-key", url: "invalid-url" } } });
    const result = resolveProviderConfig(input.providers, previous);
    expect(result[provider]).toEqual({ model: "", apiKey: "", ...(provider === "custom" ? { url: "" } : {}) });
    for (const other of AI_PROVIDERS.filter((p) => p !== provider)) expect(result[other]).toEqual(previous[other]);
    expect(JSON.stringify(result)).not.toContain("removeCredentials");
  });

  it("keeps saved keys on blank or omitted password fields", () => {
    const input = whatsappSettingsSchema.parse(settings);
    expect(resolveProviderConfig(input.providers, previous)).toEqual(previous);
  });

  it("normalizes partial orders while rejecting duplicate and unknown providers", () => {
    expect(normalizeProviderOrder(["custom", "anthropic"]).slice(0, 2)).toEqual(["custom", "anthropic"]);
    expect(normalizeProviderOrder()).toEqual([...AI_PROVIDERS]);
    for (const providerOrder of [["openai", "openai"], ["unknown"]]) expect(whatsappSettingsSchema.safeParse({ ...settings, providerOrder }).success).toBe(false);
  });

  it("tries WhatsApp providers in the selected order and stops after a successful fallback", async () => {
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    const proposal = { type: "task", title: "Fix issue", description: "Reported issue", priority: "medium", category: "bug", parentId: null, duplicateId: null, reason: "Actionable" };
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(proposal) } }] }));
    const input = { report: "Issue", project: { orgId: "org", name: "Demo", itemTypes: ["task"] }, items: [] } as unknown as TriageInput;
    const result = await triage(input, { ...previous, anthropic: { model: "", apiKey: "" } }, { orgId: "org", providerOrder: ["anthropic", "custom", "openai", "ollama"] });
    expect(result.provider).toBe("openai");
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(["https://custom.test/chat", "https://api.openai.com/v1/chat/completions"]);
  });

  it("tries Mixdi providers in order and skips removed providers", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"message":"Ready","draft":null}' } }] }));
    const reply = await runMixdi({ kind: "ticket", destination: "test", parentId: null, messages: [{ role: "user", content: "Test" }] }, {}, { ...previous, anthropic: { model: "", apiKey: "" } }, ["anthropic", "custom", "grok", "openai"]);
    expect(reply.message).toBe("Ready");
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(["https://custom.test/chat", "https://api.x.ai/v1/chat/completions"]);
  });
});
