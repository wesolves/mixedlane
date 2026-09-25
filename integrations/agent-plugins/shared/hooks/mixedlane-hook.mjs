#!/usr/bin/env node
// Mixedlane hook for Claude Code, Codex and Copilot. Dependency-free (Node ≥ 18) and never blocks:
// it always exits 0, and prints nothing when it has nothing to add.
//
// Usage (arguments may appear in any order, so it also works when launched via `node -e`):
//   mixedlane-hook.mjs <session-start|prompt|plan-approved> [claude|codex|copilot]
// Reads the hook's JSON payload from stdin (cwd, prompt, …) when there is one.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EVENTS = { "session-start": "SessionStart", prompt: "UserPromptSubmit", "plan-approved": "PostToolUse" };
const args = process.argv.slice(1).map((a) => a.replace(/^--(format=)?/, ""));
const event = args.find((a) => a in EVENTS);
const format = args.find((a) => ["claude", "codex", "copilot"].includes(a)) ?? "claude";

/** Planning-ish prompts get a reminder; everything else stays quiet (no noise on every turn). */
const PLANNING = /\b(plan|planning|roadmap|requirements?|spec|prd|features?|implement|build|scope|user stor(y|ies)|epics?|milestones?|break (it |this )?down|backlog|tickets?|todo list)\b/i;

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve({});
  return new Promise((done) => {
    let raw = "";
    const finish = () => {
      try {
        done(raw.trim() ? JSON.parse(raw) : {});
      } catch {
        done({});
      }
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", finish);
    process.stdin.on("error", () => done({}));
    setTimeout(finish, 1500).unref();
  });
}

/** The nearest .mixedlane.json from the working directory up to the filesystem root. */
function findProject(cwd) {
  let dir = resolve(cwd);
  for (;;) {
    const file = join(dir, ".mixedlane.json");
    if (existsSync(file)) {
      try {
        return { file, ...JSON.parse(readFileSync(file, "utf8")) };
      } catch {
        return { file, invalid: true };
      }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function rules() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, "mixedlane-rules.md"), join(here, "..", "mixedlane-rules.md")]) {
    if (existsSync(p)) return readFileSync(p, "utf8").trim();
  }
  return "Use the Mixedlane MCP tools: record plans with create_plan (epic → story → task), start_work / complete_work while you work.";
}

function contextFor(input) {
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const project = findProject(cwd);
  const link = project?.invalid
    ? `The repo's ${project.file} is not valid JSON — fix it or run the mixedlane-init skill.`
    : project?.project
      ? `This repository is linked to Mixedlane project **${project.project}**${project.organization ? ` (org ${project.organization})` : ""}. Plan and track its work there.`
      : "This repository isn't linked to a Mixedlane project yet (no .mixedlane.json). When you need one, use the mixedlane-init skill.";

  if (event === "session-start") return `## Mixedlane\n${link}\n\n${rules()}`;
  if (event === "prompt") {
    const prompt = String(input.prompt ?? input.user_prompt ?? "");
    if (!PLANNING.test(prompt)) return "";
    return `Mixedlane: if this results in a plan or new requirements, record it with the mixedlane-planning skill (create_plan) per your planning mode${project?.project ? ` in project ${project.project}` : ""}, and track progress with start_work / complete_work.`;
  }
  if (event === "plan-approved") {
    return `Mixedlane: the plan was just approved. Before (or as the first step of) implementing it, record it in Mixedlane with the mixedlane-planning skill — create_plan with epic → stories → tasks${project?.project ? ` in project ${project.project}` : ""}, following your planning mode — then start_work on the first task.`;
  }
  return "";
}

try {
  if (event) {
    const input = await readStdin();
    const text = contextFor(input);
    if (text) {
      const out =
        format === "copilot"
          ? { additionalContext: text }
          : { hookSpecificOutput: { hookEventName: EVENTS[event], additionalContext: text } };
      process.stdout.write(JSON.stringify(out));
    }
  }
} catch {
  /* never break the host agent */
}
process.exit(0);
