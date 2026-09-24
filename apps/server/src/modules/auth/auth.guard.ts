import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ORG_ROLE_PERMISSIONS } from "@flowboard/shared";
import { NO_ORG, PUBLIC } from "../../core/context";
import { AppError } from "../../core/http";
import { AgentsService, isApiKey } from "../agents/agents.service";
import { OrgsService } from "../orgs/orgs.service";
import { AuthService } from "./auth.service";
import { verifyAccessToken } from "./crypto";

/**
 * Global guard:
 *  1. Authenticates `Authorization: Bearer <jwt>` (session must still exist → instant logout), or
 *     an AI agent's API key (`Bearer fb_…`), which is bound to one org and only reaches org routes.
 *  2. For org-scoped routes, resolves `X-Org: <slug|id>` and the caller's membership, building
 *     the RequestContext every service uses. Non-members get 404 so orgs can't be probed.
 * Routes opt out with @Public() (no auth) or @NoOrg() (auth, no org).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly orgs: OrgsService,
    private readonly agents: AgentsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const req = context.switchToHttp().getRequest<Request>();
    const flags = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, flags);

    const header = req.header("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;

    if (bearer && isApiKey(bearer)) {
      if (isPublic) return true;
      const ctx = await this.agents.authenticate(bearer);
      if (!ctx) throw new AppError(401, "Invalid, expired or revoked API key");
      if (this.reflector.getAllAndOverride<boolean>(NO_ORG, flags)) throw new AppError(403, "API keys can only call organization endpoints");
      // The key already names its org; a conflicting X-Org header is treated as a missing org.
      const orgRef = req.header("x-org");
      if (orgRef && orgRef !== ctx.orgSlug && orgRef !== ctx.orgId) throw new AppError(404, "Organization not found");
      req.ctx = ctx;
      return true;
    }

    if (bearer) {
      const claims = await verifyAccessToken(bearer);
      const session = claims ? await this.auth.sessionActive(claims.sid, claims.sub) : null;
      if (claims && session) req.auth = { userId: claims.sub, sessionId: claims.sid, ...session };
      else if (!isPublic) throw new AppError(401, "Your session has expired — sign in again");
    }
    if (isPublic) return true;
    if (!req.auth) throw new AppError(401, "Sign in to continue");
    if (this.reflector.getAllAndOverride<boolean>(NO_ORG, flags)) return true;

    const orgRef = req.header("x-org");
    if (!orgRef) throw new AppError(400, "Select an organization (X-Org header)");
    const membership = await this.orgs.membership(req.auth.userId, orgRef);
    if (!membership) throw new AppError(404, "Organization not found");
    req.ctx = {
      orgId: membership.id,
      orgSlug: membership.slug,
      orgRole: membership.role,
      orgPermissions: ORG_ROLE_PERMISSIONS[membership.role],
      userId: req.auth.userId,
      actor: { type: "user", id: req.auth.userId, name: req.auth.name },
    };
    return true;
  }
}
