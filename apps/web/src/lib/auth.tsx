import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthResponse, AuthUser, OrgPermission, OrgSummary } from "@flowboard/shared";
import { api } from "./api";
import { getCurrentOrg, isOffline, onOffline, onSession, refreshSession, setSession } from "./session";

/** True while the server can't be reached (the session is kept; requests retry). */
export const useOffline = () => useSyncExternalStore(onOffline, isOffline);

interface AuthState {
  status: "loading" | "authenticated" | "anonymous";
  user: AuthUser | null;
  orgs: OrgSummary[];
}

interface AuthApi extends AuthState {
  login: (email: string, password: string) => Promise<AuthResponse>;
  register: (input: { name: string; email: string; password: string; orgName: string }) => Promise<AuthResponse>;
  /** Signs in with a session returned elsewhere (e.g. accepting an invite). */
  adopt: (session: AuthResponse) => void;
  logout: (everywhere?: boolean) => Promise<void>;
  /** Re-fetches the user and their orgs (after creating/leaving an org, verifying email…). */
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "loading", user: null, orgs: [] });

  useEffect(() => {
    // Any session change (login, refresh, expiry) updates the UI.
    const off = onSession((s) =>
      setState(s ? { status: "authenticated", user: s.user, orgs: s.orgs } : { status: "anonymous", user: null, orgs: [] }),
    );
    // On load, the httpOnly refresh cookie (if any) restores the session.
    void refreshSession();
    return () => void off();
  }, []);

  const adopt = useCallback((s: AuthResponse) => setSession(s), []);

  const login = useCallback(async (email: string, password: string) => {
    const s = await api.auth.login(email, password);
    setSession(s);
    return s;
  }, []);

  const register = useCallback(async (input: { name: string; email: string; password: string; orgName: string }) => {
    const s = await api.auth.register(input);
    setSession(s);
    return s;
  }, []);

  const logout = useCallback(
    async (everywhere = false) => {
      try {
        await (everywhere ? api.auth.logoutAll() : api.auth.logout());
      } finally {
        setSession(null);
        qc.clear();
      }
    },
    [qc],
  );

  const reload = useCallback(async () => {
    const me = await api.auth.me();
    setState((s) => ({ ...s, user: me.user, orgs: me.orgs }));
  }, []);

  const value = useMemo<AuthApi>(() => ({ ...state, login, register, adopt, logout, reload }), [state, login, register, adopt, logout, reload]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** The org selected in the URL, with a permission helper. */
export function useOrg() {
  const { orgs } = useAuth();
  const slug = getCurrentOrg();
  const org = orgs.find((o) => o.slug === slug) ?? null;
  const can = (permission: OrgPermission) => !!org?.permissions.includes(permission);
  return { org, can };
}
