import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Injectable } from "@nestjs/common";
import { SERVER_ROOT } from "../../core/config";
import { notFound } from "../../core/http";

/** Plugin sources: integrations/agent-plugins/shared (skills, rules, hook script, agent prompt). */
const SOURCE = resolve(SERVER_ROOT, "..", "..", "integrations", "agent-plugins", "shared");
const VERSION = "1.1.0";

export const PLUGIN_CLIENTS = ["claude-code", "codex", "copilot", "opencode", "pi"] as const;
export type PluginClient = (typeof PLUGIN_CLIENTS)[number];

export interface PluginInfo {
  id: PluginClient;
  name: string;
  includes: string[];
  /** What happens after install, shown in the UI. */
  after: string;
}

export const PLUGIN_INFO: Record<PluginClient, Omit<PluginInfo, "id">> = {
  "claude-code": {
    name: "Claude Code",
    includes: ["MCP server (OAuth sign-in)", "4 skills", "flowboard-planner agent", "hooks: session start, planning prompts, plan approved", "/flowboard:plan · sync · start · done · init"],
    after: "Start Claude Code, run /mcp → flowboard → Authenticate once, then /flowboard:init in your repo.",
  },
  codex: {
    name: "Codex",
    includes: ["MCP server (OAuth sign-in)", "4 skills", "hooks: session start, planning prompts"],
    after: "Run `codex mcp login flowboard` once, then ask Codex to link the repo (flowboard-init skill).",
  },
  copilot: {
    name: "Copilot (CLI + VS Code)",
    includes: ["MCP server (OAuth sign-in)", "4 skills", "flowboard-planner agent", "hook: session start"],
    after: "Copilot CLI signs in on first use; VS Code picks the plugin up from Copilot CLI's installed plugins.",
  },
  opencode: {
    name: "opencode",
    includes: ["MCP server (OAuth sign-in)", "4 skills", "flowboard-planner subagent", "plugin: rules in every session + plan mirroring", "/flowboard-plan · /flowboard-sync"],
    after: "Run `opencode mcp auth flowboard` once.",
  },
  pi: {
    name: "Pi",
    includes: ["MCP via pi-mcp-adapter (API key)", "4 skills", "extension: rules in every session", "/flowboard-plan prompt"],
    after: "Set FLOWBOARD_API_KEY to an agent key (Settings → AI agents), then restart Pi.",
  },
};

interface Urls {
  /** Web app origin (links, consent page). */
  web: string;
  /** API origin (installer downloads). */
  api: string;
  mcp: string;
}

