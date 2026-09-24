import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp, connectSocket, invite, settle, signUp, type TestApp, type TestUser } from "./harness";

let ctx: TestApp;
let org: string;
let owner: TestUser, member: TestUser, guest: TestUser;
let outsider: TestUser, outsiderOrg: string;
let project: { id: string; key: string };
let item: { id: string; key: string };

beforeAll(async () => {
  ctx = await bootApp();
  ({ user: owner, org } = await signUp(ctx, { name: "Owner", orgName: "Docs" }));
  member = await invite(ctx, owner, org, "member@docs.dev", "member");
  guest = await invite(ctx, owner, org, "guest@docs.dev", "guest");
  ({ user: outsider, org: outsiderOrg } = await signUp(ctx, { name: "Outsider" }));
  project = (await owner.api(org).post("/api/projects").send({ name: "App", key: "APP", itemTypes: ["task"] })).body;
  item = (await owner.api(org).post("/api/items").send({ projectId: project.id, type: "task", title: "Login flow" })).body;
});
afterAll(async () => {
  await ctx.app.close();
});

describe("spaces", () => {
  it("members create standalone spaces; guests can't see or create them", async () => {
    const res = await member.api(org).post("/api/spaces").send({ name: "Engineering", key: "eng", description: "How we build" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ key: "ENG", canWrite: true, canAdmin: false, pageCount: 0 });
    expect((await member.api(org).post("/api/spaces").send({ name: "Dup", key: "ENG" })).status).toBe(409);
    expect((await guest.api(org).post("/api/spaces").send({ name: "G", key: "GST" })).status).toBe(403);
    expect((await guest.api(org).get("/api/spaces")).body).toEqual([]);
    expect((await guest.api(org).get("/api/spaces/ENG")).status).toBe(404);
    expect((await outsider.api(outsiderOrg).get("/api/spaces/ENG")).status).toBe(404);
    // Only admins manage a standalone space.
    expect((await member.api(org).patch("/api/spaces/ENG").send({ name: "Eng" })).status).toBe(403);
    expect((await owner.api(org).patch("/api/spaces/ENG").send({ name: "Eng" })).body.name).toBe("Eng");
  });

  it("project spaces follow project access", async () => {
    expect((await member.api(org).post("/api/spaces").send({ name: "App docs", key: "APPD", projectId: project.id })).status).toBe(403);
    await owner.api(org).post("/api/spaces").send({ name: "App docs", key: "APPD", projectId: project.id }).expect(201);
    // Guest: nothing until granted; viewer grant → read-only.
    expect((await guest.api(org).get("/api/spaces/APPD")).status).toBe(404);
    await owner.api(org).post(`/api/projects/${project.id}/access`).send({ principalType: "user", principalId: guest.id, role: "viewer" }).expect(200);
    const seen = await guest.api(org).get("/api/spaces/APPD");
    expect(seen.body).toMatchObject({ projectKey: "APP", canWrite: false });
    expect((await guest.api(org).post("/api/spaces/APPD/pages").send({ title: "Nope" })).status).toBe(403);
    // Members get the project's default role (editor) → can write.
    expect((await member.api(org).post("/api/spaces/APPD/pages").send({ title: "Onboarding" })).status).toBe(201);
  });
});

