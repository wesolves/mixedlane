import { Controller, HttpCode, Inject, Injectable, Logger, Module, Post, type OnApplicationBootstrap } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DEFAULT_AGENT_PERMISSIONS, STATUS_PRESETS, type ItemType, type Priority } from "@flowboard/shared";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SERVER_ROOT, config } from "../../core/config";
import { DB, type Db } from "../../core/database/database";
import { orgMembers, orgs, projectAccess, teamMembers, teams, users } from "../../core/database/schema";
import { hashPassword } from "../auth/crypto";
import { AppError } from "../../core/http";
import { Public, type Actor } from "../../core/context";
import { CommentsService } from "../work/comments.service";
import { ItemsService } from "../work/items.service";
import { ProjectsService } from "../work/projects.service";
import { WorkModule } from "../work/work.module";
import { AccessService } from "../access/access.service";
import { AgentsService } from "../agents/agents.service";
import { DocsModule } from "../docs/docs.controller";
import { DocsService } from "../docs/docs.service";

interface Node {
  type: ItemType;
  title: string;
  status?: string;
  priority?: Priority;
  assignee?: string;
  description?: string;
  dueDate?: string;
  estimate?: number;
  labels?: string[];
  children?: Node[];
}

const SEED: Actor = { type: "system", id: null, name: "Seed" };

/** Demo accounts (development only). Everyone shares DEMO_PASSWORD. */
export const DEMO_PASSWORD = "Flowboard123";
export const DEMO_USERS = [
  { key: "alice", name: "Alice Owner", email: "alice@flowboard.dev", role: "owner" },
  { key: "bob", name: "Bob Admin", email: "bob@flowboard.dev", role: "admin" },
  { key: "priya", name: "Priya", email: "priya@flowboard.dev", role: "member" },
  { key: "sam", name: "Sam", email: "sam@flowboard.dev", role: "member" },
  { key: "gina", name: "Gina Guest", email: "guest@flowboard.dev", role: "guest" },
] as const;

const APP_TREE: Node[] = [
  {
    type: "epic",
    title: "User Onboarding",
    description: "<p>Everything a new user sees in their <strong>first 5 minutes</strong>.</p>",
    priority: "high",
    children: [
      {
        type: "milestone",
        title: "M1 · Sign up & login",
        dueDate: "2026-10-15",
        children: [
          {
            type: "story",
            title: "As a new user I can sign up with email",
            status: "done",
            assignee: "Alex",
            estimate: 3,
            labels: ["auth"],
            description:
              '<h3>Acceptance criteria</h3><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Email + password form</p></li><li data-type="taskItem" data-checked="true"><p>Validation errors inline</p></li></ul>',
            children: [
              { type: "task", title: "Build sign-up form", status: "done", assignee: "Alex" },
              { type: "task", title: "Email verification endpoint", status: "done", assignee: "Sam" },
            ],
          },
          {
            type: "story",
            title: "As a user I can log in with Google",
            status: "in_progress",
            priority: "high",
            assignee: "Sam",
            estimate: 5,
            labels: ["auth"],
            children: [
              {
                type: "task",
                title: "Configure OAuth client",
                status: "done",
                children: [
                  { type: "subtask", title: "Create Google Cloud project", status: "done" },
                  { type: "subtask", title: "Add redirect URIs", status: "todo" },
                ],
              },
              { type: "task", title: "Handle OAuth callback", status: "in_progress", assignee: "Sam" },
            ],
          },
        ],
      },
      {
        type: "milestone",
        title: "M2 · Guided tour",
        dueDate: "2026-11-01",
        children: [
          {
            type: "story",
            title: "As a new user I see a 3-step welcome tour",
            status: "todo",
            estimate: 5,
            children: [
              { type: "task", title: "Design tour screens", status: "in_review", assignee: "Priya" },
              { type: "task", title: "Implement tour carousel", status: "todo" },
            ],
          },
        ],
      },
    ],
  },
  {
    type: "epic",
    title: "Payments",
    priority: "urgent",
    children: [
      {
        type: "milestone",
        title: "M3 · Subscriptions",
        dueDate: "2026-12-01",
        children: [
          {
            type: "story",
            title: "As a user I can upgrade to Pro",
            status: "backlog",
            priority: "urgent",
            labels: ["billing"],
            children: [{ type: "task", title: "Integrate Stripe checkout", status: "backlog" }],
          },
        ],
      },
    ],
  },
];

const WEB_TREE: Node[] = [
  { type: "task", title: "New hero section copy", status: "done", assignee: "Priya" },
  {
    type: "task",
    title: "Pricing page redesign",
    status: "in_progress",
    priority: "high",
    assignee: "Alex",
    children: [
      { type: "subtask", title: "Wireframes", status: "done" },
      { type: "subtask", title: "Build components", status: "todo" },
    ],
  },
  { type: "task", title: "Set up analytics", status: "todo" },
];