type Files = Map<string, string>;

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const frontmatter = (fields: Record<string, string>, body: string) =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${/[:#\n"']/.test(v) ? JSON.stringify(v) : v}`)
    .join("\n")}\n---\n\n${body.trim()}\n`;

const PLANNER_DESCRIPTION =
  "Use proactively to turn requirements, feature requests, bug lists or an implementation plan into Flowboard epics, user stories and tasks. Planning only — it records the breakdown in Flowboard and reports the keys.";

/** Slash-command bodies shared by clients that support command/prompt files. */
const COMMANDS: Record<string, { description: string; hint?: string; body: string }> = {
  plan: {
    description: "Plan work and record it in Flowboard (epic → stories → tasks)",
    hint: "[what to plan]",
    body: "Use the flowboard-planning skill to plan the following and record it in Flowboard, following your planning mode:\n\n$ARGUMENTS\n\nIf nothing is given above, use the requirements and plan from this conversation.",
  },
  sync: {
    description: "Bring Flowboard up to date with this session's work",
    body: "Use the flowboard-work-tracking skill: start_work / complete_work the items worked on in this session, add_comment with decisions or blockers, and create_plan for any untracked work. Finish with the keys you touched and their status.",
  },
  start: {
    description: "Start working on a Flowboard item",
    hint: "<item key>",
    body: "Use the flowboard-work-tracking skill to start work on $ARGUMENTS: get_item for context, start_work with your approach, and use the key in the branch name.",
  },
  done: {
    description: "Finish a Flowboard item (review or done)",
    hint: "<item key> [done]",
    body: "Use the flowboard-work-tracking skill to finish $ARGUMENTS: complete_work with a summary of what changed (stage review, or done if I said done).",
  },
  init: {
    description: "Link this repository to a Flowboard project",
    body: "Use the flowboard-init skill to link this repository to a Flowboard project (.flowboard.json).",
  },
};

/**
 * Runs the bundled hook script with Node, locating it without shell variables so the same
 * command works in bash, zsh, cmd and PowerShell: the client's plugin-root env var first, then the
 * copy the installer keeps under ~/.flowboard/plugins/<client>.
 */
function hookLauncher(client: PluginClient, bundleSubdir: string[], event: string, format: string) {
  const fallback = ["'.flowboard'", "'plugins'", `'${client}'`, ...bundleSubdir.map((s) => `'${s}'`)].join(",");
  return `node -e "const p=require('path'),f=require('fs'),o=require('os');const r=[process.env.PLUGIN_ROOT,process.env.COPILOT_PLUGIN_ROOT,process.env.CLAUDE_PLUGIN_ROOT,p.join(o.homedir(),${fallback})].filter(Boolean).map(d=>p.join(d,'hooks','flowboard-hook.mjs')).find(x=>f.existsSync(x));if(r)import(require('url').pathToFileURL(r).href)" ${event} ${format}`;
}

@Injectable()
export class PluginsService {
  private read(rel: string) {
    const file = join(SOURCE, rel);
    if (!existsSync(file)) throw new Error(`Plugin source missing: ${file}`);
    return readFileSync(file, "utf8");
  }

  private fill(text: string, urls: Urls) {
    return text.replaceAll("{{FLOWBOARD_URL}}", urls.web).replaceAll("{{MCP_URL}}", urls.mcp).replaceAll("{{VERSION}}", VERSION);
  }

  /** skills/<name>/SKILL.md (+ any extra files), with placeholders filled. */
  private skills(urls: Urls, into: string, files: Files) {
    const root = join(SOURCE, "skills");
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else files.set(`${into}/${relative(root, p).split("\\").join("/")}`, this.fill(readFileSync(p, "utf8"), urls));
      }
    };
    walk(root);
  }

  private hookScript(into: string, files: Files) {
    files.set(`${into}/flowboard-hook.mjs`, this.read("hooks/flowboard-hook.mjs"));
    files.set(`${into}/flowboard-rules.md`, this.read("flowboard-rules.md"));
  }

  private agentBody() {
    return this.read("agent-body.md");
  }

  /* ---------- Per-client bundles ---------- */

  /** A local Claude Code marketplace ("flowboard") containing the plugin in ./flowboard. */
  private claudeCode(urls: Urls): Files {
    const f: Files = new Map();
    f.set(".claude-plugin/marketplace.json", json({
      name: "flowboard",
      owner: { name: "Flowboard" },
      description: `Flowboard agent plugin served by ${urls.web}`,
      plugins: [{ name: "flowboard", source: "./flowboard", description: "Plan and track work in Flowboard", version: VERSION }],
    }));
    const p = "flowboard";
    f.set(`${p}/.claude-plugin/plugin.json`, json({
      name: "flowboard",
      displayName: "Flowboard",
      version: VERSION,
      description: "Records plans as Flowboard epics, stories and tasks and keeps them in sync while Claude works.",
      author: { name: "Flowboard" },
      homepage: urls.web,
      keywords: ["flowboard", "planning", "project-management", "mcp"],
    }));
    f.set(`${p}/.mcp.json`, json({ mcpServers: { flowboard: { type: "http", url: urls.mcp } } }));
    const run = (event: string) => ({ type: "command", command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/flowboard-hook.mjs" ${event} claude`, timeout: 10 });
    f.set(`${p}/hooks/hooks.json`, json({
      hooks: {
        SessionStart: [{ hooks: [run("session-start")] }],
        UserPromptSubmit: [{ hooks: [run("prompt")] }],
        PostToolUse: [{ matcher: "ExitPlanMode", hooks: [run("plan-approved")] }],
      },
    }));
    this.hookScript(`${p}/hooks`, f);
    this.skills(urls, `${p}/skills`, f);
    f.set(`${p}/agents/flowboard-planner.md`, frontmatter({ name: "flowboard-planner", description: PLANNER_DESCRIPTION }, this.agentBody()));
    for (const [name, c] of Object.entries(COMMANDS)) {
      f.set(`${p}/commands/${name}.md`, frontmatter({ description: c.description, ...(c.hint ? { "argument-hint": c.hint } : {}) }, c.body));
    }
    return f;
  }

  /** A local Codex marketplace with the plugin in ./plugins/flowboard (Agent Plugins 1.0 layout). */
  private codex(urls: Urls): Files {
    const f: Files = new Map();
    f.set(".agents/plugins/marketplace.json", json({
      name: "flowboard",
      interface: { displayName: "Flowboard" },
      plugins: [
        {
          name: "flowboard",
          source: { source: "local", path: "./plugins/flowboard" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        },
      ],
    }));
    const p = "plugins/flowboard";
    // The Codex-compatible manifest (.codex-plugin/plugin.json) — what current Codex releases load.
    f.set(`${p}/.codex-plugin/plugin.json`, json({
      name: "flowboard",
      version: VERSION,
      description: "Records plans as Flowboard epics, stories and tasks and keeps them in sync while Codex works.",
      author: { name: "Flowboard", url: urls.web },
      homepage: urls.web,
      keywords: ["flowboard", "planning", "project-management", "mcp"],
      skills: "./skills/",
      mcpServers: "./.mcp.json",
      hooks: "./hooks/hooks.json",
      interface: {
        displayName: "Flowboard",
        shortDescription: "Plan and track work in Flowboard",
        longDescription: "Records your plans as Flowboard epics, user stories and tasks, and moves them through the workflow as you work.",
        developerName: "Flowboard",
        category: "Productivity",
        capabilities: ["Interactive", "Write"],
        websiteURL: urls.web,
        defaultPrompt: ["Plan this feature in Flowboard.", "Link this repo to a Flowboard project.", "Sync my work to Flowboard."],
        brandColor: "#6366F1",
      },
    }));
    f.set(`${p}/.mcp.json`, json({ mcpServers: { flowboard: { type: "http", url: urls.mcp } } }));
    const run = (event: string) => ({ type: "command", command: hookLauncher("codex", ["plugins", "flowboard"], event, "codex"), timeout: 10 });
    f.set(`${p}/hooks/hooks.json`, json({
      hooks: {
        SessionStart: [{ hooks: [run("session-start")] }],
        UserPromptSubmit: [{ hooks: [run("prompt")] }],
      },
    }));
    this.hookScript(`${p}/hooks`, f);
    this.skills(urls, `${p}/skills`, f);
    return f;
  }

  /** Agent Plugins 1.0 plugin with Copilot extras (custom agent + hooks) — used by Copilot CLI and VS Code. */
  private copilot(urls: Urls): Files {
    const f: Files = new Map();
    f.set("plugin.json", json({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "flowboard",
      version: VERSION,
      description: "Records plans as Flowboard epics, stories and tasks and keeps them in sync while Copilot works.",
      author: { name: "Flowboard" },
      homepage: urls.web,
      keywords: ["flowboard", "planning", "mcp"],
    }));
    f.set("mcp.json", json({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: { flowboard: { type: "streamable-http", url: urls.mcp } },
    }));
    this.skills(urls, "skills", f);
    f.set(
      "com.github.copilot/agents/flowboard-planner.agent.md",
      frontmatter({ name: "flowboard-planner", description: PLANNER_DESCRIPTION }, this.agentBody()),
    );
    const cmd = hookLauncher("copilot", [], "session-start", "copilot");
    f.set("com.github.copilot/hooks/hooks.json", json({
      version: 1,
      hooks: { sessionStart: [{ type: "command", bash: cmd, powershell: cmd, timeoutSec: 10 }] },
    }));
    this.hookScript("hooks", f);
    return f;
  }

  /** Files copied into ~/.config/opencode/, plus the opencode.json snippet the installer merges. */
  private opencode(urls: Urls): Files {
    const f: Files = new Map();
    const rules = this.read("flowboard-rules.md");
    f.set("plugins/flowboard.js", `// Flowboard for opencode: puts the Flowboard workflow in every session's system prompt and
// reminds the agent to mirror its todo list (its plan) into Flowboard.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RULES = ${JSON.stringify(rules.trim())};

function linkedProject(start) {
  let dir = resolve(start || process.cwd());
  for (;;) {
    const file = join(dir, ".flowboard.json");
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, "utf8")).project || null;
      } catch {
        return null;
      }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export const FlowboardPlugin = async ({ directory }) => {
  const project = linkedProject(directory);
  const link = project
    ? \`This repository is linked to Flowboard project \${project}.\`
    : "This repository isn't linked to a Flowboard project yet — use the flowboard-init skill when you need one.";
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(\`## Flowboard\\n\${link}\\n\\n\${RULES}\`);
    },
    "tool.execute.after": async (input, output) => {
      if (input.tool === "todowrite" && typeof output.output === "string") {
        output.output += "\\n\\n[Flowboard] If this todo list is a plan for new work, record it in Flowboard with create_plan (flowboard-planning skill) per your planning mode, and use start_work / complete_work as you go.";
      }
    },
  };
};
`);
    f.set("agents/flowboard-planner.md", frontmatter({ description: PLANNER_DESCRIPTION, mode: "subagent" }, this.agentBody()));
    this.skills(urls, "skills", f);
    for (const name of ["plan", "sync"] as const) {
      f.set(`commands/flowboard-${name}.md`, frontmatter({ description: COMMANDS[name].description }, COMMANDS[name].body));
    }
    f.set("flowboard/opencode.json", json({ $schema: "https://opencode.ai/config.json", mcp: { flowboard: { type: "remote", url: urls.mcp, enabled: true } } }));
    f.set("flowboard/merge-json.mjs", MERGE_JSON);
    return f;
  }

  /** A Pi package (install with `pi install <dir>`), plus the pi-mcp-adapter config snippet. */
  private pi(urls: Urls): Files {
    const f: Files = new Map();
    const rules = this.read("flowboard-rules.md");
    f.set("package.json", json({
      name: "flowboard-pi",
      version: VERSION,
      description: "Flowboard planning & work tracking for the Pi coding agent",
      type: "module",
      keywords: ["pi-package", "flowboard"],
      pi: { extensions: ["./extensions/flowboard.ts"], skills: ["./skills"], prompts: ["./prompts/*.md"] },
    }));
    f.set("extensions/flowboard.ts", `// Flowboard for Pi: appends the Flowboard workflow to the system prompt of every agent run.
// Tools come from the Flowboard MCP server via pi-mcp-adapter (reach them through its \`mcp\` tool).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RULES = ${JSON.stringify(rules.trim())};
const MCP_NOTE = "In Pi the Flowboard tools are reached through the \`mcp\` tool, e.g. mcp({ search: \\"flowboard create_plan\\" }) then mcp({ tool: \\"create_plan\\", args: {...} }).";

function linkedProject(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    const file = join(dir, ".flowboard.json");
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, "utf8")).project ?? null;
      } catch {
        return null;
      }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function flowboard(pi: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pi.on("before_agent_start", async (event: any) => {
    const project = linkedProject(process.cwd());
    const link = project ? \`This repository is linked to Flowboard project \${project}.\` : "This repository isn't linked to a Flowboard project yet — use the flowboard-init skill when you need one.";
    const extra = \`\\n\\n## Flowboard\\n\${link}\\n\\n\${RULES}\\n\\n\${MCP_NOTE}\`;
    if (typeof event?.systemPrompt === "string") return { systemPrompt: event.systemPrompt + extra };
    return undefined;
  });
}
`);
    this.skills(urls, "skills", f);
    f.set("prompts/flowboard-plan.md", frontmatter({ description: COMMANDS.plan.description }, COMMANDS.plan.body.replace("$ARGUMENTS", "$@")));
    f.set("prompts/flowboard-sync.md", frontmatter({ description: COMMANDS.sync.description }, COMMANDS.sync.body));
    f.set("flowboard/mcp.json", json({ mcpServers: { flowboard: { url: urls.mcp, auth: "bearer", bearerToken: "${FLOWBOARD_API_KEY}" } } }));
    f.set("flowboard/merge-json.mjs", MERGE_JSON);
    return f;
  }

  bundle(client: string, urls: Urls): Files {
    switch (client) {
      case "claude-code":
        return this.claudeCode(urls);
      case "codex":
        return this.codex(urls);
      case "copilot":
        return this.copilot(urls);
      case "opencode":
        return this.opencode(urls);
      case "pi":
        return this.pi(urls);
      default:
        throw notFound("Plugin");
    }
  }

  list(urls: Urls): (PluginInfo & { download: string; install: { bash: string; powershell: string } })[] {
    return PLUGIN_CLIENTS.map((id) => ({
      id,
      ...PLUGIN_INFO[id],
      download: `${urls.api}/api/plugins/${id}.tar.gz`,
      install: {
        bash: `curl -fsSL ${urls.api}/api/plugins/install.sh | sh -s -- ${id}`,
        powershell: `& ([scriptblock]::Create((irm ${urls.api}/api/plugins/install.ps1))) ${id}`,
      },
    }));
  }

  installSh(urls: Urls) {
    return INSTALL_SH.replaceAll("{{API}}", urls.api).replaceAll("{{VERSION}}", VERSION);
  }

  installPs1(urls: Urls) {
    return INSTALL_PS1.replaceAll("{{API}}", urls.api).replaceAll("{{VERSION}}", VERSION);
  }
}

