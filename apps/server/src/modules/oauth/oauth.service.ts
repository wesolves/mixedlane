import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { DEFAULT_AGENT_PERMISSIONS } from "@mixedlane/shared";
import { config } from "../../core/config";
import type { RequestContext } from "../../core/context";
import { DB, type Db } from "../../core/database/database";
import { oauthClients, oauthCodes } from "../../core/database/schema";
import { AppError, notFound } from "../../core/http";
import { AccessService } from "../access/access.service";
import { AgentsService } from "../agents/agents.service";
import { sha256 } from "../auth/crypto";

const CODE_TTL_MS = 10 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MCP_PATH = "/api/mcp";

/** An OAuth protocol error (RFC 6749 §5.2), returned as `{ error, error_description }`. */
export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** The public origin a request arrived on (honours X-Forwarded-* behind a trusted proxy). */
export const originOf = (req: Request) => `${req.protocol}://${req.get("host")}`;

/**
 * Redirect URIs we accept at registration: loopback/http(s) callbacks and app schemes
 * (e.g. vscode://). Never script-capable schemes.
 */
function validRedirect(uri: string) {
  try {
    const u = new URL(uri);
    if (["javascript:", "data:", "file:", "blob:", "about:"].includes(u.protocol)) return false;
    return !u.hash;
  } catch {
    return false;
  }
}

/**
 * OAuth 2.1 for MCP clients (Copilot, Claude, …) that sign in through the browser instead of
 * being given an API key:
 *   discovery (RFC 9728 + RFC 8414) → dynamic client registration (RFC 7591) → consent in the web
 *   app, where an org admin picks or creates the agent → PKCE code → token.
 * The access token *is* an agent API key ("OAuth · <client>"), so it carries exactly that agent's
 * permissions and can be revoked from the agent's settings like any other key.
 */
