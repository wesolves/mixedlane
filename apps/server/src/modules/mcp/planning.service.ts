import { Injectable } from "@nestjs/common";
import { TYPE_LABELS, allowedParentTypes, canHaveParent, type ItemType, type Priority, type ProjectAccessInfo, type WorkItemSummary } from "@flowboard/shared";
import { config } from "../../core/config";
import type { RequestContext } from "../../core/context";
import { AppError } from "../../core/http";
import { markdownToHtml } from "../../core/markdown";
import { AccessService } from "../access/access.service";
import { CommentsService } from "../work/comments.service";
import { ItemsService, type ItemRow } from "../work/items.service";
import { categoryOf, type ProjectRow } from "../work/projects.service";

export interface PlanItem {
  /** Local id used by other items in the same plan to point at this one as their parent. */
  ref: string;
  /** Another item's `ref`, an existing item key (e.g. APP-0012), or null/omitted for the top level. */
  parent?: string | null;
  type: ItemType;
  title: string;
  description?: string;
  priority?: Priority;
  labels?: string[];
  estimate?: number;
}

type Outcome = "created" | "existing" | "will_create" | "exists";

interface Planned {
  item: PlanItem;
  parentType: ItemType | null;
  /** Existing parent (id + key) or a planned parent (ref). */
  parentExisting: { id: string; key: string } | null;
  parentRef: string | null;
  match: WorkItemSummary | null;
}

export type Stage = "start" | "review" | "done";

const MAX_ITEMS = 100;

/**
 * Turns an agent's plan into Flowboard work items (idempotently), and moves items through the
 * workflow as the agent works. Everything goes through ItemsService, so activity, notifications and
 * realtime updates happen exactly as for people.
 */
@Injectable()
export class PlanningService {
  constructor(
    private readonly access: AccessService,
    private readonly items: ItemsService,
    private readonly comments: CommentsService,
  ) {}

  /** The workflow every connected agent is told about (MCP server instructions). */
  instructions(ctx: RequestContext) {
    const mode = ctx.agent?.planningMode ?? "auto";
    return [
      "",
      `Planning workflow — your planning mode is ${mode.toUpperCase()}:`,
      "- Whenever you make a plan, break down requirements, or are asked to build something non-trivial, record the work in Flowboard with create_plan:",
      "  epic (the outcome) → milestone (if the project uses them) → user story (user value; acceptance criteria as a `- [ ]` checklist) → task (an implementation step) → subtask.",
      "  Use only the item types enabled in the project (list_projects / get_project). search_items first and reuse existing items instead of duplicating them. If the repository has a .flowboard.json, use its project.",
      ctx.agent?.canCreateProjects === false
        ? "- If no existing project fits, you can't create one: ask the user which project to use (an org admin can allow project creation for you in Settings → AI agents)."
        : "- If no existing project fits a new initiative, create one with create_project (short 2-5 letter key, enable only the levels it needs), then plan into it. If it's unclear whether the work belongs in an existing project, ask.",
      mode === "auto"
        ? "- AUTO: call create_plan (confirmed: true) right after the plan is settled — don't ask for permission. Then tell the user the item keys."
        : "- PROPOSE: call create_plan without `confirmed` to get a preview, show it to the user, and call again with confirmed: true only after they approve.",
      "- While you work: start_work before starting an item; put its key in branch names, commit messages and PR titles (e.g. APP-0012-add-login); add_comment for decisions and blockers; complete_work with stage \"review\" when your part is done (\"done\" if there's nothing to review).",
    ].join("\n");
  }

  private url(ctx: RequestContext, project: ProjectRow, item: { type: string; key: string }) {
    return `${config().APP_URL}/${ctx.orgSlug}/projects/${project.key}/${item.type}/${item.key}`;
  }

  /** Resolves "APP-12" / "app-0012" to an item in the list (zero padding optional). */
  private findByKey(project: ProjectRow, all: WorkItemSummary[], ref: string) {
    const m = /^([A-Za-z][A-Za-z0-9]{1,4})-(\d{1,6})$/.exec(ref.trim());
    if (!m || m[1].toUpperCase() !== project.key) return null;
    const key = `${project.key}-${m[2].padStart(project.keyDigits, "0")}`;
    return all.find((i) => i.key === key) ?? null;
  }

