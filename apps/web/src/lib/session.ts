import type { AuthResponse } from "@flowboard/shared";

/**
 * Client-side session state. The access token lives only in memory (never localStorage, so XSS
 * can't lift a long-lived credential); the refresh token is an httpOnly cookie the browser sends
 * to /api/auth/refresh.
 *
 * Access tokens are short-lived (5 min), so they're refreshed in the background a minute before
 * they expire. A refresh only signs you out when the server says so (401) — if the server is
 * unreachable or erroring (restart, network blip), we keep the session and retry.
 */
let accessToken: string | null = null;
let expiresAt = 0;
let currentOrg: string | null = null;
let refreshing: Promise<AuthResponse | null> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let offline = false;
const listeners = new Set<(s: AuthResponse | null) => void>();
const offlineListeners = new Set<() => void>();

export const getAccessToken = () => accessToken;
export const getCurrentOrg = () => currentOrg;
export const setCurrentOrg = (slug: string | null) => {
  currentOrg = slug;
  try {
    if (slug) localStorage.setItem("lastOrg", slug);
  } catch {
    /* storage unavailable */
  }
};
export const lastOrg = () => {
  try {
    return localStorage.getItem("lastOrg");
  } catch {
    return null;
  }
};

/** Refresh a minute before the access token expires (never more often than every 15 s). */
function schedule(s: AuthResponse | null) {
  clearTimeout(timer);
  if (!s) {
    expiresAt = 0;
    return;
  }
  expiresAt = Date.now() + s.expiresIn * 1000;
  timer = setTimeout(() => void refreshSession(), Math.max(15_000, (s.expiresIn - 60) * 1000));
}

export function setSession(s: AuthResponse | null) {
  accessToken = s?.accessToken ?? null;
  schedule(s);
  for (const l of listeners) l(s);
}

/** Subscribe to session changes (login, refresh, logout, expiry). */
export function onSession(listener: (s: AuthResponse | null) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** "Can't reach the server right now" — for a reconnecting banner (useSyncExternalStore-friendly). */
export const isOffline = () => offline;
export function onOffline(listener: () => void) {
  offlineListeners.add(listener);
  return () => void offlineListeners.delete(listener);
}
function setOffline(v: boolean) {
  if (offline === v) return;
  offline = v;
  for (const l of offlineListeners) l();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share one request.
 * Resolves with the new session, or null once the server says the session is gone (401 / no
 * cookie). Network and server errors are retried with backoff and never sign you out.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "same-origin",
          headers: { "x-requested-with": "flowboard" },
        });
        if (res.ok && res.status !== 204) {
          const s = (await res.json()) as AuthResponse;
          setOffline(false);
          setSession(s);
          return s;
        }
        if (res.status === 204 || res.status === 401 || res.status === 403) {
          setOffline(false);
          setSession(null);
          return null;
        }
        // 5xx / 429 / proxy errors: the server is restarting or overloaded — keep the session.
      } catch {
        // Network error: same.
      }
      setOffline(true);
      await sleep(Math.min(1000 * 2 ** attempt, 15_000));
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// Background tabs throttle timers: when the tab comes back, refresh right away if the token is (nearly) expired.
if (typeof document !== "undefined") {
  const wake = () => {
    if (document.visibilityState === "visible" && accessToken && Date.now() > expiresAt - 60_000) void refreshSession();
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
}
