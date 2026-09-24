import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootApp, type TestApp } from "./harness";

/** Agent plugins served by Flowboard: bundles per client, installers, and the shared hook script. */
let ctx: TestApp;
const HOST = "flowboard.test:8080";

/** Lists a ustar archive (name → content). */
function untar(gz: Buffer) {
  const buf = gunzipSync(gz);
  const files = new Map<string, string>();
  for (let off = 0; off + 512 <= buf.length; ) {
    const name = buf.subarray(off, off + 100).toString("utf8").replace(/\0.*$/s, "");
    if (!name) break;
    const prefix = buf.subarray(off + 345, off + 500).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(buf.subarray(off + 124, off + 136).toString("utf8").replace(/\0.*$/s, "").trim(), 8);
    files.set(prefix ? `${prefix}/${name}` : name, buf.subarray(off + 512, off + 512 + size).toString("utf8"));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function bundle(client: string) {
  const res = await ctx.http().get(`/api/plugins/${client}.tar.gz`).set("host", HOST).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => chunks.push(c));
    r.on("end", () => cb(null, Buffer.concat(chunks)));
  });
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toContain("gzip");
  return untar(res.body as Buffer);
}

beforeAll(async () => {
  ctx = await bootApp();
});
afterAll(async () => {
  await ctx.app.close();
});

