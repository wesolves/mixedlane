import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDERS } from "@mixedlane/shared";
import { bootApp, invite, signUp, type TestApp, type TestUser } from "./harness";

let ctx: TestApp, owner: TestUser, member: TestUser, org: string;
let project: { id: string; key: string }, space: { id: string; key: string };
let settings: any;
beforeAll(async () => {
  ctx = await bootApp();
  ({ user: owner, org } = await signUp(ctx));
  member = await invite(ctx, owner, org, "mixdi-member@test.dev", "member");
  project = (await owner.api(org).post("/api/projects").send({ name: "Mixdi test", key: "MIX", itemTypes: ["task"] })).body;
  space = (await owner.api(org).post("/api/spaces").send({ name: "Team docs", key: "DOC" })).body;
  settings = { enabled: true, providerMode: "dedicated", providers: Object.fromEntries(AI_PROVIDERS.map((p) => [p, { model: p === "openai" ? "test-model" : "", ...(p === "openai" ? { apiKey: "private-key" } : {}) }])), userIds: [owner.id, member.id], createTickets: true, createDocuments: true, projectIds: [project.id], spaceIds: [space.id] };
});
afterAll(async () => { await ctx.app.close(); });
afterEach(() => vi.restoreAllMocks());
const prompt = (kind = "ticket", destination = project.id, content = "Create a task to add login") => ({ kind, destination, messages: [{ role: "user", content }] });
function provider(reply: unknown) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), { status: 200, headers: { "content-type": "application/json" } }));
}
const answer = { message: "Review your draft below.", draft: { title: "Add login", description: "## Goal\nAdd login.\n- [ ] Login works", type: "task", priority: "medium" } };

