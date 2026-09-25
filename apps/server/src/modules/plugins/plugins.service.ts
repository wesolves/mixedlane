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
    includes: ["MCP server (OAuth sign-in)", "4 skills", "mixedlane-planner agent", "hooks: session start, planning prompts, plan approved", "/mixedlane:plan · sync · start · done · init"],
    after: "Start Claude Code, run /mcp → mixedlane → Authenticate once, then /mixedlane:init in your repo.",
  },
  codex: {
    name: "Codex",
    includes: ["MCP server (OAuth sign-in)", "4 skills", "hooks: session start, planning prompts"],
    after: "Run `codex mcp login mixedlane` once, then ask Codex to link the repo (mixedlane-init skill).",
  },
  copilot: {
    name: "Copilot (CLI + VS Code)",
    includes: ["MCP server (OAuth sign-in)", "4 skills", "mixedlane-planner agent", "hook: session start"],
    after: "Copilot CLI signs in on first use; VS Code picks the plugin up from Copilot CLI's installed plugins.",
  },
  opencode: {
    name: "opencode",
    includes: ["MCP server (OAuth sign-in)", "4 skills", "mixedlane-planner subagent", "plugin: rules in every session + plan mirroring", "/mixedlane-plan · /mixedlane-sync"],
    after: "Run `opencode mcp auth mixedlane` once.",
  },
  pi: {
    name: "Pi",
    includes: ["MCP via pi-mcp-adapter (API key)", "4 skills", "extension: rules in every session", "/mixedlane-plan prompt"],
    after: "Set MIXEDLANE_API_KEY to an agent key (Settings → AI agents), then restart Pi.",
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
  "Use proactively to turn requirements, feature requests, bug lists or an implementation plan into Mixedlane epics, user stories and tasks. Planning only — it records the breakdown in Mixedlane and reports the keys.";

/** Slash-command bodies shared by clients that support command/prompt files. */
const COMMANDS: Record<string, { description: string; hint?: string; body: string }> = {
  plan: {
    description: "Plan work and record it in Mixedlane (epic → stories → tasks)",
    hint: "[what to plan]",
    body: "Use the mixedlane-planning skill to plan the following and record it in Mixedlane, following your planning mode:\n\n$ARGUMENTS\n\nIf nothing is given above, use the requirements and plan from this conversation.",
  },
  sync: {
    description: "Bring Mixedlane up to date with this session's work",
    body: "Use the mixedlane-work-tracking skill: start_work / complete_work the items worked on in this session, add_comment with decisions or blockers, and create_plan for any untracked work. Finish with the keys you touched and their status.",
  },
  start: {
    description: "Start working on a Mixedlane item",
    hint: "<item key>",
    body: "Use the mixedlane-work-tracking skill to start work on $ARGUMENTS: get_item for context, start_work with your approach, and use the key in the branch name.",
  },
  done: {
    description: "Finish a Mixedlane item (review or done)",
    hint: "<item key> [done]",
    body: "Use the mixedlane-work-tracking skill to finish $ARGUMENTS: complete_work with a summary of what changed (stage review, or done if I said done).",
  },
  init: {
    description: "Link this repository to a Mixedlane project",
    body: "Use the mixedlane-init skill to link this repository to a Mixedlane project (.mixedlane.json).",
  },
};

/**
 * Runs the bundled hook script with Node, locating it without shell variables so the same
 * command works in bash, zsh, cmd and PowerShell: the client's plugin-root env var first, then the
 * copy the installer keeps under ~/.mixedlane/plugins/<client>.
 */
function hookLauncher(client: PluginClient, bundleSubdir: string[], event: string, format: string) {
  const fallback = ["'.mixedlane'", "'plugins'", `'${client}'`, ...bundleSubdir.map((s) => `'${s}'`)].join(",");
  return `node -e "const p=require('path'),f=require('fs'),o=require('os');const r=[process.env.PLUGIN_ROOT,process.env.COPILOT_PLUGIN_ROOT,process.env.CLAUDE_PLUGIN_ROOT,p.join(o.homedir(),${fallback})].filter(Boolean).map(d=>p.join(d,'hooks','mixedlane-hook.mjs')).find(x=>f.existsSync(x));if(r)import(require('url').pathToFileURL(r).href)" ${event} ${format}`;
}

@Injectable()
export class PluginsService {
  private read(rel: string) {
    const file = join(SOURCE, rel);
    if (!existsSync(file)) throw new Error(`Plugin source missing: ${file}`);
    return readFileSync(file, "utf8");
  }

  private fill(text: string, urls: Urls) {
    return text.replaceAll("{{MIXEDLANE_URL}}", urls.web).replaceAll("{{MCP_URL}}", urls.mcp).replaceAll("{{VERSION}}", VERSION);
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
    files.set(`${into}/mixedlane-hook.mjs`, this.read("hooks/mixedlane-hook.mjs"));
    files.set(`${into}/mixedlane-rules.md`, this.read("mixedlane-rules.md"));
  }

  private agentBody() {
    return this.read("agent-body.md");
  }

  /* ---------- Per-client bundles ---------- */

  /** A local Claude Code marketplace ("mixedlane") containing the plugin in ./mixedlane. */
  private claudeCode(urls: Urls): Files {
    const f: Files = new Map();
    f.set(".claude-plugin/marketplace.json", json({
      name: "mixedlane",
      owner: { name: "Mixedlane" },
      description: `Mixedlane agent plugin served by ${urls.web}`,
      plugins: [{ name: "mixedlane", source: "./mixedlane", description: "Plan and track work in Mixedlane", version: VERSION }],
    }));
    const p = "mixedlane";
    f.set(`${p}/.claude-plugin/plugin.json`, json({
      name: "mixedlane",
      displayName: "Mixedlane",
      version: VERSION,
      description: "Records plans as Mixedlane epics, stories and tasks and keeps them in sync while Claude works.",
      author: { name: "Mixedlane" },
      homepage: urls.web,
      keywords: ["mixedlane", "planning", "project-management", "mcp"],
    }));
    f.set(`${p}/.mcp.json`, json({ mcpServers: { mixedlane: { type: "http", url: urls.mcp } } }));
    const run = (event: string) => ({ type: "command", command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/mixedlane-hook.mjs" ${event} claude`, timeout: 10 });
    f.set(`${p}/hooks/hooks.json`, json({
      hooks: {
        SessionStart: [{ hooks: [run("session-start")] }],
        UserPromptSubmit: [{ hooks: [run("prompt")] }],
        PostToolUse: [{ matcher: "ExitPlanMode", hooks: [run("plan-approved")] }],
      },
    }));
    this.hookScript(`${p}/hooks`, f);
    this.skills(urls, `${p}/skills`, f);
    f.set(`${p}/agents/mixedlane-planner.md`, frontmatter({ name: "mixedlane-planner", description: PLANNER_DESCRIPTION }, this.agentBody()));
    for (const [name, c] of Object.entries(COMMANDS)) {
      f.set(`${p}/commands/${name}.md`, frontmatter({ description: c.description, ...(c.hint ? { "argument-hint": c.hint } : {}) }, c.body));
    }
    return f;
  }

  /** A local Codex marketplace with the plugin in ./plugins/mixedlane (Agent Plugins 1.0 layout). */
  private codex(urls: Urls): Files {
    const f: Files = new Map();
    f.set(".agents/plugins/marketplace.json", json({
      name: "mixedlane",
      interface: { displayName: "Mixedlane" },
      plugins: [
        {
          name: "mixedlane",
          source: { source: "local", path: "./plugins/mixedlane" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        },
      ],
    }));
    const p = "plugins/mixedlane";
    // The Codex-compatible manifest (.codex-plugin/plugin.json) — what current Codex releases load.
    f.set(`${p}/.codex-plugin/plugin.json`, json({
      name: "mixedlane",
      version: VERSION,
      description: "Records plans as Mixedlane epics, stories and tasks and keeps them in sync while Codex works.",
      author: { name: "Mixedlane", url: urls.web },
      homepage: urls.web,
      keywords: ["mixedlane", "planning", "project-management", "mcp"],
      skills: "./skills/",
      mcpServers: "./.mcp.json",
      hooks: "./hooks/hooks.json",
      interface: {
        displayName: "Mixedlane",
        shortDescription: "Plan and track work in Mixedlane",
        longDescription: "Records your plans as Mixedlane epics, user stories and tasks, and moves them through the workflow as you work.",
        developerName: "Mixedlane",
        category: "Productivity",
        capabilities: ["Interactive", "Write"],
        websiteURL: urls.web,
        defaultPrompt: ["Plan this feature in Mixedlane.", "Link this repo to a Mixedlane project.", "Sync my work to Mixedlane."],
        brandColor: "#6366F1",
      },
    }));
    f.set(`${p}/.mcp.json`, json({ mcpServers: { mixedlane: { type: "http", url: urls.mcp } } }));
    const run = (event: string) => ({ type: "command", command: hookLauncher("codex", ["plugins", "mixedlane"], event, "codex"), timeout: 10 });
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
      name: "mixedlane",
      version: VERSION,
      description: "Records plans as Mixedlane epics, stories and tasks and keeps them in sync while Copilot works.",
      author: { name: "Mixedlane" },
      homepage: urls.web,
      keywords: ["mixedlane", "planning", "mcp"],
    }));
    f.set("mcp.json", json({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: { mixedlane: { type: "streamable-http", url: urls.mcp } },
    }));
    this.skills(urls, "skills", f);
    f.set(
      "com.github.copilot/agents/mixedlane-planner.agent.md",
      frontmatter({ name: "mixedlane-planner", description: PLANNER_DESCRIPTION }, this.agentBody()),
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
    const rules = this.read("mixedlane-rules.md");
    f.set("plugins/mixedlane.js", `// Mixedlane for opencode: puts the Mixedlane workflow in every session's system prompt and
// reminds the agent to mirror its todo list (its plan) into Mixedlane.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RULES = ${JSON.stringify(rules.trim())};

function linkedProject(start) {
  let dir = resolve(start || process.cwd());
  for (;;) {
    const file = join(dir, ".mixedlane.json");
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

export const MixedlanePlugin = async ({ directory }) => {
  const project = linkedProject(directory);
  const link = project
    ? \`This repository is linked to Mixedlane project \${project}.\`
    : "This repository isn't linked to a Mixedlane project yet — use the mixedlane-init skill when you need one.";
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(\`## Mixedlane\\n\${link}\\n\\n\${RULES}\`);
    },
    "tool.execute.after": async (input, output) => {
      if (input.tool === "todowrite" && typeof output.output === "string") {
        output.output += "\\n\\n[Mixedlane] If this todo list is a plan for new work, record it in Mixedlane with create_plan (mixedlane-planning skill) per your planning mode, and use start_work / complete_work as you go.";
      }
    },
  };
};
`);
    f.set("agents/mixedlane-planner.md", frontmatter({ description: PLANNER_DESCRIPTION, mode: "subagent" }, this.agentBody()));
    this.skills(urls, "skills", f);
    for (const name of ["plan", "sync"] as const) {
      f.set(`commands/mixedlane-${name}.md`, frontmatter({ description: COMMANDS[name].description }, COMMANDS[name].body));
    }
    f.set("mixedlane/opencode.json", json({ $schema: "https://opencode.ai/config.json", mcp: { mixedlane: { type: "remote", url: urls.mcp, enabled: true } } }));
    f.set("mixedlane/merge-json.mjs", MERGE_JSON);
    return f;
  }

  /** A Pi package (install with `pi install <dir>`), plus the pi-mcp-adapter config snippet. */
  private pi(urls: Urls): Files {
    const f: Files = new Map();
    const rules = this.read("mixedlane-rules.md");
    f.set("package.json", json({
      name: "mixedlane-pi",
      version: VERSION,
      description: "Mixedlane planning & work tracking for the Pi coding agent",
      type: "module",
      keywords: ["pi-package", "mixedlane"],
      pi: { extensions: ["./extensions/mixedlane.ts"], skills: ["./skills"], prompts: ["./prompts/*.md"] },
    }));
    f.set("extensions/mixedlane.ts", `// Mixedlane for Pi: appends the Mixedlane workflow to the system prompt of every agent run.
// Tools come from the Mixedlane MCP server via pi-mcp-adapter (reach them through its \`mcp\` tool).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RULES = ${JSON.stringify(rules.trim())};
const MCP_NOTE = "In Pi the Mixedlane tools are reached through the \`mcp\` tool, e.g. mcp({ search: \\"mixedlane create_plan\\" }) then mcp({ tool: \\"create_plan\\", args: {...} }).";

function linkedProject(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    const file = join(dir, ".mixedlane.json");
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
export default function mixedlane(pi: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pi.on("before_agent_start", async (event: any) => {
    const project = linkedProject(process.cwd());
    const link = project ? \`This repository is linked to Mixedlane project \${project}.\` : "This repository isn't linked to a Mixedlane project yet — use the mixedlane-init skill when you need one.";
    const extra = \`\\n\\n## Mixedlane\\n\${link}\\n\\n\${RULES}\\n\\n\${MCP_NOTE}\`;
    if (typeof event?.systemPrompt === "string") return { systemPrompt: event.systemPrompt + extra };
    return undefined;
  });
}
`);
    this.skills(urls, "skills", f);
    f.set("prompts/mixedlane-plan.md", frontmatter({ description: COMMANDS.plan.description }, COMMANDS.plan.body.replace("$ARGUMENTS", "$@")));
    f.set("prompts/mixedlane-sync.md", frontmatter({ description: COMMANDS.sync.description }, COMMANDS.sync.body));
    f.set("mixedlane/mcp.json", json({ mcpServers: { mixedlane: { url: urls.mcp, auth: "bearer", bearerToken: "${MIXEDLANE_API_KEY}" } } }));
    f.set("mixedlane/merge-json.mjs", MERGE_JSON);
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
# Mixedlane agent plugin installer ({{VERSION}}) — served by {{API}}
# usage: curl -fsSL {{API}}/api/plugins/install.sh | sh -s -- <claude-code|codex|copilot|opencode|pi> [--uninstall]
set -e
CLIENT="$1"; ACTION="\${2:-install}"
BASE="{{API}}"
DIR="$HOME/.mixedlane/plugins/$CLIENT"
say() { printf '\\033[1;35m[mixedlane]\\033[0m %s\\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { say "'$1' not found — install it first."; exit 1; }; }
case "$CLIENT" in claude-code|codex|copilot|opencode|pi) ;; *) echo "usage: sh -s -- <claude-code|codex|copilot|opencode|pi> [--uninstall]"; exit 1;; esac
need node

if [ "$ACTION" = "--uninstall" ]; then
  case "$CLIENT" in
    claude-code) claude plugin uninstall mixedlane@mixedlane >/dev/null 2>&1 || true; claude plugin marketplace remove mixedlane >/dev/null 2>&1 || true ;;
    codex) codex plugin remove mixedlane@mixedlane >/dev/null 2>&1 || true; codex plugin marketplace remove mixedlane >/dev/null 2>&1 || true ;;
    copilot) copilot plugin uninstall mixedlane >/dev/null 2>&1 || true ;;
    opencode)
      OC="$HOME/.config/opencode"
      rm -rf "$OC/plugins/mixedlane.js" "$OC/agents/mixedlane-planner.md" "$OC/commands/mixedlane-plan.md" "$OC/commands/mixedlane-sync.md" "$OC"/skills/mixedlane-*
      [ -f "$DIR/mixedlane/merge-json.mjs" ] && node "$DIR/mixedlane/merge-json.mjs" "$OC/opencode.json" - --remove mcp.mixedlane || true ;;
    pi) pi remove "$DIR" >/dev/null 2>&1 || true
      [ -f "$DIR/mixedlane/merge-json.mjs" ] && node "$DIR/mixedlane/merge-json.mjs" "$HOME/.config/mcp/mcp.json" - --remove mcpServers.mixedlane || true ;;
  esac
  rm -rf "$DIR"; say "Removed the Mixedlane plugin for $CLIENT."; exit 0