/** Deep-merges a JSON snippet into a JSON config file (keeping a .bak), used by the installers. */
const MERGE_JSON = `// usage: node merge-json.mjs <target.json> <snippet.json> [--remove key.path]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const [target, snippet, flag, removePath] = process.argv.slice(2);
const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8").replace(/^\\uFEFF/, "") || "{}") : {});
const merge = (a, b) => {
  for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? merge(a[k], v) : v;
  return a;
};
const data = read(target);
if (existsSync(target)) copyFileSync(target, target + ".bak");
if (flag === "--remove") {
  const keys = removePath.split(".");
  let node = data;
  for (const k of keys.slice(0, -1)) node = node?.[k];
  if (node) delete node[keys.at(-1)];
} else {
  merge(data, read(snippet));
}
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(data, null, 2) + "\\n");
`;

const INSTALL_SH = `#!/bin/sh
# Flowboard agent plugin installer ({{VERSION}}) — served by {{API}}
# usage: curl -fsSL {{API}}/api/plugins/install.sh | sh -s -- <claude-code|codex|copilot|opencode|pi> [--uninstall]
set -e
CLIENT="$1"; ACTION="\${2:-install}"
BASE="{{API}}"
DIR="$HOME/.flowboard/plugins/$CLIENT"
say() { printf '\\033[1;35m[flowboard]\\033[0m %s\\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { say "'$1' not found — install it first."; exit 1; }; }
case "$CLIENT" in claude-code|codex|copilot|opencode|pi) ;; *) echo "usage: sh -s -- <claude-code|codex|copilot|opencode|pi> [--uninstall]"; exit 1;; esac
need node

if [ "$ACTION" = "--uninstall" ]; then
  case "$CLIENT" in
    claude-code) claude plugin uninstall flowboard@flowboard >/dev/null 2>&1 || true; claude plugin marketplace remove flowboard >/dev/null 2>&1 || true ;;
    codex) codex plugin remove flowboard@flowboard >/dev/null 2>&1 || true; codex plugin marketplace remove flowboard >/dev/null 2>&1 || true ;;
    copilot) copilot plugin uninstall flowboard >/dev/null 2>&1 || true ;;
    opencode)
      OC="$HOME/.config/opencode"
      rm -rf "$OC/plugins/flowboard.js" "$OC/agents/flowboard-planner.md" "$OC/commands/flowboard-plan.md" "$OC/commands/flowboard-sync.md" "$OC"/skills/flowboard-*
      [ -f "$DIR/flowboard/merge-json.mjs" ] && node "$DIR/flowboard/merge-json.mjs" "$OC/opencode.json" - --remove mcp.flowboard || true ;;
    pi) pi remove "$DIR" >/dev/null 2>&1 || true
      [ -f "$DIR/flowboard/merge-json.mjs" ] && node "$DIR/flowboard/merge-json.mjs" "$HOME/.config/mcp/mcp.json" - --remove mcpServers.flowboard || true ;;
  esac
  rm -rf "$DIR"; say "Removed the Flowboard plugin for $CLIENT."; exit 0
fi

say "Downloading the Flowboard plugin for $CLIENT…"
rm -rf "$DIR"; mkdir -p "$DIR"
curl -fsSL "$BASE/api/plugins/$CLIENT.tar.gz" | tar -xzf - -C "$DIR"

case "$CLIENT" in
  claude-code)
    need claude
    claude plugin uninstall flowboard@flowboard >/dev/null 2>&1 || true
    claude plugin marketplace remove flowboard >/dev/null 2>&1 || true
    claude plugin marketplace add "$DIR"
    claude plugin install flowboard@flowboard
    say "Done. In Claude Code: /mcp → flowboard → Authenticate, then /flowboard:init in your repo." ;;
  codex)
    need codex
    codex plugin remove flowboard@flowboard >/dev/null 2>&1 || true
    codex plugin marketplace remove flowboard >/dev/null 2>&1 || true
    codex plugin marketplace add "$DIR"
    codex plugin add flowboard@flowboard
    say "Done. Run: codex mcp login flowboard   (then ask Codex to link your repo)" ;;
  copilot)
    need copilot
    copilot plugin uninstall flowboard >/dev/null 2>&1 || true
    copilot plugin install "$DIR"
    say "Done. Start copilot — it signs in to Flowboard on first use." ;;
  opencode)
    OC="$HOME/.config/opencode"
    mkdir -p "$OC/plugins" "$OC/agents" "$OC/commands" "$OC/skills"
    cp "$DIR/plugins/flowboard.js" "$OC/plugins/"
    cp "$DIR/agents/flowboard-planner.md" "$OC/agents/"
    cp "$DIR"/commands/*.md "$OC/commands/"
    cp -R "$DIR"/skills/* "$OC/skills/"
    node "$DIR/flowboard/merge-json.mjs" "$OC/opencode.json" "$DIR/flowboard/opencode.json"
    say "Done. Run: opencode mcp auth flowboard" ;;
  pi)
    need pi
    pi install npm:pi-mcp-adapter
    node "$DIR/flowboard/merge-json.mjs" "$HOME/.config/mcp/mcp.json" "$DIR/flowboard/mcp.json"
    pi install "$DIR"
    say "Done. Set FLOWBOARD_API_KEY to an agent key (Flowboard → Settings → AI agents), then restart pi." ;;
esac
`;

