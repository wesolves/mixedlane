import { Injectable } from "@nestjs/common";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  ITEM_TYPES,
  PRIORITIES,
  STATUS_PRESETS,
  TYPE_LABELS,
  type ItemType,
  type ItemUpdate,
  type ProjectPermission,
  type StatusDef,
  type WorkItemSummary,
} from "@mixedlane/shared";
import { config } from "../../core/config";
import type { RequestContext } from "../../core/context";
import { AppError } from "../../core/http";
import { htmlToMarkdown, markdownToHtml } from "../../core/markdown";
import { AccessService } from "../access/access.service";
import { DocsService } from "../docs/docs.service";
import { OrgsService } from "../orgs/orgs.service";
import { CommentsService } from "../work/comments.service";
import { ItemsService } from "../work/items.service";
import { ProjectsService, isUuid, type ProjectRow } from "../work/projects.service";
import { PlanningService } from "./planning.service";

const INSTRUCTIONS = `Mixedlane is a project tracker (projects → epics → milestones → stories → tasks → subtasks) with Kanban boards and Confluence-style docs.

- Work items are referenced by key, e.g. "APP-0012" (zero padding optional: "APP-12").
- Statuses are per project: call list_projects (or get_project) first to learn each project's statuses and enabled item types.
- Descriptions, comments and pages are Markdown in and out.
- You only see projects you were granted, and each tool enforces your permissions (read, create, edit, change status, comment, delete, docs).
- Everything you do is attributed to you and shown to the team live.`;

type Json = Record<string, unknown> | unknown[];

const ok = (data: Json | string): CallToolResult => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});
const fail = (message: string): CallToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/** Runs a tool body, turning domain errors into MCP tool errors the model can read and recover from. */
async function run(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) return fail(`${err.message} (HTTP ${err.status})`);
    if (err instanceof z.ZodError) return fail(err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    throw err;
  }
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

/**
 * Builds a per-request MCP server bound to an agent's RequestContext. Every tool goes through the
 * same services and permission checks as the REST API, so agents can never do more than the
 * toggles allow, and their changes flow into activity, notifications and realtime like anyone's.
 */
@Injectable()
export class McpService {
  constructor(
    private readonly access: AccessService,
    private readonly projects: ProjectsService,
    private readonly items: ItemsService,
    private readonly comments: CommentsService,
    private readonly docs: DocsService,
    private readonly orgs: OrgsService,
    private readonly planning: PlanningService,
  ) {}

  /* ---------- Helpers ---------- */

  private appUrl(ctx: RequestContext, path: string) {
    return `${config().APP_URL}/${ctx.orgSlug}${path}`;
  }

  private statusOf(project: ProjectRow, ref: string): StatusDef {
    const needle = ref.trim().toLowerCase();
    const s = project.statuses.find((x) => x.id === needle || x.name.toLowerCase() === needle);
    if (!s) throw new AppError(400, `Unknown status "${ref}" in ${project.key}. Valid: ${project.statuses.map((x) => `"${x.name}"`).join(", ")}`);
    return s;
  }

  /** "APP-12", "app-0012" or an id → the item (checked for `permission`). */
  private async item(ctx: RequestContext, ref: string, permission: ProjectPermission = "project.read") {
    let id = ref.trim();
    if (!isUuid(id)) {
      const m = /^([A-Za-z][A-Za-z0-9]{1,4})-(\d{1,6})$/.exec(id);
      if (!m) throw new AppError(400, `"${ref}" is not a work item key (expected e.g. APP-0012)`);
      const { project } = await this.access.project(ctx, m[1], "project.read").catch(() => {
        throw new AppError(404, `No work item with key ${ref.toUpperCase()}`);
      });
      id = await this.items.idByKey(ctx.orgId, `${project.key}-${m[2].padStart(project.keyDigits, "0")}`);
    }
    const { project, access } = await this.access.item(ctx, id, permission);
    return { item: await this.items.get(ctx.orgId, id), project, access };
  }