  async createPlan(ctx: RequestContext, input: { project: string; items: PlanItem[]; confirmed?: boolean }) {
    if (!input.items.length) throw new AppError(400, "The plan has no items");
    if (input.items.length > MAX_ITEMS) throw new AppError(400, `A plan can have at most ${MAX_ITEMS} items — split it up`);
    const { project, access } = await this.access.project(ctx, input.project, "project.read");
    const all = [...(await this.items.summarize(ctx.orgId, project.id)).values()];
    const enabled = project.itemTypes;

    const refs = new Map<string, PlanItem>();
    for (const it of input.items) {
      if (refs.has(it.ref)) throw new AppError(400, `Duplicate ref "${it.ref}" — each item needs its own ref`);
      refs.set(it.ref, it);
    }

    // Order parents before children and validate the whole tree before creating anything.
    const planned = new Map<string, Planned>();
    const problems: string[] = [];
    const visit = (it: PlanItem, trail: string[]): Planned | null => {
      const done = planned.get(it.ref);
      if (done) return done;
      if (trail.includes(it.ref)) {
        problems.push(`"${it.title}": its parent chain loops back to itself`);
        return null;
      }
      let parentType: ItemType | null = null;
      let parentExisting: Planned["parentExisting"] = null;
      let parentRef: string | null = null;
      const parent = it.parent?.trim() || null;
      if (parent) {
        const local = refs.get(parent);
        if (local) {
          const p = visit(local, [...trail, it.ref]);
          if (!p) return null;
          parentType = local.type;
          parentRef = local.ref;
          // A planned parent that already exists means this item can be matched under it too.
          if (p.match) parentExisting = { id: p.match.id, key: p.match.key };
        } else {
          const found = this.findByKey(project, all, parent);
          if (!found) {
            problems.push(`"${it.title}": parent "${parent}" is neither a ref in this plan nor an item in ${project.key}`);
            return null;
          }
          parentType = found.type;
          parentExisting = { id: found.id, key: found.key };
        }
      }
      if (!enabled.includes(it.type)) {
        problems.push(`"${it.title}": ${TYPE_LABELS[it.type]}s aren't enabled in ${project.key} (enabled: ${enabled.join(", ")})`);
        return null;
      }
      if (!canHaveParent(it.type, parentType, enabled)) {
        const allowed = allowedParentTypes(it.type, enabled).map((t) => TYPE_LABELS[t]);
        problems.push(
          `"${it.title}": a ${TYPE_LABELS[it.type]} can't be ${parentType ? `under a ${TYPE_LABELS[parentType]}` : "at the top level"}${allowed.length ? ` — put it under a ${allowed.join(" or ")}` : ""}`,
        );
        return null;
      }
      // Idempotency: same title + type under the same (existing) parent → reuse.
      const title = it.title.trim().toLowerCase();
      const siblings = parentRef && !parentExisting ? [] : all.filter((x) => (x.parentId ?? null) === (parentExisting?.id ?? null));
      const match = siblings.find((x) => x.type === it.type && x.title.trim().toLowerCase() === title) ?? null;
      const p: Planned = { item: it, parentType, parentExisting, parentRef, match };
      planned.set(it.ref, p);
      return p;
    };
    for (const it of input.items) visit(it, []);
    if (problems.length) throw new AppError(400, `The plan doesn't fit ${project.key}'s hierarchy:\n- ${problems.join("\n- ")}`);

    const order = [...planned.values()];
    const toCreate = order.filter((p) => !p.match);
    const mode = ctx.agent?.planningMode ?? "auto";
    const preview = mode === "propose" && !input.confirmed;
    if (toCreate.length && !preview && !this.can(access, "item.create")) {
      throw new AppError(403, "You don't have permission to create items in this project");
    }

    const keys = new Map<string, { key: string; id: string }>();
    const results: { ref: string; key: string | null; type: ItemType; title: string; parent: string | null; outcome: Outcome; url: string | null }[] = [];
    for (const p of order) {
      const parentKey = p.parentExisting?.key ?? (p.parentRef ? (keys.get(p.parentRef)?.key ?? `(${p.parentRef})`) : null);
      if (p.match) {
        keys.set(p.item.ref, { key: p.match.key, id: p.match.id });
        results.push({ ref: p.item.ref, key: p.match.key, type: p.item.type, title: p.match.title, parent: parentKey, outcome: preview ? "exists" : "existing", url: this.url(ctx, project, p.match) });
        continue;
      }
      if (preview) {
        results.push({ ref: p.item.ref, key: null, type: p.item.type, title: p.item.title, parent: parentKey, outcome: "will_create", url: null });
        continue;
      }
      const parentId = p.parentExisting?.id ?? (p.parentRef ? keys.get(p.parentRef)!.id : null);
      const created: ItemRow = await this.items.create(
        ctx.orgId,
        {
          projectId: project.id,
          parentId,
          type: p.item.type,
          title: p.item.title.trim(),
          description: markdownToHtml(p.item.description ?? ""),
          priority: p.item.priority ?? "medium",
          labels: p.item.labels ?? [],
          estimate: p.item.estimate ?? null,
        },
        ctx.actor,
      );
      keys.set(p.item.ref, { key: created.key, id: created.id });
      results.push({ ref: p.item.ref, key: created.key, type: created.type, title: created.title, parent: parentKey, outcome: "created", url: this.url(ctx, project, created) });
    }

    const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
    return {
      project: project.key,
      planningMode: mode,
      ...(preview
        ? {
            preview: true,
            next: "PROPOSE mode: show this breakdown to the user. Only after they approve, call create_plan again with the same items and confirmed: true.",
            willCreate: count("will_create"),
            alreadyExists: count("exists"),
          }
        : { created: count("created"), reused: count("existing") }),
      items: results,
    };
  }