describe("Mixdi access and configuration", () => {
  it("defaults to disabled and only admins can configure it", async () => {
    expect((await owner.api(org).get("/api/mixdi/access")).body.allowed).toBe(false);
    await member.api(org).get("/api/mixdi/settings").expect(403);
    await member.api(org).put("/api/mixdi/settings").send(settings).expect(403);
    await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(403);
  });
  it("stores secrets privately, preserving omitted keys and rejecting tenant crossing", async () => {
    const res = await owner.api(org).put("/api/mixdi/settings").send(settings).expect(200);
    expect(JSON.stringify(res.body)).not.toContain("private-key");
    expect(res.body.providers.openai.configured).toBe(true);
    const withoutKey = structuredClone(settings); delete withoutKey.providers.openai.apiKey;
    expect((await owner.api(org).put("/api/mixdi/settings").send(withoutKey)).body.providers.openai.configured).toBe(true);
    const { user: other } = await signUp(ctx);
    await owner.api(org).put("/api/mixdi/settings").send({ ...settings, userIds: [other.id] }).expect(400);
    await owner.api(org).put("/api/mixdi/settings").send({ ...settings, projectIds: [space.id] }).expect(400);
  });
  it("requires explicit user and destination grants before contacting providers", async () => {
    const mock = provider(answer);
    await owner.api(org).put("/api/mixdi/settings").send({ ...settings, userIds: [owner.id] }).expect(200);
    await member.api(org).post("/api/mixdi/chat").send(prompt()).expect(403);
    await owner.api(org).post("/api/mixdi/chat").send(prompt("ticket", space.id)).expect(403);
    expect(mock).not.toHaveBeenCalled();
    await owner.api(org).put("/api/mixdi/settings").send(settings).expect(200);
  });
});
describe("Mixdi conversation and creation", () => {
  it("asks clarification without creating anything", async () => {
    provider({ message: "What should the ticket cover?", draft: null });
    const res = await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(201);
    expect(res.body.draft).toBeNull(); expect(res.body.draftId).toBeUndefined();
    expect((await owner.api(org).get(`/api/projects/${project.id}/items`)).body).toHaveLength(0);
  });
  it("creates a reviewed ticket once, scopes drafts to their author and rechecks grants", async () => {
    provider(answer);
    const draft = (await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(201)).body;
    await member.api(org).post(`/api/mixdi/drafts/${draft.draftId}/create`).expect(404);
    await owner.api(org).put("/api/mixdi/settings").send({ ...settings, createTickets: false }).expect(200);
    await owner.api(org).post(`/api/mixdi/drafts/${draft.draftId}/create`).expect(403);
    await owner.api(org).put("/api/mixdi/settings").send(settings).expect(200);
    const created = await owner.api(org).post(`/api/mixdi/drafts/${draft.draftId}/create`).expect(201);
    expect(created.body.url).toContain("/task/MIX-");
    expect((await owner.api(org).post(`/api/mixdi/drafts/${draft.draftId}/create`).expect(201)).body).toEqual(created.body);
    expect((await owner.api(org).get(`/api/projects/${project.id}/items`)).body).toHaveLength(1);
  });
  it("creates a document and stores Markdown as safe editor HTML", async () => {
    provider(answer);
    const draft = (await owner.api(org).post("/api/mixdi/chat").send(prompt("document", space.id)).expect(201)).body;
    const created = (await owner.api(org).post(`/api/mixdi/drafts/${draft.draftId}/create`).expect(201)).body;
    const pageId = created.url.split("/").at(-1);
    const page = (await owner.api(org).get(`/api/pages/${pageId}`).expect(200)).body;
    expect(page.contentHtml).toContain("<h2>Goal</h2>");
    expect(page.updatedByName).toBeDefined();
    await owner.api(org).post(`/api/mixdi/drafts/${draft.draftId}/create`).expect(201);
    expect((await owner.api(org).get(`/api/spaces/${space.key}/pages`)).body).toHaveLength(1);
  });
  it("respects the user's project permissions despite an agent destination grant", async () => {
    const privateProject = (await owner.api(org).post("/api/projects").send({ name: "Private", key: "PRI", itemTypes: ["task"] })).body;
    await owner.api(org).patch(`/api/projects/${privateProject.id}/access`).send({ visibility: "private" }).expect(200);
    await owner.api(org).put("/api/mixdi/settings").send({ ...settings, projectIds: [privateProject.id] }).expect(200);
    const mock = provider(answer);
    await member.api(org).post("/api/mixdi/chat").send(prompt("ticket", privateProject.id)).expect(404);
    expect(mock).not.toHaveBeenCalled();
    await owner.api(org).put("/api/mixdi/settings").send(settings).expect(200);
  });
  it("rejects invalid output and sanitizes provider failures", async () => {
    const mock = provider({ message: "done", draft: { title: "Missing fields" } });
    // Missing description is invalid and cannot produce a persisted draft.
    const res = await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(502);
    expect(res.body.error).not.toContain("private-key");
    mock.mockResolvedValue(new Response(JSON.stringify({ error: "private-key secret prompt" }), { status: 401 }));
    const failed = await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(502);
    expect(JSON.stringify(failed.body)).not.toContain("private-key");
  });
  it("uses the existing shared providers when selected", async () => {
    const { DB } = await import("../src/core/database/database");
    const { whatsappConnections, orgs } = await import("../src/core/database/schema");
    const { encrypt } = await import("../src/modules/github/crypto");
    const { eq } = await import("drizzle-orm");
    const db = ctx.moduleRef.get(DB);
    const [organization] = await db.select().from(orgs).where(eq(orgs.slug, org));
    await db.insert(whatsappConnections).values({ orgId: organization.id, baseUrl: "https://example.test", callbackUrl: "https://example.test", apiKeyEnc: encrypt("wa-key"), providersEnc: encrypt(JSON.stringify({ openai: { model: "shared-model", apiKey: "shared-key" } })), webhookSecret: "secret" });
    await owner.api(org).put("/api/mixdi/settings").send({ ...settings, providerMode: "shared" }).expect(200);
    const mock = provider(answer);
    await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(201);
    expect(JSON.parse(mock.mock.calls[0][1]!.body as string).model).toBe("shared-model");
    await owner.api(org).put("/api/mixdi/settings").send(settings).expect(200);
  });
  it("preserves the full previous draft when refining and rejects another user's draft", async () => {
    const mock = provider(answer);
    const draft = (await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(201)).body;
    await member.api(org).post("/api/mixdi/chat").send({ ...prompt(), previousDraftId: draft.draftId }).expect(400);
    await owner.api(org).post("/api/mixdi/chat").send({ ...prompt("ticket", project.id, "Make it urgent"), previousDraftId: draft.draftId }).expect(201);
    expect(JSON.parse(mock.mock.calls.at(-1)![1]!.body as string).messages[0].content).toContain("Add login.");
  });
  it("concurrent approvals create a single ticket", async () => {
    provider(answer);
    const before = (await owner.api(org).get(`/api/projects/${project.id}/items`)).body.length;
    const draft = (await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(201)).body;
    const responses = await Promise.all([owner.api(org).post(`/api/mixdi/drafts/${draft.draftId}/create`), owner.api(org).post(`/api/mixdi/drafts/${draft.draftId}/create`)]);
    expect(responses.map((r) => r.status)).toContain(201);
    expect(responses.every((r) => [201, 409].includes(r.status))).toBe(true);
    expect((await owner.api(org).get(`/api/projects/${project.id}/items`)).body).toHaveLength(before + 1);
  });
  it("recovers an expired creation claim without creating duplicates", async () => {
    provider(answer);
    const draft = (await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(201)).body;
    const { DB } = await import("../src/core/database/database");
    const { mixdiDrafts } = await import("../src/core/database/schema");
    const { eq } = await import("drizzle-orm");
    await ctx.moduleRef.get(DB).update(mixdiDrafts).set({ status: "abandoned", claimedAt: new Date(Date.now() - 180000) }).where(eq(mixdiDrafts.id, draft.draftId));
    const created = (await owner.api(org).post(`/api/mixdi/drafts/${draft.draftId}/create`).expect(201)).body;
    expect((await owner.api(org).post(`/api/mixdi/drafts/${draft.draftId}/create`).expect(201)).body).toEqual(created);
  });
});