  private async assignee(ctx: RequestContext, ref: string | null | undefined) {
    if (ref === undefined) return undefined;
    if (ref === null || ref.trim() === "") return null;
    const needle = ref.trim().toLowerCase();
    const members = await this.orgs.members(ctx.orgId);
    const matches = members.filter((m) => m.email === needle || m.name.toLowerCase() === needle);
    if (matches.length === 1) return matches[0].userId;
    if (!matches.length) throw new AppError(400, `No member matches "${ref}". Use list_members to see who can be assigned.`);
    throw new AppError(400, `"${ref}" matches several members — use their email instead`);
  }

  private summary(project: ProjectRow, i: Pick<WorkItemSummary, "key" | "type" | "title" | "status" | "priority" | "assignee" | "parentId"> & { id: string }, keys?: Map<string, string>) {
    return {
      key: i.key,
      type: i.type,
      title: i.title,
      status: project.statuses.find((s) => s.id === i.status)?.name ?? i.status,
      priority: i.priority,
      assignee: i.assignee ?? null,
      parent: i.parentId ? (keys?.get(i.parentId) ?? i.parentId) : null,
    };
  }

  private projectInfo(p: ProjectRow, permissions: ProjectPermission[]) {
    return {
      key: p.key,
      name: p.name,
      description: p.description,
      itemTypes: p.itemTypes,
      statuses: p.statuses.map((s) => ({ id: s.id, name: s.name, category: s.category })),
      yourPermissions: permissions,
    };
  }

  private async itemDetail(ctx: RequestContext, ref: string) {
    const { item, project } = await this.item(ctx, ref);
    const detail = await this.items.detail(ctx.orgId, item.id);
    const [comments, pages] = await Promise.all([this.comments.list(ctx.orgId, item.id), this.docs.pagesForItem(ctx, item.id)]);
    const statusName = (id: string) => project.statuses.find((s) => s.id === id)?.name ?? id;
    return {
      key: detail.key,
      type: detail.type,
      title: detail.title,
      status: statusName(detail.status),
      priority: detail.priority,
      assignee: detail.assignee ?? null,
      labels: detail.labels,
      startDate: detail.startDate,
      dueDate: detail.dueDate,
      estimate: detail.estimate,
      project: project.key,
      ancestors: detail.ancestors.map((a) => `${a.key} ${a.title}`),
      progress: detail.progress,
      description: htmlToMarkdown(detail.description),
      children: detail.children.map((c) => ({ key: c.key, type: c.type, title: c.title, status: statusName(c.status) })),
      comments: comments.slice(-20).map((c) => ({ author: c.author, authorType: c.authorType, at: c.createdAt, body: htmlToMarkdown(c.body) })),
      linkedPages: pages.map((p) => ({ id: p.id, title: p.title, space: p.spaceKey })),
      url: this.appUrl(ctx, `/projects/${project.key}/${detail.type}/${detail.key}`),
      updatedAt: detail.updatedAt,
    };
  }

  /* ---------- Server ---------- */

