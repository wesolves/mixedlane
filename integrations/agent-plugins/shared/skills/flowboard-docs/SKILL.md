---
name: flowboard-docs
description: Write specs, designs, ADRs, runbooks and meeting notes into Flowboard docs and link them to work items. Use when producing a document longer than a few paragraphs (PRD, tech spec, design, decision record) that the team should keep.
---

# Write docs in Flowboard

1. `list_spaces` to find the right space (a project space for project-specific docs, otherwise an org-wide one).
   Pick the parent page from the returned page tree so the doc lands in the right place.
2. `search_docs` first — update an existing page (`get_page` → `update_page` with its `version`) instead of
   creating a near-duplicate.
3. `create_page` with Markdown content. Mention the related item keys (e.g. `APP-0012`) in the text: Flowboard
   links the page and the items both ways.
4. If `update_page` reports a conflict, someone saved in between: `get_page` again, merge, and retry.
5. Reply with the page link.

Good structure for a spec: Summary · Background · Proposed design · Alternatives · Rollout · Open questions.
