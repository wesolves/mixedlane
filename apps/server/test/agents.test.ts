import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { bootApp, connectSocket, invite, listen, settle, signUp, type TestApp, type TestUser } from "./harness";

let ctx: TestApp;
let org: string;
let owner: TestUser, member: TestUser;
let project: { id: string; key: string };
let agentId: string;
let secret: string;

/** Requests authenticated with an agent API key (no X-Org needed: the key names its org). */
const asAgent = (key = secret) => {
  const h = (t: request.Test) => t.set("authorization", `Bearer ${key}`);
  const http = () => request(ctx.app.getHttpServer());
  return {
    get: (u: string) => h(http().get(u)),
    post: (u: string) => h(http().post(u)),
    patch: (u: string) => h(http().patch(u)),
    delete: (u: string) => h(http().delete(u)),
  };
};

const grant = (permissions: string[]) => owner.api(org).put(`/api/agents/${agentId}/grants`).send({ projectId: project.id, permissions });

async function mcpClient(key = secret) {
  const url = new URL(`${await listen(ctx)}/api/mcp`);
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${key}` } } }));
  return client;
}
type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };
const text = (r: unknown) => (r as ToolResult).content[0].text;
const json = (r: unknown) => JSON.parse(text(r));

beforeAll(async () => {
  ctx = await bootApp();
  ({ user: owner, org } = await signUp(ctx, { name: "Owner", orgName: "Agents" }));
  member = await invite(ctx, owner, org, "member@agents.dev", "member");
  project = (await owner.api(org).post("/api/projects").send({ name: "App", key: "APP", itemTypes: ["story", "task"] })).body;
  await owner.api(org).post("/api/projects").send({ name: "Other", key: "OTH", itemTypes: ["task"] }).expect(201);
});
afterAll(async () => {
  await ctx.app.close();
});

describe("agent management", () => {
  it("only org admins manage agents; the key is shown once", async () => {
    expect((await member.api(org).get("/api/agents")).status).toBe(403);
    const res = await owner.api(org).post("/api/agents").send({ name: "Triage Bot", description: "Sorts the inbox" });
    expect(res.status).toBe(201);
    agentId = res.body.agent.id;
    secret = res.body.key.secret;
    expect(secret).toMatch(/^fb_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    expect(res.body.key.key.prefix).toBe(secret.slice(0, 15));

    const list = (await owner.api(org).get("/api/agents")).body;
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(secret);
    expect(list[0]).toMatchObject({ name: "Triage Bot", docAccess: "read", disabled: false, grants: [] });
  });
});

describe("API key authentication", () => {
  it("sees nothing until granted, then exactly what the toggles allow", async () => {
    expect((await asAgent().get("/api/projects")).body).toEqual([]);
    await grant(["item.create", "comment.create"]).expect(200);

    const projects = (await asAgent().get("/api/projects")).body;
    expect(projects.map((p: { key: string }) => p.key)).toEqual(["APP"]);
    expect(projects[0].access.permissions.sort()).toEqual(["comment.create", "item.create", "project.read"]);

    const item = await asAgent().post("/api/items").send({ projectId: project.id, type: "story", title: "Filed by a bot" });
    expect(item.status).toBe(201);
    expect((await asAgent().patch(`/api/items/${item.body.id}/move`).send({ status: "done", sortOrder: 1 })).status).toBe(403);
    expect((await asAgent().delete(`/api/items/${item.body.id}`)).status).toBe(403);
    const activity = (await owner.api(org).get(`/api/items/${item.body.id}/activity`)).body;
    expect(activity[0]).toMatchObject({ actorType: "agent", actorId: agentId, actor: "Triage Bot" });
  });

  it("can't reach user-only or admin endpoints, or another org", async () => {
    expect((await asAgent().get("/api/auth/me")).status).toBe(403);
    await owner.api(org).patch(`/api/agents/${agentId}`).send({ canCreateProjects: false }).expect(200);
    const denied = await asAgent().post("/api/projects").send({ name: "X", key: "XX" });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/Can create projects/);
    await owner.api(org).patch(`/api/agents/${agentId}`).send({ canCreateProjects: true }).expect(200);
    expect((await asAgent().get("/api/agents")).status).toBe(403);
    expect((await asAgent().post("/api/org/invites").send({ email: "x@y.dev", role: "admin" })).status).toBe(403);
    expect((await asAgent().get("/api/projects").set("x-org", "someone-else")).status).toBe(404);
    expect((await asAgent("fb_000000000000_" + "a".repeat(43)).get("/api/projects")).status).toBe(401);
  });

  it("revoked keys and disabled agents stop working immediately", async () => {
    const extra = (await owner.api(org).post(`/api/agents/${agentId}/keys`).send({ name: "CI" })).body;
    expect((await asAgent(extra.secret).get("/api/projects")).status).toBe(200);
    await owner.api(org).delete(`/api/agents/${agentId}/keys/${extra.key.id}`).expect(200);
    expect((await asAgent(extra.secret).get("/api/projects")).status).toBe(401);

    await owner.api(org).patch(`/api/agents/${agentId}`).send({ disabled: true }).expect(200);
    expect((await asAgent().get("/api/projects")).status).toBe(401);
    await owner.api(org).patch(`/api/agents/${agentId}`).send({ disabled: false }).expect(200);
    expect((await asAgent().get("/api/projects")).status).toBe(200);
  });

  it("shows agents in the project's access list and their activity", async () => {
    const access = (await owner.api(org).get(`/api/projects/${project.id}/access`)).body;
    expect(access.grants.find((g: { principalType: string }) => g.principalType === "agent")).toMatchObject({ name: "Triage Bot", detail: "AI agent" });
    const log = (await owner.api(org).get(`/api/agents/${agentId}/activity`)).body;
    expect(log[0]).toMatchObject({ action: "created", item: { projectKey: "APP", title: "Filed by a bot" } });
  });
});

describe("MCP server", () => {
  it("is for agents only", async () => {
    const res = await owner.api(org).post("/api/mcp").set("accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(403);
  });

  it("accepts clients that only send Accept: application/json (or no Accept at all)", async () => {
    for (const accept of ["application/json", undefined]) {
      let req = asAgent().post("/api/mcp").set("content-type", "application/json");
      if (accept) req = req.set("accept", accept);
      const res = await req.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(res.status).toBe(200);
      expect(res.body.result.tools.length).toBeGreaterThan(10);
    }
  });

  it("lists tools and reads projects through the agent's permissions", async () => {
    const client = await mcpClient();
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["list_projects", "search_items", "get_item", "create_item", "update_item", "move_item", "add_comment", "search_docs", "get_page", "create_page", "update_page"]));
    const projects = json(await client.callTool({ name: "list_projects", arguments: {} }));
    expect(projects.map((p: { key: string }) => p.key)).toEqual(["APP"]);
    expect(projects[0].statuses.map((s: { name: string }) => s.name)).toContain("In Progress");
    await client.close();
  });

  it("creates, moves and comments on items — within the toggles", async () => {
    const client = await mcpClient();
    const own = await connectSocket(ctx, owner, org);
    const created = json(
      await client.callTool({
        name: "create_item",
        arguments: { project: "APP", type: "story", title: "Checkout flow", description: "## Scope\n\n- [ ] cart\n- [x] prices", assignee: "member@agents.dev" },
      }),
    );
    expect(created).toMatchObject({ created: "APP-0002", assignee: "member", status: "Backlog" });
    expect(created.description).toContain("- [x] prices");

    // No "change status" toggle yet → a readable tool error, not a crash.
    const denied = (await client.callTool({ name: "move_item", arguments: { key: "APP-2", status: "In Progress" } })) as ToolResult;
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toMatch(/permission/);

    await grant(["item.create", "item.move", "comment.create"]).expect(200);
    expect(json(await client.callTool({ name: "move_item", arguments: { key: "APP-2", status: "in progress" } }))).toEqual({ key: "APP-0002", from: "Backlog", to: "In Progress" });
    expect(json(await client.callTool({ name: "add_comment", arguments: { key: "APP-0002", body: "Started on **cart**" } }))).toMatchObject({ commented: "APP-0002" });

    const item = json(await client.callTool({ name: "get_item", arguments: { key: "app-2" } }));
    expect(item.comments.at(-1)).toMatchObject({ author: "Triage Bot", authorType: "agent", body: "Started on **cart**" });
    const hits = json(await client.callTool({ name: "search_items", arguments: { project: "APP", status: "In Progress" } }));
    expect(hits.items.map((i: { key: string }) => i.key)).toEqual(["APP-0002"]);

    // The team sees the agent's changes live, attributed to it, and the assignee is notified.
    await settle(ctx);
    const moved = own.events.find((e) => e.type === "item" && e.action === "moved") as unknown as { actor: { type: string; name: string } };
    expect(moved.actor).toMatchObject({ type: "agent", name: "Triage Bot" });
    const inbox = (await member.api(org).get("/api/notifications")).body.items.map((n: { title: string }) => n.title);
    expect(inbox).toContain("Triage Bot assigned you APP-0002");

    // Unknown projects look like they don't exist.
    const other = (await client.callTool({ name: "get_item", arguments: { key: "OTH-1" } })) as ToolResult;
    expect(other.isError).toBe(true);
    own.socket.disconnect();
    await client.close();
  });

  it("reads and writes docs according to the agent's docs access", async () => {
    await owner.api(org).post("/api/spaces").send({ name: "Engineering", key: "ENG" }).expect(201);
    const page = (await owner.api(org).post("/api/spaces/ENG/pages").send({ title: "Runbook", contentHtml: "<p>Restart the <strong>worker</strong></p>" })).body;
    const client = await mcpClient();

    expect(json(await client.callTool({ name: "search_docs", arguments: { query: "worker" } }))[0]).toMatchObject({ pageId: page.id });
    expect(json(await client.callTool({ name: "get_page", arguments: { id: page.id } }))).toMatchObject({ content: "Restart the **worker**", version: 1 });
    expect(((await client.callTool({ name: "create_page", arguments: { space: "ENG", title: "Bot notes" } })) as ToolResult).isError).toBe(true);

    await owner.api(org).patch(`/api/agents/${agentId}`).send({ docAccess: "write" }).expect(200);
    const created = json(await client.callTool({ name: "create_page", arguments: { space: "ENG", title: "Bot notes", content: "Relates to APP-2" } }));
    const detail = (await owner.api(org).get(`/api/pages/${created.id}`)).body;
    expect(detail).toMatchObject({ updatedByName: "Triage Bot", linkedItems: [{ key: "APP-0002" }] });
    // Stale version → conflict surfaced as a tool error.
    await client.callTool({ name: "update_page", arguments: { id: page.id, version: 1, content: "v2" } });
    const stale = (await client.callTool({ name: "update_page", arguments: { id: page.id, version: 1, content: "v3" } })) as ToolResult;
    expect(stale.isError).toBe(true);
    expect(stale.content[0].text).toMatch(/409/);
    await client.close();
  });

  it("removing an agent deletes its keys and grants", async () => {
    await owner.api(org).delete(`/api/agents/${agentId}`).expect(204);
    expect((await asAgent().get("/api/projects")).status).toBe(401);
    const access = (await owner.api(org).get(`/api/projects/${project.id}/access`)).body;
    expect(access.grants.some((g: { principalType: string }) => g.principalType === "agent")).toBe(false);
  });
});
