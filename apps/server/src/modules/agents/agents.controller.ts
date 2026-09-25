import { Controller, Delete, Get, Global, HttpCode, Module, Param, Patch, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { agentCreateSchema, agentGrantSchema, agentUpdateSchema, apiKeyCreateSchema } from "@mixedlane/shared";
import type { z } from "zod";
import { Ctx, type RequestContext } from "../../core/context";
import { ZBody } from "../../core/zod-body";
import { AgentsService } from "./agents.service";

/** Managing AI agents needs the `agent.manage` org permission (owners and admins). */
@ApiTags("AI agents")
@ApiBearerAuth()
@ApiHeader({ name: "X-Org", description: "Organization slug or id", required: true })
@Controller("agents")
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  list(@Ctx() ctx: RequestContext) {
    this.agents.assertManageable(ctx);
    return this.agents.list(ctx);
  }

  /** Creates the agent and its first API key. The key's `secret` is returned only this once. */
  @Post()
  create(@Ctx() ctx: RequestContext, @ZBody(agentCreateSchema) body: z.output<typeof agentCreateSchema>) {
    this.agents.assertManageable(ctx);
    return this.agents.create(ctx, body);
  }

  @Get(":id")
  get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    this.agents.assertManageable(ctx);
    return this.agents.get(ctx, id);
  }

  @Patch(":id")
  update(@Ctx() ctx: RequestContext, @Param("id") id: string, @ZBody(agentUpdateSchema) body: z.output<typeof agentUpdateSchema>) {
    this.agents.assertManageable(ctx);
    return this.agents.update(ctx, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    this.agents.assertManageable(ctx);
    await this.agents.remove(ctx, id);
  }

  @Post(":id/keys")
  createKey(@Ctx() ctx: RequestContext, @Param("id") id: string, @ZBody(apiKeyCreateSchema) body: z.output<typeof apiKeyCreateSchema>) {
    this.agents.assertManageable(ctx);
    return this.agents.createKey(ctx, id, body);
  }

  @Delete(":id/keys/:keyId")
  revokeKey(@Ctx() ctx: RequestContext, @Param("id") id: string, @Param("keyId") keyId: string) {
    this.agents.assertManageable(ctx);
    return this.agents.revokeKey(ctx, id, keyId);
  }

  /** Set the agent's permissions in one project (empty list = no access). */
  @Put(":id/grants")
  setGrant(@Ctx() ctx: RequestContext, @Param("id") id: string, @ZBody(agentGrantSchema) body: z.output<typeof agentGrantSchema>) {
    this.agents.assertManageable(ctx);
    return this.agents.setGrant(ctx, id, body);
  }

  @Get(":id/activity")
  activity(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    this.agents.assertManageable(ctx);
    return this.agents.activity(ctx, id);
  }
}

@Global()
@Module({ controllers: [AgentsController], providers: [AgentsService], exports: [AgentsService] })
export class AgentsModule {}
