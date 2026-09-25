import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { bootApp, listen, signUp, type TestApp, type TestUser } from "./harness";

/** Agents recording plans in Mixedlane: create_plan, planning modes, and the work lifecycle. */
let ctx: TestApp;
let org: string;
let owner: TestUser;
let project: { id: string; key: string };
let agentId: string;
let secret: string;

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };

async function client() {
  const c = new Client({ name: "planning-test", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${await listen(ctx)}/api/mcp`), { requestInit: { headers: { authorization: `Bearer ${secret}` } } }));
  return c;
}
async function call(c: Client, name: string, args: Record<string, unknown>) {
  const r = (await c.callTool({ name, arguments: args })) as ToolResult;
  if (r.isError) throw new Error(r.content[0].text);
  return JSON.parse(r.content[0].text);
}

const PLAN = [
  { ref: "e1", type: "epic", title: "Password reset", description: "Let users recover their account." },
  { ref: "s1", parent: "e1", type: "story", title: "As a user I can request a reset link", description: "- [ ] email sent\n- [ ] link expires in 1h" },
  { ref: "t1", parent: "s1", type: "task", title: "Reset token table + migration" },
  { ref: "t2", parent: "s1", type: "task", title: "POST /auth/forgot-password" },
  { ref: "s2", parent: "e1", type: "story", title: "As a user I can set a new password" },
];

beforeAll(async () => {
  ctx = await bootApp();
  ({ user: owner, org } = await signUp(ctx, { name: "Owner", orgName: "Planning" }));
  project = (await owner.api(org).post("/api/projects").send({ name: "App", key: "APP" })).body;
  const created = (await owner.api(org).post("/api/agents").send({ name: "Codex" })).body;
  agentId = created.agent.id;
  secret = created.key.secret;
  await owner
    .api(org)
    .put(`/api/agents/${agentId}/grants`)
    .send({ projectId: project.id, permissions: ["item.create", "item.update", "item.move", "comment.create"] })
    .expect(200);
});
afterAll(async () => {
  await ctx.app.close();
});

describe("create_plan", () => {
  it("creates a whole epic → story → task tree in one call", async () => {
    const c = await client();
    const res = await call(c, "create_plan", { project: "APP", items: PLAN });
    expect(res).toMatchObject({ project: "APP", planningMode: "auto", created: 5, reused: 0 });
    const byRef = Object.fromEntries(res.items.map((i: { ref: string }) => [i.ref, i]));
    expect(byRef.t1.parent).toBe(byRef.s1.key);
    expect(byRef.s1.parent).toBe(byRef.e1.key);

    const story = (await owner.api(org).get(`/api/items/by-key/${byRef.s1.key}`)).body;
    expect(story.ancestors.map((a: { key: string }) => a.key)).toEqual([byRef.e1.key]);
    expect(story.children.map((ch: { title: string }) => ch.title)).toEqual(["Reset token table + migration", "POST /auth/forgot-password"]);
    expect(story.description).toContain('data-type="taskList"');
    await c.close();
  });

  it("is idempotent: running the same plan again reuses everything", async () => {
    const c = await client();
    const again = await call(c, "create_plan", { project: "APP", items: PLAN });
    expect(again).toMatchObject({ created: 0, reused: 5 });

    // Adding one task under an existing story by its key only creates that task.
    const storyKey = again.items.find((i: { ref: string }) => i.ref === "s2").key;
    const more = await call(c, "create_plan", { project: "APP", items: [{ ref: "t3", parent: storyKey, type: "task", title: "Set-password form" }] });
    expect(more).toMatchObject({ created: 1, reused: 0 });
    await c.close();
  });

  it("validates the whole tree against the hierarchy before creating anything", async () => {
    const c = await client();
    const before = (await owner.api(org).get(`/api/projects/${project.id}/tree`)).body.length;
    const r = (await c.callTool({
      name: "create_plan",
      arguments: {
        project: "APP",
        items: [
          { ref: "e9", type: "epic", title: "Valid epic" },
          { ref: "x", type: "story", title: "Orphan story" }, // stories can't sit at the top level
          { ref: "y", parent: "nope", type: "task", title: "Lost task" },
        ],
      },
    })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Orphan story.*top level/);
    expect(r.content[0].text).toMatch(/parent "nope"/);
    expect((await owner.api(org).get(`/api/projects/${project.id}/tree`)).body.length).toBe(before);
    await c.close();
  });
});

describe("planning mode", () => {
  it("PROPOSE returns a preview until confirmed, and is reported to the agent", async () => {
    await owner.api(org).patch(`/api/agents/${agentId}`).send({ planningMode: "propose" }).expect(200);
    const c = await client();
    expect(c.getInstructions()).toContain("planning mode is PROPOSE");
    expect((await call(c, "whoami", {})).planningMode).toBe("propose");

    const items = [
      { ref: "e", type: "epic", title: "Billing" },
      { ref: "s", parent: "e", type: "story", title: "As an admin I can see invoices" },
    ];
    const before = (await owner.api(org).get(`/api/projects/${project.id}/tree`)).body.length;
    const preview = await call(c, "create_plan", { project: "APP", items });
    expect(preview).toMatchObject({ preview: true, willCreate: 2 });
    expect(preview.next).toMatch(/confirmed: true/);
    expect((await owner.api(org).get(`/api/projects/${project.id}/tree`)).body.length).toBe(before);

    const done = await call(c, "create_plan", { project: "APP", items, confirmed: true });
    expect(done).toMatchObject({ created: 2 });
    await c.close();
    await owner.api(org).patch(`/api/agents/${agentId}`).send({ planningMode: "auto" }).expect(200);
  });

  it("offers plan and sync prompts", async () => {
    const c = await client();
    const prompts = (await c.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(expect.arrayContaining(["plan", "sync"]));
    const msg = await c.getPrompt({ name: "plan", arguments: { requirements: "Dark mode" } });
    expect(JSON.stringify(msg.messages)).toContain("Dark mode");
    await c.close();
  });
});

describe("projects", () => {
  it("agents can create a project for a new initiative and get full access to it", async () => {
    const c = await client();
    const res = await call(c, "create_project", { name: "Marketing Agent POC", key: "mka", itemTypes: ["epic", "story", "task"], workflow: "Simple" });
    expect(res).toMatchObject({ created: "MKA", itemTypes: ["epic", "story", "task"] });
    expect(res.statuses.map((s: { name: string }) => s.name)).toEqual(["To Do", "In Progress", "Done"]);
    expect(res.yourPermissions).toEqual(expect.arrayContaining(["item.create", "item.move", "item.delete", "doc.write"]));
    // It can plan into it straight away, and the team sees the project.
    const plan = await call(c, "create_plan", { project: "MKA", items: [{ ref: "e", type: "epic", title: "Lead capture" }] });
    expect(plan.created).toBe(1);
    expect((await owner.api(org).get("/api/projects")).body.map((p: { key: string }) => p.key)).toContain("MKA");
    await c.close();
  });

  it("tells the agent how to proceed when a plan targets a project that doesn't exist yet", async () => {
    const c = await client();
    expect((await call(c, "whoami", {})).canCreateProjects).toBe(true);
    const r = (await c.callTool({ name: "create_plan", arguments: { project: "ZZZ", items: [{ ref: "e", type: "epic", title: "X" }] } })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/"ZZZ" doesn't exist\. Create it with the create_project tool.*reconnect/);
    await c.close();
  });

  it("explains exactly which setting to change when something isn't allowed", async () => {
    await owner.api(org).patch(`/api/agents/${agentId}`).send({ canCreateProjects: false }).expect(200);
    const c = await client();
    expect(c.getInstructions()).toMatch(/can't create one: ask the user/);
    const r = (await c.callTool({ name: "create_project", arguments: { name: "Nope", key: "NOPE" } })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Settings → AI agents → Codex → "Can create projects"/);

    // A project it has no delete permission in: the error names the project and the setting.
    const t = (await call(c, "create_plan", { project: "APP", items: [{ ref: "t", type: "task", title: "Throwaway" }] })).items[0].key;
    const del = (await c.callTool({ name: "delete_item", arguments: { key: t } })) as ToolResult;
    expect(del.content[0].text).toMatch(/project APP \(needs item\.delete\).*Project access → APP/);
    await c.close();
    await owner.api(org).patch(`/api/agents/${agentId}`).send({ canCreateProjects: true }).expect(200);
  });
});

describe("work lifecycle", () => {
  it("start_work → complete_work(review) → complete_work(done), with comments", async () => {
    const c = await client();
    const key = (await call(c, "search_items", { project: "APP", query: "POST /auth/forgot-password" })).items[0].key;
    expect(await call(c, "start_work", { key, note: "Starting with the controller" })).toMatchObject({ to: "In Progress", moved: true, commented: true });
    expect(await call(c, "complete_work", { key, summary: "Endpoint + tests added", stage: "review" })).toMatchObject({ to: "In Review", moved: true });
    expect(await call(c, "complete_work", { key, summary: "Merged", stage: "done" })).toMatchObject({ to: "Done" });
    // Starting a finished item doesn't pull it back.
    expect(await call(c, "start_work", { key })).toMatchObject({ to: "Done", moved: false });

    const item = await call(c, "get_item", { key });
    expect(item.comments.map((x: { body: string }) => x.body)).toEqual(["Starting with the controller", "Endpoint + tests added", "Merged"]);
    await c.close();
  });
});
