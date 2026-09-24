import { Body, Controller, Get, HttpCode, Module, Param, Post, Query, Res, type INestApplication } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { Ctx, NoOrg, Public, type RequestContext } from "../../core/context";
import { ZBody } from "../../core/zod-body";
import { OAuthError, OAuthService } from "./oauth.service";

const approveSchema = z.object({
  clientId: z.string().uuid(),
  redirectUri: z.string().min(1).max(2000),
  codeChallenge: z.string().min(43).max(128),
  codeChallengeMethod: z.literal("S256").default("S256"),
  state: z.string().max(2000).optional(),
  agentId: z.string().uuid().optional(),
  newAgent: z.object({ name: z.string().trim().max(80), projectIds: z.array(z.string().uuid()).max(100).default([]) }).optional(),
});

/** OAuth errors use the RFC 6749 shape, not the app's `{ error: message }`. */
function sendOAuth(res: Response, fn: () => Promise<unknown>, status = 200) {
  res.setHeader("cache-control", "no-store");
  return fn().then(
    (body) => res.status(status).json(body),
    (err) => {
      if (err instanceof OAuthError) return res.status(err.status).json({ error: err.code, error_description: err.message });
      throw err;
    },
  );
}

@ApiExcludeController()
@Controller("oauth")
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  /** RFC 7591 dynamic client registration (public, like every MCP-capable authorization server). */
  @Public()
  @Post("register")
  register(@Body() body: Record<string, unknown>, @Res() res: Response) {
    return sendOAuth(res, () => this.oauth.register(body ?? {}), 201);
  }

  /** Exchanges a PKCE authorization code for an agent API key. */
  @Public()
  @Post("token")
  @HttpCode(200)
  token(@Body() body: Record<string, unknown>, @Res() res: Response) {
    return sendOAuth(res, () => this.oauth.token(body ?? {}));
  }

  /** For the consent screen: who is asking, and where they'll be sent back to. */
  @NoOrg()
  @Get("clients/:id")
  async client(@Param("id") id: string, @Query("code_challenge") codeChallenge?: string) {
    const c = await this.oauth.client(id);
    // Lets the consent page spot an old, already-approved link before anyone clicks Allow.
    return { id: c.id, name: c.name, redirectUris: c.redirectUris, linkUsed: await this.oauth.linkUsed(c.id, codeChallenge ?? "") };
  }

  /** The signed-in admin approves: returns the redirect URL (with the code) for the browser. */
  @Post("authorize")
  @HttpCode(200)
  approve(@Ctx() ctx: RequestContext, @ZBody(approveSchema) body: z.output<typeof approveSchema>) {
    return this.oauth.approve(ctx, body);
  }
}

@Module({ controllers: [OAuthController], providers: [OAuthService], exports: [OAuthService] })
export class OAuthModule {}

/**
 * Discovery documents live at the site root, outside the /api prefix:
 *   /.well-known/oauth-protected-resource[/api/mcp]   (RFC 9728)
 *   /.well-known/oauth-authorization-server[/…]       (RFC 8414)
 *   /.well-known/openid-configuration                 (some clients look here first)
 */
export function mountWellKnown(app: INestApplication) {
  const oauth = app.get(OAuthService);
  const json = (build: (req: Request) => unknown) => (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("cache-control", "public, max-age=300");
    res.json(build(req));
  };
  app.use("/.well-known/oauth-protected-resource", json((req) => oauth.resourceMetadata(req)));
  app.use("/.well-known/oauth-authorization-server", json((req) => oauth.serverMetadata(req)));
  app.use("/.well-known/openid-configuration", json((req) => oauth.serverMetadata(req)));
}
