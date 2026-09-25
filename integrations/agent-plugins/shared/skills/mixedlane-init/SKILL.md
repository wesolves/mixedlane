---
name: mixedlane-init
description: Link the current repository to a Mixedlane project by writing a .mixedlane.json file. Use when the user asks to connect/link/init Mixedlane for this repo, or when planning needs a project and the repo has no .mixedlane.json yet.
---

# Link this repository to a Mixedlane project

1. Call `whoami` (organization, planning mode) and `list_projects`.
2. Ask the user which project this repository belongs to (list the keys and names). If there's only one project,
   confirm it instead of asking open-endedly.
3. Write `.mixedlane.json` at the repository root:

   ```json
   {
     "server": "{{MIXEDLANE_URL}}",
     "organization": "<organization slug from whoami>",
     "project": "<PROJECT KEY>"
   }
   ```

4. Suggest committing it so everyone's agents (Claude Code, Codex, Copilot, opencode, Pi) use the same project.
5. Confirm in one line: "This repo now tracks work in Mixedlane project <KEY>."
