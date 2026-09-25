---
name: mixedlane-planning
description: Record plans and requirements as Mixedlane work items (epic → milestone → user story → task → subtask). Use whenever you create an implementation plan, break down a feature, bug list, spec or requirements, or the user asks to plan, scope or build something non-trivial.
---

# Plan work in Mixedlane

Turn the plan you just made — or the requirements you were given — into a clean Mixedlane breakdown that the
team can see on the board. Use the `mixedlane` MCP tools.

## 1. Find the project
- If the repo has a `.mixedlane.json`, use its `project` key.
- Otherwise call `list_projects`. If there is exactly one sensible project, use it; if it's unclear, ask the user
  which one (and offer to link the repo with the `mixedlane-init` skill).
- **New initiative with no fitting project?** Create it with `create_project` (a short 2–5 letter key like `MKA`,
  enable only the levels it needs, e.g. `["epic","story","task"]`). If the tool says you aren't allowed, tell the
  user the exact setting it names (Settings → AI agents → your agent → "Can create projects") instead of stopping
  silently — and offer to plan into an existing project meanwhile.
- Call `get_project` to learn the **enabled item types** and **statuses**. Only use enabled types.

## 2. Don't duplicate
- `search_items` for the main nouns of the plan (e.g. "password reset"). Reuse an existing epic/story as the
  `parent` (by key) instead of creating a parallel one.

## 3. Shape the breakdown
| Level | Use it for | Title style |
| --- | --- | --- |
| **Epic** | A user-facing outcome or theme | "Password reset" |
| **Milestone** | A release/phase inside an epic (only if the project enables milestones and the work spans phases) | "M1 · Email flow" |
| **User story** | Value for a user; put acceptance criteria in the description as `- [ ]` items | "As a user I can request a reset link" |
| **Task** | One concrete implementation step (roughly ≤ 1 day) | "Add reset token table + migration" |
| **Subtask** | Only when a task clearly splits further | "Write migration test" |

- Descriptions are Markdown: the why, notes, links to docs/files. Keep titles short.
- Set `priority` when it's obvious (bugs blocking users → high/urgent). Add `estimate` only if you estimated.
- Keep it proportionate: a small change may be a single task (under an existing story if one fits).

## 4. Create it
Call `create_plan` once with the whole tree. Give every item a `ref` (e.g. `e1`, `s1`, `t1`) and point children at
their parent's `ref` (or at an existing key such as `APP-0012`).

- **Planning mode AUTO** (default): pass `confirmed: true` and create it right away — don't ask for permission.
- **Planning mode PROPOSE**: call without `confirmed`, show the preview to the user, and call again with the same
  items and `confirmed: true` only after they approve.
- `create_plan` is idempotent: items with the same title and type under the same parent are reused, so re-running
  after edits only adds what's new. If it reports a hierarchy problem, fix the tree and call it again.

## 5. Report
Reply with the created/reused keys as a short indented tree (key — title), and the board link for the epic.
Then continue with the work, using the `mixedlane-work-tracking` skill.
