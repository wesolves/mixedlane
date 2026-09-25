import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import {
  commentCreateSchema,
  commentUpdateSchema,
  itemCreateSchema,
  itemMoveSchema,
  itemUpdateSchema,
  projectAccessGrantSchema,
  projectAccessSettingsSchema,
  projectCreateSchema,
  projectUpdateSchema,
  type ItemCreate,
  type ItemMove,
  type ItemUpdate,
  type ProjectCreate,
  type ProjectRole,
  type ProjectUpdate,
} from "@mixedlane/shared";
import { Ctx, type RequestContext } from "../../core/context";
import { AppError } from "../../core/http";
import { ZBody } from "../../core/zod-body";
import { EventBus } from "../../core/events";
import { AccessService, requireOrg } from "../access/access.service";
import { ActivityService } from "./activity.service";
import { CommentsService } from "./comments.service";
import { ItemsService, toItemDto } from "./items.service";
import { ProjectsService, toProjectDto, type ProjectRow } from "./projects.service";

const csv = (v?: string) => (v ? v.split(",").filter(Boolean) : undefined);

const OrgScoped = () => (target: object) => {
  ApiBearerAuth()(target as never);
  ApiHeader({ name: "X-Org", description: "Organization slug or id", required: true })(target as never);
};

@ApiTags("Projects")
@OrgScoped()
@Controller("projects")
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly items: ItemsService,
    private readonly access: AccessService,
    private readonly events: EventBus,
  ) {}

  /** Only projects the caller can read, each with their effective access. */
  @Get()
  async list(@Ctx() ctx: RequestContext) {
    const list = await this.projects.list(ctx.orgId);
    const access = await this.access.resolveMany(ctx, list as unknown as ProjectRow[]);
    return list.filter((p) => access.get(p.id)).map((p) => ({ ...p, access: access.get(p.id) }));
  }

  @Post()
  async create(@Ctx() ctx: RequestContext, @ZBody(projectCreateSchema) body: ProjectCreate) {
    const project = await this.projects.createFor(ctx, body);
    return { ...toProjectDto(project), access: await this.access.resolve(ctx, project) };
  }

  @Get(":id")
  async get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const { project, access } = await this.access.project(ctx, id, "project.read");
    return { ...toProjectDto(project), access };
  }

  @Patch(":id")
  async update(@Ctx() ctx: RequestContext, @Param("id") id: string, @ZBody(projectUpdateSchema) body: ProjectUpdate) {
    const { project, access } = await this.access.project(ctx, id, "project.admin");
    const updated = await this.projects.update(ctx.orgId, project.id, body);
    this.events.emit("project", { orgId: ctx.orgId, projectId: project.id, action: "updated", actor: ctx.actor });
    return { ...toProjectDto(updated), access };
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const { project } = await this.access.project(ctx, id, "project.admin");
    await this.projects.remove(ctx.orgId, project.id);
    this.events.emit("project", { orgId: ctx.orgId, projectId: project.id, action: "deleted", actor: ctx.actor });
  }

  @Get(":id/items")
  async listItems(
    @Ctx() ctx: RequestContext,
    @Param("id") id: string,
    @Query("type") type?: string,
    @Query("status") status?: string,
    @Query("parentId") parentId?: string,
    @Query("q") q?: string,
  ) {
    const { project } = await this.access.project(ctx, id, "project.read");
    return this.items.list(ctx.orgId, project.id, {
      type: csv(type),
      status: csv(status),
      parentId: parentId === undefined ? undefined : parentId === "root" ? null : parentId,
      q,
    });
  }

  @Get(":id/tree")
  async tree(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const { project } = await this.access.project(ctx, id, "project.read");
    return [...(await this.items.summarize(ctx.orgId, project.id)).values()];
  }

  /* ---------- Access (who can see/edit this project) ---------- */

  @Get(":id/access")
  accessOverview(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.access.overview(ctx, id);
  }

  @Patch(":id/access")
  accessSettings(@Ctx() ctx: RequestContext, @Param("id") id: string, @ZBody(projectAccessSettingsSchema) body: { visibility?: "org" | "private"; defaultRole?: ProjectRole }) {
    return this.access.updateSettings(ctx, id, body);
  }

  @Post(":id/access")
  @HttpCode(200)
  grant(@Ctx() ctx: RequestContext, @Param("id") id: string, @ZBody(projectAccessGrantSchema) body: { principalType: "user" | "team"; principalId: string; role: ProjectRole }) {
    return this.access.grant(ctx, id, body);
  }

  @Delete(":id/access/:grantId")
  revokeGrant(@Ctx() ctx: RequestContext, @Param("id") id: string, @Param("grantId") grantId: string) {
    return this.access.revoke(ctx, id, grantId);
  }
}

