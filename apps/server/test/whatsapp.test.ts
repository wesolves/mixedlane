import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { bootApp, invite, signUp, type TestApp, type TestUser } from "./harness";
import { DB, type Db } from "../src/core/database/database";
import { whatsappConnections, whatsappDrafts, whatsappEvents, whatsappSessions, workItems } from "../src/core/database/schema";
import { WhatsappService } from "../src/modules/whatsapp/whatsapp.service";
import { decrypt } from "../src/modules/github/crypto";
import { triage } from "../src/modules/whatsapp/triage";
import { OpenWaClient } from "../src/modules/whatsapp/client";

let app: TestApp, owner: TestUser, member: TestUser, outsider: TestUser;
let org: string, foreignOrg: string, orgId: string, project: any, sessionId: string;
let db: Db, wa: WhatsappService, webhookSecret: string;
const phone = "919876543210";
const proposal = { type: "task", title: "Fix password reset", description: "Reset links fail.\n\n- [ ] Reset links open successfully", priority: "high", category: "bug", parentId: null, duplicateId: null, reason: "One actionable defect" };
let remoteCalls: { url: string; body: any; method: string }[] = [];

function mockRemote(providerMode: "valid" | "fallback" | "all-fail" = "valid") {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    remoteCalls.push({ url: String(url), body, method: init?.method ?? "GET" });
    const output = JSON.stringify(body)?.includes("previousTicket") ? { title: proposal.title, description: proposal.description, priority: proposal.priority } : proposal;
    if (String(url).startsWith("https://ollama.com")) return providerMode === "all-fail" ? new Response("", { status: 503 }) : Response.json({ message: { content: providerMode === "fallback" ? '{"type":"unknown"}' : JSON.stringify(output) } });
    if (String(url).startsWith("https://generativelanguage.googleapis.com")) return providerMode === "all-fail" ? new Response("", { status: 429 }) : Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] });
    if (String(url).startsWith("https://api.x.ai")) return providerMode === "all-fail" ? new Response("", { status: 503 }) : Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] });
    if (String(url).endsWith("/sessions") && init?.method === "POST") return Response.json({ id: sessionId, name: body.name });
    if (String(url).endsWith("/sessions")) return Response.json([]);
    if (String(url).endsWith("/webhooks")) return Response.json({ id: randomUUID() });
    if (String(url).endsWith("/qr")) return Response.json({ qrCode: "data:image/png;base64,TEST", status: "qr_ready" });
    return Response.json({ id: sessionId, name: "team-support", status: "qr_ready", engineLoaded: true, messageId: randomUUID() });
  }));
}

beforeAll(async () => {
  app = await bootApp();
  ({ user: owner, org } = await signUp(app));
  ({ user: outsider, org: foreignOrg } = await signUp(app));
  member = await invite(app, owner, org, "wa-member@test.dev", "member");
  project = (await owner.api(org).post("/api/projects").send({ key: "APP", name: "Application" })).body;
  orgId = (await owner.api(org).get("/api/org")).body.id;
  sessionId = randomUUID();
  db = app.moduleRef.get(DB); wa = app.moduleRef.get(WhatsappService);
  mockRemote();
  await owner.api(org).put("/api/whatsapp/settings").send({ baseUrl: "http://gateway.test:2785", apiKey: "test-gateway-key", callbackUrl: "http://mixedlane.test:3001", providers: { ollama: { model: "ollama-test", apiKey: "ollama-secret" }, gemini: { model: "gemini-test", apiKey: "gemini-secret" }, grok: { model: "grok-test", apiKey: "grok-secret" } } }).expect(200);
  await owner.api(org).post("/api/whatsapp/sessions").send({ name: "team-support" }).expect(201);
  await owner.api(org).put("/api/whatsapp/contacts").send({ phone: `+${phone}`, userId: member.id }).expect(200);
  webhookSecret = (await db.select().from(whatsappConnections).where(eq(whatsappConnections.orgId, orgId)))[0].webhookSecret;
});
afterAll(async () => { vi.unstubAllGlobals(); if (app) await app.app.close(); });
afterEach(() => { remoteCalls = []; mockRemote(); });

