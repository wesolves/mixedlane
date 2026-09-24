import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp, invite, signUp, type TestApp, type TestUser } from "./harness";

/** OAuth 2.1 sign-in for MCP clients: discovery → registration → consent → PKCE token → MCP. */
let ctx: TestApp;
let org: string;
let owner: TestUser, member: TestUser;
let project: { id: string; key: string };
const REDIRECT = "http://127.0.0.1:43123/callback";

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

async function register(name = "Copilot CLI") {
  const res = await ctx.http().post("/api/oauth/register").send({ client_name: name, redirect_uris: [REDIRECT] });
  expect(res.status).toBe(201);
  return res.body.client_id as string;
}

const codeFrom = (redirect: string) => new URL(redirect).searchParams.get("code")!;

beforeAll(async () => {
  ctx = await bootApp();
  ({ user: owner, org } = await signUp(ctx, { name: "Owner", orgName: "OAuth" }));
  member = await invite(ctx, owner, org, "member@oauth.dev", "member");
  project = (await owner.api(org).post("/api/projects").send({ name: "App", key: "APP", itemTypes: ["task"] })).body;
});
afterAll(async () => {
  await ctx.app.close();
});

describe("discovery", () => {
  it("points unauthenticated MCP clients at the OAuth metadata", async () => {
    const res = await ctx.http().post("/api/mcp").set("host", "flowboard.test").send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain('resource_metadata="http://flowboard.test/.well-known/oauth-protected-resource/api/mcp"');

    const prm = await ctx.http().get("/.well-known/oauth-protected-resource/api/mcp").set("host", "flowboard.test");
    expect(prm.body).toMatchObject({ resource: "http://flowboard.test/api/mcp", authorization_servers: ["http://flowboard.test"] });

    const as = await ctx.http().get("/.well-known/oauth-authorization-server").set("host", "flowboard.test");
    expect(as.body).toMatchObject({
      issuer: "http://flowboard.test",
      token_endpoint: "http://flowboard.test/api/oauth/token",
      registration_endpoint: "http://flowboard.test/api/oauth/register",
      code_challenge_methods_supported: ["S256"],
    });
    expect(as.body.authorization_endpoint).toMatch(/\/oauth\/authorize$/);
  });
});

describe("registration", () => {
  it("rejects script-capable or missing redirect URIs", async () => {
    for (const redirect_uris of [[], ["javascript:alert(1)"], ["data:text/html,hi"], "http://x"]) {
      const res = await ctx.http().post("/api/oauth/register").send({ client_name: "Bad", redirect_uris });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_redirect_uri");
    }
  });
});