const INSTALL_PS1 = `# Flowboard agent plugin installer ({{VERSION}}) — served by {{API}}
# usage: & ([scriptblock]::Create((irm {{API}}/api/plugins/install.ps1))) <claude-code|codex|copilot|opencode|pi> [-Uninstall]
param([Parameter(Position = 0)][string]$Client, [switch]$Uninstall)
$ErrorActionPreference = "Stop"
$Base = "{{API}}"
$Clients = "claude-code", "codex", "copilot", "opencode", "pi"
function Say($m) { Write-Host "[flowboard] $m" -ForegroundColor Magenta }
function Need($c) { if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Say "'$c' not found - install it first."; exit 1 } }
function Quiet([scriptblock]$b) { try { & $b *> $null } catch { } }
if ($Clients -notcontains $Client) { Write-Host "usage: ... install.ps1 <$($Clients -join '|')> [-Uninstall]"; exit 1 }
Need node
$Dir = Join-Path $HOME ".flowboard\\plugins\\$Client"
$OC = Join-Path $HOME ".config\\opencode"

if ($Uninstall) {
  switch ($Client) {
    "claude-code" { Quiet { claude plugin uninstall flowboard@flowboard }; Quiet { claude plugin marketplace remove flowboard } }
    "codex" { Quiet { codex plugin remove flowboard@flowboard }; Quiet { codex plugin marketplace remove flowboard } }
    "copilot" { Quiet { copilot plugin uninstall flowboard } }
    "opencode" {
      Remove-Item -Force -ErrorAction SilentlyContinue "$OC\\plugins\\flowboard.js", "$OC\\agents\\flowboard-planner.md", "$OC\\commands\\flowboard-plan.md", "$OC\\commands\\flowboard-sync.md"
      Get-ChildItem "$OC\\skills" -Filter "flowboard-*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
      if (Test-Path "$Dir\\flowboard\\merge-json.mjs") { node "$Dir\\flowboard\\merge-json.mjs" "$OC\\opencode.json" - --remove mcp.flowboard }
    }
    "pi" {
      Quiet { pi remove $Dir }
      if (Test-Path "$Dir\\flowboard\\merge-json.mjs") { node "$Dir\\flowboard\\merge-json.mjs" (Join-Path $HOME ".config\\mcp\\mcp.json") - --remove mcpServers.flowboard }
    }
  }
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Dir
  Say "Removed the Flowboard plugin for $Client."; exit 0
}

Say "Downloading the Flowboard plugin for $Client..."
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Dir
New-Item -ItemType Directory -Force $Dir | Out-Null
$Tgz = Join-Path $env:TEMP "flowboard-$Client.tar.gz"
Invoke-WebRequest -UseBasicParsing "$Base/api/plugins/$Client.tar.gz" -OutFile $Tgz
tar -xzf $Tgz -C $Dir
Remove-Item -Force $Tgz

switch ($Client) {
  "claude-code" {
    Need claude
    Quiet { claude plugin uninstall flowboard@flowboard }; Quiet { claude plugin marketplace remove flowboard }
    claude plugin marketplace add $Dir
    claude plugin install flowboard@flowboard
    Say "Done. In Claude Code: /mcp -> flowboard -> Authenticate, then /flowboard:init in your repo."
  }
  "codex" {
    Need codex
    Quiet { codex plugin remove flowboard@flowboard }; Quiet { codex plugin marketplace remove flowboard }
    codex plugin marketplace add $Dir
    codex plugin add flowboard@flowboard
    Say "Done. Run: codex mcp login flowboard   (then ask Codex to link your repo)"
  }
  "copilot" {
    Need copilot
    Quiet { copilot plugin uninstall flowboard }
    copilot plugin install $Dir
    Say "Done. Start copilot - it signs in to Flowboard on first use."
  }
  "opencode" {
    foreach ($d in "plugins", "agents", "commands", "skills") { New-Item -ItemType Directory -Force (Join-Path $OC $d) | Out-Null }
    Copy-Item "$Dir\\plugins\\flowboard.js" "$OC\\plugins\\" -Force
    Copy-Item "$Dir\\agents\\flowboard-planner.md" "$OC\\agents\\" -Force
    Copy-Item "$Dir\\commands\\*.md" "$OC\\commands\\" -Force
    Copy-Item "$Dir\\skills\\*" "$OC\\skills\\" -Recurse -Force
    node "$Dir\\flowboard\\merge-json.mjs" "$OC\\opencode.json" "$Dir\\flowboard\\opencode.json"
    Say "Done. Run: opencode mcp auth flowboard"
  }
  "pi" {
    Need pi
    pi install npm:pi-mcp-adapter
    node "$Dir\\flowboard\\merge-json.mjs" (Join-Path $HOME ".config\\mcp\\mcp.json") "$Dir\\flowboard\\mcp.json"
    pi install $Dir
    Say "Done. Set FLOWBOARD_API_KEY to an agent key (Flowboard -> Settings -> AI agents), then restart pi."
  }
}
`;
