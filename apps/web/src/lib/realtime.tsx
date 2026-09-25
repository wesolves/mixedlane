import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import type { LiveEvent, PresenceResource, PresenceUser } from "@mixedlane/shared";
import { useAuth } from "./auth";
import { getAccessToken, refreshSession } from "./session";

type Listener = (e: LiveEvent) => void;

interface Realtime {
  socket: Socket | null;
  connected: boolean;
  /** Subscribe to raw live events (returns an unsubscribe function). */
  subscribe: (l: Listener) => () => void;
}

const RealtimeContext = createContext<Realtime>({ socket: null, connected: false, subscribe: () => () => {} });

const VERB: Record<string, string> = { created: "created", updated: "updated", moved: "moved", deleted: "deleted" };

/** Which cached queries a live event makes stale. Keys match hooks/queries.ts and hooks/docs.ts. */
function invalidate(qc: QueryClient, e: LiveEvent) {
  const inv = (queryKey: readonly unknown[]) => void qc.invalidateQueries({ queryKey });
  switch (e.type) {
    case "item":
      inv(["tree"]);
      inv(["item"]);
      inv(["activity", e.itemId]);
      inv(["projects"]);
      break;
    case "comment":
      inv(["comments", e.itemId]);
      inv(["activity", e.itemId]);
      inv(["tree"]);
      inv(["item"]);
      break;
    case "project":
      inv(["projects"]);
      inv(["project"]);
      inv(["tree"]);
      if (e.action === "access") inv(["docs"]);
      break;
    case "space":
      inv(["docs", "spaces"]);
      inv(["docs", "space"]);
      break;
    case "page":
      inv(["docs", "tree"]);
      inv(["docs", "spaces"]);
      // The open page itself is refreshed by the page view (it may be mid-edit).
      if (e.action !== "updated") inv(["docs", "page", e.pageId]);
      inv(["docs", "versions", e.pageId]);
      inv(["docs", "item-pages"]);
      break;
    case "notification":
      inv(["notifications"]);
      break;
  }
}

/** A short toast for changes made by someone else (people, agents, GitHub). */
function announce(e: LiveEvent, me: string | undefined) {
  if (e.type === "notification") {
    toast(e.notification.title, { description: e.notification.body || undefined, id: e.notification.id });
    return;
  }
  if (e.type !== "item" || e.actor.id === me) return;
  const who = e.actor.type === "agent" ? `🤖 ${e.actor.name}` : e.actor.name;
  // One toast per item, so a burst of edits doesn't stack up.
  toast(`${who} ${VERB[e.action]} ${e.key}`, { description: e.title, id: `item-${e.itemId}` });
}

/**
 * Keeps one socket per org session. Live events invalidate the matching React Query caches, so
 * every open view updates when a teammate, an agent or GitHub changes something.
 */
export function RealtimeProvider({ org, children }: { org: string; children: ReactNode }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const me = useRef(user?.id);
  me.current = user?.id;
  const listeners = useRef(new Set<Listener>());
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = io({
      path: "/api/socket",
      transports: ["websocket"],
      // Called on every (re)connect, so a refreshed access token is always used.
      auth: (cb) => cb({ token: getAccessToken(), org }),
    });
    let everConnected = false;
    s.on("connect", () => {
      setConnected(true);
      // Anything could have changed while we were offline.
      if (everConnected) void qc.invalidateQueries();
      everConnected = true;
    });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", async (err) => {
      // Expired access token: refresh, then socket.io's own retry picks up the new one.
      if (err.message === "unauthorized" && (await refreshSession())) s.connect();
    });
    s.on("live", (e: LiveEvent) => {
      invalidate(qc, e);
      announce(e, me.current);
      for (const l of listeners.current) l(e);
    });
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [org, qc]);

  const subscribe = useCallback((l: Listener) => {
    listeners.current.add(l);
    return () => void listeners.current.delete(l);
  }, []);
  const value = useMemo<Realtime>(() => ({ socket, connected, subscribe }), [socket, connected, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);

/** Run `handler` for every live event while mounted. */
export function useLiveEvents(handler: Listener) {
  const { subscribe } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}

/**
 * Announces that you're viewing/editing `resource` and returns everyone else who is.
 * Re-joins after reconnects; leaves on unmount.
 */
export function usePresence(resource: PresenceResource | null, mode: PresenceUser["mode"] = "viewing") {
  const { socket, connected } = useRealtime();
  const { user } = useAuth();
  const [users, setUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    if (!socket || !connected || !resource) return;
    const onPresence = (p: { resource: string; users: PresenceUser[] }) => {
      if (p.resource === resource) setUsers(p.users);
    };
    socket.on("presence", onPresence);
    socket.emit("presence:join", { resource, mode }, (ack: { ok: boolean; users?: PresenceUser[] }) => {
      if (ack?.ok && ack.users) setUsers(ack.users);
    });
    return () => {
      socket.off("presence", onPresence);
      socket.emit("presence:leave", { resource });
      setUsers([]);
    };
  }, [socket, connected, resource, mode]);

  return users.filter((u) => u.userId !== user?.id);
}
