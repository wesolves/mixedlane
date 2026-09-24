import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp, invite, signUp, type TestApp, type TestUser } from "./harness";

/**
 * Permission matrix: one org with an owner, admin, two members (one in a team), a guest,
 * an org-visible project and a private project — plus a second org to prove isolation.
 */
let ctx: TestApp;
let org: string;
let owner: TestUser, admin: TestUser, member: TestUser, teamMember: TestUser, guest: TestUser;
let outsider: TestUser, outsiderOrg: string;
let open: { id: string; key: string }, secret: { id: string; key: string };
let openItem: string, secretItem: string;
let teamId: string;

beforeAll(async () => {
  ctx = await bootApp();
  ({ user: owner, org } = await signUp(ctx, { name: "Owner", orgName: "Matrix" }));
  teamId = (await owner.api(org).post("/api/org/teams").send({ name: "Core" })).body.id;
  admin = await invite(ctx, owner, org, "admin@matrix.dev", "admin");
  member = await invite(ctx, owner, org, "member@matrix.dev", "member");
  teamMember = await invite(ctx, owner, org, "team@matrix.dev", "member", [teamId]);
  guest = await invite(ctx, owner, org, "guest@matrix.dev", "guest");
  ({ user: outsider, org: outsiderOrg } = await signUp(ctx, { name: "Outsider" }));

  const o = owner.api(org);
  open = (await o.post("/api/projects").send({ name: "Open", key: "OPN", itemTypes: ["task"] })).body;
  secret = (await o.post("/api/projects").send({ name: "Secret", key: "SEC", itemTypes: ["task"] })).body;
  await o.patch(`/api/projects/${secret.id}/access`).send({ visibility: "private" }).expect(200);
  openItem = (await o.post("/api/items").send({ projectId: open.id, type: "task", title: "Open task" })).body.id;
  secretItem = (await o.post("/api/items").send({ projectId: secret.id, type: "task", title: "Secret task" })).body.id;
});
afterAll(async () => {
  await ctx.app.close();
});

const keys = (res: { body: { key: string }[] }) => res.body.map((p) => p.key).sort();

describe("project visibility", () => {
  it("owners/admins see everything, members see org-visible projects, guests nothing", async () => {
    expect(keys(await owner.api(org).get("/api/projects"))).toEqual(["OPN", "SEC"]);
    expect(keys(await admin.api(org).get("/api/projects"))).toEqual(["OPN", "SEC"]);
    expect(keys(await member.api(org).get("/api/projects"))).toEqual(["OPN"]);
    expect(keys(await guest.api(org).get("/api/projects"))).toEqual([]);
  });

  it("hidden projects and their items look like they don't exist (404)", async () => {
    expect((await member.api(org).get(`/api/projects/${secret.id}`)).status).toBe(404);
    expect((await member.api(org).get(`/api/items/${secretItem}`)).status).toBe(404);
    expect((await guest.api(org).get(`/api/items/${openItem}`)).status).toBe(404);
    const search = await member.api(org).get("/api/search?q=task");
    expect(search.body.items.map((i: { title: string }) => i.title)).toEqual(["Open task"]);
  });

  it("team grants open private projects to team members only", async () => {
    await owner.api(org).post(`/api/projects/${secret.id}/access`).send({ principalType: "team", principalId: teamId, role: "commenter" }).expect(200);
    const res = await teamMember.api(org).get(`/api/projects/${secret.id}`);
    expect(res.status).toBe(200);
    expect(res.body.access.role).toBe("commenter");
    expect((await member.api(org).get(`/api/projects/${secret.id}`)).status).toBe(404);
  });
});

