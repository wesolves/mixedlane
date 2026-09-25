# Mixedlane

A simpler, friendlier Jira-style tracker.

**Project → Epic → Milestone → User Story → Task → Subtask**, with a Kanban board, a tree list, rich-text descriptions and comments, and an activity history.

It also has:
- Confluence-style docs.
- Realtime collaboration (live updates, presence, an inbox).
- GitHub automation.
- **AI agents** that connect over MCP with their own API keys and permissions.

## Stack

| Part | Tech |
| --- | --- |
| Web (`apps/web`) | React 19, Vite, Tailwind v4, shadcn/ui (Radix), lucide-react, react-icons, TanStack Query, React Router, dnd-kit, Tiptap |
| Server (`apps/server`) | NestJS (Express), Drizzle ORM, Postgres — embedded PGlite in dev, real Postgres in prod; DB-backed job queue |
| Shared (`packages/shared`) | Zod schemas, types and hierarchy rules used by both sides |

This is one npm package with a single `node_modules`. The project drive is FAT32, which can't create the symlinks npm workspaces need. `@mixedlane/shared` is resolved through path aliases (`tsconfig` `paths`, Vite `resolve.alias`, and SWC for the server).

How the server runs TypeScript:
- **In development:** directly through SWC (`@swc-node/register`), which emits the decorator metadata NestJS needs.
- **For production:** `npm run build` compiles it the same way into plain JavaScript in `build/`.

## Run it

```bash
npm install
npm run dev          # API on :3001, web on http://localhost:5173 (demo data is seeded into an empty database)
npm run seed:reset   # wipe and reseed the demo org (dev server must be running)
```

**On your network (LAN):** `npm run dev:lan` exposes the web app on every interface; the API always listens on all interfaces (`HOST`, default `0.0.0.0`) and prints its LAN addresses at startup.
- Other devices open `http://<your-ip>:5173` (use `WEB_PORT=5180 npm run dev:lan` if 5173 is taken — the dev server fails rather than silently switching ports).
- MCP clients on other machines use `http://<your-ip>:3001/api/mcp` (or the web port + `/api/mcp`) with an agent key.
- Windows: the network must be **Private** and Node.js allowed through the firewall (Windows asks the first time). In development any browser origin is accepted; in production list extra origins in `CORS_ORIGINS`.

Other scripts:
- `npm run typecheck`
- `npm run test:api`: Vitest against in-memory Postgres. Set `TEST_DATABASE_URL=postgres://…` to run the same suite against a real Postgres; its `public` schema is wiped.
- `npm run build`: web app, then the compiled API.
- `npm start`: run the build.
- `npm run db:generate`: a new migration after editing `apps/server/src/core/database/schema.ts`.

**Database**
- **Dev:** embedded PGlite (real Postgres compiled to WASM) at `~/.mixedlane/pgdata`. Override with `PGLITE_DIR`.
  - It lives in your home folder because PGlite can't store data on FAT32/exFAT drives.
  - PGlite is single-process, so only the dev server may open it. A lock file prevents accidents; use `npm run seed:reset` (an HTTP call) rather than scripts.
- **Prod:** set `DATABASE_URL` to a Postgres connection string.
- **Migrations** live in `apps/server/drizzle` and are applied automatically on start.

**Background jobs** run on the same database (`jobs` table): retries with exponential backoff, dedupe keys, and recurring schedules. GitHub polling, webhook processing and emails all run as jobs.

**API docs (Swagger):** http://localhost:3001/api/docs. Sign in with `POST /api/auth/login`, click **Authorize**, paste the `accessToken`, and set the `X-Org` header (e.g. `demo`).

**Demo accounts (dev):** all use the password `Mixedlane123`.

| Email | Org role | Notes |
| --- | --- | --- |
| alice@mixedlane.dev | Owner | |
| bob@mixedlane.dev | Admin | |
| priya@mixedlane.dev | Member | Mobile team lead |
| sam@mixedlane.dev | Member | Mobile team |
| guest@mixedlane.dev | Guest | Viewer on WEB only |

