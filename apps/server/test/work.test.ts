import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PASSWORD, bootApp, invite, signUp, type TestUser } from "./harness";

let ctx: Awaited<ReturnType<typeof bootApp>>;
let me: TestUser;
let api: ReturnType<TestUser["api"]>;
let org: string;
beforeAll(async () => {
  ctx = await bootApp();
  const s = await signUp(ctx, { name: "Tester" });
  me = s.user;
  org = s.org;
  api = me.api(s.org);
});
afterAll(async () => {
  await ctx.app.close();
});

type Status = { id: string; category: string };

describe("projects & items", () => {
  let projectId: string;

  it("creates a project with padded keys and validates the code", async () => {
    const bad = await api.post("/api/projects").send({ name: "X", key: "TOOLONG" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/2-5/);

    const res = await api.post("/api/projects").send({ name: "Alpha", key: "ab", keyDigits: 6, itemTypes: ["story", "task"] });
    expect(res.status).toBe(201);
    expect(res.body.key).toBe("AB");
    projectId = res.body.id;

    const clash = await api.post("/api/projects").send({ name: "Again", key: "AB" });
    expect(clash.status).toBe(409);
  });

  it("enforces the project's hierarchy and statuses", async () => {
    const epic = await api.post("/api/items").send({ projectId, type: "epic", title: "Not enabled" });
    expect(epic.status).toBe(400);
    expect(epic.body.error).toMatch(/not enabled/);

    const story = await api.post("/api/items").send({ projectId, type: "story", title: "Checkout" });
    expect(story.status).toBe(201);
    expect(story.body.key).toBe("AB-000001");
    expect(story.body.status).toBe("backlog");

    const task = await api.post("/api/items").send({ projectId, type: "task", title: "Stripe", parentId: story.body.id });
    expect(task.body.key).toBe("AB-000002");

    const badStatus = await api.patch(`/api/items/${task.body.id}`).send({ status: "nope" });
    expect(badStatus.status).toBe(400);

    const cycle = await api.patch(`/api/items/${story.body.id}`).send({ parentId: task.body.id });
    expect(cycle.status).toBe(400);
  });

  it("moves items, logs activity and rolls up progress", async () => {
    const tree = (await api.get(`/api/projects/${projectId}/tree`)).body as { id: string; key: string }[];
    const task = tree.find((i) => i.key === "AB-000002")!;
    const moved = await api.patch(`/api/items/${task.id}/move`).send({ status: "done", sortOrder: 5 });
    expect(moved.body.status).toBe("done");

    const detail = (await api.get("/api/items/by-key/AB-000001")).body;
    expect(detail.progress).toEqual({ total: 1, done: 1 });
    expect(detail.children).toHaveLength(1);

    const activity = (await api.get(`/api/items/${task.id}/activity`)).body;
    expect(activity[0]).toMatchObject({ actor: "Tester", action: "moved", fromValue: "backlog", toValue: "done" });
  });

  it("remaps items when a status is removed and blocks disabling used types", async () => {
    const project = (await api.get(`/api/projects/${projectId}`)).body;
    const withoutDone = (project.statuses as Status[]).filter((s) => s.id !== "done");
    await api.patch(`/api/projects/${projectId}`).send({ statuses: withoutDone }).expect(200);
    const task = (await api.get("/api/items/by-key/AB-000002")).body;
    expect(task.status).toBe(withoutDone[0].id); // no other "done" status → first status

    const res = await api.patch(`/api/projects/${projectId}`).send({ itemTypes: ["task"] });
    expect(res.status).toBe(409);
  });

  it("comments and search", async () => {
    const item = (await api.get("/api/items/by-key/AB-000001")).body;
    const c = await api.post(`/api/items/${item.id}/comments`).send({ body: "<p>hi</p>" });
    expect(c.status).toBe(201);
    expect(c.body.author).toBe("Tester");
    const found = (await api.get("/api/search?q=checkout")).body;
    expect(found.items.map((i: { key: string }) => i.key)).toContain("AB-000001");
  });

  it("changes a ticket's epic and milestone without moving its former parent or siblings", async () => {
    const project = (await api.post("/api/projects").send({ key: "HR", name: "Hierarchy", itemTypes: ["epic", "milestone", "story", "task"] }).expect(201)).body;
    const create = async (type: string, title: string, parentId?: string) => (await api.post("/api/items").send({ projectId: project.id, type, title, parentId }).expect(201)).body;
    const first = await create("epic", "First epic");
    const second = await create("epic", "Second epic");
    const milestone = await create("milestone", "First milestone", first.id);
    const nextMilestone = await create("milestone", "Second milestone", second.id);
    const story = await create("story", "Original story", milestone.id);
    const task = await create("task", "Move this task", story.id);
    const sibling = await create("task", "Keep this sibling", story.id);
    const detail = async (id: string) => (await api.get(`/api/items/${id}`).expect(200)).body;
    expect((await detail(task.id)).ancestors.map((a: { id: string }) => a.id)).toEqual([first.id, milestone.id, story.id]);

    await api.patch(`/api/items/${task.id}`).send({ parentId: nextMilestone.id }).expect(200);
    expect((await detail(task.id)).ancestors.map((a: { id: string }) => a.id)).toEqual([second.id, nextMilestone.id]);
    expect((await detail(story.id)).parentId).toBe(milestone.id);
    expect((await detail(sibling.id)).parentId).toBe(story.id);

    // Clearing a milestone keeps its epic; selecting an epic moves directly under it.
    await api.patch(`/api/items/${task.id}`).send({ parentId: second.id }).expect(200);
    expect((await detail(task.id)).ancestors.map((a: { id: string }) => a.id)).toEqual([second.id]);
    await api.patch(`/api/items/${task.id}`).send({ parentId: null }).expect(200);
    expect((await detail(task.id)).ancestors).toEqual([]);

    await api.patch(`/api/items/${milestone.id}`).send({ parentId: null }).expect(400);
    await api.patch(`/api/items/${task.id}`).send({ parentId: task.id }).expect(400);
    const foreignParent = (await api.get("/api/items/by-key/AB-000001").expect(200)).body;
    await api.patch(`/api/items/${task.id}`).send({ parentId: foreignParent.id }).expect(400);

    const viewer = await invite(ctx, me, org, "hierarchy-viewer@test.dev", "member");
    await api.patch(`/api/projects/${project.id}/access`).send({ defaultRole: "viewer" }).expect(200);
    await viewer.api(org).get(`/api/items/${story.id}`).expect(200).then((res) => {
      expect(res.body.ancestors.map((a: { id: string }) => a.id)).toEqual([first.id, milestone.id]);
    });
    await viewer.api(org).patch(`/api/items/${task.id}`).send({ parentId: first.id }).expect(403);
  });

  it.each([
    { key: "QT", top: "task", child: "subtask" },
    { key: "QS", top: "story", child: "task" },
  ] as const)("includes top-level $top work in project statistics", async ({ key, top, child }) => {
    const project = await api.post("/api/projects").send({ name: `Stats ${key}`, key, itemTypes: [top, child] }).expect(201);
    const parent = await api.post("/api/items").send({ projectId: project.body.id, type: top, title: "Completed work", status: "done" }).expect(201);
    let projects = (await api.get("/api/projects").expect(200)).body;
    expect(projects.find((p: { key: string }) => p.key === key).stats).toEqual({ total: 1, done: 1, inProgress: 0 });
    await api.post("/api/items").send({ projectId: project.body.id, type: child, parentId: parent.body.id, title: "Remaining work" }).expect(201);
    projects = (await api.get("/api/projects").expect(200)).body;
    expect(projects.find((p: { key: string }) => p.key === key).stats).toEqual({ total: 2, done: 1, inProgress: 0 });
  });
});

describe("uploads", () => {
  it("revokes file-cookie access on logout even when the cookie is replayed", async () => {
    const { user, org } = await signUp(ctx);
    const login = await user.agent.post("/api/auth/login").send({ email: user.email, password: PASSWORD }).expect(200);
    const cookies = login.headers["set-cookie"] as unknown as string[];
    const fileCookie = cookies.find((c) => c.startsWith("ml_file="))!.split(";")[0];
    const up = await user.api(org).post("/api/uploads").attach("file", Buffer.from("image"), { filename: "a.png", contentType: "image/png" }).expect(201);
    const download = await ctx.http().get(up.body.url).set("cookie", fileCookie).expect(200);
    expect(download.headers["cache-control"]).toBe("private, no-store");
    await user.agent.post("/api/auth/logout").set("authorization", `Bearer ${login.body.accessToken}`).expect(204);
    await ctx.http().get(up.body.url).set("cookie", fileCookie).expect(404);
  });
  it("stores allowed files, serves ranges and rejects others", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
      "base64",
    );
    const up = await api.post("/api/uploads").attach("file", png, { filename: "a.png", contentType: "image/png" });
    expect(up.status).toBe(201);
    // Files load via the httpOnly ml_file cookie the agent received at sign-up (like <img> tags do).
    const get = await me.agent.get(up.body.url).set("Range", "bytes=0-9");
    expect(get.status).toBe(206);
    expect(get.headers["content-range"]).toBe(`bytes 0-9/${png.length}`);

    const svg = await api.post("/api/uploads").attach("file", Buffer.from("<svg/>"), { filename: "x.svg", contentType: "image/svg+xml" });
    expect(svg.status).toBe(415);
    await me.agent.get("/api/uploads/..%2F..%2Fsecret.key").expect(404);
    // Without the cookie (e.g. someone with the link) the file is not served.
    await ctx.http().get(up.body.url).expect(404);
  });
});
