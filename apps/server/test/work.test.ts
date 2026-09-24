import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp, signUp, type TestUser } from "./harness";

let ctx: Awaited<ReturnType<typeof bootApp>>;
let me: TestUser;
let api: ReturnType<TestUser["api"]>;
beforeAll(async () => {
  ctx = await bootApp();
  const s = await signUp(ctx, { name: "Tester" });
  me = s.user;
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
});

describe("uploads", () => {
  it("stores allowed files, serves ranges and rejects others", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
      "base64",
    );
    const up = await api.post("/api/uploads").attach("file", png, { filename: "a.png", contentType: "image/png" });
    expect(up.status).toBe(201);
    // Files load via the httpOnly fb_file cookie the agent received at sign-up (like <img> tags do).
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
