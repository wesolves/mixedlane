import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { OrgPermission, OrgRole, ProjectAccessInfo } from "@mixedlane/shared";
import type { ActorType } from "./database/schema";

/** Who is acting. Stored on comments/activity and used for permission checks. */
export interface Actor {
  type: ActorType;
  id: string | null;
  name: string;
}

/** The authenticated principal (set by the auth guard). */
export interface AuthInfo {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
}

/** Org-scoped request context. Every tenant query is scoped by `orgId`. */
export interface RequestContext {
  orgId: string;
  orgSlug: string;
  orgRole: OrgRole;
  orgPermissions: OrgPermission[];
  userId: string | null;
  /** Set when an AI agent calls with an API key (userId is then null). */
  agent?: { id: string; keyId: string; name: string; docAccess: "none" | "read" | "write"; planningMode: "auto" | "propose"; canCreateProjects: boolean };
  actor: Actor;
  /** Per-request cache of resolved project access (see AccessService). */
  accessCache?: Map<string, ProjectAccessInfo | null>;
}

declare module "express" {
  interface Request {
    auth?: AuthInfo;
    ctx?: RequestContext;
  }
}

/** Skip authentication entirely (login, webhooks, invite previews…). */
export const PUBLIC = "mixedlane:public";
export const Public = () => SetMetadata(PUBLIC, true);

/** Authenticated, but not tied to an organization (e.g. /auth/me, list/create orgs). */
export const NO_ORG = "mixedlane:no-org";
export const NoOrg = () => SetMetadata(NO_ORG, true);

/** Injects the org-scoped RequestContext into a controller method. */
export const Ctx = createParamDecorator((_data: unknown, host: ExecutionContext): RequestContext => {
  const req = host.switchToHttp().getRequest<Request>();
  if (!req.ctx) throw new Error("RequestContext missing — is this route marked @NoOrg/@Public by mistake?");
  return req.ctx;
});

/** Injects the authenticated user (routes that aren't org-scoped). */
export const Auth = createParamDecorator((_data: unknown, host: ExecutionContext): AuthInfo => {
  const req = host.switchToHttp().getRequest<Request>();
  if (!req.auth) throw new Error("AuthInfo missing — route is public");
  return req.auth;
});

export const systemActor = (name = "System"): Actor => ({ type: "system", id: null, name });
