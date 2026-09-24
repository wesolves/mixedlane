import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp, connectSocket, invite, settle, signUp, type TestApp, type TestUser } from "./harness";

/**
 * Realtime: sockets only hear about what they can read, access changes re-route them,
 * presence is permission-checked, and notifications reach the right inbox.
 */
let ctx: TestApp;
let org: string;
let owner: TestUser, member: TestUser;
let outsider: TestUser, outsiderOrg: string;
let open: { id: string }, secret: { id: string };
const sockets: { socket: { disconnect: () => void } }[] = [];

beforeAll(async () => {
  ctx = await bootApp();
  ({ user: owner, org } = await signUp(ctx, { name: "Olivia Owner", orgName: "Live" }));
  member = await invite(ctx, owner, org, "mia@live.dev", "member");
  ({ user: outsider, org: outsiderOrg } = await signUp(ctx, { name: "Outsider" }));
  const o = owner.api(org);
  open = (await o.post("/api/projects").send({ name: "Open", key: "OPN", itemTypes: ["task"] })).body;
  secret = (await o.post("/api/projects").send({ name: "Secret", key: "SEC", itemTypes: ["task"] })).body;
  await o.patch(`/api/projects/${secret.id}/access`).send({ visibility: "private" }).expect(200);
});
afterAll(async () => {
  for (const s of sockets) s.socket.disconnect();
  await ctx.app.close();
});

const connect = async (...args: Parameters<typeof connectSocket>) => {
  const s = await connectSocket(...args);
  sockets.push(s);
  return s;
};

const mention = (u: TestUser, name: string) => `<p>Hey <span data-type="mention" data-id="${u.id}" data-label="${name}">@${name}</span> look</p>`;

describe("socket authentication", () => {
  it("rejects missing/invalid tokens and orgs you don't belong to", async () => {
    await expect(connectSocket(ctx, null, org, "not-a-token")).rejects.toThrow(/unauthorized/);
    await expect(connectSocket(ctx, member, outsiderOrg)).rejects.toThrow(/org_not_found/);
  });
});

describe("event routing", () => {
  it("delivers item events only to sockets that can read the project", async () => {
    const own = await connect(ctx, owner, org);
    const mem = await connect(ctx, member, org);
    const out = await connect(ctx, outsider, outsiderOrg);

    const o = owner.api(org);
    await o.post("/api/items").send({ projectId: open.id, type: "task", title: "Visible work" }).expect(201);
    await o.post("/api/items").send({ projectId: secret.id, type: "task", title: "Hidden work" }).expect(201);
    await settle(ctx);

    const titles = (evs: { type: string; title?: unknown }[]) => evs.filter((e) => e.type === "item").map((e) => e.title);
    expect(titles(own.events)).toEqual(["Visible work", "Hidden work"]);
    expect(titles(mem.events)).toEqual(["Visible work"]);
    expect(out.events).toEqual([]);
  });

  it("re-routes sockets when project access changes", async () => {
    const mem = await connect(ctx, member, org);
    const grant = await owner.api(org).post(`/api/projects/${secret.id}/access`).send({ principalType: "user", principalId: member.id, role: "viewer" }).expect(200);
    await settle(ctx);
    await owner.api(org).post("/api/items").send({ projectId: secret.id, type: "task", title: "Now visible" }).expect(201);
    await settle(ctx);
    expect(mem.events.some((e) => e.type === "item" && e.title === "Now visible")).toBe(true);
    expect(mem.events.some((e) => e.type === "project" && e.action === "access")).toBe(true);

    // Revoke again: no more events.
    const grantId = grant.body.grants.find((g: { principalId: string }) => g.principalId === member.id).id;
    await owner.api(org).delete(`/api/projects/${secret.id}/access/${grantId}`).expect(200);
    await settle(ctx);
    mem.events.length = 0;
    await owner.api(org).post("/api/items").send({ projectId: secret.id, type: "task", title: "Hidden again" }).expect(201);
    await settle(ctx);
    expect(mem.events.filter((e) => e.type === "item")).toEqual([]);
  });

  it("carries the actor so clients can attribute changes", async () => {
    const own = await connect(ctx, owner, org);
    const item = (await member.api(org).post("/api/items").send({ projectId: open.id, type: "task", title: "By Mia" })).body;
    await member.api(org).post(`/api/items/${item.id}/comments`).send({ body: "<p>note</p>" }).expect(201);
    await settle(ctx);
    const created = own.events.find((e) => e.type === "item" && e.itemId === item.id) as unknown as { actor: { name: string } };
    expect(created.actor.name).toBe("mia");
    expect(own.events.some((e) => e.type === "comment" && e.itemId === item.id && e.action === "created")).toBe(true);
  });
});

