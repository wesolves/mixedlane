import { Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import {
  inviteCreateSchema,
  memberUpdateSchema,
  orgCreateSchema,
  orgUpdateSchema,
  teamCreateSchema,
  teamMemberSchema,
  teamUpdateSchema,
  type OrgRole,
} from "@flowboard/shared";
import { Auth, Ctx, NoOrg, type AuthInfo, type RequestContext } from "../../core/context";
import { ZBody } from "../../core/zod-body";
import { requireOrg } from "../access/access.service";
import { OrgsService } from "./orgs.service";

/** Orgs the signed-in user belongs to (not scoped to one org). */
@ApiTags("Organizations")
@ApiBearerAuth()
@Controller("orgs")
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @NoOrg()
  @Get()
  mine(@Auth() auth: AuthInfo) {
    return this.orgs.listForUser(auth.userId);
  }

  @NoOrg()
  @Post()
  async create(@Auth() auth: AuthInfo, @ZBody(orgCreateSchema) body: { name: string; slug?: string }) {
    const org = await this.orgs.create(auth.userId, body.name, body.slug);
    return (await this.orgs.listForUser(auth.userId)).find((o) => o.id === org.id);
  }
}

/** The current org, selected with the X-Org header. */
@ApiTags("Organization")
@ApiBearerAuth()
@ApiHeader({ name: "X-Org", description: "Organization slug or id", required: true })
@Controller("org")
export class CurrentOrgController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  async get(@Ctx() ctx: RequestContext) {
    const org = await this.orgs.get(ctx.orgId);
    return { id: org.id, name: org.name, slug: org.slug, role: ctx.orgRole, permissions: ctx.orgPermissions };
  }

  @Patch()
  async update(@Ctx() ctx: RequestContext, @ZBody(orgUpdateSchema) body: { name?: string; slug?: string }) {
    requireOrg(ctx, "org.manage");
    const org = await this.orgs.update(ctx.orgId, body);
    return { id: org.id, name: org.name, slug: org.slug, role: ctx.orgRole, permissions: ctx.orgPermissions };
  }

  @Delete()
  @HttpCode(204)
  async remove(@Ctx() ctx: RequestContext) {
    requireOrg(ctx, "org.delete");
    await this.orgs.remove(ctx.orgId);
  }

  /* ---------- Members ---------- */

  @Get("members")
  members(@Ctx() ctx: RequestContext) {
    return this.orgs.members(ctx.orgId);
  }

  @Patch("members/:userId")
  @HttpCode(204)
  async updateMember(@Ctx() ctx: RequestContext, @Param("userId") userId: string, @ZBody(memberUpdateSchema) body: { role: OrgRole }) {
    requireOrg(ctx, "org.manage");
    await this.orgs.updateMemberRole(ctx, userId, body.role);
  }

  /** Admins remove members; anyone can remove themselves (leave). */
  @Delete("members/:userId")
  @HttpCode(204)
  async removeMember(@Ctx() ctx: RequestContext, @Param("userId") userId: string) {
    if (userId !== ctx.userId) requireOrg(ctx, "org.manage");
    await this.orgs.removeMember(ctx, userId);
  }

  /* ---------- Teams ---------- */

  @Get("teams")
  teams(@Ctx() ctx: RequestContext) {
    return this.orgs.teams(ctx.orgId);
  }

  @Post("teams")
  createTeam(@Ctx() ctx: RequestContext, @ZBody(teamCreateSchema) body: { name: string; description?: string }) {
    requireOrg(ctx, "team.manage");
    return this.orgs.createTeam(ctx.orgId, body);
  }

  @Patch("teams/:teamId")
  updateTeam(@Ctx() ctx: RequestContext, @Param("teamId") teamId: string, @ZBody(teamUpdateSchema) body: { name?: string; description?: string }) {
    requireOrg(ctx, "team.manage");
    return this.orgs.updateTeam(ctx.orgId, teamId, body);
  }

  @Delete("teams/:teamId")
  @HttpCode(204)
  async deleteTeam(@Ctx() ctx: RequestContext, @Param("teamId") teamId: string) {
    requireOrg(ctx, "team.manage");
    await this.orgs.deleteTeam(ctx.orgId, teamId);
  }

  @Post("teams/:teamId/members")
  @HttpCode(204)
  async addTeamMember(@Ctx() ctx: RequestContext, @Param("teamId") teamId: string, @ZBody(teamMemberSchema) body: { userId: string; role: "lead" | "member" }) {
    requireOrg(ctx, "team.manage");
    await this.orgs.addTeamMember(ctx.orgId, teamId, body.userId, body.role);
  }

  @Delete("teams/:teamId/members/:userId")
  @HttpCode(204)
  async removeTeamMember(@Ctx() ctx: RequestContext, @Param("teamId") teamId: string, @Param("userId") userId: string) {
    requireOrg(ctx, "team.manage");
    await this.orgs.removeTeamMember(ctx.orgId, teamId, userId);
  }

  /* ---------- Invites ---------- */

  @Get("invites")
  invites(@Ctx() ctx: RequestContext) {
    requireOrg(ctx, "org.invite");
    return this.orgs.listInvites(ctx.orgId);
  }

  /** Returns the invite link too, so admins can share it directly (no email setup needed). */
  @Post("invites")
  invite(@Ctx() ctx: RequestContext, @ZBody(inviteCreateSchema) body: { email: string; role: Exclude<OrgRole, "owner">; teamIds: string[] }) {
    requireOrg(ctx, "org.invite");
    return this.orgs.invite(ctx, body);
  }

  @Delete("invites/:inviteId")
  @HttpCode(204)
  async revokeInvite(@Ctx() ctx: RequestContext, @Param("inviteId") inviteId: string) {
    requireOrg(ctx, "org.invite");
    await this.orgs.revokeInvite(ctx.orgId, inviteId);
  }
}