async function webhook(body: any, signature?: string) {
  const raw = JSON.stringify(body);
  return app.http().post(`/api/whatsapp/webhook/${orgId}/${sessionId}`).set("content-type", "application/json").set("x-openwa-signature", signature ?? `sha256=${createHmac("sha256", webhookSecret).update(raw).digest("hex")}`).send(raw);
}
function message(extra: Record<string, unknown> = {}) { return { event: "message.received", sessionId, data: { id: randomUUID(), from: `${phone}@c.us`, chatId: `${phone}@c.us`, body: "Password reset fails", fromMe: false, ...extra } }; }
async function ingest(body = message()) {
  await webhook(body).then((r) => expect(r.status).toBe(202));
  const [event] = await db.select().from(whatsappEvents).where(eq(whatsappEvents.eventKey, (await import("node:crypto")).createHash("sha256").update(body.data.id).digest("hex")));
  await wa.processEvent(event.id);
  return (await db.select().from(whatsappDrafts).where(eq(whatsappDrafts.messageId, body.data.id)))[0];
}

describe("WhatsApp integration", () => {
  it("restricts settings, accounts, QR codes, and sender mappings to admins", async () => {
    for (const path of ["settings", "sessions", `sessions/${sessionId}/qr`, "contacts"]) await member.api(org).get(`/api/whatsapp/${path}`).expect(403);
    await outsider.api(foreignOrg).get(`/api/whatsapp/sessions/${sessionId}/qr`).expect(404);
    await owner.api(org).get(`/api/whatsapp/sessions/${sessionId}/qr`).expect(200);
    expect(remoteCalls.some((c) => c.url.endsWith("/webhooks") && c.body?.events?.includes("message.received"))).toBe(true);
  });
  it("creates a ticket manually from a failed report once and exposes its link", async () => {
    const [draft] = await db.insert(whatsappDrafts).values({ orgId, sessionId, messageId: randomUUID(), chatId: `${phone}@c.us`, userId: member.id, projectId: project.id, report: "A saved report", status: "failed", error: "AI unavailable" }).returning();
    const input = { projectId: project.id, type: "task", title: "Manually recovered report", description: "Original report", labels: ["bug"] };
    const other = await invite(app, owner, org, "wa-manual-other@test.dev", "member");
    await other.api(org).post(`/api/whatsapp/drafts/${draft.id}/create-ticket`).send(input).expect(403);
    const item = (await member.api(org).post(`/api/whatsapp/drafts/${draft.id}/create-ticket`).send(input).expect(201)).body;
    expect(item.labels).toContain("whatsapp");
    expect(await wa.draft(orgId, draft.id)).toMatchObject({ status: "created", itemId: item.id, error: null });
    await member.api(org).post(`/api/whatsapp/drafts/${draft.id}/create-ticket`).send(input).expect(409);
    const visible = (await member.api(org).get("/api/whatsapp/drafts").expect(200)).body.find((d: any) => d.id === draft.id);
    expect(visible.item).toEqual({ key: item.key, type: "task", projectKey: project.key });
  });

  it("allows selecting a project for manual recovery but rejects changing an assigned draft's project", async () => {
    const [draft] = await db.insert(whatsappDrafts).values({ orgId, sessionId, messageId: randomUUID(), chatId: `${phone}@c.us`, userId: member.id, report: "No project yet", status: "select_project" }).returning();
    await member.api(org).post(`/api/whatsapp/drafts/${draft.id}/create-ticket`).send({ projectId: project.id, type: "task", title: "Recovered unassigned report" }).expect(201);
    const other = (await owner.api(org).post("/api/projects").send({ key: "MAN", name: "Manual" }).expect(201)).body;
    const [failed] = await db.insert(whatsappDrafts).values({ orgId, sessionId, messageId: randomUUID(), chatId: `${phone}@c.us`, userId: member.id, projectId: project.id, report: "Already assigned", status: "failed" }).returning();
    await owner.api(org).post(`/api/whatsapp/drafts/${failed.id}/create-ticket`).send({ projectId: other.id, type: "task", title: "Wrong project" }).expect(400);
    await owner.api(org).delete(`/api/projects/${other.id}`).expect(204);
  });

  it("lists all drafts beyond 100 for admins, only own drafts for members, and isolates organizations", async () => {
    const admin = await invite(app, owner, org, "wa-admin@test.dev", "admin");
    const other = await invite(app, owner, org, "wa-other@test.dev", "member");
    const rows = Array.from({ length: 105 }, (_, i) => ({
      id: randomUUID(), orgId, sessionId, messageId: randomUUID(), chatId: `${phone}@c.us`,
      userId: i % 2 ? other.id : member.id, report: `Draft ${i}`, projectId: project.id,
      createdAt: new Date(2020, 0, 1, 0, i),
    }));
    await db.insert(whatsappDrafts).values(rows);
    try {
      const all = (await admin.api(org).get("/api/whatsapp/drafts").expect(200)).body;
      const ids = new Set(rows.map((r) => r.id));
      expect(all.filter((d: any) => ids.has(d.id))).toHaveLength(105);
      expect(all.filter((d: any) => ids.has(d.id)).map((d: any) => d.id)).toEqual([...rows].reverse().map((r) => r.id));
      for (const user of [member, other]) {
        const own = (await user.api(org).get("/api/whatsapp/drafts").expect(200)).body;
        expect(own.every((d: any) => d.userId === user.id)).toBe(true);
        expect(own.filter((d: any) => ids.has(d.id))).toHaveLength(rows.filter((r) => r.userId === user.id).length);
      }
      const foreign = (await outsider.api(foreignOrg).get("/api/whatsapp/drafts").expect(200)).body;
      expect(foreign.some((d: any) => ids.has(d.id))).toBe(false);
      await other.api(org).post(`/api/whatsapp/drafts/${rows[0].id}/review`).send({ action: "cancel" }).expect(403);
    } finally {
      for (const row of rows) await db.delete(whatsappDrafts).where(eq(whatsappDrafts.id, row.id));
    }
  });
  it("encrypts all API keys and never returns credentials or signing secrets", async () => {
    const [stored] = await db.select().from(whatsappConnections).where(eq(whatsappConnections.orgId, orgId));
    expect(stored.apiKeyEnc).not.toContain("test-gateway-key");
    expect(decrypt(stored.apiKeyEnc)).toBe("test-gateway-key");
    expect(stored.providersEnc).not.toContain("ollama-secret");
    const res = await owner.api(org).get("/api/whatsapp/settings").expect(200);
    expect(res.body.providers.ollama).toEqual({ model: "ollama-test", configured: true });
    expect(JSON.stringify(res.body)).not.toContain(webhookSecret);
    expect(JSON.stringify(res.body)).not.toContain("ollama-secret");
  });
  it("rejects invalid signatures and mismatched session envelopes", async () => {
    await webhook(message(), "sha256=bad").then((r) => expect(r.status).toBe(401));
    await webhook({ ...message(), sessionId: randomUUID() }).then((r) => expect(r.status).toBe(400));
  });
  it("ignores groups, outgoing messages, and unlinked phone numbers", async () => {
    for (const data of [{ chatId: "12345@g.us" }, { fromMe: true }, { chatId: "919999999999@c.us" }]) {
      const body = message(data); await webhook(body).then((r) => expect(r.status).toBe(202));
      const eventList = await db.select().from(whatsappEvents);
      const event = eventList.find((e) => (e.payload as any).messageId === body.data.id);
      if (event) await wa.processEvent(event.id);
      expect(await db.select().from(whatsappDrafts).where(eq(whatsappDrafts.messageId, body.data.id))).toHaveLength(0);
    }
  });
  it("deduplicates repeated signed deliveries and generates a structured proposal", async () => {
    const body = message();
    const draft = await ingest(body);
    await webhook(body); await webhook(body);
    await wa.generate(orgId, draft.id);
    const ready = await wa.draft(orgId, draft.id);
    expect(ready).toMatchObject({ status: "review", provider: "ollama", proposal });
    expect(await db.select().from(whatsappDrafts).where(eq(whatsappDrafts.messageId, body.data.id))).toHaveLength(1);
    await wa.notify(orgId, draft.id);
    expect(remoteCalls.some((c) => c.url.endsWith("send-buttons") && c.body.buttons[0].id === `approve:${draft.id}`)).toBe(true);
  });
  it("falls back on invalid AI output and on provider HTTP errors in the requested order", async () => {
    const draft = await ingest(); mockRemote("fallback");
    await wa.generate(orgId, draft.id);
    expect((await wa.draft(orgId, draft.id)).provider).toBe("gemini");
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => String(url).startsWith("https://api.x.ai") ? Response.json({ choices: [{ message: { content: JSON.stringify(proposal) } }] }) : new Response("", { status: 503 })));
    const result = await triage({ report: "Reset fails", project, items: [] }, { ollama: { model: "a", apiKey: "a" }, gemini: { model: "b", apiKey: "b" }, grok: { model: "c", apiKey: "c" } });
    expect(result.provider).toBe("grok");
    vi.stubGlobal("fetch", original);
  });
  it("keeps reports retryable when every AI provider fails", async () => {
    const draft = await ingest(); mockRemote("all-fail"); await wa.generate(orgId, draft.id);
    expect(await wa.draft(orgId, draft.id)).toMatchObject({ status: "failed", proposal: null });
    await owner.api(org).post(`/api/whatsapp/drafts/${draft.id}/review`).send({ action: "retry" }).expect(201);
    expect((await wa.draft(orgId, draft.id)).status).toBe("generating");
  });
  it("creates only one ticket when the sender and admin approve concurrently", async () => {
    const draft = await ingest(); await wa.generate(orgId, draft.id);
    const responses = await Promise.all([member.api(org).post(`/api/whatsapp/drafts/${draft.id}/review`).send({ action: "approve" }), owner.api(org).post(`/api/whatsapp/drafts/${draft.id}/review`).send({ action: "approve" })]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses[0].body.itemId).toBe(responses[1].body.itemId);
    const items = await db.select().from(workItems).where(and(eq(workItems.projectId, project.id), eq(workItems.title, proposal.title)));
    expect(items).toHaveLength(1);
    expect(items[0].labels).toEqual(["bug", "whatsapp"]);
  });
  it("rejects cross-organization approvals and lets the sender cancel", async () => {
    const draft = await ingest(); await wa.generate(orgId, draft.id);
    await outsider.api(foreignOrg).post(`/api/whatsapp/drafts/${draft.id}/review`).send({ action: "approve" }).expect(404);
    await member.api(org).post(`/api/whatsapp/drafts/${draft.id}/review`).send({ action: "cancel" }).expect(201);
    expect((await wa.draft(orgId, draft.id)).status).toBe("cancelled");
  });
  it("uses list menus when more than one project is available", async () => {
    await owner.api(org).post("/api/projects").send({ key: "WEB", name: "Website" }).expect(201);
    const d = await ingest(); expect(d.status).toBe("select_project");
    expect(remoteCalls.some((c) => c.url.endsWith("send-list") && c.body.sections[0].rows.length === 2)).toBe(true);
    await ingest(message({ body: `project:${d.id}:${project.id}` }));
    expect((await wa.draft(orgId, d.id)).status).toBe("generating");
  });
  it("routes to a configured project, remembers choices when enabled, and can ask again", async () => {
    const settings = (await owner.api(org).get("/api/whatsapp/settings")).body;
    const save = (defaultProjectId: string | null, askProjectEveryTime: boolean) => owner.api(org).put("/api/whatsapp/settings").send({ ...settings, defaultProjectId, askProjectEveryTime });
    await save(project.id, true).expect(200);
    expect(await ingest()).toMatchObject({ projectId: project.id, status: "generating" });
    const web = (await owner.api(org).get("/api/projects")).body.find((p: any) => p.key === "WEB");
    expect(await ingest(message({ body: "WEB Another report" }))).toMatchObject({ projectId: web.id, report: "Another report" });
    await owner.api(org).patch(`/api/projects/${project.key}/access`).send({ defaultRole: "viewer" }).expect(200);
    expect((await ingest()).projectId).not.toBe(project.id);
    await owner.api(org).patch(`/api/projects/${project.key}/access`).send({ defaultRole: "editor" }).expect(200);
    await ingest(message({ body: "APP Remember this project" }));
    await save(null, false).expect(200);
    expect(await ingest()).toMatchObject({ projectId: project.id, status: "generating" });
    await save(null, true).expect(200);
    expect((await ingest()).status).toBe("select_project");
    const foreign = (await outsider.api(foreignOrg).post("/api/projects").send({ key: "EXT", name: "Foreign" })).body;
    await save(foreign.id, true).expect(404);
  });
  it("sends typing and clears it after successful and failed generation", async () => {
    for (const mode of ["valid", "all-fail"] as const) {
      const draft = await ingest(message({ body: "APP Password reset fails" }));
      mockRemote(mode);
      await wa.generate(orgId, draft.id);
      const presence = remoteCalls.filter((c) => c.url.endsWith("/chats/typing"));
      expect(presence.at(-2)?.body).toEqual({ chatId: `${phone}@c.us`, state: "typing" });
      expect(presence.at(-1)?.body.state).toBe("paused");
    }
  });
  it("treats unsupported presence as best effort and cleans up on errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 501 })));
    const client = new OpenWaClient("http://gateway.test", "key");
    await expect(client.whileTyping(sessionId, `${phone}@c.us`, async () => "ok")).resolves.toBe("ok");
    await expect(client.whileTyping(sessionId, `${phone}@c.us`, async () => { throw new Error("work failed"); })).rejects.toThrow("work failed");
  });
  it("refreshes typing during long processing and stops refreshing when finished", async () => {
    const states: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      states.push(JSON.parse(String(init.body)).state);
      return Response.json({ ok: true });
    }));
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      const running = new OpenWaClient("http://gateway.test", "key").whileTyping(sessionId, `${phone}@c.us`, () => new Promise<void>((resolve) => { finish = resolve; }));
      await vi.advanceTimersByTimeAsync(16000);
      finish(); await running;
      expect(states).toEqual(["typing", "typing", "typing", "paused"]);
      await vi.advanceTimersByTimeAsync(16000);
      expect(states).toHaveLength(4);
    } finally { vi.useRealTimers(); }
  });
  it("uses OpenAI and custom chat completions with the configured model and key", async () => {
    for (const provider of ["openai", "custom"] as const) {
      const url = provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "http://custom.test/v1/chat/completions";
      const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify(proposal) } }] }));
      vi.stubGlobal("fetch", fetchMock);
      const result = await triage({ report: "Reset fails", project, items: [] }, { [provider]: { model: "test-model", apiKey: "test-secret", url } });
      expect(result.provider).toBe(provider);
      expect(fetchMock.mock.calls[0]).toMatchObject([url, { headers: { authorization: "Bearer test-secret" } }]);
      expect(JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body)).model).toBe("test-model");
    }
  });
  it("saves custom credentials securely and rejects invalid endpoint URLs", async () => {
    const settings = (await owner.api(org).get("/api/whatsapp/settings")).body;
    const input = { ...settings, providers: { ...settings.providers, custom: { model: "custom-model", apiKey: "custom-secret", url: "https://custom.test/v1/chat/completions" }, openai: { model: "openai-model", apiKey: "openai-secret" } } };
    const res = await owner.api(org).put("/api/whatsapp/settings").send(input).expect(200);
    expect(res.body.providers.custom).toEqual({ model: "custom-model", configured: true, url: input.providers.custom.url });
    expect(JSON.stringify(res.body)).not.toContain("custom-secret");
    const [stored] = await db.select().from(whatsappConnections).where(eq(whatsappConnections.orgId, orgId));
    expect(stored.providersEnc).not.toContain("custom-secret");
    for (const url of ["file:///tmp/test", "https://user:pass@custom.test/v1", "https://custom.test/v1?key=secret"]) {
      await owner.api(org).put("/api/whatsapp/settings").send({ ...input, providers: { ...input.providers, custom: { ...input.providers.custom, url } } }).expect(400);
    }
  });
  it("falls back to a quoted text reply for an unsupported interactive engine", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(url); return url.endsWith("send-buttons") ? new Response("", { status: 501 }) : Response.json({ messageId: "ok" }); }));
    await new OpenWaClient("http://gateway.test", "key").interactive(sessionId, "send-buttons", { chatId: `${phone}@c.us` }, "approve draft", "test-idem", "original-message");
    expect(calls).toEqual([`http://gateway.test/api/sessions/${sessionId}/messages/send-buttons`, `http://gateway.test/api/sessions/${sessionId}/messages/reply`]);
  });
  it("handles OpenWA button IDs instead of treating the button label as a new report", async () => {
    const draft = await ingest(message({ body: "APP Reset still fails" })); await wa.generate(orgId, draft.id);
    await ingest(message({ body: "Cancel", button: { id: `cancel:${draft.id}`, text: "Cancel" } }));
    expect((await wa.draft(orgId, draft.id)).status).toBe("cancelled");
  });
  it("refines an existing draft when the sender quotes its preview", async () => {
    const draft = await ingest(message({ body: "APP Reset fails on Android" })); await wa.generate(orgId, draft.id); await wa.notify(orgId, draft.id);
    const previewId = (await wa.draft(orgId, draft.id)).previewMessageId;
    expect(previewId).toBeTruthy();
    await ingest(message({ body: "Only happens on Android 16", quotedMessage: { id: previewId } }));
    const edited = await wa.draft(orgId, draft.id);
    expect(edited.status).toBe("generating"); expect(edited.report).toContain("Android 16");
  });
  it("rechecks current project permissions before creating an approved ticket", async () => {
    const draft = await ingest(message({ body: "APP Reset fails with long passwords" })); await wa.generate(orgId, draft.id);
    await owner.api(org).patch(`/api/projects/${project.key}/access`).send({ defaultRole: "viewer" }).expect(200);
    await member.api(org).post(`/api/whatsapp/drafts/${draft.id}/review`).send({ action: "approve" }).expect(403);
    await owner.api(org).patch(`/api/projects/${project.key}/access`).send({ defaultRole: "editor" }).expect(200);
    expect((await wa.draft(orgId, draft.id)).status).toBe("review");
  });
  it("rejects AI parents and duplicates outside the selected project", async () => {
    const base = { report: "Broken reset", project, items: [] };
    const { validateProposal } = await import("../src/modules/whatsapp/triage");
    expect(() => validateProposal({ ...proposal, type: "subtask", parentId: randomUUID() }, base)).toThrow("unknown parent");
    expect(() => validateProposal({ ...proposal, type: "subtask" }, base)).toThrow("invalid hierarchy");
    expect(() => validateProposal({ ...proposal, duplicateId: randomUUID() }, base)).toThrow("unknown duplicate");
  });

  it("lets an owner inspect and change only the connected account's scope without creating drafts", async () => {
    const adminPhone = "919000000001";
    await owner.api(org).put("/api/whatsapp/contacts").send({ phone: adminPhone, userId: owner.id }).expect(200);
    const secondId = randomUUID();
    await db.insert(whatsappSessions).values({ id: secondId, orgId, name: "another-account", defaultProjectId: project.id });
    const send = (body: string) => ingest(message({ from: `${adminPhone}@c.us`, chatId: `${adminPhone}@c.us`, body }));
    try {
      expect(await send("/scope")).toBeUndefined();
      expect(remoteCalls.some((c) => c.url.endsWith("send-list") && c.body.description.includes("Current scope:") && c.body.sections[0].rows.some((r: any) => r.rowId === `scope:${project.id}`))).toBe(true);
      expect(await send(`scope:${project.id}`)).toBeUndefined();
      expect((await db.select().from(whatsappSessions).where(eq(whatsappSessions.id, sessionId)))[0].defaultProjectId).toBe(project.id);
      await send("/scope");
      const currentScope = remoteCalls.filter((c) => c.url.endsWith("send-list")).at(-1)!;
      expect(currentScope.body.title).toBe("Default project: APP");
      expect(currentScope.body.sections[0].rows.find((r: any) => r.rowId === `scope:${project.id}`).title).toContain("APP (default)");
      expect((await db.select().from(whatsappSessions).where(eq(whatsappSessions.id, secondId)))[0].defaultProjectId).toBe(project.id);
      expect((await db.select().from(whatsappConnections).where(eq(whatsappConnections.orgId, orgId)))[0].defaultProjectId).toBeNull();
      expect(await send("/scope clear")).toBeUndefined();
      expect((await db.select().from(whatsappSessions).where(eq(whatsappSessions.id, sessionId)))[0].defaultProjectId).toBeNull();
      expect((await db.select().from(whatsappSessions).where(eq(whatsappSessions.id, secondId)))[0].defaultProjectId).toBe(project.id);
    } finally {
      await db.update(whatsappSessions).set({ defaultProjectId: null }).where(eq(whatsappSessions.id, sessionId));
      await db.delete(whatsappSessions).where(eq(whatsappSessions.id, secondId));
    }
  });

  it("rejects scope commands from members and ignores unknown numbers", async () => {
    expect(await ingest(message({ body: "/scope APP" }))).toBeUndefined();
    expect(await ingest(message({ body: `scope:${project.id}` }))).toBeUndefined();
    expect(await ingest(message({ body: "scope-page:1" }))).toBeUndefined();
    expect(remoteCalls.some((c) => c.body?.text?.includes("Only organization owners and admins"))).toBe(true);
    expect((await db.select().from(whatsappSessions).where(eq(whatsappSessions.id, sessionId)))[0].defaultProjectId).toBeNull();
    remoteCalls = [];
    expect(await ingest(message({ body: "/scope", from: "919000000099@c.us", chatId: "919000000099@c.us" }))).toBeUndefined();
    expect(remoteCalls).toHaveLength(0);
  });

  it("validates scope projects without leaking foreign project information or creating reports", async () => {
    const send = (body: string) => ingest(message({ from: "919000000001@c.us", chatId: "919000000001@c.us", body }));
    for (const command of ["/scope EXT", "/scope UNKNOWN", "/scope APP extra"]) expect(await send(command)).toBeUndefined();
    expect((await db.select().from(whatsappSessions).where(eq(whatsappSessions.id, sessionId)))[0].defaultProjectId).toBeNull();
    expect(remoteCalls.some((c) => c.body?.text?.includes("That project is unavailable"))).toBe(true);
    expect(remoteCalls.some((c) => c.body?.text?.includes("Foreign"))).toBe(false);
  });

  it("routes by account scope, permits explicit overrides, and rechecks sender access", async () => {
    const scoped = (await owner.api(org).post("/api/projects").send({ key: "SCP", name: "Scoped reports" }).expect(201)).body;
    const send = (body: string) => ingest(message({ from: "919000000001@c.us", chatId: "919000000001@c.us", body }));
    try {
      await send("/scope SCP");
      expect(await ingest()).toMatchObject({ projectId: scoped.id, status: "generating" });
      expect(await ingest(message({ body: "APP Explicit override" }))).toMatchObject({ projectId: project.id, report: "Explicit override" });
      await owner.api(org).patch(`/api/projects/${scoped.id}/access`).send({ defaultRole: "viewer" }).expect(200);
      expect((await ingest()).projectId).not.toBe(scoped.id);
      await send("/scope clear");
      expect((await ingest()).status).toBe("select_project");
    } finally {
      await db.update(whatsappSessions).set({ defaultProjectId: null }).where(eq(whatsappSessions.id, sessionId));
      await owner.api(org).delete(`/api/projects/${scoped.id}`).expect(204);
    }
  });

  it("pages the scope project list and accepts WhatsApp selected-row replies", async () => {
    const created: any[] = [];
    const adminPhone = "919000000002";
    const admin = await invite(app, owner, org, "wa-scope-admin@test.dev", "admin");
    await owner.api(org).put("/api/whatsapp/contacts").send({ phone: adminPhone, userId: admin.id }).expect(200);
    const send = (extra: Record<string, unknown>) => ingest(message({ from: `${adminPhone}@c.us`, chatId: `${adminPhone}@c.us`, ...extra }));
    try {
      for (let n = 0; n < 9; n++) created.push((await owner.api(org).post("/api/projects").send({ key: `P0${n}`, name: `Scope page project ${n}` }).expect(201)).body);
      await send({ body: "/scope" });
      const first = remoteCalls.filter((c) => c.url.endsWith("send-list")).at(-1)!;
      expect(first.body.sections[0].rows).toHaveLength(9);
      expect(first.body.sections[0].rows.at(-1).rowId).toBe("scope-page:1");
      await send({ body: "More projects", selectedRowId: "scope-page:1" });
      const second = remoteCalls.filter((c) => c.url.endsWith("send-list")).at(-1)!;
      const rows = second.body.sections[0].rows;
      expect(rows.length).toBeLessThanOrEqual(10);
      expect(rows.some((r: any) => r.rowId === "scope-page:0")).toBe(true);
      const chosen = rows.find((r: any) => r.rowId.startsWith("scope:"));
      expect(await send({ body: chosen.title, selectedRowId: chosen.rowId })).toBeUndefined();
      expect((await db.select().from(whatsappSessions).where(eq(whatsappSessions.id, sessionId)))[0].defaultProjectId).toBe(chosen.rowId.slice(6));
      expect(remoteCalls.some((c) => c.body?.text?.startsWith("Scope set to"))).toBe(true);
    } finally {
      await db.update(whatsappSessions).set({ defaultProjectId: null }).where(eq(whatsappSessions.id, sessionId));
      for (const p of created) await owner.api(org).delete(`/api/projects/${p.id}`).expect(204);
    }
  });
  it("updates the requested ticket from text-only context and preserves media and unrelated fields", async () => {
    const image = '<img src="/api/uploads/11111111-1111-1111-1111-111111111111.png" alt="private screenshot">';
    const video = '<video src="/api/uploads/22222222-2222-2222-2222-222222222222.mp4" controls></video>';
    const item = (await member.api(org).post("/api/items").send({ projectId: project.id, type: "task", title: "Original reset issue", description: `<p>Existing requirements</p>${image}${video}`, labels: ["keep-me"], priority: "low" }).expect(201)).body;
    const body = message({ body: `/UPDATE ${item.key.toLowerCase()} Fix password reset`, quotedMessage: { id: "unrelated-preview" } });
    expect(await ingest(body)).toBeUndefined();
    const updated = (await db.select().from(workItems).where(eq(workItems.id, item.id)))[0];
    expect(updated).toMatchObject({ title: proposal.title, priority: "high", labels: ["keep-me"], type: "task", parentId: null, status: item.status });
    expect(updated.description).toContain(image);
    expect(updated.description).toContain(video);
    const prompt = JSON.parse(remoteCalls.find((c) => c.url.startsWith("https://ollama.com"))!.body.messages[1].content);
    expect(prompt.previousTicket).toMatchObject({ key: item.key, title: item.title, description: "Existing requirements" });
    expect(prompt.request).toBe("Fix password reset");
    expect(JSON.stringify(prompt)).not.toMatch(/private screenshot|\/api\/uploads|<img|<video/);
    expect(remoteCalls.some((c) => c.body?.text?.startsWith(`Updated ${item.key}:`))).toBe(true);
    const [event] = await db.select().from(whatsappEvents).where(eq(whatsappEvents.eventKey, (await import("node:crypto")).createHash("sha256").update(body.data.id).digest("hex")));
    await db.update(whatsappEvents).set({ processed: false }).where(eq(whatsappEvents.id, event.id));
    remoteCalls = [];
    await wa.processEvent(event.id);
    expect(remoteCalls.some((c) => c.url.startsWith("https://ollama.com"))).toBe(false);
    expect((await db.select().from(workItems).where(eq(workItems.id, item.id)))[0].updatedAt).toEqual(updated.updatedAt);
    expect(remoteCalls.some((c) => c.body?.text?.startsWith(`Updated ${item.key}:`))).toBe(true);
  });

  it("returns update usage or an unavailable response without creating reports or calling AI", async () => {
    for (const body of ["/update", "/update APP-123", "/update invalid some request", "/update APP-99999 fix it"]) expect(await ingest(message({ body }))).toBeUndefined();
    expect(remoteCalls.some((c) => c.body?.text?.startsWith("Use /update"))).toBe(true);
    expect(remoteCalls.some((c) => c.body?.text?.includes("ticket is unavailable"))).toBe(true);
    expect(remoteCalls.some((c) => c.url.startsWith("https://ollama.com"))).toBe(false);
  });

  it("checks ticket edit permissions before exposing context to AI", async () => {
    const item = (await member.api(org).post("/api/items").send({ projectId: project.id, type: "task", title: "Permission test" }).expect(201)).body;
    await owner.api(org).patch(`/api/projects/${project.key}/access`).send({ defaultRole: "viewer" }).expect(200);
    try {
      expect(await ingest(message({ body: `/update ${item.key} change this` }))).toBeUndefined();
      expect(remoteCalls.some((c) => c.url.startsWith("https://ollama.com"))).toBe(false);
      expect((await db.select().from(workItems).where(eq(workItems.id, item.id)))[0].title).toBe(item.title);
    } finally {
      await owner.api(org).patch(`/api/projects/${project.key}/access`).send({ defaultRole: "editor" }).expect(200);
    }
  });

  it("leaves the existing ticket unchanged when all update providers fail", async () => {
    const item = (await member.api(org).post("/api/items").send({ projectId: project.id, type: "task", title: "Retain original" }).expect(201)).body;
    mockRemote("all-fail");
    expect(await ingest(message({ body: `/update ${item.key} fix it` }))).toBeUndefined();
    expect((await db.select().from(workItems).where(eq(workItems.id, item.id)))[0].title).toBe(item.title);
    expect(remoteCalls.some((c) => c.body?.text?.includes("ticket is unchanged"))).toBe(true);
  });

  it("rejects stale AI updates when the ticket changes during generation", async () => {
    const item = (await member.api(org).post("/api/items").send({ projectId: project.id, type: "task", title: "Conflict test" }).expect(201)).body;
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
      if (String(url).startsWith("https://ollama.com")) await member.api(org).patch(`/api/items/${item.id}`).send({ title: "Newer human edit" }).expect(200);
      return original(url, init);
    }));
    expect(await ingest(message({ body: `/update ${item.key} fix it` }))).toBeUndefined();
    expect((await db.select().from(workItems).where(eq(workItems.id, item.id)))[0].title).toBe("Newer human edit");
    expect(remoteCalls.some((c) => c.body?.text?.includes("changed while AI"))).toBe(true);
  });

});
