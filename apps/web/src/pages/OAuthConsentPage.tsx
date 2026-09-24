import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bot, Check, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProjectIcon } from "@/components/common";
import { api } from "@/lib/api";
import { AGENT_PRESETS, detectPreset, uniqueAgentName } from "@/lib/mcp-clients";
import { useAuth } from "@/lib/auth";
import { setCurrentOrg } from "@/lib/session";
import { cn } from "@/lib/utils";

const NEW = "__new__";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-sm">{children}</div>
    </div>
  );
}

/**
 * OAuth consent for MCP clients (Copilot, Claude, …) signing in through the browser. An org
 * admin chooses which agent the client acts as — an existing one, or a new one with access to the
 * projects picked here — and the browser goes back to the client with a single-use code.
 */
export function OAuthConsentPage() {
  const location = useLocation();
  const { status, orgs } = useAuth();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? undefined;
  const codeChallenge = params.get("code_challenge") ?? "";
  const method = params.get("code_challenge_method") ?? "S256";
  const responseType = params.get("response_type") ?? "code";

  const client = useQuery({
    queryKey: ["oauth-client", clientId, codeChallenge],
    queryFn: () => api.oauth.client(clientId, codeChallenge),
    enabled: status === "authenticated" && !!clientId,
    retry: false,
  });

  const adminOrgs = orgs.filter((o) => o.permissions.includes("agent.manage"));
  const [org, setOrg] = useState<string>("");
  useEffect(() => {
    if (!org && adminOrgs[0]) setOrg(adminOrgs[0].slug);
  }, [org, adminOrgs]);
  // Org-scoped API calls below use the selected org.
  if (org) setCurrentOrg(org);

  const agents = useQuery({ queryKey: ["oauth-agents", org], queryFn: api.agents.list, enabled: !!org });
  const projects = useQuery({ queryKey: ["oauth-projects", org], queryFn: api.projects.list, enabled: !!org });
  const [agentChoice, setAgentChoice] = useState(NEW);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [projectIds, setProjectIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-select the agent type from the app that's connecting (e.g. "OpenCode" → opencode).
  useEffect(() => {
    if (client.data && !presetId) setPresetId(detectPreset(client.data.name).clientId);
  }, [client.data, presetId]);
  useEffect(() => {
    setAgentChoice(NEW);
    setProjectIds(null);
  }, [org]);

  if (status === "loading") return <Shell><Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" /></Shell>;
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;

  // Never redirect anywhere we can't vouch for: bad requests stop here.
  const badRequest =
    !clientId || !redirectUri || responseType !== "code" || !codeChallenge || method !== "S256"
      ? "This sign-in link is incomplete (it needs client_id, redirect_uri and a PKCE S256 code_challenge)."
      : client.isError
        ? "This app isn't registered with Flowboard. Try connecting again from the app."
        : client.data && !client.data.redirectUris.includes(redirectUri)
          ? "The return address doesn't match what this app registered."
          : client.data?.linkUsed
            ? `This sign-in link was already used. Links only work once, while ${client.data.name} is waiting for you — start the sign-in again from ${client.data.name} and use the new link it opens.`
            : null;
  if (badRequest) {
    return (
      <Shell>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <h1 className="font-semibold">Can't connect this app</h1>
            <p className="mt-1 text-sm text-muted-foreground">{badRequest}</p>
          </div>
        </div>
      </Shell>
    );
  }
  if (!client.data) return <Shell><Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" /></Shell>;

  const back = (extra: Record<string, string>) => {
    const url = new URL(redirectUri);
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
    if (state) url.searchParams.set("state", state);
    window.location.href = url.toString();
  };

  const allProjects = projects.data ?? [];
  const preset = AGENT_PRESETS.find((p) => p.clientId === presetId) ?? detectPreset(client.data.name);
  const newAgentName = uniqueAgentName(preset.name, (agents.data ?? []).map((a) => a.name));
  const selected = projectIds ?? allProjects.map((p) => p.id);
  const redirectHost = (() => {
    try {
      const u = new URL(redirectUri);
      return u.host || u.protocol;
    } catch {
      return redirectUri;
    }
  })();

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const { redirect } = await api.oauth.approve({
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod: "S256",
        state,
        ...(agentChoice === NEW ? { newAgent: { name: newAgentName, projectIds: selected } } : { agentId: agentChoice }),
      });
      window.location.href = redirect;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow">
          <Bot className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Connect {client.data.name}</h1>
          <p className="text-sm text-muted-foreground">
            wants to work in Flowboard as an AI agent · returns to <span className="font-mono">{redirectHost}</span>
          </p>
        </div>
      </div>

      {adminOrgs.length === 0 ? (
        <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Only organization owners and admins can connect AI agents. Ask an admin to connect it, or to give you an agent API key.
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {adminOrgs.length > 1 && (
            <div className="grid gap-1.5">
              <Label>Organization</Label>
              <Select value={org} onValueChange={setOrg}>
                <SelectTrigger>
                  <SelectValue>{adminOrgs.find((o) => o.slug === org)?.name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {adminOrgs.map((o) => (
                    <SelectItem key={o.slug} value={o.slug}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label>Act as</Label>
            <Select value={agentChoice} onValueChange={setAgentChoice}>
              <SelectTrigger>
                <SelectValue>{agentChoice === NEW ? "A new agent" : agents.data?.find((a) => a.id === agentChoice)?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW}>A new agent</SelectItem>
                {(agents.data ?? [])
                  .filter((a) => !a.disabled)
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} {a.grants.length ? `· ${a.grants.map((g) => g.projectKey).join(", ")}` : "· no projects"}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {agentChoice === NEW ? (
            <>
              <div className="grid gap-1.5">
                <Label>Agent</Label>
                <Select value={preset.clientId} onValueChange={setPresetId}>
                  <SelectTrigger>
                    <SelectValue>{newAgentName}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {AGENT_PRESETS.map((p) => (
                      <SelectItem key={p.clientId} value={p.clientId}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Projects it can work in</Label>
                <p className="text-xs text-muted-foreground">Read, create, edit, change status and comment (no deleting). Fine-tune later in Settings → AI agents.</p>
                <div className="max-h-48 divide-y overflow-y-auto rounded-lg border">
                  {allProjects.map((p) => {
                    const on = selected.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setProjectIds(on ? selected.filter((x) => x !== p.id) : [...selected, p.id])}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
                      >
                        <span className={cn("flex size-4 items-center justify-center rounded border", on && "border-primary bg-primary text-primary-foreground")}>
                          {on && <Check className="size-3" />}
                        </span>
                        <ProjectIcon icon={p.icon} color={p.color} size="sm" />
                        <span className="flex-1 truncate">{p.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{p.key}</span>
                      </button>
                    );
                  })}
                  {!allProjects.length && (
                    <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                      {projects.isLoading ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" /> Loading projects…
                        </>
                      ) : (
                        "No projects yet."
                      )}
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">It gets exactly this agent's permissions. A new key named “OAuth · {client.data.name}” is added to the agent — revoke it any time.</p>
          )}

          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Keep {client.data.name} running while you approve — after <span className="font-medium">Allow</span> this page hands you back to it on this computer.
          </p>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            Everything it does is attributed to the agent and visible to your team. Only continue if you started this connection yourself.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => back({ error: "access_denied", error_description: "The user denied access" })} disabled={busy}>
          Cancel
        </Button>
        {adminOrgs.length > 0 && (
          <Button onClick={() => void approve()} disabled={busy || (agentChoice === NEW && selected.length === 0)}>
            {busy && <Loader2 className="size-4 animate-spin" />} Allow
          </Button>
        )}
      </div>
    </Shell>
  );
}
