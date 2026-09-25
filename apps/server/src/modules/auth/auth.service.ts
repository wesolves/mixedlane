import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { AuthResponse, AuthUser } from "@mixedlane/shared";
import { config } from "../../core/config";
import { DB, type Db, type Executor } from "../../core/database/database";
import { authTokens, sessions, teams, users } from "../../core/database/schema";
import { AppError } from "../../core/http";
import { MailService, actionEmail } from "../../core/mail";
import { OrgsService } from "../orgs/orgs.service";
import { DUMMY_HASH, hashPassword, randomToken, sha256, signAccessToken, verifyPassword } from "./crypto";

type UserRow = typeof users.$inferSelect;

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

/** Everything the controller needs to answer and set cookies. */
export interface IssuedSession {
  response: AuthResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
  userId: string;
}

/** Window in which a just-rotated refresh token is still honoured (parallel tabs refreshing at once). */
/** A just-rotated token still works this long (parallel tabs, a response lost on a flaky network). */
const ROTATION_GRACE_MS = 60_000;

export const toAuthUser = (u: UserRow): AuthUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  avatarUrl: u.avatarUrl,
  emailVerified: !!u.emailVerifiedAt,
  sessionDays: u.sessionDays,
});

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly orgs: OrgsService,
    private readonly mail: MailService,
  ) {}

  /* ---------- Sessions ---------- */

  /**
   * Creates a session. Org lists are filled in by `withOrgs` *after* any surrounding transaction
   * commits — PGlite has a single connection, so querying outside an open transaction would deadlock.
   */
  private async issue(user: UserRow, meta: SessionMeta, familyId?: string, tx: Executor = this.db): Promise<IssuedSession> {
    const refreshToken = randomToken();
    // The user's "Stay signed in for" choice; every refresh issues a new token, so this is a sliding window.
    const days = user.sessionDays || config().REFRESH_TOKEN_TTL_DAYS;
    const refreshExpiresAt = new Date(Date.now() + days * 86400_000);
    const [session] = await tx
      .insert(sessions)
      .values({
        userId: user.id,
        familyId: familyId ?? crypto.randomUUID(),
        tokenHash: sha256(refreshToken),
        expiresAt: refreshExpiresAt,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        ip: meta.ip ?? null,
      })
      .returning();
    const accessToken = await signAccessToken({ sub: user.id, sid: session.id });
    return {
      refreshToken,
      refreshExpiresAt,
      userId: user.id,
      response: {
        accessToken,
        expiresIn: config().ACCESS_TOKEN_TTL_SECONDS,
        user: toAuthUser(user),
        orgs: [],
      },
    };
  }

  private async withOrgs(session: IssuedSession): Promise<IssuedSession> {
    session.response.orgs = await this.orgs.listForUser(session.userId);
    return session;
  }

  /** Is this session still valid? (Checked on every request so logout takes effect immediately.) */
  async sessionActive(sessionId: string, userId: string): Promise<{ email: string; name: string } | null> {
    const [row] = await this.db
      .select({ email: users.email, name: users.name })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
    // A session rotated away by /refresh stays valid for its access token's lifetime — only
    // explicit revocation (logout / reuse detection) ends it early; see revokeFamily.
    return row ?? null;
  }

  /* ---------- Register / login ---------- */

  async register(input: { name: string; email: string; password: string; orgName: string }, meta: SessionMeta) {
    const [taken] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (taken) throw new AppError(409, "An account with this email already exists — sign in instead");
    const passwordHash = await hashPassword(input.password);
    const issued = await this.db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ email: input.email, name: input.name, passwordHash }).returning();
      await this.orgs.create(user.id, input.orgName, undefined, tx);
      return { user, session: await this.issue(user, meta, undefined, tx) };
    });
    await this.sendVerification(issued.user);
    return this.withOrgs(issued.session);
  }

  async login(input: { email: string; password: string }, meta: SessionMeta) {
    const [user] = await this.db.select().from(users).where(eq(users.email, input.email));
    const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new AppError(401, "Incorrect email or password");
    return this.withOrgs(await this.issue(user, meta));
  }

  /**
   * Rotates a refresh token. Presenting an already-rotated token (outside a short grace window)
   * means it was stolen or replayed, so the whole session family is revoked.
   */
  async refresh(token: string | undefined, meta: SessionMeta) {
    if (!token) throw new AppError(401, "Not signed in");
    const [session] = await this.db.select().from(sessions).where(eq(sessions.tokenHash, sha256(token)));
    if (!session || session.expiresAt < new Date()) throw new AppError(401, "Session expired — sign in again");
    if (session.revokedAt) {
      const recentRotation = Date.now() - session.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (!recentRotation) {
        await this.revokeFamily(session.familyId);
        throw new AppError(401, "Session was revoked — sign in again");
      }
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, session.userId));
    if (!user) throw new AppError(401, "Not signed in");
    const issued = await this.db.transaction(async (tx) => {
      if (!session.revokedAt) await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.id));
      return this.issue(user, meta, session.familyId, tx);
    });
    return this.withOrgs(issued);
  }

  private async revokeFamily(familyId: string) {
    // Deleting (not just flagging) the family also kills its access tokens via sessionActive().
    await this.db.delete(sessions).where(eq(sessions.familyId, familyId));
  }

  async logout(token: string | undefined, sessionId?: string) {
    if (token) {
      const [s] = await this.db.select({ familyId: sessions.familyId }).from(sessions).where(eq(sessions.tokenHash, sha256(token)));
      if (s) await this.revokeFamily(s.familyId);
    }
    if (sessionId) {
      const [s] = await this.db.select({ familyId: sessions.familyId }).from(sessions).where(eq(sessions.id, sessionId));
      if (s) await this.revokeFamily(s.familyId);
    }
  }

  async logoutEverywhere(userId: string) {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async me(userId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new AppError(401, "Not signed in");
    return { user: toAuthUser(user), orgs: await this.orgs.listForUser(userId) };
  }

  async updateProfile(userId: string, patch: { name?: string; avatarUrl?: string | null; sessionDays?: number }) {
    const [user] = await this.db.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
    return toAuthUser(user);
  }

  async changePassword(userId: string, sessionId: string, current: string, next: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user || !(await verifyPassword(current, user.passwordHash))) throw new AppError(400, "Current password is incorrect");
    await this.db.update(users).set({ passwordHash: await hashPassword(next), updatedAt: new Date() }).where(eq(users.id, userId));
    // Sign out every other device.
    const [mine] = await this.db.select({ familyId: sessions.familyId }).from(sessions).where(eq(sessions.id, sessionId));
    const others = await this.db.select({ familyId: sessions.familyId }).from(sessions).where(eq(sessions.userId, userId));
    for (const f of new Set(others.map((o) => o.familyId))) if (f !== mine?.familyId) await this.revokeFamily(f);
  }

  /* ---------- Email tokens ---------- */

  private async createToken(userId: string, purpose: "password_reset" | "email_verify", ttlMs: number) {
    const token = randomToken();
    await this.db.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));
    await this.db.insert(authTokens).values({ userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) });
    return token;
  }

  private async consumeToken(token: string, purpose: "password_reset" | "email_verify") {
    const [row] = await this.db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
      .returning();
    if (!row) throw new AppError(400, "This link is invalid or has expired");
    return row.userId;
  }

  async sendVerification(user: UserRow) {
    if (user.emailVerifiedAt) return;
    const token = await this.createToken(user.id, "email_verify", 3 * 86400_000);
    await this.mail.send(
      actionEmail({
        to: user.email,
        subject: "Confirm your email for Mixedlane",
        intro: `Hi ${user.name}, please confirm your email address.`,
        action: "Confirm email",
        url: `${config().APP_URL}/verify-email?token=${token}`,
      }),
    );
  }

  async resendVerification(userId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (user) await this.sendVerification(user);
  }

  async verifyEmail(token: string) {
    const userId = await this.consumeToken(token, "email_verify");
    await this.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
  }

  /** Always succeeds (doesn't reveal whether the email has an account). */
  async forgotPassword(email: string) {
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    if (!user) return;
    const token = await this.createToken(user.id, "password_reset", 60 * 60_000);
    await this.mail.send(
      actionEmail({
        to: user.email,
        subject: "Reset your Mixedlane password",
        intro: `Hi ${user.name}, someone asked to reset your password. The link works for one hour.`,
        action: "Choose a new password",
        url: `${config().APP_URL}/reset-password?token=${token}`,
        outro: "If you didn't ask for this, ignore this email — your password stays the same.",
      }),
    );
  }

  async resetPassword(token: string, password: string) {
    const userId = await this.consumeToken(token, "password_reset");
    // Reset proves control of the inbox, so the email counts as verified too.
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(password), emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
    await this.logoutEverywhere(userId);
  }

  /* ---------- Invites ---------- */

  /**
   * Accept as the signed-in user (email must match) or create the account inline.
   * Returns a session when an account was created.
   */
  async acceptInvite(token: string, input: { name?: string; password?: string }, signedInUserId: string | null, meta: SessionMeta) {
    const { invite } = await this.orgs.findInvite(token);
    const validTeams = invite.teamIds.length
      ? (await this.db.select({ id: teams.id }).from(teams).where(and(eq(teams.orgId, invite.orgId), inArray(teams.id, invite.teamIds)))).map((t) => t.id)
      : [];

    if (signedInUserId) {
      const [user] = await this.db.select().from(users).where(eq(users.id, signedInUserId));
      if (!user || user.email !== invite.email) {
        throw new AppError(403, `This invitation is for ${invite.email}. Sign in with that account to accept it.`);
      }
      await this.db.transaction((tx) => this.orgs.consumeInvite(tx, invite.id, invite.orgId, user.id, invite.role, validTeams));
      return { orgs: await this.orgs.listForUser(user.id), session: null };
    }

    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, invite.email));
    if (existing) throw new AppError(409, "You already have an account — sign in to accept this invitation");
    if (!input.name || !input.password) throw new AppError(400, "Enter your name and a password to create your account");
    const passwordHash = await hashPassword(input.password);
    const session = await this.db.transaction(async (tx) => {
      // The invite link proves the email address.
      const [user] = await tx.insert(users).values({ email: invite.email, name: input.name!, passwordHash, emailVerifiedAt: new Date() }).returning();
      await this.orgs.consumeInvite(tx, invite.id, invite.orgId, user.id, invite.role, validTeams);
      return this.issue(user, meta, undefined, tx);
    });
    await this.withOrgs(session);
    return { orgs: session.response.orgs, session };
  }
}