/** Demo data for development: seeded automatically into an empty database. */
@Injectable()
export class DemoSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger("Seed");

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly projects: ProjectsService,
    private readonly items: ItemsService,
    private readonly comments: CommentsService,
    private readonly access: AccessService,
    private readonly docs: DocsService,
    private readonly agents: AgentsService,
  ) {}

  async onApplicationBootstrap() {
    if (config().NODE_ENV !== "development") return;
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(orgs);
    if (n === 0) await this.seed();
  }

  /** Deletes every org and user (cascading to all data) and seeds the demo org. */
  async reset() {
    await this.db.delete(orgs);
    await this.db.delete(users);
    await this.seed();
  }

  async seed() {
    const [org] = await this.db.insert(orgs).values({ name: "Flowboard Demo", slug: "demo" }).returning();
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const people: Record<string, Actor> = {};
    for (const u of DEMO_USERS) {
      const [row] = await this.db
        .insert(users)
        .values({ email: u.email, name: u.name, passwordHash, emailVerifiedAt: new Date() })
        .returning();
      await this.db.insert(orgMembers).values({ orgId: org.id, userId: row.id, role: u.role });
      people[u.name] = { type: "user", id: row.id, name: u.name };
      people[u.key] = people[u.name];
    }
    const [mobile] = await this.db.insert(teams).values({ orgId: org.id, name: "Mobile", slug: "mobile", description: "iOS & Android app" }).returning();
    await this.db.insert(teamMembers).values([
      { teamId: mobile.id, userId: people.priya.id!, role: "lead" },
      { teamId: mobile.id, userId: people.sam.id!, role: "member" },
    ]);
    this.people = people;
    const person = (name: string) => people[name] ?? SEED;
    this.person = person;

    const app = await this.projects.create(org.id, {
      name: "Flowboard Mobile App",
      key: "APP",
      description: "Ship the first version of our mobile companion app.",
      color: "#6366f1",
      icon: "lucide:smartphone",
      keyDigits: 4,
    });
    await this.insert(org.id, app.id, APP_TREE, null);

    const web = await this.projects.create(org.id, {
      name: "Marketing Website",
      key: "WEB",
      description: "Landing page refresh — just tasks, no epics.",
      color: "#f97316",
      icon: "emoji:🌐",
      keyDigits: 5,
      itemTypes: ["task", "subtask"],
      statuses: STATUS_PRESETS.find((p) => p.name === "Simple")!.statuses,
    });
    await this.insert(org.id, web.id, WEB_TREE, null);
    // The guest can only see the marketing site, read-only.
    await this.db.insert(projectAccess).values({ projectId: web.id, principalType: "user", principalId: people.gina.id!, role: "viewer" });
    await this.seedDocs(org.id, app.id, people);
    await this.seedAgent(org.id, app.id, people);
    this.logger.log(`Seeded demo org (projects APP, WEB). Sign in as alice@flowboard.dev / ${DEMO_PASSWORD} (also bob, priya, sam, guest)`);
  }

  private person: (name: string) => Actor = () => SEED;
  private people: Record<string, Actor> = {};
  /** Item keys by title, for linking docs pages to work. */
  private keys = new Map<string, string>();

  /**
   * A demo AI agent with access to APP. Its key is written to apps/server/data/demo-agent.key
   * (git-ignored) so you can connect an MCP client straight away.
   */
  private async seedAgent(orgId: string, appProjectId: string, people: Record<string, Actor>) {
    const ctx = await this.access.contextFor(orgId, people.alice.id!);
    if (!ctx) return;
    // Reuse the previous demo key so MCP clients configured with it keep working after a reset.
    const keyFile = join(SERVER_ROOT, "data", "demo-agent.key");
    const previous = existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : undefined;
    const { agent, key } = await this.agents.create(ctx, { name: "Triage Bot", description: "Labels, prioritizes and routes new work.", docAccess: "read" }, previous);
    await this.agents.setGrant(ctx, agent.id, { projectId: appProjectId, permissions: [...DEFAULT_AGENT_PERMISSIONS] });
    const bot: Actor = { type: "agent", id: agent.id, name: agent.name };
    const target = this.keys.get("Handle OAuth callback");
    if (target) {
      const id = await this.items.idByKey(orgId, target);
      await this.items.update(orgId, id, { labels: ["auth", "needs-review"], priority: "high" }, bot);
      await this.comments.add(orgId, id, "<p>Flagged as <strong>high</strong> priority: login is blocked for new users until this ships. Suggest pairing with Priya.</p>", bot);
    }
    mkdirSync(join(SERVER_ROOT, "data"), { recursive: true });
    writeFileSync(keyFile, key.secret, { mode: 0o600 });
    this.logger.log(`Demo agent "Triage Bot" key written to apps/server/data/demo-agent.key (MCP endpoint: /api/mcp)`);
  }

  /** An engineering space (org-wide) and a project space for APP, with pages that reference work items. */
  private async seedDocs(orgId: string, appProjectId: string, people: Record<string, Actor>) {
    const ctx = await this.access.contextFor(orgId, people.alice.id!);
    if (!ctx) return;
    const key = (title: string) => this.keys.get(title) ?? "";
    const mention = (a: Actor) => `<span data-type="mention" class="mention" data-id="${a.id}" data-label="${a.name}">@${a.name}</span>`;

    await this.docs.createSpace(ctx, { key: "ENG", name: "Engineering", description: "How we build: architecture, runbooks and decisions.", icon: "lucide:cpu", color: "#0ea5e9" });
    const arch = await this.docs.createPage(ctx, "ENG", {
      title: "Architecture overview",
      contentHtml: [
        "<h2>Stack</h2><ul><li><p><strong>API</strong> — NestJS on Node, Postgres (PGlite in development)</p></li><li><p><strong>Web</strong> — React, Vite, Tailwind, shadcn/ui</p></li><li><p><strong>Realtime</strong> — socket.io, rooms per project and space</p></li></ul>",
        "<h2>Principles</h2><ol><li><p>Every query is scoped by organization.</p></li><li><p>Events are published only after the transaction commits.</p></li><li><p>Clients refetch through the permission-checked REST API.</p></li></ol>",
      ].join(""),
    });
    await this.docs.createPage(ctx, "ENG", {
      title: "Auth & sessions",
      parentId: arch.id,
      contentHtml: `<p>Short-lived JWT access tokens plus rotating refresh cookies. Google sign-in is tracked in ${key("As a user I can log in with Google")}; email sign-up shipped with ${key("As a new user I can sign up with email")}.</p><h3>Refresh rotation</h3><p>Reusing a refresh token outside the grace window revokes the whole session family.</p><p>Reviewer: ${mention(people.bob)}</p>`,
    });
    await this.docs.createPage(ctx, "ENG", {
      title: "Runbook: deploying the API",
      contentHtml: '<ol><li><p>Merge to <code>main</code> — CI runs tests and builds the image.</p></li><li><p>Migrations run on boot.</p></li><li><p>Check <code>/api/health</code>.</p></li></ol><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Add a rollback section</p></li></ul>',
    });

    await this.docs.createSpace(ctx, { key: "APPDOCS", name: "Mobile App", description: "Product docs for the mobile companion app.", icon: "lucide:smartphone", color: "#6366f1", projectId: appProjectId });
    await this.docs.createPage(ctx, "APPDOCS", {
      title: "PRD: Mobile companion app",
      contentHtml: `<h2>Problem</h2><p>People want to check and update their work on the go.</p><h2>Goals</h2><ul><li><p>Onboarding in under 2 minutes (${key("User Onboarding")})</p></li><li><p>Push notifications for assignments and mentions</p></li></ul><h2>Open questions</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>${mention(people.priya)} — do we need offline mode in v1?</p></li></ul>`,
    });
    await this.docs.createPage(ctx, "APPDOCS", {
      title: "Sprint 12 planning — notes",
      contentHtml: `<p><strong>Attendees:</strong> Alice, Priya, Sam</p><h2>Decisions</h2><ul><li><p>Google login (${key("As a user I can log in with Google")}) is the sprint goal.</p></li></ul><h2>Action items</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Sam — finish the OAuth callback</p></li></ul>`,
    });
  }

  private async insert(orgId: string, projectId: string, nodes: Node[], parentId: string | null) {
    for (const n of nodes) {
      const item = await this.items.create(
        orgId,
        {
          projectId,
          parentId,
          type: n.type,
          title: n.title,
          description: n.description ?? "",
          status: n.status ?? "todo",
          priority: n.priority ?? "medium",
          ...(n.assignee && this.people[n.assignee]?.id ? { assigneeId: this.people[n.assignee].id } : { assignee: n.assignee ?? null }),
          labels: n.labels ?? [],
          dueDate: n.dueDate ?? null,
          estimate: n.estimate ?? null,
        },
        this.person("Alice Owner"),
      );
      this.keys.set(n.title, item.key);
      if (n.title.includes("Google")) {
        await this.comments.add(orgId, item.id, "<p>Callback URL needs to be whitelisted in <code>staging</code> too 👀</p>", this.person("Priya"));
        await this.comments.add(orgId, item.id, "<p>Good catch — added both.</p>", this.person("Sam"));
      }
      if (n.children) await this.insert(orgId, projectId, n.children, item.id);
    }
  }
}

/** Development helpers — never mounted in production. */
@Controller("dev")
export class DevController {
  constructor(private readonly seeder: DemoSeeder) {}

  @Public()
  @Post("reset-demo")
  @HttpCode(200)
  async reset() {
    if (config().NODE_ENV !== "development") throw new AppError(404, "Not found");
    await this.seeder.reset();
    return { ok: true };
  }
}

@Module({ imports: [WorkModule, DocsModule], providers: [DemoSeeder], controllers: [DevController] })
export class DevModule {}