describe("pages", () => {
  let root: { id: string; version: number }, child: { id: string };

  it("builds a page tree with breadcrumbs", async () => {
    const m = member.api(org);
    root = (await m.post("/api/spaces/ENG/pages").send({ title: "Architecture", contentHtml: "<p>Overview</p>" })).body;
    child = (await m.post("/api/spaces/ENG/pages").send({ title: "Database", parentId: root.id, contentHtml: "<p>We use Postgres</p>" })).body;
    const grandchild = (await m.post("/api/spaces/ENG/pages").send({ title: "Migrations", parentId: child.id })).body;
    expect(grandchild.breadcrumbs.map((b: { title: string }) => b.title)).toEqual(["Architecture", "Database"]);
    expect(root).toMatchObject({ version: 1, spaceKey: "ENG", canWrite: true, updatedByName: "member" });
    const tree = (await m.get("/api/spaces/ENG/pages")).body;
    expect(tree.map((p: { title: string }) => p.title)).toEqual(["Architecture", "Database", "Migrations"]);

    // Can't nest a page under its own descendant.
    expect((await m.post(`/api/pages/${root.id}/move`).send({ parentId: grandchild.id })).status).toBe(400);
  });

  it("reorders siblings", async () => {
    const m = member.api(org);
    const second = (await m.post("/api/spaces/ENG/pages").send({ title: "Runbooks" })).body;
    const tree = (await m.post(`/api/pages/${second.id}/move`).send({ parentId: null, beforeId: root.id })).body;
    const roots = tree.filter((p: { parentId: string | null }) => !p.parentId).map((p: { title: string }) => p.title);
    expect(roots).toEqual(["Runbooks", "Architecture"]);
  });

  it("detects concurrent edits (409) and keeps every version", async () => {
    const m = member.api(org);
    const o = owner.api(org);
    const v2 = await m.patch(`/api/pages/${root.id}`).send({ contentHtml: "<p>Overview v2</p>", baseVersion: 1 });
    expect(v2.body.version).toBe(2);
    // Owner started from v1 too → conflict.
    const clash = await o.patch(`/api/pages/${root.id}`).send({ contentHtml: "<p>Owner edit</p>", baseVersion: 1 });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/member saved a newer version \(v2\)/);
    await o.patch(`/api/pages/${root.id}`).send({ title: "System architecture", contentHtml: "<p>Owner edit</p>", baseVersion: 2 }).expect(200);

    const versions = (await m.get(`/api/pages/${root.id}/versions`)).body;
    expect(versions.map((v: { version: number; authorName: string }) => `${v.version}:${v.authorName}`)).toEqual(["3:Owner", "2:member", "1:member"]);
    const v1 = (await m.get(`/api/pages/${root.id}/versions/1`)).body;
    expect(v1).toMatchObject({ title: "Architecture", contentHtml: "<p>Overview</p>", contentText: "Overview" });

    // Restore = a new version with the old content.
    const restored = (await m.post(`/api/pages/${root.id}/versions/1/restore`)).body;
    expect(restored).toMatchObject({ version: 4, title: "Architecture", contentHtml: "<p>Overview</p>" });
  });

  it("links item keys mentioned in the content, both ways", async () => {
    const m = member.api(org);
    const unpadded = item.key.replace(/-0+/, "-");
    const page = (await m.post("/api/spaces/ENG/pages").send({ title: "Auth spec", contentHtml: `<p>Implements ${unpadded} and FAKE-1234</p>` })).body;
    expect(page.linkedItems.map((i: { key: string }) => i.key)).toEqual([item.key]);
    expect((await m.get(`/api/items/${item.id}/pages`)).body).toEqual([{ id: page.id, title: "Auth spec", spaceKey: "ENG", spaceName: "Eng" }]);
    // The guest can read the item but not the ENG space → no linked pages shown.
    expect((await guest.api(org).get(`/api/items/${item.id}/pages`)).body).toEqual([]);
  });

  it("searches full text across readable spaces", async () => {
    const hits = (await member.api(org).get("/api/docs/search?q=postgres")).body;
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: "Database", spaceKey: "ENG" });
    expect(hits[0].snippet).toContain("«Postgres»");
    expect((await member.api(org).get("/api/docs/search?q=datab")).body[0].title).toBe("Database"); // title prefix
    expect((await guest.api(org).get("/api/docs/search?q=postgres")).body).toEqual([]);
  });

  it("broadcasts page events to space readers and notifies @mentions", async () => {
    const own = await connectSocket(ctx, owner, org);
    const gst = await connectSocket(ctx, guest, org);
    const body = `<p>Review please <span data-type="mention" data-id="${owner.id}" data-label="Owner">@Owner</span></p>`;
    const page = (await member.api(org).post("/api/spaces/ENG/pages").send({ title: "RFC", contentHtml: body })).body;
    await settle(ctx);
    expect(own.events.some((e) => e.type === "page" && e.pageId === page.id && e.action === "created")).toBe(true);
    expect(gst.events.filter((e) => e.type === "page")).toEqual([]);
    const inbox = (await owner.api(org).get("/api/notifications")).body;
    expect(inbox.items[0]).toMatchObject({ type: "mentioned", link: `/docs/ENG/${page.id}` });
    own.socket.disconnect();
    gst.socket.disconnect();
  });

  it("deleting a page removes its sub-pages", async () => {
    const m = member.api(org);
    await m.delete(`/api/pages/${child.id}`).expect(204);
    const titles = (await m.get("/api/spaces/ENG/pages")).body.map((p: { title: string }) => p.title);
    expect(titles).not.toContain("Database");
    expect(titles).not.toContain("Migrations");
    expect((await m.get(`/api/pages/${child.id}`)).status).toBe(404);
  });
});
