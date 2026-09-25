import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  createBranchSchema,
  gitAutomationSchema,
  githubConnectSchema,
  githubSettingsSchema,
  linkRepoSchema,
  type GitAutomation,
} from "@mixedlane/shared";
import type { z } from "zod";
import { Ctx, Public, type RequestContext } from "../../core/context";
import { ZodPipe } from "../../core/http";
import { AccessService, requireOrg } from "../access/access.service";
import { GithubService } from "./github.service";

/** Org-level connection + the webhook receiver. Managing the connection needs integration.manage. */
@ApiTags("GitHub")
@ApiBearerAuth()
@Controller("github")
export class GithubController {
  constructor(private readonly github: GithubService) {}

  @Get("connection")
  async connection(@Ctx() ctx: RequestContext) {
    const info = await this.github.connectionInfo(ctx.orgId);
    // Only integration managers may see the webhook secret.
    return ctx.orgPermissions.includes("integration.manage") ? info : { ...info, webhookSecret: null };
  }

  @Put("connection")
  connect(@Ctx() ctx: RequestContext, @Body(new ZodPipe(githubConnectSchema)) body: z.infer<typeof githubConnectSchema>) {
    requireOrg(ctx, "integration.manage");
    const { publicUrl, ...rest } = body;
    return this.github.connect(ctx.orgId, { ...rest, publicUrl: publicUrl?.replace(/\/$/, "") });
  }

  @Patch("connection")
  settings(@Ctx() ctx: RequestContext, @Body(new ZodPipe(githubSettingsSchema)) body: z.infer<typeof githubSettingsSchema>) {
    requireOrg(ctx, "integration.manage");
    return this.github.updateSettings(ctx.orgId, { publicUrl: body.publicUrl?.replace(/\/$/, ""), pollSeconds: body.pollSeconds });
  }

  @Delete("connection")
  @HttpCode(204)
  async disconnect(@Ctx() ctx: RequestContext) {
    requireOrg(ctx, "integration.manage");
    await this.github.disconnect(ctx.orgId);
  }

  @Get("repos")
  repos(@Ctx() ctx: RequestContext, @Query("q") q = "") {
    requireOrg(ctx, "integration.manage");
    return this.github.searchRepos(ctx.orgId, q);
  }

  /** Public endpoint; authenticity comes from the HMAC signature over the raw body. */
  @Public()
  @Post("webhook")
  @HttpCode(202)
  async webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers("x-github-event") event = "", @Headers("x-hub-signature-256") signature?: string) {
    const raw = req.rawBody?.toString("utf8") ?? "";
    return { ok: true, event, ...(await this.github.receiveWebhook(event, raw, signature)) };
  }
}

/** Per-project repos and automation: readable by project members, managed by project admins. */
@ApiTags("GitHub")
@ApiBearerAuth()
@Controller("projects/:id/github")
export class ProjectGithubController {
  constructor(
    private readonly github: GithubService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const { project } = await this.access.project(ctx, id, "project.read");
    return this.github.projectGithub(ctx.orgId, project.id);
  }

  @Post("repos")
  async link(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(linkRepoSchema)) body: { fullName: string }) {
    const { project } = await this.access.project(ctx, id, "project.admin");
    return this.github.linkRepo(ctx.orgId, project.id, body.fullName);
  }

  @Delete("repos/:repoId")
  @HttpCode(204)
  async unlink(@Ctx() ctx: RequestContext, @Param("id") id: string, @Param("repoId") repoId: string) {
    await this.access.project(ctx, id, "project.admin");
    await this.github.unlinkRepo(ctx.orgId, repoId);
  }

  @Post("repos/:repoId/webhook")
  @HttpCode(200)
  async register(@Ctx() ctx: RequestContext, @Param("id") id: string, @Param("repoId") repoId: string) {
    await this.access.project(ctx, id, "project.admin");
    return this.github.registerWebhook(ctx.orgId, repoId);
  }

  @Post("sync")
  @HttpCode(200)
  async sync(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const { project } = await this.access.project(ctx, id, "item.update");
    return this.github.syncProject(ctx.orgId, project.id);
  }

  @Put("automation")
  async automation(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(gitAutomationSchema)) body: GitAutomation) {
    const { project } = await this.access.project(ctx, id, "project.admin");
    return this.github.saveAutomation(ctx.orgId, project.id, body);
  }
}

@ApiTags("GitHub")
@ApiBearerAuth()
@Controller("items/:id")
export class ItemGithubController {
  constructor(
    private readonly github: GithubService,
    private readonly access: AccessService,
  ) {}

  @Get("development")
  async development(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    await this.access.item(ctx, id, "project.read");
    return this.github.developmentInfo(ctx.orgId, id);
  }

  @Post("github/branch")
  async branch(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body(new ZodPipe(createBranchSchema)) body: z.infer<typeof createBranchSchema>) {
    await this.access.item(ctx, id, "item.update");
    return this.github.createBranch(ctx.orgId, id, body);
  }
}