The demo also has an AI agent, **Triage Bot**, with access to APP. Its API key is written to `apps/server/data/demo-agent.key` on each seed, so you can connect an MCP client right away (see [AI agents & MCP](#ai-agents--mcp)).

## Accounts, organizations & permissions

- **Sign-in**
  - **Tokens:** email and password. A short-lived JWT access token (15 min) is kept in memory only, and a rotating refresh token sits in an httpOnly cookie scoped to `/api/auth`.
  - **Reuse detection:** reusing an already-rotated refresh token revokes the whole session family.
  - **Instant logout:** signing out ends the session immediately.
  - **Email flows:** password reset and email verification work by emailed link. Without `SMTP_URL`, emails are printed to the server console.
- **Organizations → teams → people.** Anyone can create an organization, and org roles control what you can do:
  - **Owner:** everything.
  - **Admin:** manage members, teams, integrations and every project.
  - **Member:** sees org-visible projects and can create projects.
  - **Guest:** only projects they're added to.

  Invite by email or a shareable link. The invite can pre-assign teams, and accepting creates the account.
- **Project access.**
  - Each project is either **Organization** (visible to members at a default role) or **Private**.
  - You can grant roles (Admin, Editor, Commenter, Viewer) to people or whole teams. Someone gets the highest role that applies to them.
  - The UI hides what you can't do, and the server enforces it on every endpoint.
  - Projects you can't see return 404, and every query is scoped to your organization.
- **Uploads:**
  - Files are served only to members of the organization that owns them.
  - A signed httpOnly cookie makes this work for `<img>` and `<video>` tags, which can't send auth headers.

## Pages

All app pages live under your organization, e.g. `/demo/...`.

| URL | Page |
| --- | --- |
| `/login`, `/register`, `/forgot-password`, `/invite/:token` | Auth pages |
| `/demo/projects` | All projects |
| `/demo/projects/new` | Create a project |
| `/demo/projects/APP` | Overview (`/board`, `/list` and `/settings` tabs) |
| `/demo/projects/APP/settings/access` | Who can see and edit the project |
| `/demo/projects/APP/story/APP-0012` | A work item (URL contains its type) |
| `/demo/settings/general`, `/members`, `/teams`, `/integrations` | Organization settings |
| `/demo/docs` | Docs: spaces and full-text search |
| `/demo/docs/ENG` | A space: page tree and recent pages |
| `/demo/docs/ENG/<pageId>` | A page (view, edit, history) |

If the type in an item URL is wrong, it redirects to the correct one.

## Per-project configuration

- **Project code:** 2–5 characters, starting with a letter. It can't be changed later.
- **Item number length:** 4, 5 or 6 digits, set when the project is created. Keys look like `APP-0001`, `WEB-00001` or `AB-000001`.
- **Work item types:** turn on only the levels you need.
  - Presets: Full hierarchy, Agile, Milestones, Simple tasks.
  - An item can sit under any enabled type above it.
  - The top enabled type (and Tasks) can sit directly under the project.
  - Types that have items can't be switched off.
- **Workflow:** an ordered list of statuses. Each has a name, a color and a group (To-do, In progress or Done).
  - The statuses become the board columns.
  - "Done" statuses count toward progress.
  - Renaming a status keeps its items in place.
  - Deleting one moves its items to another status in the same group.
- **Appearance:** any color (color picker or hex code), and any Lucide icon (searchable) or any emoji.

## Editor (descriptions & comments)

- **Markdown shortcuts as you type:**
  - `#`, `##` and `###` for headings
  - `**bold**`, `*italic*`, `~~strike~~` and `` `code` ``
  - `-` and `1.` for lists, `[ ]` for checklists
  - `>` for quotes, ` ```ts ` for code blocks
  - `---` for a divider
- **Pasting Markdown text renders it**, including GFM tables and fenced code with syntax highlighting.
- **Markdown source view:** the **Markdown** toggle in the toolbar lets you edit the raw source.
- **Images and videos:** upload with the toolbar buttons, **paste from the clipboard** (screenshots included) or **drag and drop**. A progress indicator shows while uploading. Click an image to zoom.
  - Allowed images: PNG, JPG, GIF, WebP and AVIF, up to 20 MB. SVG is blocked because it can contain scripts.
  - Allowed videos: MP4, WebM, OGG and MOV, up to 200 MB.
  - Files are stored in `apps/server/data/uploads` (override with `UPLOAD_DIR`) under random names, and served with range support so videos can seek.
- **@mentions:** type `@` to pick an org member. They get a notification if they can read the item or page.
- Content is stored as HTML and always rendered through the editor's schema, so unsafe markup is dropped.

## Realtime & notifications

- **Live updates:** the browser keeps one socket.io connection (`/api/socket`) per org.
  - Changes by teammates, GitHub automations and (soon) AI agents refresh boards, lists, items, comments and docs instantly.
  - Other people's changes also show a short toast, e.g. "Bob Admin moved APP-0006".
- **Rooms and permissions:**
  - On connect, the server checks the access token, the session and org membership.
  - Each socket joins only the rooms for projects and spaces it can read, so hidden projects never leak.
  - Rooms are re-synced when access changes and every 30 seconds. Revoked sessions are disconnected.
  - Events carry only ids and summaries. Clients refetch details through the permission-checked REST API.
- **Presence:** avatars on items and pages show who else is viewing, and who is editing.
- **Inbox** (sidebar): you're notified when:
  - someone assigns you an item
  - you're @mentioned in a description, comment or page
  - someone comments on your item
  - someone else moves your item
  - You never get notified about your own actions, or about things you can't read.
- **Assignees** are org members, picked from a searchable list.

## AI agents & MCP

Agents are first-class members of an organization, with their own identity.

**Managing agents:** in **Settings → AI agents**. This needs org owner or admin.
- Create an agent and copy its API key. The key is shown once and stored only as a SHA-256 hash.
- Add, rotate or revoke keys, optionally with an expiry. You can also disable or delete the agent.

**What an agent can do:**
- **Project access:** an agent sees **only** the projects you switch on. For each project, toggle **Read**, **Create items**, **Edit fields**, **Change status**, **Delete items**, **Comment**, **Read docs** and **Write docs**.
- **Never allowed:** agents can't administer projects, manage members or create projects.
- **Docs:** a separate setting (none, read or write) covers org-wide doc spaces.

**Attribution:** everything an agent does is attributed to it.
- The activity log and comments show a 🤖 avatar and an **AI** badge.
- Teammates get live toasts ("🤖 Triage Bot moved APP-0012"), and assignees get notifications.
- Each agent's settings page shows its recent activity.

**MCP server:** at **`/api/mcp`** (Streamable HTTP, stateless). Authenticate with `Authorization: Bearer ml_…`.

| Tools | |
| --- | --- |
| Work | `whoami`, `list_projects`, `get_project`, `search_items`, `get_item`, `create_item`, `update_item`, `move_item`, `delete_item`, `add_comment`, `list_members` |
| Docs | `list_spaces`, `search_docs`, `get_page`, `create_page`, `update_page` (sends the version it read, so conflicting edits are rejected rather than overwritten) |
| Resources | `mixedlane://items/{key}`, `mixedlane://projects/{key}/board` |

How the tools behave:
- Descriptions, comments and pages are **Markdown** in and out.
- Items are referenced by key (`APP-12` or `APP-0012`), and statuses by name.
- Every tool goes through the same services and permission checks as the REST API.
- A denied action comes back as a readable tool error.

**Agent plugins (recommended).** Settings → AI agents → an agent → Connect → **Install plugin**. Mixedlane serves a plugin for each tool with this server's URL baked in, installed by a one-liner:

```bash
curl -fsSL http://<host>/api/plugins/install.sh | sh -s -- claude-code        # or codex | copilot | opencode | pi
& ([scriptblock]::Create((irm http://<host>/api/plugins/install.ps1))) claude-code   # Windows PowerShell
```

| Plugin | Contents | Install does |
| --- | --- | --- |
| Claude Code | MCP (OAuth), 4 skills, `mixedlane-planner` agent, hooks (`SessionStart`, planning prompts, `PostToolUse` on `ExitPlanMode`), `/mixedlane:plan · sync · start · done · init` | `claude plugin marketplace add` + `claude plugin install mixedlane@mixedlane` |
| Codex | MCP (OAuth), 4 skills, hooks (`SessionStart`, `UserPromptSubmit`) | `codex plugin marketplace add` + `codex plugin add mixedlane@mixedlane` |
| Copilot (CLI + VS Code) | MCP (OAuth), 4 skills, planner agent, `sessionStart` hook | `copilot plugin install` (VS Code reads Copilot CLI's plugins) |
| opencode | MCP (OAuth), 4 skills, planner subagent, plugin (rules in the system prompt, mirrors `todowrite` plans), `/mixedlane-plan` | copies into `~/.config/opencode`, merges `opencode.json` (backup kept) |
| Pi | MCP via `pi-mcp-adapter` (API key in `MIXEDLANE_API_KEY`), 4 skills, extension (rules in the system prompt), `/mixedlane-plan` | `pi install npm:pi-mcp-adapter` + `pi install <dir>` |

Skills: **mixedlane-planning** (plans/requirements → epic → milestone → story (acceptance criteria) → task), **mixedlane-work-tracking** (`start_work` → keys in branches/commits → `complete_work`), **mixedlane-docs**, **mixedlane-init** (writes `.mixedlane.json` so every tool uses the same project). Re-run the installer to update; `--uninstall` / `-Uninstall` removes it. Verified end to end: a plain “make a plan for X” prompt in Claude Code, Codex and opencode created the epic/stories/tasks in the linked project.

**Per-agent settings** (agent page): **Can create projects** (on by default — the agent gets full access to projects it creates) and **When it plans work**: *Create items automatically* (default) or *Propose first* (`create_plan` returns a preview until the user confirms). Denied actions name the exact setting to change.

**Planning tools:** `create_plan` (a whole tree in one call, validated against the project's hierarchy first, idempotent — re-running reuses existing items), `create_project`, `start_work`, `complete_work`; MCP prompts `plan` and `sync`.

**Two ways to connect**
- **Browser sign-in (OAuth 2.1).** Add just the URL; the client discovers Mixedlane's OAuth metadata (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`), registers itself (dynamic client registration) and opens a browser. An org owner/admin signs in, picks the agent to act as — or creates one with access to chosen projects — and clicks **Allow**. The client receives an agent API key named “OAuth · <client>”, revocable from the agent's page like any other key. PKCE (S256) is required and codes are single-use. Verified with opencode and an MCP-SDK client (the flow Copilot CLI / Claude Code use).
- **API key.** Create a key on the agent's page and send `Authorization: Bearer ml_…`.

**Connecting a client.** The agent's settings page (**Connect**) has a ready-to-paste setup for each of these, with your server URL filled in:

| Client | How it connects | Tested here |
| --- | --- | --- |
| **Claude Code** | `claude mcp add --transport http mixedlane <url> --header "Authorization: Bearer ml_…"` | ✅ |
| **Claude Desktop** | `claude_desktop_config.json`, bridged by `npx mcp-remote` | |
| **OpenAI Codex** (CLI / IDE) | `codex mcp add mixedlane --url <url> --bearer-token-env-var MIXEDLANE_API_KEY`, or `[mcp_servers.mixedlane]` in `~/.codex/config.toml` | ✅ called `whoami` and `list_projects` over the LAN |
| **GitHub Copilot** (VS Code agent mode) | `.vscode/mcp.json`: an `http` server with `"Authorization": "Bearer ${input:mixedlane-key}"`; VS Code prompts for the key once | |
| **GitHub Copilot CLI** | `copilot mcp add --transport http --header "Authorization: Bearer ml_…" mixedlane <url>`, or `~/.copilot/mcp-config.json` | |
| **opencode** | `opencode.json` → `mcp.mixedlane` with `"type": "remote"`, `"oauth": false`, and `"Authorization": "Bearer {env:MIXEDLANE_API_KEY}"` | ✅ `opencode mcp list` shows it connected |
| **Pi** | No built-in MCP support. Install `pi install npm:pi-mcp-adapter`, then add `{ "url": "<url>", "auth": "bearer", "bearerToken": "${MIXEDLANE_API_KEY}" }` to `~/.config/mcp/mcp.json` | |
| Anything else | Any streamable-HTTP MCP client that can send an `Authorization` header | |

- `<url>` is `http(s)://<host>/api/mcp`. In development either the API port (`:3001`) or the web port works.
- Where the tool supports it (Codex, opencode, Pi), the setup reads the key from the `MIXEDLANE_API_KEY` env var so it doesn't end up in a config file.
- Clients that send only `Accept: application/json` are accepted too.
- Use one key per machine or tool, so each can be revoked on its own.

Beyond MCP, agents can also use the same API key for:
- **The REST API:** any org-scoped endpoint; the key already names its org.
- **The realtime socket:** `io({ path: "/api/socket", auth: { token: "ml_…" } })` to react to changes live.

## Docs

Confluence-style documentation that lives next to the work.

- **Spaces** hold a tree of pages:
  - **Org-wide space:** members can write, admins manage it, and guests can't see it.
  - **Project space:** follows that project's access (viewers read, editors write, admins manage).
- **Page tree:** drag a page onto another to nest it, or onto its top edge to reorder. Create sub-pages from the tree.
- **Templates:** Blank, Product requirements, Technical spec, Meeting notes, Retrospective.
- **Editing:** the same full-screen editor as items (Markdown, media, tables, @mentions). Ctrl+S saves.
- **Versions:** every save is kept. History shows a word-level diff against the previous version. Restoring saves the old content as a new version.
- **Conflicts:**
  - A save sends the version it started from. If someone saved in between, the API answers **409**.
  - The page then shows both sides and lets you keep editing, discard your changes, or save anyway.
  - While you edit, a banner warns as soon as someone else saves.
- **Item links:** item keys in a page (`APP-12` or `APP-0012`) link it to those items. Each item shows a **Linked pages** panel.
- **Search:** Postgres full-text search, weighting titles above body text, with highlighted snippets.

## GitHub integration

### Setup
1. **Settings → Integrations** (sidebar): paste a GitHub personal access token.
   - Fine-grained tokens need these repository permissions:
     - Read: Metadata, Pull requests, Deployments, Actions
     - Contents: Read, or Read & write to create branches from items
     - Webhooks: Read & write (optional)
   - The token is checked against GitHub, then stored encrypted with AES-256-GCM. The key is in `apps/server/data/secret.key` in dev. Production must set `SECRET_KEY` (64 hex characters).
   - GitHub Enterprise Server works too: set the API URL.
2. **Project → Settings → GitHub**:
   - Link one or more repositories. The first sync imports existing PRs, branches and commits but does not move any items.
   - Set up the automations.

### Linking
Any mention of an item key links that GitHub object to the item:
- branch names
- PR titles and descriptions
- commit messages

Keys are case-insensitive and zero-padding is optional: `app-12` matches `APP-0012`.

### Automations (per project)
- **Status triggers.** Each trigger can move linked items to one of the project's statuses:
  - Branch created
  - Commit pushed
  - PR opened
  - PR merged
  - PR closed without merging
- **Deploy rules.** Each rule moves every item that shipped in a deploy. It fires on one of three sources:
  - A GitHub Deployment succeeding (matched by environment, e.g. `prod*`)
  - An Actions workflow run succeeding on the default branch (matched by workflow name)
  - A release being published (matched by tag, e.g. `v*`; pre-releases are skipped)

  To find the items, Mixedlane compares the deployed commit with the previous successful deploy on the same line. For the very first deploy, it checks which merged PRs are ancestors of the deployed commit.
- **Only move forward** (default on): items never move back to an earlier status.
- **Smart commits:** `APP-0012 #comment Fixed it #done` adds a comment and moves the item. Any status name or id works as a command, e.g. `#in-review`.
- The activity log records every automatic change, e.g. "GitHub · PR #12 merged" or "GitHub · deployed to production".

### Delivery
- **Polling** (default, works on localhost): every linked repo is checked on an interval you set (30 s to 15 min). Use **Sync now** to force a check.
- **Webhooks** (instant): set a public URL, e.g. from `cloudflared tunnel --url http://localhost:3001`. Mixedlane registers the webhook itself when the token allows it; otherwise the page shows the URL and secret for manual setup. Signatures are verified with HMAC SHA-256.
- Both paths feed one processor, which stores the last known state of every PR and deploy. An automation fires only on a real change, so duplicate deliveries, replays and polling overlap are safe.

## Using it

- **C**: create a work item from anywhere. **Ctrl/⌘ K** or **/**: search and commands.
- Project tabs:
  - **Overview**: top-level items and anything due soon.
  - **Board**: Kanban of stories and tasks (or whichever work types the project uses), with drag and drop and filters.
  - **List**: expandable tree of the full hierarchy.
  - **Settings**: everything from the project form.
- Click a card or row to open the quick-view side panel. **Open** takes you to the full page.
- Everything is edited inline: title, description (Ctrl+Enter saves, Esc cancels), status, priority, assignee, labels, dates and estimate.
- Allowed parents, statuses and item numbers are enforced by both the UI and the API (`packages/shared/src/hierarchy.ts`).

## REST API

All routes are under `/api`. Request bodies are validated with the shared Zod schemas. The full interactive reference is at **`/api/docs`** (Swagger).

- **Sessions:** access tokens last 5 minutes and are refreshed in the background; the refresh token renews on every use and expires after the user's **Stay signed in for** setting (Account settings: 30 days – 1 year) of inactivity. Network/server errors never sign you out — the app shows “Reconnecting…” and retries.
- **Auth:** send `Authorization: Bearer <accessToken>` everywhere except the public auth and invite endpoints and the GitHub webhook.
- **Org scope:** org-scoped routes also need `X-Org: <org slug>`.

```
POST   /auth/register | /auth/login | /auth/refresh | /auth/logout | /auth/logout-all
GET    /auth/me                        PATCH /auth/me    POST /auth/change-password
POST   /auth/forgot-password | /auth/reset-password | /auth/verify-email | /auth/resend-verification
GET    /invites/:token                 POST /invites/:token/accept
GET    /orgs                           POST /orgs         (yours / create)
GET    /org                            PATCH/DELETE /org  (current org via X-Org)
GET    /org/members                    PATCH/DELETE /org/members/:userId
GET    /org/teams                      POST /org/teams    PATCH/DELETE /org/teams/:id
POST   /org/teams/:id/members          DELETE /org/teams/:id/members/:userId
GET    /org/invites                    POST /org/invites  DELETE /org/invites/:id
GET    /projects/:key/access           PATCH/POST /projects/:key/access   DELETE /projects/:key/access/:grantId

GET    /projects                      POST /projects
GET    /projects/:idOrKey             PATCH/DELETE /projects/:idOrKey
GET    /projects/:idOrKey/tree        all items with roll-up progress
GET    /projects/:idOrKey/items?type=story,task&status=&parentId=root|<id>&q=
POST   /items                         GET /items/:id   GET /items/by-key/APP-0012
PATCH  /items/:id                     PATCH /items/:id/move {status, sortOrder}
DELETE /items/:id                     (cascades to children)
GET    /items/:id/activity
GET    /items/:id/comments            POST /items/:id/comments
PATCH  /comments/:id                  DELETE /comments/:id
GET    /search?q=

GET    /agents                        POST /agents  (→ agent + one-time key)   GET/PATCH/DELETE /agents/:id
POST   /agents/:id/keys               DELETE /agents/:id/keys/:keyId (revoke)
PUT    /agents/:id/grants {projectId, permissions[]}   GET /agents/:id/activity
POST   /mcp                           MCP endpoint (agent API key)
GET    /plugins                       plugin catalogue with install commands (public)
GET    /plugins/<client>.tar.gz       bundle with this server's URLs · /plugins/install.sh · /plugins/install.ps1
GET    /notifications?unread=true     POST /notifications/:id/read   POST /notifications/read-all
GET    /spaces                        POST /spaces       GET/PATCH/DELETE /spaces/:key
GET    /spaces/:key/pages             POST /spaces/:key/pages   (tree / create)
GET    /pages/:id                     PATCH /pages/:id {title?, contentHtml?, baseVersion} → 409 on conflict
POST   /pages/:id/move {parentId, beforeId?}      DELETE /pages/:id (cascades to sub-pages)
GET    /pages/:id/versions            GET /pages/:id/versions/:v   POST /pages/:id/versions/:v/restore
GET    /docs/search?q=                GET /items/:id/pages

GET/PUT/PATCH/DELETE /github/connection      POST /github/webhook (signed)
GET    /github/repos?q=
GET    /projects/:key/github                 POST /projects/:key/github/repos
DELETE /projects/:key/github/repos/:repoId   POST /projects/:key/github/repos/:repoId/webhook
POST   /projects/:key/github/sync            PUT  /projects/:key/github/automation
GET    /items/:id/development                POST /items/:id/github/branch
POST   /uploads (multipart "file")           GET  /uploads/:name (supports Range)
```

Every change is attributed to the signed-in user (or to GitHub, for automations) in the activity log.

**Realtime socket:** `io({ path: "/api/socket", auth: { token, org } })`.
- Server → client: `live` (a `LiveEvent`: item, comment, project, space, page or notification) and `presence` (`{ resource, users }`).
- Client → server: `presence:join` (`{ resource: "item:<id>" | "page:<id>", mode }`) and `presence:leave`.

## Production

`docker-compose.yml` runs the full stack. Only the web container is published; everything is served from one origin.

| Service | Image target | What it does |
| --- | --- | --- |
| `web` | `Dockerfile --target web` (nginx, non-root) | Serves the built UI and reverse-proxies `/api` (REST, uploads), `/api/socket` (WebSocket), `/api/mcp` (MCP, streamed) and `/.well-known` (OAuth discovery). Strict CSP (`script-src 'self'`), security headers, long-cache hashed assets, `index.html` never cached. |
| `api` | `Dockerfile --target api` (Node, non-root, tini) | REST API, **MCP server**, realtime socket, job worker, agent plugins. Runs migrations on start. Internal only. |
| `db` | `postgres:17-alpine` | Data (volume `pgdata`). Internal only. |
| `minio` *(optional)* | `quay.io/minio/minio` | S3-compatible uploads (`--profile s3`). |

```bash
cp .env.example .env            # set POSTGRES_PASSWORD and APP_URL (the public URL)
docker compose up -d --build    # → http://<host>:${HOST_PORT:-3000}
# with S3-compatible uploads on a bundled MinIO:
docker compose --profile s3 up -d --build
```

- **HTTPS:** put any TLS proxy (Caddy, Traefik, a cloud load balancer) in front of `web`, set `APP_URL=https://…` (turns on Secure cookies + HSTS) and `TRUST_PROXY=2`. nginx passes the proxy's `X-Forwarded-Proto` through.
- **Single container instead:** `docker build -t mixedlane .` builds the default `app` target — the api also serving the UI (`WEB_DIST`) — and needs only `DATABASE_URL` plus the secrets.
- **Verified:** the compose stack was built and smoke-tested through nginx only: health, SPA deep links, strict CSP (no violations in the browser), register/refresh cookie, uploads, WebSocket realtime, OAuth discovery and plugin installers on the public URL, and an agent creating a project and a plan over MCP with the team seeing it live.

**Build and startup**
- **Images:** one multi-stage `Dockerfile` builds the web app (Vite) and compiles the API (SWC), producing the `api`, `web` and `app` targets.
- **Runtime:** production dependencies only, running as the non-root `node` user under `tini`, with a health check.
- **Migrations:** run automatically on start.

**Required configuration**
- `DATABASE_URL`, plus `JWT_SECRET` and `SECRET_KEY` (64 hex characters).
- The Docker images set `SECRETS_DIR=/data/secrets`: when the two secrets are left empty, they are generated on first start and kept on the `/data` volume (back it up, or set them in `.env`).
- Outside Docker, the server refuses to start in production without them unless `SECRETS_DIR` is set.

**Uploads**
- `STORAGE_DRIVER=local`: a volume at `/data`.
- `STORAGE_DRIVER=s3`: any S3-compatible bucket (AWS, MinIO, R2, Spaces) via `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE`. Credentials come from the keys or the default AWS chain.
- Files stay private and are streamed through the API, with range support.

**Security**
- A strict Content-Security-Policy on the web app: scripts come only from the app itself, plus a hashed inline theme snippet.
- `frame-ancestors 'none'`, `nosniff`, and the other `helmet` defaults.
- HSTS and `Secure` cookies are turned on automatically when `APP_URL` is `https://`.

**Rate limits**
- `API_RATE_LIMIT` requests per minute per client (agent key or IP) across the API.
- Stricter per-IP limits on login, registration and password reset (`AUTH_RATE_LIMIT`).
- Limits are kept in memory per instance.

**Behind a reverse proxy**
- Set `TRUST_PROXY` (e.g. `1`) so client IPs are correct.
- Forward WebSocket upgrades for `/api/socket`.

**Health check:** `GET /api/health` checks the database too.

**Graceful shutdown:** on SIGTERM, sockets, the job worker and the DB pool close cleanly.

**Excluded in production:** the dev-only demo seeding and reset endpoint.

**Scaling beyond one instance:** later work will add the socket.io Redis adapter, a shared rate limiter, and BullMQ in place of the DB job queue. The job queue already works across instances (`FOR UPDATE SKIP LOCKED`).

**Verified:**
- The full test suite passes against PGlite and against Postgres 17.
- A smoke test against the compose stack passed: health, SPA and CSP, registration, docs search, S3 upload and range reads, an agent over MCP, and live socket delivery.

## Roadmap

- ~~Phase 3 — Realtime~~ ✅ live updates, presence, notifications inbox
- ~~Phase 4 — Docs~~ ✅ spaces, page tree, templates, versions, conflicts, item links, search
- ~~Phase 5 — AI agents~~ ✅ agent identities, API keys, per-project toggles, MCP server
- ~~Phase 6 — Production~~ ✅ Docker + Postgres, S3 storage, CSP/rate limits/health, compiled build
- Next ideas: OAuth sign-in, the Redis adapter for multi-instance realtime, BullMQ, and webhooks out to other tools.
