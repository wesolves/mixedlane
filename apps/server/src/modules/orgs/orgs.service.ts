import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  ORG_ROLE_PERMISSIONS,
  type Invite,
  type InviteCreate,
  type InvitePreview,
  type Member,
  type OrgRole,
  type OrgSummary,
  type Team,
} from "@flowboard/shared";
import { config } from "../../core/config";
import type { RequestContext } from "../../core/context";
import { DB, type Db, type Executor } from "../../core/database/database";
import { invites, orgMembers, orgs, teamMembers, teams, users } from "../../core/database/schema";
import { AppError, notFound } from "../../core/http";
import { MailService, actionEmail } from "../../core/mail";
import { randomToken, sha256 } from "../auth/crypto";

/** Slugs that would collide with top-level app routes. */
const RESERVED = new Set([
  "api", "app", "login", "logout", "register", "signup", "invite", "invites", "reset-password", "forgot-password",
  "verify-email", "settings", "projects", "docs", "admin", "new", "auth", "static", "assets", "help", "account",
  "oauth", "mcp", ".well-known",
]);

const INVITE_TTL_DAYS = 7;

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org";

@Injectable()
export class OrgsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly mail: MailService,
  ) {}

  /* ---------- Orgs ---------- */

  async uniqueSlug(base: string, tx: Executor = this.db, exceptOrgId?: string): Promise<string> {
    let slug = slugify(base);
    if (RESERVED.has(slug)) slug = `${slug}-team`;
    for (let i = 2; ; i++) {
      const [taken] = await tx
        .select({ id: orgs.id })
        .from(orgs)
        .where(exceptOrgId ? and(eq(orgs.slug, slug), ne(orgs.id, exceptOrgId)) : eq(orgs.slug, slug));
      if (!taken) return slug;
      slug = `${slugify(base).slice(0, 36)}-${i}`;
    }
  }

  async create(userId: string, name: string, slug?: string, tx: Executor = this.db) {
    if (slug && RESERVED.has(slug)) throw new AppError(400, `"${slug}" is reserved — pick another URL`);
    if (slug) {
      const [taken] = await tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, slug));
      if (taken) throw new AppError(409, `The URL "${slug}" is taken`);
    }
    const [org] = await tx.insert(orgs).values({ name, slug: slug ?? (await this.uniqueSlug(name, tx)) }).returning();
    await tx.insert(orgMembers).values({ orgId: org.id, userId, role: "owner" });
    return org;
  }

  async listForUser(userId: string): Promise<OrgSummary[]> {
    const rows = await this.db
      .select({ id: orgs.id, name: orgs.name, slug: orgs.slug, role: orgMembers.role })
      .from(orgMembers)
      .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
      .where(eq(orgMembers.userId, userId))
      .orderBy(asc(orgs.name));
    return rows.map((r) => ({ ...r, permissions: ORG_ROLE_PERMISSIONS[r.role] }));
  }

  /** Resolves an org by slug or id and the user's membership in it. */
  async membership(userId: string, orgRef: string) {
    const isId = /^[0-9a-f-]{36}$/i.test(orgRef);
    const [row] = await this.db
      .select({ id: orgs.id, name: orgs.name, slug: orgs.slug, role: orgMembers.role })
      .from(orgs)
      .innerJoin(orgMembers, and(eq(orgMembers.orgId, orgs.id), eq(orgMembers.userId, userId)))
      .where(isId ? eq(orgs.id, orgRef) : eq(orgs.slug, orgRef.toLowerCase()));
    return row ?? null;
  }

  async get(orgId: string) {
    const [org] = await this.db.select().from(orgs).where(eq(orgs.id, orgId));
    if (!org) throw notFound("Organization");
    return org;
  }

  async update(orgId: string, patch: { name?: string; slug?: string }) {
    if (patch.slug) {
      if (RESERVED.has(patch.slug)) throw new AppError(400, `"${patch.slug}" is reserved — pick another URL`);
      const [taken] = await this.db.select({ id: orgs.id }).from(orgs).where(and(eq(orgs.slug, patch.slug), ne(orgs.id, orgId)));
      if (taken) throw new AppError(409, `The URL "${patch.slug}" is taken`);
    }
    const [org] = await this.db.update(orgs).set({ ...patch, updatedAt: new Date() }).where(eq(orgs.id, orgId)).returning();
    return org;
  }

  async remove(orgId: string) {
    await this.db.delete(orgs).where(eq(orgs.id, orgId));
  }

  /* ---------- Members ---------- */

  async members(orgId: string): Promise<Member[]> {
    const rows = await this.db
      .select({ userId: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl, role: orgMembers.role, joinedAt: orgMembers.createdAt })
      .from(orgMembers)
      .innerJoin(users, eq(users.id, orgMembers.userId))
      .where(eq(orgMembers.orgId, orgId))
      .orderBy(asc(users.name));
    const memberships = await this.db
      .select({ userId: teamMembers.userId, id: teams.id, name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teams.orgId, orgId));
    return rows.map((r) => ({
      ...r,
      joinedAt: r.joinedAt.toISOString(),
      teams: memberships.filter((m) => m.userId === r.userId).map(({ id, name }) => ({ id, name })),
    }));
  }

  private async ownerCount(orgId: string) {
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, "owner")));
    return n;
  }

  private async memberRole(orgId: string, userId: string): Promise<OrgRole> {
    const [m] = await this.db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
    if (!m) throw notFound("Member");
    return m.role;
  }

  async updateMemberRole(ctx: RequestContext, userId: string, role: OrgRole) {
    const current = await this.memberRole(ctx.orgId, userId);
    // Only owners can create or change owners.
    if ((role === "owner" || current === "owner") && ctx.orgRole !== "owner") {
      throw new AppError(403, "Only owners can change ownership");
    }
    if (current === "owner" && role !== "owner" && (await this.ownerCount(ctx.orgId)) <= 1) {
      throw new AppError(409, "An organization needs at least one owner");
    }
    await this.db.update(orgMembers).set({ role }).where(and(eq(orgMembers.orgId, ctx.orgId), eq(orgMembers.userId, userId)));
  }

  async removeMember(ctx: RequestContext, userId: string) {
    const current = await this.memberRole(ctx.orgId, userId);
    if (current === "owner" && ctx.orgRole !== "owner") throw new AppError(403, "Only owners can remove an owner");
    if (current === "owner" && (await this.ownerCount(ctx.orgId)) <= 1) {
      throw new AppError(409, "An organization needs at least one owner — transfer ownership first");
    }
    await this.db.transaction(async (tx) => {
      const teamIds = (await tx.select({ id: teams.id }).from(teams).where(eq(teams.orgId, ctx.orgId))).map((t) => t.id);
      if (teamIds.length) await tx.delete(teamMembers).where(and(eq(teamMembers.userId, userId), inArray(teamMembers.teamId, teamIds)));
      await tx.delete(orgMembers).where(and(eq(orgMembers.orgId, ctx.orgId), eq(orgMembers.userId, userId)));
    });
  }

  /* ---------- Teams ---------- */

  async teams(orgId: string): Promise<Team[]> {
    const list = await this.db.select().from(teams).where(eq(teams.orgId, orgId)).orderBy(asc(teams.name));
    if (!list.length) return [];
    const members = await this.db
      .select({ teamId: teamMembers.teamId, userId: users.id, name: users.name, email: users.email, role: teamMembers.role })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(inArray(teamMembers.teamId, list.map((t) => t.id)));
    return list.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      description: t.description,
      members: members.filter((m) => m.teamId === t.id).map(({ teamId: _t, ...m }) => m),
    }));
  }

  private async team(orgId: string, teamId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(teamId)) throw notFound("Team");
    const [t] = await this.db.select().from(teams).where(and(eq(teams.orgId, orgId), eq(teams.id, teamId)));
    if (!t) throw notFound("Team");
    return t;
  }

  async createTeam(orgId: string, input: { name: string; description?: string }) {
    let slug = slugify(input.name);
    for (let i = 2; ; i++) {
      const [taken] = await this.db.select({ id: teams.id }).from(teams).where(and(eq(teams.orgId, orgId), eq(teams.slug, slug)));
      if (!taken) break;
      slug = `${slugify(input.name)}-${i}`;
    }
    const [t] = await this.db.insert(teams).values({ orgId, name: input.name, slug, description: input.description ?? "" }).returning();
    return t;
  }

  async updateTeam(orgId: string, teamId: string, patch: { name?: string; description?: string }) {
    await this.team(orgId, teamId);
    const [t] = await this.db.update(teams).set(patch).where(eq(teams.id, teamId)).returning();
    return t;
  }

  async deleteTeam(orgId: string, teamId: string) {
    await this.team(orgId, teamId);
    await this.db.delete(teams).where(eq(teams.id, teamId));
  }

  async addTeamMember(orgId: string, teamId: string, userId: string, role: "lead" | "member") {
    await this.team(orgId, teamId);
    await this.memberRole(orgId, userId); // must belong to the org
    await this.db
      .insert(teamMembers)
      .values({ teamId, userId, role })
      .onConflictDoUpdate({ target: [teamMembers.teamId, teamMembers.userId], set: { role } });
  }

  async removeTeamMember(orgId: string, teamId: string, userId: string) {
    await this.team(orgId, teamId);
    await this.db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  }

  /** Team ids of a user within an org (for project access resolution). */
  async teamIdsOf(orgId: string, userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: teams.id })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teams.orgId, orgId), eq(teamMembers.userId, userId)));
    return rows.map((r) => r.id);
  }

  /* ---------- Invites ---------- */

  private toInvite(i: typeof invites.$inferSelect, inviterName: string | null): Invite {
    return {
      id: i.id,
      email: i.email,
      role: i.role,
      teamIds: i.teamIds,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
      invitedBy: inviterName,
    };
  }

  async listInvites(orgId: string): Promise<Invite[]> {
    const rows = await this.db
      .select({ invite: invites, inviter: users.name })
      .from(invites)
      .leftJoin(users, eq(users.id, invites.invitedBy))
      .where(and(eq(invites.orgId, orgId), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
      .orderBy(asc(invites.createdAt));
    return rows.map((r) => this.toInvite(r.invite, r.inviter));
  }

  /** Creates (or re-sends) an invite; returns the invite plus the one-time link. */
  async invite(ctx: RequestContext, input: InviteCreate & { role: OrgRole; teamIds: string[] }) {
    const email = input.email.toLowerCase();
    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(orgMembers, and(eq(orgMembers.userId, users.id), eq(orgMembers.orgId, ctx.orgId)))
      .where(eq(users.email, email));
    if (existing) throw new AppError(409, `${email} is already a member`);
    if (input.teamIds.length) {
      const valid = await this.db.select({ id: teams.id }).from(teams).where(and(eq(teams.orgId, ctx.orgId), inArray(teams.id, input.teamIds)));
      if (valid.length !== input.teamIds.length) throw new AppError(400, "Unknown team");
    }

    const token = randomToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
    // Re-inviting replaces any pending invite for the same email.
    await this.db.delete(invites).where(and(eq(invites.orgId, ctx.orgId), eq(invites.email, email), isNull(invites.acceptedAt)));
    const [row] = await this.db
      .insert(invites)
      .values({ orgId: ctx.orgId, email, role: input.role, teamIds: input.teamIds, tokenHash: sha256(token), invitedBy: ctx.userId, expiresAt })
      .returning();

    const org = await this.get(ctx.orgId);
    const url = `${config().APP_URL}/invite/${token}`;
    await this.mail.send(
      actionEmail({
        to: email,
        subject: `${ctx.actor.name} invited you to ${org.name} on Flowboard`,
        intro: `${ctx.actor.name} invited you to join ${org.name} as ${input.role}.`,
        action: "Accept invitation",
        url,
        outro: `This invitation expires in ${INVITE_TTL_DAYS} days.`,
      }),
    );
    return { invite: this.toInvite(row, ctx.actor.name), url };
  }

  async revokeInvite(orgId: string, inviteId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(inviteId)) throw notFound("Invite");
    const res = await this.db.delete(invites).where(and(eq(invites.orgId, orgId), eq(invites.id, inviteId))).returning({ id: invites.id });
    if (!res.length) throw notFound("Invite");
  }

  async findInvite(token: string) {
    const [row] = await this.db
      .select({ invite: invites, orgName: orgs.name, orgSlug: orgs.slug, inviter: users.name })
      .from(invites)
      .innerJoin(orgs, eq(orgs.id, invites.orgId))
      .leftJoin(users, eq(users.id, invites.invitedBy))
      .where(eq(invites.tokenHash, sha256(token)));
    if (!row || row.invite.acceptedAt || row.invite.expiresAt < new Date()) throw new AppError(404, "This invitation is invalid or has expired");
    return row;
  }

  async previewInvite(token: string): Promise<InvitePreview> {
    const row = await this.findInvite(token);
    const [account] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, row.invite.email));
    return {
      orgName: row.orgName,
      orgSlug: row.orgSlug,
      email: row.invite.email,
      role: row.invite.role,
      invitedBy: row.inviter,
      accountExists: !!account,
    };
  }

  /** Adds the user to the org (and invited teams) and marks the invite used. */
  async consumeInvite(tx: Executor, inviteId: string, orgId: string, userId: string, role: OrgRole, teamIds: string[]) {
    await tx.insert(orgMembers).values({ orgId, userId, role }).onConflictDoNothing();
    if (teamIds.length) {
      await tx.insert(teamMembers).values(teamIds.map((teamId) => ({ teamId, userId }))).onConflictDoNothing();
    }
    await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, inviteId));
  }
}