describe("presence", () => {
  it("is visible to other viewers and permission-checked", async () => {
    const item = (await owner.api(org).post("/api/items").send({ projectId: open.id, type: "task", title: "Pair on this" })).body;
    const hidden = (await owner.api(org).post("/api/items").send({ projectId: secret.id, type: "task", title: "Private" })).body;
    const own = await connect(ctx, owner, org);
    const mem = await connect(ctx, member, org);
    const updates: { users: { name: string; mode: string }[] }[] = [];
    own.socket.on("presence", (p: { users: { name: string; mode: string }[] }) => updates.push(p));

    const ack = (s: typeof own, ev: string, body: unknown) =>
      new Promise<{ ok: boolean; users?: unknown[] }>((resolve) => (s.socket as unknown as { emit: (...a: unknown[]) => void }).emit(ev, body, resolve));

    expect((await ack(own, "presence:join", { resource: `item:${item.id}`, mode: "viewing" })).ok).toBe(true);
    expect((await ack(mem, "presence:join", { resource: `item:${hidden.id}` })).ok).toBe(false);
    const joined = await ack(mem, "presence:join", { resource: `item:${item.id}`, mode: "editing" });
    expect(joined.users).toHaveLength(2);
    await settle(ctx);
    expect(updates.at(-1)!.users.map((u) => `${u.name}:${u.mode}`).sort()).toEqual(["Olivia Owner:viewing", "mia:editing"]);

    mem.socket.disconnect();
    await settle(ctx);
    expect(updates.at(-1)!.users.map((u) => u.name)).toEqual(["Olivia Owner"]);
  });
});

describe("notifications", () => {
  it("notifies the assignee, not the person assigning themselves", async () => {
    const mem = await connect(ctx, member, org);
    const o = owner.api(org);
    const item = (await o.post("/api/items").send({ projectId: open.id, type: "task", title: "Assigned to Mia", assigneeId: member.id })).body;
    expect(item.assignee).toBe("mia");
    expect(item.assigneeId).toBe(member.id);
    await o.post("/api/items").send({ projectId: open.id, type: "task", title: "Mine", assigneeId: owner.id }).expect(201);
    await settle(ctx);

    const inbox = (await member.api(org).get("/api/notifications")).body;
    expect(inbox.unread).toBe(1);
    expect(inbox.items[0]).toMatchObject({ type: "assigned", actorName: "Olivia Owner", link: expect.stringMatching(/^\/projects\/OPN\/task\/OPN-\d{4}$/) });
    expect((await owner.api(org).get("/api/notifications")).body.unread).toBe(0);
    expect(mem.events.some((e) => e.type === "notification")).toBe(true);

    // Status changes by someone else, and comments, reach the assignee too.
    await o.patch(`/api/items/${item.id}/move`).send({ status: "done", sortOrder: 1 }).expect(200);
    await o.post(`/api/items/${item.id}/comments`).send({ body: "<p>Shipped!</p>" }).expect(201);
    await settle(ctx);
    const types = (await member.api(org).get("/api/notifications")).body.items.map((n: { type: string }) => n.type);
    expect(types).toEqual(["commented", "status_changed", "assigned"]);
  });

  it("rejects assignees outside the org", async () => {
    const res = await owner.api(org).post("/api/items").send({ projectId: open.id, type: "task", title: "x", assigneeId: outsider.id });
    expect(res.status).toBe(400);
  });

  it("@mentions notify readers only, once per new mention", async () => {
    const hidden = (await owner.api(org).post("/api/items").send({ projectId: secret.id, type: "task", title: "Secret plan" })).body;
    const visible = (await owner.api(org).post("/api/items").send({ projectId: open.id, type: "task", title: "Open plan" })).body;
    const before = (await member.api(org).get("/api/notifications")).body.items.length;

    // Mia can't read the secret project → no notification (and nothing leaks).
    await owner.api(org).post(`/api/items/${hidden.id}/comments`).send({ body: mention(member, "mia") }).expect(201);
    const c = await owner.api(org).post(`/api/items/${visible.id}/comments`).send({ body: mention(member, "mia") }).expect(201);
    // Editing without adding a new mention doesn't notify again.
    await owner.api(org).patch(`/api/comments/${c.body.id}`).send({ body: `${mention(member, "mia")}<p>edit</p>` }).expect(200);
    await settle(ctx);

    const items = (await member.api(org).get("/api/notifications")).body.items;
    expect(items.length - before).toBe(1);
    expect(items[0]).toMatchObject({ type: "mentioned", body: "Hey @mia look" });
  });

  it("marks read individually and all at once", async () => {
    const m = member.api(org);
    const { items, unread } = (await m.get("/api/notifications")).body;
    expect(unread).toBeGreaterThan(1);
    await m.post(`/api/notifications/${items[0].id}/read`).expect(200);
    expect((await m.get("/api/notifications")).body.unread).toBe(unread - 1);
    // Someone else can't mark my notifications.
    expect((await owner.api(org).post(`/api/notifications/${items[1].id}/read`)).status).toBe(404);
    await m.post("/api/notifications/read-all").expect(200);
    expect((await m.get("/api/notifications?unread=true")).body).toEqual({ items: [], unread: 0 });
  });
});
