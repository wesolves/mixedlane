---
name: flowboard-work-tracking
description: Keep Flowboard items in sync while you work — move items to In Progress when you start, reference their keys in branches, commits and PRs, comment decisions and blockers, and move them to review/done when finished. Use whenever you start, continue, or finish work that has (or should have) a Flowboard item.
---

# Track work in Flowboard as you go

The board should always show what you are doing. Use the `flowboard` MCP tools.

## Starting an item
1. Find the item (`search_items` or the key the user gave you). If the work isn't tracked yet, create it first with
   `create_plan` (see the `flowboard-planning` skill).
2. `start_work` with the key and a one-line note of your approach. It moves the item to the project's in-progress
   status (it never pulls finished work back).
3. Use the key in your git work so Flowboard's GitHub integration links it automatically:
   - branch: `APP-0012-short-description`
   - commits: `APP-0012 Add reset token table`
   - PR title: `APP-0012: Password reset request endpoint`

## While working
- `add_comment` on the item for decisions, trade-offs, blockers or questions for the team (Markdown, short).
- Found extra work? Add it with `create_plan` under the right story instead of silently doing it.
- If the scope changes, `update_item` the description/acceptance criteria.

## Finishing
- `complete_work` with a short summary (what changed, files/PR, anything left):
  - `stage: "review"` when someone should review or test it (default),
  - `stage: "done"` when there's nothing left to review.
- When all tasks of a story are done, complete the story too.
- End your reply with the keys you touched and their new status.