  private can(access: ProjectAccessInfo, permission: string) {
    return (access.permissions as string[]).includes(permission);
  }

  /** The status an item should move to for a work stage, from the project's workflow. */
  private targetStatus(project: ProjectRow, stage: Stage) {
    const s = project.statuses;
    const inProgress = s.filter((x) => x.category === "in_progress");
    if (stage === "start") return inProgress[0] ?? null;
    if (stage === "done") return s.find((x) => x.category === "done") ?? null;
    return s.find((x) => /review/i.test(x.name) || /review/i.test(x.id)) ?? inProgress.at(-1) ?? s.find((x) => x.category === "done") ?? null;
  }

  /** start / review / done: move the item (never backwards out of done on "start") and comment. */
  async moveToStage(ctx: RequestContext, target: { item: ItemRow; project: ProjectRow; access: ProjectAccessInfo }, stage: Stage, note?: string) {
    const { item, project, access } = target;
    const status = this.targetStatus(project, stage);
    if (!status) throw new AppError(400, `${project.key}'s workflow has no status for "${stage}"`);
    const current = project.statuses.find((x) => x.id === item.status);
    const fromName = current?.name ?? item.status;
    let moved = false;
    const alreadyDone = categoryOf(project.statuses, item.status) === "done";
    if (item.status !== status.id && !(stage === "start" && alreadyDone)) {
      if (!this.can(access, "item.move")) throw new AppError(403, "You don't have permission to change status in this project");
      const siblings = [...(await this.items.summarize(ctx.orgId, project.id)).values()].filter((i) => i.status === status.id);
      await this.items.move(ctx.orgId, item.id, { status: status.id, sortOrder: Math.max(0, ...siblings.map((i) => i.sortOrder)) + 1000 }, ctx.actor);
      moved = true;
    }
    let commented = false;
    if (note?.trim() && this.can(access, "comment.create")) {
      await this.comments.add(ctx.orgId, item.id, markdownToHtml(note), ctx.actor);
      commented = true;
    }
    return { key: item.key, from: fromName, to: moved ? status.name : fromName, moved, commented, url: this.url(ctx, project, item) };
  }
}