fi

say "Downloading the Mixedlane plugin for $CLIENT…"
rm -rf "$DIR"; mkdir -p "$DIR"
curl -fsSL "$BASE/api/plugins/$CLIENT.tar.gz" | tar -xzf - -C "$DIR"

case "$CLIENT" in
  claude-code)
    need claude
    claude plugin uninstall mixedlane@mixedlane >/dev/null 2>&1 || true
    claude plugin marketplace remove mixedlane >/dev/null 2>&1 || true
    claude plugin marketplace add "$DIR"
    claude plugin install mixedlane@mixedlane
    say "Done. In Claude Code: /mcp → mixedlane → Authenticate, then /mixedlane:init in your repo." ;;
  codex)
    need codex
    codex plugin remove mixedlane@mixedlane >/dev/null 2>&1 || true
    codex plugin marketplace remove mixedlane >/dev/null 2>&1 || true
    codex plugin marketplace add "$DIR"
    codex plugin add mixedlane@mixedlane
    say "Done. Run: codex mcp login mixedlane   (then ask Codex to link your repo)" ;;
  copilot)
    need copilot
    copilot plugin uninstall mixedlane >/dev/null 2>&1 || true
    copilot plugin install "$DIR"
    say "Done. Start copilot — it signs in to Mixedlane on first use." ;;
  opencode)
    OC="$HOME/.config/opencode"
    mkdir -p "$OC/plugins" "$OC/agents" "$OC/commands" "$OC/skills"
    cp "$DIR/plugins/mixedlane.js" "$OC/plugins/"
    cp "$DIR/agents/mixedlane-planner.md" "$OC/agents/"
    cp "$DIR"/commands/*.md "$OC/commands/"
    cp -R "$DIR"/skills/* "$OC/skills/"
    node "$DIR/mixedlane/merge-json.mjs" "$OC/opencode.json" "$DIR/mixedlane/opencode.json"
    say "Done. Run: opencode mcp auth mixedlane" ;;
  pi)
    need pi
    pi install npm:pi-mcp-adapter
    node "$DIR/mixedlane/merge-json.mjs" "$HOME/.config/mcp/mcp.json" "$DIR/mixedlane/mcp.json"
    pi install "$DIR"
    say "Done. Set MIXEDLANE_API_KEY to an agent key (Mixedlane → Settings → AI agents), then restart pi." ;;
esac
`;

const INSTALL_PS1 = `# Mixedlane agent plugin installer ({{VERSION}}) — served by {{API}}
# usage: & ([scriptblock]::Create((irm {{API}}/api/plugins/install.ps1))) <claude-code|codex|copilot|opencode|pi> [-Uninstall]
param([Parameter(Position = 0)][string]$Client, [switch]$Uninstall)
$ErrorActionPreference = "Stop"
$Base = "{{API}}"
$Clients = "claude-code", "codex", "copilot", "opencode", "pi"
function Say($m) { Write-Host "[mixedlane] $m" -ForegroundColor Magenta }
function Need($c) { if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Say "'$c' not found - install it first."; exit 1 } }
function Quiet([scriptblock]$b) { try { & $b *> $null } catch { } }
if ($Clients -notcontains $Client) { Write-Host "usage: ... install.ps1 <$($Clients -join '|')> [-Uninstall]"; exit 1 }
Need node
$Dir = Join-Path $HOME ".mixedlane\\plugins\\$Client"
$OC = Join-Path $HOME ".config\\opencode"

if ($Uninstall) {
  switch ($Client) {
    "claude-code" { Quiet { claude plugin uninstall mixedlane@mixedlane }; Quiet { claude plugin marketplace remove mixedlane } }
    "codex" { Quiet { codex plugin remove mixedlane@mixedlane }; Quiet { codex plugin marketplace remove mixedlane } }
    "copilot" { Quiet { copilot plugin uninstall mixedlane } }
    "opencode" {
      Remove-Item -Force -ErrorAction SilentlyContinue "$OC\\plugins\\mixedlane.js", "$OC\\agents\\mixedlane-planner.md", "$OC\\commands\\mixedlane-plan.md", "$OC\\commands\\mixedlane-sync.md"
      Get-ChildItem "$OC\\skills" -Filter "mixedlane-*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
      if (Test-Path "$Dir\\mixedlane\\merge-json.mjs") { node "$Dir\\mixedlane\\merge-json.mjs" "$OC\\opencode.json" - --remove mcp.mixedlane }
    }
    "pi" {
      Quiet { pi remove $Dir }
      if (Test-Path "$Dir\\mixedlane\\merge-json.mjs") { node "$Dir\\mixedlane\\merge-json.mjs" (Join-Path $HOME ".config\\mcp\\mcp.json") - --remove mcpServers.mixedlane }
    }
  }
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Dir
  Say "Removed the Mixedlane plugin for $Client."; exit 0
}

Say "Downloading the Mixedlane plugin for $Client..."
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Dir
New-Item -ItemType Directory -Force $Dir | Out-Null
$Tgz = Join-Path $env:TEMP "mixedlane-$Client.tar.gz"
Invoke-WebRequest -UseBasicParsing "$Base/api/plugins/$Client.tar.gz" -OutFile $Tgz
tar -xzf $Tgz -C $Dir
Remove-Item -Force $Tgz

switch ($Client) {
  "claude-code" {
    Need claude
    Quiet { claude plugin uninstall mixedlane@mixedlane }; Quiet { claude plugin marketplace remove mixedlane }
    claude plugin marketplace add $Dir
    claude plugin install mixedlane@mixedlane
    Say "Done. In Claude Code: /mcp -> mixedlane -> Authenticate, then /mixedlane:init in your repo."
  }
  "codex" {
    Need codex
    Quiet { codex plugin remove mixedlane@mixedlane }; Quiet { codex plugin marketplace remove mixedlane }
    codex plugin marketplace add $Dir
    codex plugin add mixedlane@mixedlane
    Say "Done. Run: codex mcp login mixedlane   (then ask Codex to link your repo)"
  }
  "copilot" {
    Need copilot
    Quiet { copilot plugin uninstall mixedlane }
    copilot plugin install $Dir
    Say "Done. Start copilot - it signs in to Mixedlane on first use."
  }
  "opencode" {
    foreach ($d in "plugins", "agents", "commands", "skills") { New-Item -ItemType Directory -Force (Join-Path $OC $d) | Out-Null }
    Copy-Item "$Dir\\plugins\\mixedlane.js" "$OC\\plugins\\" -Force
    Copy-Item "$Dir\\agents\\mixedlane-planner.md" "$OC\\agents\\" -Force
    Copy-Item "$Dir\\commands\\*.md" "$OC\\commands\\" -Force
    Copy-Item "$Dir\\skills\\*" "$OC\\skills\\" -Recurse -Force
    node "$Dir\\mixedlane\\merge-json.mjs" "$OC\\opencode.json" "$Dir\\mixedlane\\opencode.json"
    Say "Done. Run: opencode mcp auth mixedlane"
  }
  "pi" {
    Need pi
    pi install npm:pi-mcp-adapter
    node "$Dir\\mixedlane\\merge-json.mjs" (Join-Path $HOME ".config\\mcp\\mcp.json") "$Dir\\mixedlane\\mcp.json"
    pi install $Dir
    Say "Done. Set MIXEDLANE_API_KEY to an agent key (Mixedlane -> Settings -> AI agents), then restart pi."
  }
}
`;
