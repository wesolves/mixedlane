/**
 * Ready-to-paste setup for every MCP client we support. Formats follow each tool's docs:
 * Claude Code / Desktop, OpenAI Codex, GitHub Copilot (VS Code + CLI), opencode and Pi
 * (via pi-mcp-adapter). Where the tool can read the key from an environment variable we do that,
 * so the key doesn't end up in a config file that might be committed.
 */

export const KEY_ENV = "FLOWBOARD_API_KEY";

export interface SnippetStep {
  /** What this step is, e.g. "Add the server". */
  title: string;
  code: string;
  /** Syntax hint for display only. */
  lang: "bash" | "powershell" | "json" | "toml";
  note?: string;
}

export interface McpClient {
  id: string;
  name: string;
  /** One line on how it connects. */
  blurb: string;
  /** Sign in through the browser (OAuth) — no key to copy. Only for clients that support it. */
  oauth?: (url: string) => SnippetStep[];
  /** Flowboard plugin id (hooks + skills + agent), installable with a one-liner. */
  plugin?: "claude-code" | "codex" | "copilot" | "opencode" | "pi";
  /** Connect with an agent API key. */
  steps: (url: string, key: string) => SnippetStep[];
  docs: string;
}

const signInNote = "A browser opens: sign in to Flowboard, pick the agent (or create one) and click Allow.";

const json = (v: unknown) => JSON.stringify(v, null, 2);

/** Setting the key as an env var, for bash/zsh and PowerShell. */
const envSteps = (key: string): SnippetStep[] => [
  { title: "Store the key (macOS / Linux)", lang: "bash", code: `export ${KEY_ENV}="${key}"`, note: "Add it to ~/.bashrc or ~/.zshrc to keep it." },
  { title: "…or on Windows (PowerShell)", lang: "powershell", code: `setx ${KEY_ENV} "${key}"`, note: "Then open a new terminal so it's picked up." },
];