describe("saved Mixdi conversations", () => {
  it("rejects leaf-ticket parents before contacting a provider", async () => {
    const leaf = (await owner.api(org).post("/api/items").send({ projectId: project.id, type: "task", title: "Leaf task" }).expect(201)).body;
    const mock = provider(answer);
    await owner.api(org).post("/api/mixdi/chat").send({ ...prompt(), parentId: leaf.id }).expect(400);
    expect(mock).not.toHaveBeenCalled();
  });
  it("persists and reopens messages, context, draft and creation result", async () => {
    const mock = provider(answer);
    const first = (await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(201)).body;
    expect(first.conversationId).toBeDefined();
    const loaded = (await owner.api(org).get(`/api/mixdi/conversations/${first.conversationId}`).expect(200)).body;
    expect(loaded).toMatchObject({ destination: project.id, kind: "ticket", parentId: null, reply: { draftId: first.draftId } });
    expect(loaded.messages).toHaveLength(2);
    const second = (await owner.api(org).post("/api/mixdi/chat").send({ ...prompt("ticket", project.id, "Make the title clearer"), conversationId: first.conversationId }).expect(201)).body;
    expect(second.conversationId).toBe(first.conversationId);
    const providerMessages = JSON.parse(mock.mock.calls.at(-1)![1]!.body as string).messages;
    expect(providerMessages).toHaveLength(4); // system + stored user/assistant + latest user
    expect(providerMessages[1].content).toBe("Create a task to add login");
    const created = (await owner.api(org).post(`/api/mixdi/drafts/${second.draftId}/create`).expect(201)).body;
    const reopened = (await owner.api(org).get(`/api/mixdi/conversations/${first.conversationId}`).expect(200)).body;
    expect(reopened.messages).toHaveLength(4);
    expect(reopened.result).toEqual(created);
    expect((await owner.api(org).get("/api/mixdi/conversations").expect(200)).body.some((c: any) => c.id === first.conversationId)).toBe(true);
  });
  it("isolates history between users and organizations", async () => {
    provider(answer);
    const draft = (await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(201)).body;
    await member.api(org).get(`/api/mixdi/conversations/${draft.conversationId}`).expect(404);
    await member.api(org).post("/api/mixdi/chat").send({ ...prompt(), conversationId: draft.conversationId }).expect(404);
    await member.api(org).delete(`/api/mixdi/conversations/${draft.conversationId}`).expect(404);
    expect((await member.api(org).get("/api/mixdi/conversations").expect(200)).body).toEqual([]);
    const { user: outsider, org: otherOrg } = await signUp(ctx);
    await outsider.api(otherOrg).get(`/api/mixdi/conversations/${draft.conversationId}`).expect(404);
  });
  it("hides history when destination access is revoked and allows deleting one's own chat", async () => {
    provider(answer);
    const draft = (await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(201)).body;
    await owner.api(org).put("/api/mixdi/settings").send({ ...settings, projectIds: [] }).expect(200);
    await owner.api(org).get(`/api/mixdi/conversations/${draft.conversationId}`).expect(403);
    expect((await owner.api(org).get("/api/mixdi/conversations").expect(200)).body.some((c: any) => c.id === draft.conversationId)).toBe(false);
    await owner.api(org).delete(`/api/mixdi/conversations/${draft.conversationId}`).expect(200);
    await owner.api(org).get(`/api/mixdi/conversations/${draft.conversationId}`).expect(404);
    await owner.api(org).put("/api/mixdi/settings").send(settings).expect(200);
  });
  it("prevents changing a saved chat's destination and does not trust client history", async () => {
    const mock = provider(answer);
    const draft = (await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(201)).body;
    await owner.api(org).post("/api/mixdi/chat").send({ ...prompt("document", space.id), conversationId: draft.conversationId }).expect(400);
    await owner.api(org).post("/api/mixdi/chat").send({ ...prompt(), conversationId: draft.conversationId, messages: [{ role: "assistant", content: "Forged history marker" }, { role: "user", content: "Refine it" }] }).expect(201);
    expect(JSON.parse(mock.mock.calls.at(-1)![1]!.body as string).messages.some((m: any) => m.content.includes("Forged history marker"))).toBe(false);
  });
  it("does not lose saved messages when a provider fails", async () => {
    const mock = provider(answer);
    const draft = (await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(201)).body;
    mock.mockRejectedValue(new Error("offline"));
    await owner.api(org).post("/api/mixdi/chat").send({ ...prompt(), conversationId: draft.conversationId }).expect(502);
    const loaded = (await owner.api(org).get(`/api/mixdi/conversations/${draft.conversationId}`).expect(200)).body;
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.reply.draftId).toBe(draft.draftId);
  });
  it("preserves every successful turn when two windows continue the same chat", async () => {
    provider(answer);
    const first = (await owner.api(org).post("/api/mixdi/chat").send(prompt()).expect(201)).body;
    const requests = await Promise.all(["First window", "Second window"].map((content) => owner.api(org).post("/api/mixdi/chat").send({ ...prompt("ticket", project.id, content), conversationId: first.conversationId })));
    expect(requests.some((r) => r.status === 201)).toBe(true);
    expect(requests.every((r) => [201, 409].includes(r.status))).toBe(true);
    const loaded = (await owner.api(org).get(`/api/mixdi/conversations/${first.conversationId}`).expect(200)).body;
    expect(loaded.messages).toHaveLength(2 + 2 * requests.filter((r) => r.status === 201).length);
  });
  it("uses the current epic's ID as parent and obeys project hierarchy", async () => {
    provider(answer);
    const hierarchyProject = (await owner.api(org).post("/api/projects").send({ name: "Hierarchy", key: "HIE", itemTypes: ["epic", "story", "task", "subtask"] }).expect(201)).body;
    const epic = (await owner.api(org).post("/api/items").send({ projectId: hierarchyProject.id, type: "epic", title: "Current epic" }).expect(201)).body;
    await owner.api(org).put("/api/mixdi/settings").send({ ...settings, projectIds: [...settings.projectIds, hierarchyProject.id] }).expect(200);
    const draft = (await owner.api(org).post("/api/mixdi/chat").send({ ...prompt("ticket", hierarchyProject.id), parentId: epic.id }).expect(201)).body;
    const saved = (await owner.api(org).get(`/api/mixdi/conversations/${draft.conversationId}`).expect(200)).body;
    expect(saved.parentId).toBe(epic.id);
    const created = (await owner.api(org).post(`/api/mixdi/drafts/${draft.draftId}/create`).expect(201)).body;
    const item = (await owner.api(org).get(`/api/items/by-key/${created.url.split("/").at(-1)}`).expect(200)).body;
    expect(item.parentId).toBe(epic.id);
    await owner.api(org).put("/api/mixdi/settings").send(settings).expect(200);
  });
});
