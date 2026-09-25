import { Logger, Module, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type { LiveActor, LiveEvent, PresenceResource, PresenceUser } from "@mixedlane/shared";
import { originAllowed } from "../../core/config";
import type { Actor, RequestContext } from "../../core/context";
import { EventBus } from "../../core/events";
import { AccessService } from "../access/access.service";
import { AgentsService, isApiKey } from "../agents/agents.service";
import { AuthService } from "../auth/auth.service";
import { verifyAccessToken } from "../auth/crypto";
import { OrgsService } from "../orgs/orgs.service";
import { DocsModule } from "../docs/docs.controller";
import { DocsService } from "../docs/docs.service";
import { toNotificationDto } from "../notifications/notifications.service";

/** What we remember about each authenticated socket. */
interface SocketData {
  /** For agents: the agent id (presence and self-filtering use it like a user id). */
  userId: string;
  sessionId: string;
  name: string;
  orgId: string;
  /** Set for agents connecting with an API key (re-verified on every recheck). */
  apiKey?: string;
}
type LiveSocket = Socket<Record<string, never>, Record<string, never>, Record<string, never>, SocketData>;

const RECHECK_MS = 30_000;
const liveActor = (a: Actor): LiveActor => ({ type: a.type, id: a.id, name: a.name });
const rooms = {
  org: (orgId: string) => `org:${orgId}`,
  user: (orgId: string, userId: string) => `user:${orgId}:${userId}`,
  project: (id: string) => `project:${id}`,
  space: (id: string) => `space:${id}`,
  presence: (r: string) => `presence:${r}`,
};

/**
 * Realtime channel at /api/socket (socket.io).
 *
 * Handshake: `auth: { token: <access JWT>, org: <slug|id> }`, or `auth: { token: <agent API key> }`. The session must be live and the
 * user a member of the org. Each socket is placed in rooms for its org, itself, and every project
 * and space it can read; rooms are re-synced when access changes and every 30s (which also drops
 * sockets whose session was revoked).
 *
 * Server → client: `live` (LiveEvent), `presence` ({ resource, users }).
 * Client → server: `presence:join` ({ resource, mode }), `presence:leave` ({ resource }).
 * Events only carry ids and summaries; clients refetch through the permission-checked REST API.
 */
@WebSocketGateway({
  path: "/api/socket",
  cors: { origin: (origin: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => cb(null, originAllowed(origin)), credentials: true },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleInit, OnApplicationShutdown {
  @WebSocketServer() server!: Server;
  private readonly log = new Logger("Realtime");
  /** resource → socket id → viewer */
  private readonly presence = new Map<string, Map<string, PresenceUser>>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly auth: AuthService,
    private readonly orgs: OrgsService,
    private readonly access: AccessService,
    private readonly docs: DocsService,
    private readonly events: EventBus,
    private readonly agents: AgentsService,
  ) {}

  /* ---------- Connection lifecycle ---------- */

  afterInit(server: Server) {
    server.use((socket, next) => {
      this.authenticate(socket as LiveSocket).then(
        () => next(),
        (err: Error) => next(err),
      );
    });
    this.timer = setInterval(() => void this.recheckAll().catch((e) => this.log.warn(`recheck failed: ${e}`)), RECHECK_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  private async authenticate(socket: LiveSocket) {
    const { token, org } = (socket.handshake.auth ?? {}) as { token?: string; org?: string };
    if (token && isApiKey(token)) {
      const ctx = await this.agents.authenticate(token);
      if (!ctx?.agent) throw new Error("unauthorized");
      socket.data = { userId: ctx.agent.id, sessionId: ctx.agent.keyId, name: ctx.actor.name, orgId: ctx.orgId, apiKey: token };
      await this.sync(socket);
      return;
    }
    const claims = token ? await verifyAccessToken(token) : null;
    const session = claims ? await this.auth.sessionActive(claims.sid, claims.sub) : null;
    if (!claims || !session) throw new Error("unauthorized");
    const membership = org ? await this.orgs.membership(claims.sub, org) : null;
    if (!membership) throw new Error("org_not_found");
    socket.data = { userId: claims.sub, sessionId: claims.sid, name: session.name, orgId: membership.id };
    // Join rooms before the client sees "connect", so no event slips through.
    await this.sync(socket);
  }

  handleDisconnect(socket: LiveSocket) {
    for (const resource of [...this.presence.keys()]) this.dropPresence(socket, resource);
  }

  /** Current context for a socket (null = no longer a member). */
  private context(socket: LiveSocket): Promise<RequestContext | null> {
    if (socket.data.apiKey) return this.agents.authenticate(socket.data.apiKey);
    return this.access.contextFor(socket.data.orgId, socket.data.userId);
  }

  /** Puts the socket in exactly the rooms it may listen to. */
  private async sync(socket: LiveSocket) {
    const ctx = await this.context(socket);
    if (!ctx) {
      socket.disconnect(true);
      return;
    }
    const { orgId, userId } = socket.data;
    const [projectIds, spaceIds] = await Promise.all([this.access.readableProjectIds(ctx), this.docs.readableSpaceIds(ctx)]);
    const want = new Set([rooms.org(orgId), rooms.user(orgId, userId), ...projectIds.map(rooms.project), ...spaceIds.map(rooms.space)]);
    for (const room of socket.rooms) {
      if (room === socket.id || room.startsWith("presence:") || want.has(room)) continue;
      void socket.leave(room);
    }
    void socket.join([...want]);
  }

  /** Re-syncs every socket in an org (after an access change). */
  private async syncOrg(orgId: string) {
    const sockets = (await this.server.in(rooms.org(orgId)).fetchSockets()) as unknown as LiveSocket[];
    for (const s of sockets) {
      const live = this.server.sockets.sockets.get(s.id) as LiveSocket | undefined;
      if (live) await this.sync(live);
    }
  }

  /** Drops sockets whose session ended or membership was removed; refreshes rooms for the rest. */
  async recheckAll() {
    for (const socket of this.server.sockets.sockets.values() as IterableIterator<LiveSocket>) {
      if (!socket.data?.userId) continue;
      const active = socket.data.apiKey
        ? await this.agents.keyActive(socket.data.sessionId)
        : await this.auth.sessionActive(socket.data.sessionId, socket.data.userId);
      if (!active) {
        socket.disconnect(true);
        continue;
      }
      await this.sync(socket);
    }
  }

  /* ---------- Presence ---------- */

  private viewers(resource: string): PresenceUser[] {
    // One entry per user; "editing" wins over "viewing" across their tabs.
    const byUser = new Map<string, PresenceUser>();
    for (const p of this.presence.get(resource)?.values() ?? []) {
      const prev = byUser.get(p.userId);
      if (!prev || p.mode === "editing") byUser.set(p.userId, p);
    }
    return [...byUser.values()];
  }

  private broadcastPresence(resource: string) {
    this.server.to(rooms.presence(resource)).emit("presence", { resource, users: this.viewers(resource) });
  }

  private dropPresence(socket: LiveSocket, resource: string) {
    const entries = this.presence.get(resource);
    if (!entries?.delete(socket.id)) return;
    if (!entries.size) this.presence.delete(resource);
    void socket.leave(rooms.presence(resource));
    this.broadcastPresence(resource);
  }

  private async canView(ctx: RequestContext, resource: string) {
    const [kind, id] = resource.split(":");
    try {
      if (kind === "item") await this.access.item(ctx, id, "project.read");
      else if (kind === "page") await this.docs.page(ctx, id);
      else return false;
      return true;
    } catch {
      return false;
    }
  }

  @SubscribeMessage("presence:join")
  async presenceJoin(@ConnectedSocket() socket: LiveSocket, @MessageBody() body: { resource?: PresenceResource; mode?: PresenceUser["mode"] }) {
    const resource = String(body?.resource ?? "");
    const ctx = await this.context(socket);
    if (!ctx || !(await this.canView(ctx, resource))) return { ok: false, error: "not_found" };
    const entries = this.presence.get(resource) ?? new Map<string, PresenceUser>();
    entries.set(socket.id, { userId: socket.data.userId, name: socket.data.name, mode: body?.mode === "editing" ? "editing" : "viewing" });
    this.presence.set(resource, entries);
    await socket.join(rooms.presence(resource));
    this.broadcastPresence(resource);
    return { ok: true, users: this.viewers(resource) };
  }

  @SubscribeMessage("presence:leave")
  presenceLeave(@ConnectedSocket() socket: LiveSocket, @MessageBody() body: { resource?: string }) {
    this.dropPresence(socket, String(body?.resource ?? ""));
    return { ok: true };
  }

  /* ---------- Domain events → rooms ---------- */

  private send(room: string, event: LiveEvent) {
    this.server.to(room).emit("live", event);
  }

  onModuleInit() {
    this.events.on("item", ({ item, action, actor }) =>
      this.send(rooms.project(item.projectId), {
        type: "item",
        action,
        projectId: item.projectId,
        itemId: item.id,
        key: item.key,
        itemType: item.type,
        title: item.title,
        status: item.status,
        actor: liveActor(actor),
      }),
    );
    this.events.on("comment", ({ item, action, actor }) =>
      this.send(rooms.project(item.projectId), { type: "comment", action, projectId: item.projectId, itemId: item.id, key: item.key, actor: liveActor(actor) }),
    );
    this.events.on("project", async ({ orgId, projectId, action, actor }) => {
      // Access may have changed: fix room membership before telling anyone.
      if (action !== "updated" || !(await this.server.in(rooms.project(projectId)).fetchSockets()).length) await this.syncOrg(orgId);
      this.send(rooms.org(orgId), { type: "project", action, projectId, actor: liveActor(actor) });
    });
    this.events.on("space", async ({ orgId, spaceId, action, actor }) => {
      await this.syncOrg(orgId);
      this.send(rooms.org(orgId), { type: "space", action, spaceId, actor: liveActor(actor) });
    });
    this.events.on("page", ({ page, action, actor }) =>
      this.send(rooms.space(page.spaceId), {
        type: "page",
        action,
        spaceId: page.spaceId,
        pageId: page.id,
        title: page.title,
        version: page.version,
        actor: liveActor(actor),
      }),
    );
    this.events.on("notification", ({ notification }) =>
      this.send(rooms.user(notification.orgId, notification.userId), { type: "notification", notification: toNotificationDto(notification) }),
    );
  }
}

@Module({ imports: [DocsModule], providers: [RealtimeGateway], exports: [RealtimeGateway] })
export class RealtimeModule {}