export const MCP_CLIENTS: McpClient[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    plugin: "claude-code",
    blurb: "Native remote MCP over HTTP.",
    docs: "https://docs.anthropic.com/en/docs/claude-code/mcp",
    oauth: (url) => [
      { title: "Add the server", lang: "bash", code: `claude mcp add --transport http flowboard ${url}` },
      { title: "Sign in", lang: "bash", code: "/mcp", note: `In Claude Code, run /mcp, select flowboard → Authenticate. ${signInNote}` },
    ],
    steps: (url, key) => [
      {
        title: "Add the server",
        lang: "bash",
        code: `claude mcp add --transport http flowboard ${url} --header "Authorization: Bearer ${key}"`,
        note: "Add `-s user` to use it in every project. Then run /mcp in Claude Code to check it's connected.",
      },
    ],
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    blurb: "Bridged with mcp-remote (needs Node.js).",
    docs: "https://www.npmjs.com/package/mcp-remote",
    steps: (url, key) => [
      {
        title: "Add to claude_desktop_config.json",
        lang: "json",
        code: json({
          mcpServers: { flowboard: { command: "npx", args: ["-y", "mcp-remote", url, "--header", "Authorization:${AUTH}"], env: { AUTH: `Bearer ${key}` } } },
        }),
        note: "Settings → Developer → Edit Config, then restart Claude Desktop.",
      },
    ],
  },
  {
    id: "codex",
    name: "Codex",
    plugin: "codex",
    blurb: "OpenAI Codex CLI & IDE extension, streamable HTTP with a bearer token from an env var.",
    docs: "https://developers.openai.com/codex/mcp",
    oauth: (url) => [
      { title: "Add the server", lang: "bash", code: `codex mcp add flowboard --url ${url}` },
      { title: "Sign in", lang: "bash", code: "codex mcp login flowboard", note: signInNote },
    ],
    steps: (url, key) => [
      ...envSteps(key),
      {
        title: "Add the server",
        lang: "bash",
        code: `codex mcp add flowboard --url ${url} --bearer-token-env-var ${KEY_ENV}`,
      },
      {
        title: "…or edit ~/.codex/config.toml directly",
        lang: "toml",
        code: `[mcp_servers.flowboard]\nurl = "${url}"\nbearer_token_env_var = "${KEY_ENV}"\ntool_timeout_sec = 60`,
        note: "Check it with `codex mcp list`, then ask Codex e.g. “list my Flowboard projects”.",
      },
    ],
  },
  {
    id: "copilot-vscode",
    name: "Copilot (VS Code)",
    plugin: "copilot",
    blurb: "GitHub Copilot agent mode in VS Code; the key is prompted once and stored securely.",
    docs: "https://code.visualstudio.com/docs/copilot/customization/mcp-servers",
    oauth: (url) => [
      {
        title: "Create .vscode/mcp.json (or run “MCP: Open User Configuration” for all workspaces)",
        lang: "json",
        code: json({ servers: { flowboard: { type: "http", url } } }),
        note: `Click Start above the server; VS Code asks to sign in. ${signInNote}`,
      },
    ],
    steps: (url) => [
      {
        title: "Create .vscode/mcp.json (or run “MCP: Open User Configuration” for all workspaces)",
        lang: "json",
        code: json({
          inputs: [{ type: "promptString", id: "flowboard-key", description: "Flowboard API key (fb_…)", password: true }],
          servers: { flowboard: { type: "http", url, headers: { Authorization: "Bearer ${input:flowboard-key}" } } },
        }),
        note: "Click Start above the server in mcp.json, paste the key when asked, then pick the Flowboard tools in Copilot Chat's Agent mode.",
      },
    ],
  },
  {
    id: "copilot-cli",
    name: "Copilot CLI",
    plugin: "copilot",
    blurb: "GitHub Copilot in the terminal (`copilot`).",
    docs: "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers",
    oauth: (url) => [
      {
        title: "Add the server",
        lang: "bash",
        code: `copilot mcp add --transport http flowboard ${url}`,
        note: `Copilot signs in the first time it connects. ${signInNote}`,
      },
    ],
    steps: (url, key) => [
      {
        title: "Add the server",
        lang: "bash",
        code: `copilot mcp add --transport http --header "Authorization: Bearer ${key}" flowboard ${url}`,
      },
      {
        title: "…or edit ~/.copilot/mcp-config.json",
        lang: "json",
        code: json({ mcpServers: { flowboard: { type: "http", url, headers: { Authorization: `Bearer ${key}` }, tools: ["*"] } } }),
        note: "Inside a session, /mcp shows the server and its tools.",
      },
    ],
  },
  {
    id: "opencode",
    name: "opencode",
    plugin: "opencode",
    blurb: "Remote MCP with headers; the key comes from an env var.",
    docs: "https://opencode.ai/docs/mcp-servers/",
    oauth: (url) => [
      {
        title: "Add to opencode.json (project) or ~/.config/opencode/opencode.json (global)",
        lang: "json",
        code: json({ $schema: "https://opencode.ai/config.json", mcp: { flowboard: { type: "remote", url, enabled: true } } }),
      },
      { title: "Sign in", lang: "bash", code: "opencode mcp auth flowboard", note: signInNote },
    ],
    steps: (url, key) => [
      ...envSteps(key),
      {
        title: "Add to opencode.json (project) or ~/.config/opencode/opencode.json (global)",
        lang: "json",
        code: json({
          $schema: "https://opencode.ai/config.json",
          mcp: { flowboard: { type: "remote", url, enabled: true, oauth: false, headers: { Authorization: `Bearer {env:${KEY_ENV}}` } } },
        }),
        note: "`oauth: false` stops opencode trying OAuth first. Check it with `opencode mcp list`.",
      },
    ],
  },
  {
    id: "pi",
    name: "Pi",
    plugin: "pi",
    blurb: "Pi has no built-in MCP; the pi-mcp-adapter extension adds it via one `mcp` proxy tool.",
    docs: "https://github.com/nicobailon/pi-mcp-adapter",
    steps: (url, key) => [
      { title: "Install the adapter", lang: "bash", code: "pi install npm:pi-mcp-adapter" },
      ...envSteps(key),
      {
        title: "Add to ~/.config/mcp/mcp.json (global) or .mcp.json (project)",
        lang: "json",
        code: json({ mcpServers: { flowboard: { url, auth: "bearer", bearerToken: `\${${KEY_ENV}}` } } }),
        note: "Restart Pi. It reaches Flowboard through its `mcp` tool, e.g. mcp({ search: \"flowboard\" }).",
      },
    ],
  },
  {
    id: "http",
    name: "Any client / HTTP",
    blurb: "Streamable HTTP (stateless, JSON responses), bearer auth.",
    docs: "https://modelcontextprotocol.io/specification",
    steps: (url, key) => [
      {
        title: "Try it with curl",
        lang: "bash",
        code: `curl -X POST ${url} \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
        note: "Any MCP client that supports streamable HTTP with a custom Authorization header works the same way.",
      },
    ],
  },
];

/* ---------- Agent names (picked from a list, never typed) ---------- */

export interface AgentPreset {
  /** Matches an MCP_CLIENTS id, so its setup instructions open by default. */
  clientId: string;
  name: string;
}

export const AGENT_PRESETS: AgentPreset[] = [
  { clientId: "claude-code", name: "Claude Code" },
  { clientId: "claude-desktop", name: "Claude Desktop" },
  { clientId: "codex", name: "Codex" },
  { clientId: "copilot-vscode", name: "Copilot" },
  { clientId: "copilot-cli", name: "Copilot CLI" },
  { clientId: "opencode", name: "opencode" },
  { clientId: "pi", name: "Pi" },
  { clientId: "http", name: "Other agent" },
];

/** Best guess of which preset an OAuth client is, from the name it registered with. */
export function detectPreset(clientName: string): AgentPreset {
  const n = clientName.toLowerCase();
  const id =
    /claude[\s-]*code/.test(n) ? "claude-code"
    : /claude/.test(n) ? "claude-desktop"
    : /codex|openai/.test(n) ? "codex"
    : /copilot/.test(n) && /cli|terminal/.test(n) ? "copilot-cli"
    : /copilot|vs\s*code|visual studio/.test(n) ? "copilot-vscode"
    : /open\s*code/.test(n) ? "opencode"
    : /\bpi\b/.test(n) ? "pi"
    : "http";
  return AGENT_PRESETS.find((p) => p.clientId === id)!;
}

/** "Codex", or "Codex 2", "Codex 3"… when an agent already has that name. */
export function uniqueAgentName(base: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}
