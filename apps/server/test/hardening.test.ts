import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp, signUp, type TestApp } from "./harness";

/** Production behaviour: SPA serving with a strict CSP, API rate limiting, health checks, cookies. */
let ctx: TestApp;
const web = mkdtempSync(join(tmpdir(), "mixedlane-web-"));

beforeAll(async () => {
  mkdirSync(join(web, "assets"));
  writeFileSync(join(web, "index.html"), `<!doctype html><html><head><script>document.documentElement.dataset.x="1"</script></head><body><div id="root"></div></body></html>`);
  writeFileSync(join(web, "assets", "app-abc123.js"), "console.log(1)");
  ctx = await bootApp({ WEB_DIST: web, API_RATE_LIMIT: "30" });
});
afterAll(async () => {
  await ctx.app.close();
});

describe("single-container web serving", () => {
  it("serves the SPA for app routes, with a strict CSP that allows only the hashed inline script", async () => {
    const res = await ctx.http().get("/demo/projects/APP/story/APP-0001");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
    expect(res.headers["cache-control"]).toBe("no-cache");
    const csp = res.headers["content-security-policy"];
    expect(csp).toContain("script-src 'self' 'sha256-");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("caches hashed assets forever, and keeps unknown API routes as JSON 404s", async () => {
    const asset = await ctx.http().get("/assets/app-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");
    const api = await ctx.http().get("/api/does-not-exist");
    expect(api.status).toBe(404);
    expect(api.headers["content-type"]).toContain("application/json");
  });

  it("doesn't mark cookies Secure on plain http (so self-hosted http setups can sign in)", async () => {
    const res = await ctx.http().post("/api/auth/register").send({ name: "A", email: "a@web.dev", password: "Passw0rd!", orgName: "Web" });
    expect(res.status).toBe(201);
    const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
    expect(cookies.some((c) => c.startsWith("ml_rt=") && c.includes("HttpOnly") && !c.includes("Secure"))).toBe(true);
  });
});

describe("health and rate limiting", () => {
  it("health checks the database and is never rate limited", async () => {
    for (let i = 0; i < 40; i++) expect((await ctx.http().get("/api/health")).status).toBe(200);
    expect((await ctx.http().get("/api/health")).body).toEqual({ ok: true, db: "up" });
  });

  it("limits requests per client and says when to retry", async () => {
    const { user, org } = await signUp(ctx);
    let last = await user.api(org).get("/api/projects");
    expect(Number(last.headers["ratelimit-limit"])).toBe(30);
    for (let i = 0; i < 40 && last.status !== 429; i++) last = await user.api(org).get("/api/projects");
    expect(last.status).toBe(429);
    expect(last.body.error).toMatch(/Too many requests/);
    expect(Number(last.headers["retry-after"])).toBeGreaterThan(0);
  });
});
