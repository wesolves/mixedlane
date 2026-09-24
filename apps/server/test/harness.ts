import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import pg from "pg";
import request from "supertest";
import { resetConfig } from "../src/core/config";

/**
 * Boots the real app against a fresh database with the job worker off: in-memory PGlite by default,
 * or a real Postgres when TEST_DATABASE_URL is set (its public schema is wiped first).
 */
export async function bootApp(overrides: Record<string, string> = {}) {
  const pgUrl = process.env.TEST_DATABASE_URL;
  if (pgUrl) {
    const client = new pg.Client({ connectionString: pgUrl });
    await client.connect();
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;");
    await client.end();
  }
  resetConfig({
    NODE_ENV: "test",
    ...(pgUrl ? { DATABASE_URL: pgUrl } : { PGLITE_DIR: "memory://" }),
    WORKER_ENABLED: "false",
    AUTH_RATE_LIMIT: "10000",
    API_RATE_LIMIT: "100000",
    UPLOAD_DIR: mkdtempSync(join(tmpdir(), "flowboard-uploads-")),
    WEB_DIST: "",
    ...overrides,
  });
  // Imported after the env is set so module-level config reads see it.
  const { AppModule } = await import("../src/app.module");
  const { configureApp } = await import("../src/bootstrap");
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  configureApp(app);
  await app.init();
  const http = () => request(app.getHttpServer());
  return { app, moduleRef, http };
}

export type TestApp = Awaited<ReturnType<typeof bootApp>>;

/** A signed-in test user: a cookie-keeping agent plus helpers that add auth + org headers. */
export interface TestUser {
  id: string;
  email: string;
  token: string;
  agent: ReturnType<typeof request.agent>;
  /** Org-scoped API client (X-Org header). */
  api: (org: string) => {
    get: (url: string) => request.Test;
    post: (url: string) => request.Test;
    patch: (url: string) => request.Test;
    put: (url: string) => request.Test;
    delete: (url: string) => request.Test;
  };
  /** Requests that aren't org-scoped. */
  get: (url: string) => request.Test;
  post: (url: string) => request.Test;
}

export const PASSWORD = "Passw0rd!";

function wrap(ctx: TestApp, body: { accessToken: string; user: { id: string; email: string } }, agent: ReturnType<typeof request.agent>): TestUser {
  const auth = (t: request.Test) => t.set("authorization", `Bearer ${body.accessToken}`);
  return {
    id: body.user.id,
    email: body.user.email,
    token: body.accessToken,
    agent,
    api: (org: string) => {
      const scoped = (t: request.Test) => auth(t).set("x-org", org);
      return {
        get: (u) => scoped(agent.get(u)),
        post: (u) => scoped(agent.post(u)),
        patch: (u) => scoped(agent.patch(u)),
        put: (u) => scoped(agent.put(u)),
        delete: (u) => scoped(agent.delete(u)),
      };
    },
    get: (u) => auth(agent.get(u)),
    post: (u) => auth(agent.post(u)),
  };
}

let counter = 0;

/** Registers a new user with their own org; returns the user and the org slug. */
export async function signUp(ctx: TestApp, opts: { name?: string; email?: string; orgName?: string } = {}) {
  const n = ++counter;
  const agent = request.agent(ctx.app.getHttpServer());
  const res = await agent.post("/api/auth/register").send({
    name: opts.name ?? `User ${n}`,
    email: opts.email ?? `user${n}-${Date.now()}@test.dev`,
    password: PASSWORD,
    orgName: opts.orgName ?? `Org ${n}`,
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { user: wrap(ctx, res.body, agent), org: res.body.orgs[0].slug as string };
}

export async function signIn(ctx: TestApp, email: string, password = PASSWORD) {
  const agent = request.agent(ctx.app.getHttpServer());
  const res = await agent.post("/api/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return wrap(ctx, res.body, agent);
}

/** Invites `email` into `org` with `role` (as `admin`), accepts it creating the account, returns the new user. */
export async function invite(ctx: TestApp, admin: TestUser, org: string, email: string, role: string, teamIds: string[] = []) {
  const res = await admin.api(org).post("/api/org/invites").send({ email, role, teamIds });
  if (res.status !== 201) throw new Error(`invite failed: ${res.status} ${JSON.stringify(res.body)}`);
  const token = new URL(res.body.url).pathname.split("/").pop()!;
  const agent = request.agent(ctx.app.getHttpServer());
  const acc = await agent.post(`/api/invites/${token}/accept`).send({ name: email.split("@")[0], password: PASSWORD });
  if (acc.status !== 200) throw new Error(`accept failed: ${acc.status} ${JSON.stringify(acc.body)}`);
  return wrap(ctx, acc.body, agent);
}

/** Starts listening (sockets need a real port) and returns the base URL. */
export async function listen(ctx: TestApp): Promise<string> {
  const server = ctx.app.getHttpServer();
  if (!server.listening) await ctx.app.listen(0, "127.0.0.1");
  const { port } = server.address() as { port: number };
  return `http://127.0.0.1:${port}`;
}

/** A connected socket.io client for `user` in `org`, recording every `live` event. */
export async function connectSocket(ctx: TestApp, user: TestUser | null, org: string, token?: string) {
  const { io } = await import("socket.io-client");
  const url = await listen(ctx);
  const socket = io(url, { path: "/api/socket", transports: ["websocket"], auth: { token: token ?? user?.token, org }, reconnection: false, forceNew: true });
  const events: { type: string; [k: string]: unknown }[] = [];
  socket.on("live", (e) => events.push(e));
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (err) => reject(err));
  });
  return { socket, events };
}

/** Waits for the event bus (and a socket round-trip) to settle. */
export async function settle(ctx: TestApp) {
  const { EventBus } = await import("../src/core/events");
  await ctx.moduleRef.get(EventBus).idle();
  await new Promise((r) => setTimeout(r, 60));
}