  build(ctx: RequestContext): McpServer {
    const server = new McpServer({ name: "mixedlane", title: "Mixedlane", version: "1.0.0" }, { instructions: INSTRUCTIONS + this.planning.instructions(ctx) });

    server.registerTool(
      "whoami",
      { title: "Who am I", description: "Your agent identity, organization and the projects you can access.", annotations: READ_ONLY },
      () =>
        run(async () => {
          const readable = await this.access.readableProjectIds(ctx);
          return ok({
            agent: ctx.actor.name,
            organization: ctx.orgSlug,
            projectCount: readable.length,
            docsAccess: ctx.agent?.docAccess ?? null,
            planningMode: ctx.agent?.planningMode ?? "auto",
            canCreateProjects: ctx.agent?.canCreateProjects ?? false,
          });
        }),
    );

    server.registerTool(
      "list_projects",
      {
        title: "List projects",
        description: "Projects you can access, with their item types, workflow statuses and your permissions in each.",
        annotations: READ_ONLY,
      },
      () =>
        run(async () => {
          const all = (await this.projects.list(ctx.orgId)) as unknown as (ProjectRow & { stats: unknown })[];
          const access = await this.access.resolveMany(ctx, all);
          return ok(
            all
              .filter((p) => access.get(p.id))
              .map((p) => ({ ...this.projectInfo(p, access.get(p.id)!.permissions), stats: p.stats, url: this.appUrl(ctx, `/projects/${p.key}`) })),
          );
        }),
    );

    server.registerTool(
      "get_project",
      {
        title: "Get project",
        description: "One project's configuration and its top-level items.",
        inputSchema: { project: z.string().describe("Project key, e.g. APP") },
        annotations: READ_ONLY,
      },
      ({ project }) =>
        run(async () => {
          const { project: p, access } = await this.access.project(ctx, project, "project.read");
          const items = [...(await this.items.summarize(ctx.orgId, p.id)).values()];
          const byStatus = Object.fromEntries(p.statuses.map((s) => [s.name, items.filter((i) => i.status === s.id).length]));
          return ok({
            ...this.projectInfo(p, access.permissions),
            itemsByStatus: byStatus,
            topLevel: items.filter((i) => !i.parentId).map((i) => this.summary(p, i)),
            url: this.appUrl(ctx, `/projects/${p.key}`),
          });
        }),
    );

    server.registerTool(
      "create_project",
      {
        title: "Create project",
        description:
          "Create a new Mixedlane project when the work doesn't belong to an existing one (check list_projects first). You get full access to projects you create. Only works if an org admin allowed this agent to create projects.",
        inputSchema: {
          name: z.string().min(1).max(120),
          key: z.string().regex(/^[A-Za-z][A-Za-z0-9]{1,4}$/).describe("2-5 letters/digits, starting with a letter, e.g. MKA. Becomes the item key prefix (MKA-0001)"),
          description: z.string().max(5000).optional().describe("What the project is about (plain text)"),
          itemTypes: z
            .array(z.enum(ITEM_TYPES))
            .min(1)
            .optional()
            .describe("Enabled levels; default all (epic, milestone, story, task, subtask). E.g. [\"epic\",\"story\",\"task\"]"),
          workflow: z.enum(STATUS_PRESETS.map((p) => p.name) as [string, ...string[]]).optional().describe("Status preset; default is the standard workflow"),
        },
        annotations: WRITE,
      },
      (args) =>
        run(async () => {
          const project = await this.projects.createFor(ctx, {
            name: args.name,
            key: args.key.toUpperCase(),
            description: args.description ?? "",
            ...(args.itemTypes ? { itemTypes: args.itemTypes } : {}),
            ...(args.workflow ? { statuses: STATUS_PRESETS.find((p) => p.name === args.workflow)!.statuses } : {}),
          });
          const access = await this.access.resolve(ctx, project);
          return ok({ created: project.key, ...this.projectInfo(project, access?.permissions ?? []), url: this.appUrl(ctx, `/projects/${project.key}`) });
        }),
    );

    server.registerTool(
      "search_items",
      {
        title: "Search work items",
        description:
          "Find work items. With `project`, filters that project's items (by text, status, type, assignee); without it, searches titles and keys across all your projects.",
        inputSchema: {
          query: z.string().optional().describe("Text to match in the title or key"),
          project: z.string().optional().describe("Project key"),
          status: z.string().optional().describe("Status name or id (requires project)"),
          type: z.enum(ITEM_TYPES).optional(),
          assignee: z.string().optional().describe("Assignee name or email (requires project)"),
          limit: z.number().int().min(1).max(200).default(50),
        },
        annotations: READ_ONLY,
      },
      (args) =>
        run(async () => {
          if (!args.project) {
            if (!args.query) throw new AppError(400, "Give a query, or a project to list its items");
            const readable = await this.access.readableProjectIds(ctx);
            const hits = await this.items.search(ctx.orgId, args.query, readable, args.limit);
            return ok(hits.filter((h) => !args.type || h.type === args.type).map((h) => ({ key: h.key, type: h.type, title: h.title, status: h.status, project: h.projectKey })));
          }
          const { project } = await this.access.project(ctx, args.project, "project.read");
          const all = await this.items.list(ctx.orgId, project.id, {
            q: args.query,
            type: args.type ? [args.type] : undefined,
            status: args.status ? [this.statusOf(project, args.status).id] : undefined,
          });
          const who = args.assignee?.trim().toLowerCase();
          const keys = new Map(all.map((i) => [i.id, i.key]));
          const rows = all.filter((i) => !who || i.assignee?.toLowerCase() === who || i.assignee?.toLowerCase().includes(who));
          return ok({ total: rows.length, items: rows.slice(0, args.limit).map((i) => this.summary(project, i, keys)) });
        }),
    );

    server.registerTool(
      "get_item",
      {
        title: "Get work item",
        description: "Everything about one item: fields, Markdown description, parents, children, recent comments and linked doc pages.",
        inputSchema: { key: z.string().describe("Item key, e.g. APP-0012") },
        annotations: READ_ONLY,
      },
      ({ key }) => run(async () => ok(await this.itemDetail(ctx, key))),
    );

    server.registerTool(
      "create_item",
      {
        title: "Create work item",
        description: "Create a work item. The type must be enabled in the project and allowed under the parent (e.g. a task under a story).",
        inputSchema: {
          project: z.string().describe("Project key"),
          type: z.enum(ITEM_TYPES),
          title: z.string().min(1).max(300),
          description: z.string().max(100_000).optional().describe("Markdown"),
          parent: z.string().optional().describe("Parent item key"),
          status: z.string().optional().describe("Status name or id (defaults to the first status)"),
          priority: z.enum(PRIORITIES).optional(),
          assignee: z.string().optional().describe("Member name or email"),
          labels: z.array(z.string().max(40)).max(20).optional(),
          dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD"),
          estimate: z.number().min(0).max(1000).optional(),
        },
        annotations: WRITE,
      },
      (args) =>
        run(async () => {
          const { project } = await this.access.project(ctx, args.project, "item.create");
          const parent = args.parent ? (await this.item(ctx, args.parent)).item : null;
          const created = await this.items.create(
            ctx.orgId,
            {
              projectId: project.id,
              parentId: parent?.id ?? null,
              type: args.type,
              title: args.title,
              description: markdownToHtml(args.description ?? ""),
              status: args.status ? this.statusOf(project, args.status).id : undefined,
              priority: args.priority ?? "medium",
              assigneeId: await this.assignee(ctx, args.assignee),
              labels: args.labels ?? [],
              dueDate: args.dueDate ?? null,
              estimate: args.estimate ?? null,
            },
            ctx.actor,
          );
          return ok({ created: created.key, ...(await this.itemDetail(ctx, created.id)) });
        }),
    );

    server.registerTool(
      "update_item",
      {
        title: "Update work item",
        description: "Change fields of a work item. Only the fields you pass change. Use move_item to change status.",
        inputSchema: {
          key: z.string(),
          title: z.string().min(1).max(300).optional(),
          description: z.string().max(100_000).optional().describe("Markdown; replaces the whole description"),
          priority: z.enum(PRIORITIES).optional(),
          assignee: z.string().nullable().optional().describe("Member name or email; null to unassign"),
          labels: z.array(z.string().max(40)).max(20).optional(),
          startDate: z.string().nullable().optional().describe("YYYY-MM-DD or null"),
          dueDate: z.string().nullable().optional().describe("YYYY-MM-DD or null"),
          estimate: z.number().min(0).max(1000).nullable().optional(),
          parent: z.string().nullable().optional().describe("New parent item key, or null for top level"),
        },
        annotations: WRITE,
      },
      (args) =>
        run(async () => {
          const { item } = await this.item(ctx, args.key, "item.update");
          const patch: ItemUpdate = {};
          if (args.title !== undefined) patch.title = args.title;
          if (args.description !== undefined) patch.description = markdownToHtml(args.description);
          if (args.priority !== undefined) patch.priority = args.priority;
          if (args.labels !== undefined) patch.labels = args.labels;
          if (args.startDate !== undefined) patch.startDate = args.startDate;
          if (args.dueDate !== undefined) patch.dueDate = args.dueDate;
          if (args.estimate !== undefined) patch.estimate = args.estimate;
          if (args.assignee !== undefined) patch.assigneeId = await this.assignee(ctx, args.assignee);
          if (args.parent !== undefined) patch.parentId = args.parent === null ? null : (await this.item(ctx, args.parent)).item.id;
          if (!Object.keys(patch).length) throw new AppError(400, "Nothing to update — pass at least one field");
          await this.items.update(ctx.orgId, item.id, patch, ctx.actor);
          return ok(await this.itemDetail(ctx, item.id));
        }),
    );

    server.registerTool(
      "move_item",
      {
        title: "Change status",
        description: "Move a work item to another status of its project's workflow (by status name or id).",
        inputSchema: { key: z.string(), status: z.string().describe('e.g. "In Progress" or "done"') },
        annotations: WRITE,
      },
      ({ key, status }) =>
        run(async () => {
          const { item, project } = await this.item(ctx, key, "item.move");
          const target = this.statusOf(project, status);
          const siblings = [...(await this.items.summarize(ctx.orgId, project.id)).values()].filter((i) => i.status === target.id);
          const sortOrder = Math.max(0, ...siblings.map((i) => i.sortOrder)) + 1000;
          await this.items.move(ctx.orgId, item.id, { status: target.id, sortOrder }, ctx.actor);
          return ok({ key: item.key, from: project.statuses.find((s) => s.id === item.status)?.name ?? item.status, to: target.name });
        }),
    );

    /* ----- Planning & work lifecycle ----- */

    const planItem = z.object({
      ref: z.string().min(1).max(40).describe('Your local id for this item, e.g. "e1", "s1", "t1"'),
      parent: z.string().max(40).nullable().optional().describe("A ref from this plan, an existing item key (e.g. APP-0012), or null for the top level"),
      type: z.enum(ITEM_TYPES),
      title: z.string().min(1).max(300),
      description: z.string().max(20_000).optional().describe("Markdown. For stories put acceptance criteria as a `- [ ]` checklist"),
      priority: z.enum(PRIORITIES).optional(),
      labels: z.array(z.string().max(40)).max(10).optional(),
      estimate: z.number().min(0).max(1000).optional(),
    });

    server.registerTool(
      "create_plan",
      {
        title: "Record a plan as work items",
        description:
          "Create a whole breakdown (epic → milestone → story → task → subtask) in one call. Items reference their parent by `ref` (or an existing key). The tree is validated against the project's hierarchy before anything is created, and items that already exist (same title and type under the same parent) are reused, so calling it again never duplicates. In PROPOSE planning mode, calls without confirmed: true only return a preview.",
        inputSchema: {
          project: z.string().describe("Project key, e.g. APP"),
          items: z.array(planItem).min(1).max(100),
          confirmed: z.boolean().optional().describe("PROPOSE mode: set true once the user approved the preview"),
        },
        annotations: WRITE,
      },
      (args) => run(async () => ok(await this.planning.createPlan(ctx, args))),
    );

    server.registerTool(
      "start_work",
      {
        title: "Start working on an item",
        description: "Move an item to the project's first in-progress status (never pulls a finished item back) and optionally comment what you're about to do.",
        inputSchema: { key: z.string(), note: z.string().max(20_000).optional().describe("Markdown comment, e.g. your approach") },
        annotations: WRITE,
      },
      ({ key, note }) => run(async () => ok(await this.planning.moveToStage(ctx, await this.item(ctx, key), "start", note))),
    );

    server.registerTool(
      "complete_work",
      {
        title: "Finish work on an item",
        description: 'Move an item to review ("review": a status named like Review, else the last in-progress one) or to done, with a summary comment of what changed.',
        inputSchema: {
          key: z.string(),
          summary: z.string().min(1).max(20_000).describe("Markdown: what you did, files/PRs, anything left"),
          stage: z.enum(["review", "done"]).default("review"),
        },
        annotations: WRITE,
      },
      ({ key, summary, stage }) => run(async () => ok(await this.planning.moveToStage(ctx, await this.item(ctx, key), stage, summary))),
    );

    server.registerPrompt(
      "plan",
      {
        title: "Plan in Mixedlane",
        description: "Break requirements down into Mixedlane epics, stories and tasks",
        argsSchema: { requirements: z.string().optional().describe("What to plan (leave empty to use the current conversation)") },
      },
      ({ requirements }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Plan the following work and record it in Mixedlane, following the Mixedlane planning workflow in your instructions.",
                "1. Find the project (.mixedlane.json in the repo, or list_projects) and check its enabled item types and statuses with get_project.",
                "2. search_items to find anything that already exists.",
                "3. Break it down: epic → (milestone) → user stories with acceptance criteria → implementation tasks.",
                "4. Call create_plan, then list the item keys.",
                "",
                requirements?.trim() ? `Requirements:\n${requirements.trim()}` : "Use the requirements and plan from our conversation so far.",
              ].join("\n"),
            },
          },
        ],
      }),
    );

    server.registerPrompt(
      "sync",
      { title: "Sync work to Mixedlane", description: "Update Mixedlane with what was done in this session" },
      () => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Bring Mixedlane up to date with this session: start_work / complete_work the items you worked on, add_comment with decisions or blockers, and use create_plan for any work that isn't tracked yet. Finish with a short list of the keys you touched and their status.",
            },
          },
        ],
      }),
    );

    server.registerTool(
      "delete_item",
      {
        title: "Delete work item",
        description: "Permanently delete a work item and everything under it. Requires the delete permission.",
        inputSchema: { key: z.string() },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      ({ key }) =>
        run(async () => {
          const { item } = await this.item(ctx, key, "item.delete");
          await this.items.remove(ctx.orgId, item.id, ctx.actor);
          return ok({ deleted: item.key });
        }),
    );

    server.registerTool(
      "add_comment",
      {
        title: "Comment on an item",
        description: "Post a Markdown comment on a work item.",
        inputSchema: { key: z.string(), body: z.string().min(1).max(50_000).describe("Markdown") },
        annotations: WRITE,
      },
      ({ key, body }) =>
        run(async () => {
          const { item } = await this.item(ctx, key, "comment.create");
          const c = await this.comments.add(ctx.orgId, item.id, markdownToHtml(body), ctx.actor);
          return ok({ commented: item.key, id: c.id });
        }),
    );

    server.registerTool(
      "list_members",
      { title: "List members", description: "People in the organization (for assigning work).", annotations: READ_ONLY },
      () => run(async () => ok((await this.orgs.members(ctx.orgId)).map((m) => ({ name: m.name, email: m.email, role: m.role })))),
    );

    /* ----- Docs ----- */

    server.registerTool(
      "list_spaces",
      { title: "List doc spaces", description: "Documentation spaces you can read, with their page trees.", annotations: READ_ONLY },
      () =>
        run(async () => {
          const spaces = await this.docs.listSpaces(ctx);
          return ok(
            await Promise.all(
              spaces.map(async (s) => ({
                key: s.key,
                name: s.name,
                description: s.description,
                project: s.projectKey,
                canWrite: s.canWrite,
                pages: (await this.docs.tree(ctx, s.key)).map((p) => ({ id: p.id, parentId: p.parentId, title: p.title })),
              })),
            ),
          );
        }),
    );

    server.registerTool(
      "search_docs",
      {
        title: "Search docs",
        description: "Full-text search across doc pages you can read. Matches in snippets are wrapped in «».",
        inputSchema: { query: z.string().min(1) },
        annotations: READ_ONLY,
      },
      ({ query }) => run(async () => ok(await this.docs.search(ctx, query))),
    );

    server.registerTool(
      "get_page",
      {
        title: "Get doc page",
        description: "A doc page's content as Markdown, with its version (needed to update it) and linked work items.",
        inputSchema: { id: z.string().uuid() },
        annotations: READ_ONLY,
      },
      ({ id }) =>
        run(async () => {
          const p = await this.docs.detail(ctx, id);
          return ok({
            id: p.id,
            space: p.spaceKey,
            title: p.title,
            version: p.version,
            breadcrumbs: p.breadcrumbs.map((b) => b.title),
            content: htmlToMarkdown(p.contentHtml),
            linkedItems: p.linkedItems.map((i) => `${i.key} ${i.title}`),
            updatedBy: p.updatedByName,
            updatedAt: p.updatedAt,
            url: this.appUrl(ctx, `/docs/${p.spaceKey}/${p.id}`),
          });
        }),
    );

    server.registerTool(
      "create_page",
      {
        title: "Create doc page",
        description: "Create a page in a space (optionally under a parent page). Mention item keys like APP-0012 to link them.",
        inputSchema: {
          space: z.string().describe("Space key"),
          title: z.string().min(1).max(300),
          content: z.string().max(500_000).default("").describe("Markdown"),
          parentId: z.string().uuid().optional(),
        },
        annotations: WRITE,
      },
      (args) =>
        run(async () => {
          const p = await this.docs.createPage(ctx, args.space, { title: args.title, parentId: args.parentId ?? null, contentHtml: markdownToHtml(args.content) });
          return ok({ id: p.id, version: p.version, url: this.appUrl(ctx, `/docs/${p.spaceKey}/${p.id}`) });
        }),
    );

    server.registerTool(
      "update_page",
      {
        title: "Update doc page",
        description:
          "Replace a page's title and/or content. Pass the `version` you read with get_page: if someone saved since, the update is rejected so you can re-read and merge.",
        inputSchema: {
          id: z.string().uuid(),
          version: z.number().int().min(1).describe("The version you based your edit on"),
          title: z.string().min(1).max(300).optional(),
          content: z.string().max(500_000).optional().describe("Markdown; replaces the whole page"),
        },
        annotations: WRITE,
      },
      (args) =>
        run(async () => {
          const p = await this.docs.updatePage(ctx, args.id, {
            baseVersion: args.version,
            title: args.title,
            contentHtml: args.content === undefined ? undefined : markdownToHtml(args.content),
          });
          return ok({ id: p.id, version: p.version, url: this.appUrl(ctx, `/docs/${p.spaceKey}/${p.id}`) });
        }),
    );

    /* ----- Resources ----- */

    server.registerResource(
      "work-item",
      new ResourceTemplate("mixedlane://items/{key}", { list: undefined }),
      { title: "Work item", description: "A work item as JSON (fields, Markdown description, children, comments)", mimeType: "application/json" },
      async (uri, { key }) => ({
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await this.itemDetail(ctx, String(key)), null, 2) }],
      }),
    );

    server.registerResource(
      "board",
      new ResourceTemplate("mixedlane://projects/{project}/board", { list: undefined }),
      { title: "Project board", description: "A project's items grouped by status column", mimeType: "application/json" },
      async (uri, { project }) => {
        const { project: p } = await this.access.project(ctx, String(project), "project.read");
        const items = [...(await this.items.summarize(ctx.orgId, p.id)).values()];
        const board = p.statuses.map((s) => ({
          status: s.name,
          items: items.filter((i) => i.status === s.id).map((i) => ({ key: i.key, type: TYPE_LABELS[i.type as ItemType], title: i.title, assignee: i.assignee })),
        }));
        return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(board, null, 2) }] };
      },
    );

    return server;
  }
}