@Injectable()
export class OAuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly agents: AgentsService,
    private readonly access: AccessService,
  ) {}

  /* ---------- Discovery ---------- */

  /**
   * Where the consent page lives. In a single-container deploy that's this origin. In development
   * the web app runs on its own port: if the client talked to the API port directly, point it at
   * APP_URL's port on the same host the client used.
   */
  webOrigin(req: Request) {
    const origin = originOf(req);
    // Production (web app served by this server, or by nginx on the same origin): same origin.
    if (config().WEB_DIST || config().NODE_ENV === "production") return origin;
    const u = new URL(origin);
    if (Number(u.port || 80) !== config().PORT) return origin;
    const app = new URL(config().APP_URL);
    app.hostname = u.hostname;
    return app.origin;
  }

  resourceMetadata(req: Request) {
    const origin = originOf(req);
    return {
      resource: `${origin}${MCP_PATH}`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mixedlane"],
      resource_name: "Mixedlane",
      resource_documentation: `${this.webOrigin(req)}/`,
    };
  }

  serverMetadata(req: Request) {
    const origin = originOf(req);
    return {
      issuer: origin,
      authorization_endpoint: `${this.webOrigin(req)}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mixedlane"],
    };
  }

  /* ---------- Registration ---------- */

  async register(body: { client_name?: unknown; redirect_uris?: unknown }) {
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
    if (!uris.length || uris.length > 10 || !uris.every(validRedirect)) {
      throw new OAuthError("invalid_redirect_uri", "Provide 1-10 valid redirect_uris");
    }
    const name = (typeof body.client_name === "string" && body.client_name.trim().slice(0, 80)) || "MCP client";
    const [client] = await this.db.insert(oauthClients).values({ name, redirectUris: uris }).returning();
    return {
      client_id: client.id,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    };
  }

  /**
   * Has an approval already been given for this exact sign-in attempt? Each attempt has its own
   * PKCE challenge, so a match means someone opened an old link (the app has stopped waiting).
   */
  async linkUsed(clientId: string, codeChallenge: string) {
    if (!UUID.test(clientId) || !codeChallenge) return false;
    const [hit] = await this.db
      .select({ id: oauthCodes.id })
      .from(oauthCodes)
      .where(and(eq(oauthCodes.clientId, clientId), eq(oauthCodes.codeChallenge, codeChallenge)));
    return !!hit;
  }

  async client(id: string) {
    if (!UUID.test(id)) throw notFound("OAuth client");
    const [c] = await this.db.select().from(oauthClients).where(eq(oauthClients.id, id));
    if (!c) throw notFound("OAuth client");
    return c;
  }

  /* ---------- Consent ---------- */

  /**
   * The signed-in org admin approved the client: pick (or create) the agent it will act as and
   * return the redirect carrying a single-use code.
   */
  async approve(
    ctx: RequestContext,
    input: { clientId: string; redirectUri: string; codeChallenge: string; codeChallengeMethod?: string; state?: string; agentId?: string; newAgent?: { name: string; projectIds: string[] } },
  ) {
    this.agents.assertManageable(ctx);
    const client = await this.client(input.clientId);
    if (!client.redirectUris.includes(input.redirectUri)) throw new AppError(400, "That redirect URI isn't registered for this client");
    if ((input.codeChallengeMethod ?? "S256") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) {
      throw new AppError(400, "A PKCE S256 code_challenge is required");
    }

    if (await this.linkUsed(client.id, input.codeChallenge)) {
      throw new AppError(409, "This sign-in link was already used. Start the sign-in again from your app — it opens a fresh link.");
    }
    // A new agent is only created when the app redeems the code (see token()), so abandoned
    // sign-ins never leave half-configured agents behind.
    const agentId = input.agentId ?? null;
    if (agentId) await this.agents.get(ctx, agentId); // 404s for agents outside this org
    const newAgent = agentId ? null : { name: (input.newAgent?.name?.trim() || client.name).slice(0, 80), projectIds: input.newAgent?.projectIds ?? [] };

    const code = randomBytes(32).toString("base64url");
    await this.db.insert(oauthCodes).values({
      codeHash: sha256(code),
      clientId: client.id,
      orgId: ctx.orgId,
      agentId,
      newAgent,
      userId: ctx.userId!,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    const url = new URL(input.redirectUri);
    url.searchParams.set("code", code);
    if (input.state) url.searchParams.set("state", input.state);
    return { redirect: url.toString(), agentId };
  }

  /* ---------- Token ---------- */

  async token(body: Record<string, unknown>) {
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
    if (str("grant_type") !== "authorization_code") throw new OAuthError("unsupported_grant_type", "Only authorization_code is supported");
    const [code, verifier, clientId, redirectUri] = [str("code"), str("code_verifier"), str("client_id"), str("redirect_uri")];
    if (!code || !verifier) throw new OAuthError("invalid_request", "code and code_verifier are required");

    // Claim the code atomically: it can only ever be redeemed once.
    const [row] = await this.db
      .update(oauthCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(oauthCodes.codeHash, sha256(code)), isNull(oauthCodes.usedAt), gt(oauthCodes.expiresAt, new Date())))
      .returning();
    if (!row) throw new OAuthError("invalid_grant", "The authorization code is invalid, expired or already used");
    if (clientId && clientId !== row.clientId) throw new OAuthError("invalid_grant", "The code was issued to another client");
    if (redirectUri && redirectUri !== row.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri doesn't match the authorization request");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (challenge !== row.codeChallenge) throw new OAuthError("invalid_grant", "PKCE verification failed");

    const ctx = await this.access.contextFor(row.orgId, row.userId);
    if (!ctx || !ctx.orgPermissions.includes("agent.manage")) throw new OAuthError("invalid_grant", "The approving user can no longer manage agents");
    const client = await this.client(row.clientId);
    let agentId = row.agentId;
    if (!agentId) {
      const spec = row.newAgent ?? { name: client.name, projectIds: [] };
      const existing = (await this.agents.list(ctx)).map((a) => a.name.toLowerCase());
      let name = spec.name;
      for (let i = 2; existing.includes(name.toLowerCase()); i++) name = `${spec.name} ${i}`;
      const { agent } = await this.agents.create(ctx, { name, description: `Connected via OAuth (${client.name})`, docAccess: "read" });
      for (const projectId of spec.projectIds) {
        await this.agents.setGrant(ctx, agent.id, { projectId, permissions: [...DEFAULT_AGENT_PERMISSIONS] }).catch(() => undefined);
      }
      // The key minted at creation isn't needed — this client gets its own key below.
      await this.agents.revokeKey(ctx, agent.id, agent.keys[0].id);
      agentId = agent.id;
    }
    const { secret } = await this.agents.createKey(ctx, agentId, { name: `OAuth · ${client.name}` });
    return { access_token: secret, token_type: "Bearer", scope: "mixedlane" };
  }
}