@ApiTags("Work items")
@OrgScoped()
@Controller("items")
export class ItemsController {
  constructor(
    private readonly items: ItemsService,
    private readonly comments: CommentsService,
    private readonly activity: ActivityService,
    private readonly access: AccessService,
  ) {}

  @Post()
  async create(@Ctx() ctx: RequestContext, @ZBody(itemCreateSchema) body: ItemCreate) {
    const { project } = await this.access.project(ctx, body.projectId, "item.create");
    return toItemDto(await this.items.create(ctx.orgId, { ...body, projectId: project.id }, ctx.actor));
  }

  @Get("by-key/:key")
  async byKey(@Ctx() ctx: RequestContext, @Param("key") key: string) {
    const id = await this.items.idByKey(ctx.orgId, key);
    await this.access.item(ctx, id, "project.read");
    return this.items.detail(ctx.orgId, id);
  }

  @Get(":id")
  async detail(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    await this.access.item(ctx, id, "project.read");
    return this.items.detail(ctx.orgId, id);
  }

  /** Changing status needs `item.move`; any other field needs `item.update`. */
  @Patch(":id")
  async update(@Ctx() ctx: RequestContext, @Param("id") id: string, @ZBody(itemUpdateSchema) body: ItemUpdate) {
    const fields = Object.keys(body).filter((k) => body[k as keyof ItemUpdate] !== undefined);
    if (fields.includes("status")) await this.access.item(ctx, id, "item.move");
    if (fields.some((f) => f !== "status")) await this.access.item(ctx, id, "item.update");
    if (!fields.length) await this.access.item(ctx, id, "project.read");
    return toItemDto(await this.items.update(ctx.orgId, id, body, ctx.actor));
  }

  @Patch(":id/move")
  async move(@Ctx() ctx: RequestContext, @Param("id") id: string, @ZBody(itemMoveSchema) body: ItemMove) {
    await this.access.item(ctx, id, "item.move");
    return toItemDto(await this.items.move(ctx.orgId, id, body, ctx.actor));
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    await this.access.item(ctx, id, "item.delete");
    await this.items.remove(ctx.orgId, id, ctx.actor);
  }

  @Get(":id/activity")
  async activityFor(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    await this.access.item(ctx, id, "project.read");
    const rows = await this.activity.list(ctx.orgId, id);
    return rows.map(({ orgId: _o, ...r }) => r);
  }

  @Get(":id/comments")
  async listComments(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    await this.access.item(ctx, id, "project.read");
    return this.comments.list(ctx.orgId, id);
  }

  @Post(":id/comments")
  async addComment(@Ctx() ctx: RequestContext, @Param("id") id: string, @ZBody(commentCreateSchema) body: { body: string }) {
    await this.access.item(ctx, id, "comment.create");
    return this.comments.add(ctx.orgId, id, body.body, ctx.actor);
  }
}

@ApiTags("Work items")
@OrgScoped()
@Controller("comments")
export class CommentsController {
  constructor(
    private readonly comments: CommentsService,
    private readonly access: AccessService,
  ) {}

  /** Authors edit their own comments; moderators (project admins) can edit or delete any. */
  private async assertCanChange(ctx: RequestContext, id: string) {
    const comment = await this.comments.get(ctx.orgId, id);
    const { access } = await this.access.item(ctx, comment.workItemId, "project.read");
    const isAuthor = comment.authorType === ctx.actor.type && comment.authorId === ctx.actor.id;
    if (!isAuthor && !access.permissions.includes("comment.moderate")) throw new AppError(403, "You can only change your own comments");
  }

  @Patch(":id")
  async update(@Ctx() ctx: RequestContext, @Param("id") id: string, @ZBody(commentUpdateSchema) body: { body: string }) {
    await this.assertCanChange(ctx, id);
    return this.comments.update(ctx.orgId, id, body.body, ctx.actor);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    await this.assertCanChange(ctx, id);
    await this.comments.remove(ctx.orgId, id, ctx.actor);
  }
}

@ApiTags("Search")
@OrgScoped()
@Controller("search")
export class SearchController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly items: ItemsService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async search(@Ctx() ctx: RequestContext, @Query("q") q = "") {
    const needle = q.trim();
    if (!needle) return { projects: [], items: [] };
    const readable = await this.access.readableProjectIds(ctx);
    const lower = needle.toLowerCase();
    const projects = (await this.projects.list(ctx.orgId)).filter(
      (p) => readable.includes(p.id) && (p.name.toLowerCase().includes(lower) || p.key.toLowerCase().includes(lower)),
    );
    return { projects, items: await this.items.search(ctx.orgId, needle, readable) };
  }
}
