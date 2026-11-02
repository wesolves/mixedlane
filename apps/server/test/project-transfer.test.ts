import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp, invite, signUp, type TestApp, type TestUser } from "./harness";

let app: TestApp, owner: TestUser, org: string, source: any, target: any;
beforeAll(async () => {
  app = await bootApp();
  ({ user: owner, org } = await signUp(app));
  source = (await owner.api(org).post("/api/projects").send({ key: "SRC", name: "Source" }).expect(201)).body;
  target = (await owner.api(org).post("/api/projects").send({ key: "DST", name: "Destination" }).expect(201)).body;
});
afterAll(async () => { if (app) await app.app.close(); });
const create = async (type = "task", parentId: string | null = null, projectId = source.id) =>
  (await owner.api(org).post("/api/items").send({ projectId, type, parentId, title: `Transfer ${type}` }).expect(201)).body;

describe("cross-project ticket transfers", () => {
  it("requires an organization admin with admin access to every project", async () => {
    const item = await create();
    const member = await invite(app, owner, org, "transfer-member@test.dev", "member");
    const admin = await invite(app, owner, org, "transfer-admin@test.dev", "admin");
    expect((await member.api(org).get("/api/items/transfer-access").expect(200)).body.allowed).toBe(false);
    await member.api(org).post(`/api/items/${item.id}/transfer`).send({ projectId: target.id }).expect(403);
    expect((await admin.api(org).get("/api/items/transfer-access").expect(200)).body.allowed).toBe(true);
    const hidden = (await owner.api(org).post("/api/projects").send({ key: "HID", name: "Hidden" }).expect(201)).body;
    for (const project of [source, target]) await owner.api(org).post(`/api/projects/${project.id}/access`).send({ principalType: "user", principalId: member.id, role: "admin" }).expect(200);
    await owner.api(org).patch(`/api/projects/${hidden.id}/revocations`).send({ userId: member.id, revoked: true }).expect(200);
    expect((await member.api(org).get("/api/items/transfer-access").expect(200)).body.allowed).toBe(false);
    await member.api(org).post(`/api/items/${item.id}/transfer`).send({ projectId: target.id }).expect(403);
    await admin.api(org).post(`/api/items/${item.id}/transfer`).send({ projectId: target.id }).expect(201);
  });

  it("moves every hierarchy level together and preserves identity, comments and history", async () => {
    const chain: any[] = [];
    for (const type of ["epic", "milestone", "story", "task", "subtask"]) chain.push(await create(type, chain.at(-1)?.id));
    await owner.api(org).post(`/api/items/${chain[3].id}/comments`).send({ body: "Keep this comment" }).expect(201);
    const moved = (await owner.api(org).post(`/api/items/${chain[0].id}/transfer`).send({ projectId: target.id }).expect(201)).body;
    expect(moved.key).toMatch(/^DST-/);
    for (const [n, old] of chain.entries()) {
      const current = (await owner.api(org).get(`/api/items/${old.id}`).expect(200)).body;
      expect(current.projectId).toBe(target.id);
      expect(current.key).toMatch(/^DST-/);
      expect(current.parentId).toBe(n ? chain[n - 1].id : null);
    }
    expect((await owner.api(org).get(`/api/items/${chain[3].id}/comments`).expect(200)).body[0].body).toContain("Keep this comment");
    expect((await owner.api(org).get(`/api/items/${chain[0].id}/activity`).expect(200)).body.some((a: any) => a.field === "project")).toBe(true);
    await owner.api(org).get(`/api/items/by-key/${chain[0].key}`).expect(404);
    const next = await create("task", null, target.id);
    expect(next.key).not.toBe(moved.key);
  });

  it("lets stories and subtasks select a valid destination parent", async () => {
    const epic = await create("epic", null, target.id);
    const sourceEpic = await create("epic");
    const story = await create("story", sourceEpic.id);
    const moved = (await owner.api(org).post(`/api/items/${story.id}/transfer`).send({ projectId: target.id, parentId: epic.id }).expect(201)).body;
    expect(moved.parentId).toBe(epic.id);
    const task = await create();
    const subtask = await create("subtask", task.id);
    await owner.api(org).post(`/api/items/${subtask.id}/transfer`).send({ projectId: target.id }).expect(400);
    const targetTask = await create("task", null, target.id);
    await owner.api(org).post(`/api/items/${subtask.id}/transfer`).send({ projectId: target.id, parentId: targetTask.id }).expect(201);
  });

  it("rejects incompatible descendants and foreign destinations without partial changes", async () => {
    const simple = (await owner.api(org).post("/api/projects").send({ key: "SMP", name: "Simple", itemTypes: ["epic", "task"] }).expect(201)).body;
    const epic = await create("epic");
    const story = await create("story", epic.id);
    await owner.api(org).post(`/api/items/${epic.id}/transfer`).send({ projectId: simple.id }).expect(400);
    expect((await owner.api(org).get(`/api/items/${story.id}`).expect(200)).body.projectId).toBe(source.id);
    const foreign = await signUp(app);
    const foreignProject = (await foreign.user.api(foreign.org).post("/api/projects").send({ key: "FOR", name: "Foreign" }).expect(201)).body;
    await owner.api(org).post(`/api/items/${epic.id}/transfer`).send({ projectId: foreignProject.id }).expect(404);
    await owner.api(org).post(`/api/items/${epic.id}/transfer`).send({ projectId: source.id }).expect(400);
  });

  it("maps workflow categories and allocates unique keys for concurrent moves", async () => {
    const simple = (await owner.api(org).post("/api/projects").send({ key: "WF", name: "Workflow", statuses: [
      { id: "ready", name: "Ready", category: "todo", color: "#aaaaaa" },
      { id: "closed", name: "Closed", category: "done", color: "#00aa00" },
    ] }).expect(201)).body;
    const items = [await create(), await create()];
    await owner.api(org).patch(`/api/items/${items[0].id}`).send({ status: "done" }).expect(200);
    const results = await Promise.all(items.map((i) => owner.api(org).post(`/api/items/${i.id}/transfer`).send({ projectId: simple.id }).expect(201)));
    expect(results[0].body.status).toBe("closed");
    expect(results[1].body.status).toBe("ready");
    expect(new Set(results.map((r) => r.body.key)).size).toBe(2);
  });
});
