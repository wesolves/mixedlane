import { Controller, Get, HttpCode, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  inviteAcceptSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from "@flowboard/shared";
import { config, secureCookies } from "../../core/config";
import { Auth, NoOrg, Public, type AuthInfo } from "../../core/context";
import { AppError } from "../../core/http";
import { ZBody } from "../../core/zod-body";
import { OrgsService } from "../orgs/orgs.service";
import { AuthService, type IssuedSession, type SessionMeta } from "./auth.service";
import { signFileToken } from "./crypto";

export const REFRESH_COOKIE = "fb_rt";
export const FILE_COOKIE = "fb_file";

const meta = (req: Request): SessionMeta => ({ userAgent: req.header("user-agent"), ip: req.ip });

/** Refresh token: httpOnly, only ever sent to /api/auth. File token: lets <img>/<video> load uploads. */
async function setSessionCookies(res: Response, s: IssuedSession) {
  const secure = secureCookies();
  res.cookie(REFRESH_COOKIE, s.refreshToken, { httpOnly: true, secure, sameSite: "lax", path: "/api/auth", expires: s.refreshExpiresAt });
  res.cookie(FILE_COOKIE, await signFileToken(s.userId), { httpOnly: true, secure, sameSite: "lax", path: "/api/uploads", maxAge: 86400_000 });
}

function clearSessionCookies(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  res.clearCookie(FILE_COOKIE, { path: "/api/uploads" });
}

const limit = () => ({ default: { limit: config().AUTH_RATE_LIMIT, ttl: 60_000 } });

@ApiTags("Auth")
@Controller("auth")
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly orgs: OrgsService,
  ) {}

  @Public()
  @Throttle(limit())
  @Post("register")
  @ApiOperation({ summary: "Create an account and its first organization" })
  async register(@ZBody(registerSchema) body: { name: string; email: string; password: string; orgName: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.register(body, meta(req));
    await setSessionCookies(res, session);
    return session.response;
  }

  @Public()
  @Throttle(limit())
  @Post("login")
  @HttpCode(200)
  async login(@ZBody(loginSchema) body: { email: string; password: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.login(body, meta(req));
    await setSessionCookies(res, session);
    return session.response;
  }

  /** Rotates the refresh cookie. Requires X-Requested-With so cross-site forms can't trigger it. */
  @Public()
  @Post("refresh")
  @HttpCode(200)
  @ApiOperation({ summary: "Exchange the refresh cookie for a new access token (send X-Requested-With: flowboard)" })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!req.header("x-requested-with")) throw new AppError(400, "Missing X-Requested-With header");
    // No cookie = simply signed out (every page load asks); answer quietly instead of 401.
    if (!req.cookies?.[REFRESH_COOKIE]) {
      res.status(204);
      return;
    }
    try {
      const session = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], meta(req));
      await setSessionCookies(res, session);
      return session.response;
    } catch (err) {
      clearSessionCookies(res);
      throw err;
    }
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE], req.auth?.sessionId);
    clearSessionCookies(res);
  }

  @NoOrg()
  @ApiBearerAuth()
  @Post("logout-all")
  @HttpCode(204)
  async logoutAll(@Auth() auth: AuthInfo, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutEverywhere(auth.userId);
    clearSessionCookies(res);
  }

  @NoOrg()
  @ApiBearerAuth()
  @Get("me")
  me(@Auth() auth: AuthInfo) {
    return this.auth.me(auth.userId);
  }

  @NoOrg()
  @ApiBearerAuth()
  @Patch("me")
  updateMe(@Auth() auth: AuthInfo, @ZBody(updateProfileSchema) body: { name?: string; avatarUrl?: string | null; sessionDays?: number }) {
    return this.auth.updateProfile(auth.userId, body);
  }

  @NoOrg()
  @ApiBearerAuth()
  @Post("change-password")
  @HttpCode(204)
  async changePassword(@Auth() auth: AuthInfo, @ZBody(changePasswordSchema) body: { currentPassword: string; newPassword: string }) {
    await this.auth.changePassword(auth.userId, auth.sessionId, body.currentPassword, body.newPassword);
  }

  @Public()
  @Throttle(limit())
  @Post("forgot-password")
  @HttpCode(204)
  async forgot(@ZBody(forgotPasswordSchema) body: { email: string }) {
    await this.auth.forgotPassword(body.email);
  }

  @Public()
  @Throttle(limit())
  @Post("reset-password")
  @HttpCode(204)
  async reset(@ZBody(resetPasswordSchema) body: { token: string; password: string }) {
    await this.auth.resetPassword(body.token, body.password);
  }

  @Public()
  @Post("verify-email")
  @HttpCode(204)
  async verify(@ZBody(verifyEmailSchema) body: { token: string }) {
    await this.auth.verifyEmail(body.token);
  }

  @NoOrg()
  @ApiBearerAuth()
  @Post("resend-verification")
  @HttpCode(204)
  async resend(@Auth() auth: AuthInfo) {
    await this.auth.resendVerification(auth.userId);
  }
}

/** Public invite links: preview, then accept (signed in, or creating the account inline). */
@ApiTags("Invites")
@Controller("invites")
export class InviteLinksController {
  constructor(
    private readonly auth: AuthService,
    private readonly orgs: OrgsService,
  ) {}

  @Public()
  @Get(":token")
  preview(@Param("token") token: string) {
    return this.orgs.previewInvite(token);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(limit())
  @Post(":token/accept")
  @HttpCode(200)
  async accept(
    @Param("token") token: string,
    @ZBody(inviteAcceptSchema) body: { name?: string; password?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.acceptInvite(token, body, req.auth?.userId ?? null, meta(req));
    if (result.session) {
      await setSessionCookies(res, result.session);
      return result.session.response;
    }
    return { orgs: result.orgs };
  }
}