describe("authorization code flow", () => {
  it("creates an agent with the chosen projects and issues a working key", async () => {
    const clientId = await register();
    const { verifier, challenge } = pkce();
    const approved = await owner.api(org).post("/api/oauth/authorize").send({
      clientId,
      redirectUri: REDIRECT,
      codeChallenge: challenge,
      state: "xyz",
      newAgent: { name: "Copilot", projectIds: [project.id] },
    });
    expect(approved.status).toBe(200);
    const redirect = new URL(approved.body.redirect);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT);
    expect(redirect.searchParams.get("state")).toBe("xyz");

    const token = await ctx
      .http()
      .post("/api/oauth/token")
      .type("form")
      .send({ grant_type: "authorization_code", code: codeFrom(approved.body.redirect), code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT });
    expect(token.status).toBe(200);
    expect(token.headers["cache-control"]).toBe("no-store");
    expect(token.body).toMatchObject({ token_type: "Bearer", access_token: expect.stringMatching(/^fb_/) });

    // The token works on MCP with exactly the new agent's access.
    const tools = await ctx
      .http()
      .post("/api/mcp")
      .set("authorization", `Bearer ${token.body.access_token}`)
      .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_projects", arguments: {} } });
    expect(tools.status).toBe(200);
    expect(JSON.parse(tools.body.result.content[0].text).map((p: { key: string }) => p.key)).toEqual(["APP"]);

    // The agent is created when the code is redeemed; the token is a revocable key on it.
    expect(approved.body.agentId).toBeNull();
    const agent = (await owner.api(org).get("/api/agents")).body.find((a: { name: string }) => a.name === "Copilot");
    expect(agent.grants.map((g: { projectKey: string }) => g.projectKey)).toEqual(["APP"]);
    expect(agent.keys.filter((k: { revokedAt: string | null }) => !k.revokedAt).map((k: { name: string }) => k.name)).toEqual(["OAuth · Copilot CLI"]);

    // Codes are single-use.
    const again = await ctx
      .http()
      .post("/api/oauth/token")
      .type("form")
      .send({ grant_type: "authorization_code", code: codeFrom(approved.body.redirect), code_verifier: verifier, client_id: clientId });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("invalid_grant");
  });

  it("refuses an already-used sign-in link and leaves no agent behind for abandoned sign-ins", async () => {
    const clientId = await register("OpenCode");
    const { challenge } = pkce();
    const before = (await owner.api(org).get("/api/agents")).body.length;
    const first = await owner.api(org).post("/api/oauth/authorize").send({ clientId, redirectUri: REDIRECT, codeChallenge: challenge, newAgent: { name: "opencode", projectIds: [project.id] } });
    expect(first.status).toBe(200);
    // The app never redeemed the code (e.g. it had stopped waiting): no agent was created.
    expect((await owner.api(org).get("/api/agents")).body.length).toBe(before);
    // Opening the same link again is detected and refused.
    expect((await owner.get(`/api/oauth/clients/${clientId}?code_challenge=${challenge}`)).body.linkUsed).toBe(true);
    const again = await owner.api(org).post("/api/oauth/authorize").send({ clientId, redirectUri: REDIRECT, codeChallenge: challenge, newAgent: { name: "opencode", projectIds: [] } });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already used/);
  });

  it("can reuse an existing agent", async () => {
    const created = await owner.api(org).post("/api/agents").send({ name: "Existing Bot" });
    const clientId = await register("Claude Code");
    const { verifier, challenge } = pkce();
    const approved = await owner.api(org).post("/api/oauth/authorize").send({ clientId, redirectUri: REDIRECT, codeChallenge: challenge, agentId: created.body.agent.id });
    expect(approved.body.agentId).toBe(created.body.agent.id);
    const token = await ctx.http().post("/api/oauth/token").send({ grant_type: "authorization_code", code: codeFrom(approved.body.redirect), code_verifier: verifier });
    expect(token.status).toBe(200);
  });

  it("enforces PKCE, the registered redirect URI and admin rights", async () => {
    const clientId = await register();
    const { challenge } = pkce();

    // Wrong verifier.
    const ok = await owner.api(org).post("/api/oauth/authorize").send({ clientId, redirectUri: REDIRECT, codeChallenge: challenge, newAgent: { name: "X", projectIds: [] } });
    const bad = await ctx.http().post("/api/oauth/token").send({ grant_type: "authorization_code", code: codeFrom(ok.body.redirect), code_verifier: pkce().verifier });
    expect(bad.body).toMatchObject({ error: "invalid_grant", error_description: expect.stringMatching(/PKCE/) });

    // Unregistered redirect.
    const other = await owner.api(org).post("/api/oauth/authorize").send({ clientId, redirectUri: "http://evil.example/cb", codeChallenge: challenge });
    expect(other.status).toBe(400);

    // Only people who can manage agents may approve.
    const denied = await member.api(org).post("/api/oauth/authorize").send({ clientId, redirectUri: REDIRECT, codeChallenge: challenge });
    expect(denied.status).toBe(403);

    // Other grant types aren't supported.
    const cc = await ctx.http().post("/api/oauth/token").send({ grant_type: "client_credentials" });
    expect(cc.body.error).toBe("unsupported_grant_type");
  });
});