describe("project roles", () => {
  it("default role 'editor' lets members create and move work but not manage the project", async () => {
    const m = member.api(org);
    const created = await m.post("/api/items").send({ projectId: open.id, type: "task", title: "By member" });
    expect(created.status).toBe(201);
    expect((await m.patch(`/api/items/${openItem}/move`).send({ status: "done", sortOrder: 1 })).status).toBe(200);
    expect((await m.patch(`/api/projects/${open.id}`).send({ name: "Renamed" })).status).toBe(403);
    expect((await m.post(`/api/projects/${open.id}/access`).send({ principalType: "user", principalId: guest.id, role: "admin" })).status).toBe(403);
  });

  it("commenters can comment but not edit; viewers can only read", async () => {
    const t = teamMember.api(org);
    expect((await t.post(`/api/items/${secretItem}/comments`).send({ body: "<p>hi</p>" })).status).toBe(201);
    expect((await t.patch(`/api/items/${secretItem}`).send({ title: "x" })).status).toBe(403);
    expect((await t.patch(`/api/items/${secretItem}`).send({ status: "done" })).status).toBe(403);
    expect((await t.post("/api/items").send({ projectId: secret.id, type: "task", title: "x" })).status).toBe(403);

    await owner.api(org).post(`/api/projects/${open.id}/access`).send({ principalType: "user", principalId: guest.id, role: "viewer" }).expect(200);
    const g = guest.api(org);
    expect((await g.get(`/api/items/${openItem}`)).status).toBe(200);
    expect((await g.post(`/api/items/${openItem}/comments`).send({ body: "<p>no</p>" })).status).toBe(403);
    expect((await g.delete(`/api/items/${openItem}`)).status).toBe(403);
  });

  it("lowering the default role limits members immediately", async () => {
    await owner.api(org).patch(`/api/projects/${open.id}/access`).send({ defaultRole: "viewer" }).expect(200);
    expect((await member.api(org).post("/api/items").send({ projectId: open.id, type: "task", title: "Nope" })).status).toBe(403);
    // A direct grant beats the default.
    await owner.api(org).post(`/api/projects/${open.id}/access`).send({ principalType: "user", principalId: member.id, role: "editor" }).expect(200);
    expect((await member.api(org).post("/api/items").send({ projectId: open.id, type: "task", title: "Yes" })).status).toBe(201);
  });

  it("only authors or moderators can change comments", async () => {
    const c = await member.api(org).post(`/api/items/${openItem}/comments`).send({ body: "<p>mine</p>" });
    expect((await teamMember.api(org).patch(`/api/comments/${c.body.id}`).send({ body: "<p>hijack</p>" })).status).toBe(403);
    expect((await member.api(org).patch(`/api/comments/${c.body.id}`).send({ body: "<p>edited</p>" })).status).toBe(200);
    expect((await admin.api(org).delete(`/api/comments/${c.body.id}`)).status).toBe(204);
  });
});

describe("org administration", () => {
  it("only admins invite and manage teams; members can't", async () => {
    expect((await member.api(org).post("/api/org/invites").send({ email: "x@y.dev", role: "member" })).status).toBe(403);
    expect((await member.api(org).post("/api/org/teams").send({ name: "Rogue" })).status).toBe(403);
    expect((await admin.api(org).post("/api/org/invites").send({ email: "x@y.dev", role: "member" })).status).toBe(201);
    expect((await guest.api(org).post("/api/projects").send({ name: "G", key: "GG" })).status).toBe(403);
  });

  it("protects ownership", async () => {
    expect((await admin.api(org).patch(`/api/org/members/${member.id}`).send({ role: "owner" })).status).toBe(403);
    expect((await admin.api(org).delete(`/api/org/members/${owner.id}`)).status).toBe(403);
    expect((await owner.api(org).patch(`/api/org/members/${owner.id}`).send({ role: "admin" })).status).toBe(409);
    expect((await owner.api(org).delete(`/api/org/members/${owner.id}`)).status).toBe(409);
  });

  it("members can leave; removed members lose access", async () => {
    const leaver = await invite(ctx, owner, org, "leaver@matrix.dev", "member");
    expect((await leaver.api(org).get("/api/projects")).status).toBe(200);
    await leaver.api(org).delete(`/api/org/members/${leaver.id}`).expect(204);
    expect((await leaver.api(org).get("/api/projects")).status).toBe(404);
  });
});

describe("tenant isolation", () => {
  it("another org's members can't reach this org by header, id or key", async () => {
    const x = outsider.api(org);
    expect((await x.get("/api/projects")).status).toBe(404); // not a member → org not found
    const own = outsider.api(outsiderOrg);
    expect((await own.get(`/api/projects/${open.id}`)).status).toBe(404);
    expect((await own.get(`/api/items/${openItem}`)).status).toBe(404);
    expect((await own.get("/api/items/by-key/OPN-0001")).status).toBe(404);
    expect((await own.post(`/api/items/${openItem}/comments`).send({ body: "<p>x</p>" })).status).toBe(404);
    expect((await own.post("/api/items").send({ projectId: open.id, type: "task", title: "x" })).status).toBe(404);
  });

  it("uploads are only served to members of the owning org", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
    const up = await owner.api(org).post("/api/uploads").attach("file", png, { filename: "a.png", contentType: "image/png" });
    expect((await member.agent.get(up.body.url)).status).toBe(200);
    expect((await outsider.agent.get(up.body.url)).status).toBe(404);
  });
});