describe("plugin catalogue", () => {
  it("lists every client with one-line installers pointing at this server", async () => {
    const list = (await ctx.http().get("/api/plugins").set("host", HOST)).body;
    expect(list.map((p: { id: string }) => p.id)).toEqual(["claude-code", "codex", "copilot", "opencode", "pi"]);
    expect(list[0].install.bash).toBe(`curl -fsSL http://${HOST}/api/plugins/install.sh | sh -s -- claude-code`);
    expect(list[0].install.powershell).toContain(`irm http://${HOST}/api/plugins/install.ps1`);
    expect((await ctx.http().get("/api/plugins/nope.tar.gz")).status).toBe(404);
  });

  it("serves installers for bash and PowerShell", async () => {
    const sh = (await ctx.http().get("/api/plugins/install.sh").set("host", HOST)).text;
    expect(sh).toContain(`BASE="http://${HOST}"`);
    expect(sh).toContain("claude plugin marketplace add");
    expect(sh).toContain("codex plugin add flowboard@flowboard");
    expect(sh).toContain("copilot plugin install");
    const ps = (await ctx.http().get("/api/plugins/install.ps1").set("host", HOST)).text;
    expect(ps).toContain(`$Base = "http://${HOST}"`);
    expect(ps).toMatch(/param\(/);
  });
});

describe("bundles", () => {
  const MCP = `http://${HOST}/api/mcp`;

  it("every bundle has the four skills, the MCP URL filled in, and no placeholders left", async () => {
    for (const client of ["claude-code", "codex", "copilot", "opencode", "pi"]) {
      const files = await bundle(client);
      const all = [...files.values()].join("\n");
      expect(all, client).not.toMatch(/\{\{[A-Z_]+\}\}/);
      expect(all, client).toContain(MCP);
      const skills = [...files.keys()].filter((k) => k.endsWith("SKILL.md")).map((k) => k.split("/").at(-2)).sort();
      expect(skills, client).toEqual(["flowboard-docs", "flowboard-init", "flowboard-planning", "flowboard-work-tracking"]);
    }
  });

  it("Claude Code: marketplace + plugin with hooks, planner agent and commands", async () => {
    const f = await bundle("claude-code");
    expect(JSON.parse(f.get(".claude-plugin/marketplace.json")!).plugins[0]).toMatchObject({ name: "flowboard", source: "./flowboard" });
    expect(JSON.parse(f.get("flowboard/.claude-plugin/plugin.json")!).name).toBe("flowboard");
    expect(JSON.parse(f.get("flowboard/.mcp.json")!).mcpServers.flowboard).toEqual({ type: "http", url: MCP });
    const hooks = JSON.parse(f.get("flowboard/hooks/hooks.json")!).hooks;
    expect(Object.keys(hooks)).toEqual(["SessionStart", "UserPromptSubmit", "PostToolUse"]);
    expect(hooks.PostToolUse[0].matcher).toBe("ExitPlanMode");
    expect(f.get("flowboard/agents/flowboard-planner.md")).toMatch(/^---\nname: flowboard-planner/);
    expect([...f.keys()].filter((k) => k.startsWith("flowboard/commands/")).length).toBe(5);
    expect(f.get("flowboard/skills/flowboard-init/SKILL.md")).toContain(`"server": "http://${HOST}"`);
  });

  it("Codex: Codex-compatible manifest, MCP and hooks; Copilot: agent + hooks; opencode & Pi: config snippets", async () => {
    const codex = await bundle("codex");
    expect(JSON.parse(codex.get("plugins/flowboard/.codex-plugin/plugin.json")!)).toMatchObject({ skills: "./skills/", mcpServers: "./.mcp.json", hooks: "./hooks/hooks.json" });
    expect(JSON.parse(codex.get(".agents/plugins/marketplace.json")!).plugins[0].source).toEqual({ source: "local", path: "./plugins/flowboard" });

    const copilot = await bundle("copilot");
    expect(JSON.parse(copilot.get("plugin.json")!).$schema).toContain("agent-plugins.org");
    expect(copilot.has("com.github.copilot/agents/flowboard-planner.agent.md")).toBe(true);
    expect(JSON.parse(copilot.get("com.github.copilot/hooks/hooks.json")!).hooks.sessionStart[0]).toHaveProperty("powershell");

    const opencode = await bundle("opencode");
    expect(JSON.parse(opencode.get("flowboard/opencode.json")!).mcp.flowboard).toEqual({ type: "remote", url: MCP, enabled: true });
    expect(opencode.get("plugins/flowboard.js")).toContain('"experimental.chat.system.transform"');
    expect(opencode.get("agents/flowboard-planner.md")).toContain("mode: subagent");

    const pi = await bundle("pi");
    expect(JSON.parse(pi.get("package.json")!).pi.extensions).toEqual(["./extensions/flowboard.ts"]);
    expect(JSON.parse(pi.get("flowboard/mcp.json")!).mcpServers.flowboard).toMatchObject({ url: MCP, auth: "bearer", bearerToken: "${FLOWBOARD_API_KEY}" });
  });
});

describe("hook script", () => {
  it("links the repo's project, nudges on planning prompts only, and speaks each client's format", async () => {
    const files = await bundle("claude-code");
    const dir = mkdtempSync(join(tmpdir(), "fb-hook-"));
    const hook = join(dir, "flowboard-hook.mjs");
    writeFileSync(hook, files.get("flowboard/hooks/flowboard-hook.mjs")!);
    writeFileSync(join(dir, "flowboard-rules.md"), files.get("flowboard/hooks/flowboard-rules.md")!);
    const repo = join(dir, "repo");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, ".flowboard.json"), JSON.stringify({ project: "MKA", organization: "demo" }));
    const run = (args: string[], input: object) => execFileSync(process.execPath, [hook, ...args], { input: JSON.stringify(input), encoding: "utf8" });

    const start = JSON.parse(run(["session-start", "claude"], { cwd: join(repo, "src") }));
    expect(start.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(start.hookSpecificOutput.additionalContext).toContain("project **MKA**");
    expect(start.hookSpecificOutput.additionalContext).toContain("create_plan");

    expect(JSON.parse(run(["prompt", "codex"], { cwd: repo, prompt: "Plan the checkout feature" })).hookSpecificOutput.additionalContext).toContain("project MKA");
    expect(run(["prompt", "claude"], { cwd: repo, prompt: "fix the typo in README" })).toBe("");
    expect(JSON.parse(run(["session-start", "copilot"], { cwd: dir }))).toEqual({ additionalContext: expect.stringContaining("isn't linked") });
    expect(JSON.parse(run(["plan-approved", "claude"], { cwd: repo })).hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(readFileSync(hook, "utf8")).toContain("process.exit(0)");
  });
});
