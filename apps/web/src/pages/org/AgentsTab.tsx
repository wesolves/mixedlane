import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Bot, Check, Copy, KeyRound, Plug, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AGENT_PERMISSIONS,
  AGENT_PERMISSION_LABELS,
  AGENT_PLANNING_MODES,
  AGENT_PLANNING_MODE_LABELS,
  DEFAULT_AGENT_PERMISSIONS,
  type Agent,
  type AgentDocAccess,
  type AgentPermission,
  type CreatedApiKey,
} from "@flowboard/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ActorAvatar, EmptyState, ProjectIcon } from "@/components/common";
import { useProjects } from "@/hooks/queries";
import { api } from "@/lib/api";
import { AGENT_PRESETS, MCP_CLIENTS, uniqueAgentName } from "@/lib/mcp-clients";
import { paths } from "@/lib/project";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";

const onError = (e: Error) => toast.error(e.message);
const DOC_ACCESS: Record<AgentDocAccess, string> = {
  none: "No access to org-wide spaces",
  read: "Read org-wide spaces",
  write: "Read and write org-wide spaces",
};
const ago = (d: string | null) => (d ? formatDistanceToNowStrict(new Date(d), { addSuffix: true }) : "never");
const mcpUrl = () => `${window.location.origin}/api/mcp`;

function useAgentsMutation<T, V>(fn: (v: V) => Promise<T>, onSuccess?: (t: T) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ["agents"] });
      onSuccess?.(t);
    },
    onError,
  });
}

/** Org settings → AI agents: identities with API keys, per-project permission toggles, MCP setup. */
export function AgentsTab() {
  const { data: agents, isLoading } = useQuery({ queryKey: ["agents"], queryFn: api.agents.list });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ agent: string; key: CreatedApiKey } | null>(null);
  const open = agents?.find((a) => a.id === openId) ?? null;

  return (
    <div className="max-w-4xl space-y-6 px-6 py-6">
      <div className="flex flex-wrap items-start gap-4 rounded-xl border bg-gradient-to-br from-violet-500/10 via-transparent to-fuchsia-500/10 p-5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow">
          <Bot className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">AI agents</h2>
          <p className="text-sm text-muted-foreground">
            Give Claude or any MCP-capable agent its own identity. It sees only the projects you grant, can do only what you toggle on, and everything it does is
            attributed to it and shown to the team live.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New agent
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : !agents?.length ? (
        <EmptyState
          icon={<Bot className="size-5" />}
          title="No agents yet"
          description="Create an agent, give it access to a project, and connect it over MCP in a minute."
          action={<Button onClick={() => setCreating(true)}>Create your first agent</Button>}
        />
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {agents.map((a) => (
            <button key={a.id} onClick={() => setOpenId(a.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
              <ActorAvatar name={a.name} type="agent" className="size-9" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-medium">
                  {a.name}
                  {a.disabled && <span className="rounded bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Disabled</span>}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{a.description || "No description"}</span>
              </span>
              <span className="hidden text-right text-xs text-muted-foreground sm:block">
                {a.grants.length ? a.grants.map((g) => g.projectKey).join(", ") : "No projects"}
                <br />
                Last active {ago(a.lastUsedAt)}
              </span>
            </button>
          ))}
        </div>
      )}

      <CreateAgentDialog open={creating} onOpenChange={setCreating} existingNames={(agents ?? []).map((a) => a.name)} onCreated={(agent, key) => setRevealed({ agent: agent.name, key })} onOpen={setOpenId} />
      {open && <AgentSheet agent={open} onClose={() => setOpenId(null)} onKey={(key) => setRevealed({ agent: open.name, key })} />}
      {revealed && <KeyDialog agentName={revealed.agent} created={revealed.key} onClose={() => setRevealed(null)} />}
    </div>
  );
}

function CreateAgentDialog({
  open,
  onOpenChange,
  onCreated,
  onOpen,
  existingNames,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (agent: Agent, key: CreatedApiKey) => void;
  onOpen: (id: string) => void;
  existingNames: string[];
}) {
  const [presetId, setPresetId] = useState(AGENT_PRESETS[0].clientId);
  const [description, setDescription] = useState("");
  const preset = AGENT_PRESETS.find((p) => p.clientId === presetId) ?? AGENT_PRESETS[0];
  const name = uniqueAgentName(preset.name, existingNames);
  const create = useAgentsMutation(api.agents.create, ({ agent, key }) => {
    // Open the matching setup instructions (Connect) for the tool that was picked.
    try {
      localStorage.setItem("mcpClient", preset.clientId);
    } catch {
      /* storage unavailable */
    }
    onOpenChange(false);
    setDescription("");
    onOpen(agent.id);
    onCreated(agent, key);
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New AI agent</DialogTitle>
          <DialogDescription>It starts with no project access — you choose what it can see and do next.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ name, description });
          }}
        >
          <div className="grid gap-1.5">
            <Label>Which agent will use it?</Label>
            <Select value={presetId} onValueChange={setPresetId}>
              <SelectTrigger>
                <SelectValue>{name}</SelectValue>
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
            <Label htmlFor="agent-desc">What does it do?</Label>
            <Textarea id="agent-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Labels and prioritizes new bugs" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              Create agent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 shrink-0"
      onClick={() => {
        void copyText(value).then((ok) => {
          if (!ok) return toast.error("Couldn't copy — select the text and copy it manually");
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {done ? "Copied" : label}
    </Button>
  );
}

function Snippet({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="rounded-lg border bg-muted/60 p-3 pr-24 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">{code}</pre>
      <div className="absolute top-2 right-2">
        <CopyButton value={code} />
      </div>
    </div>
  );
}

/** Ready-to-paste setup for each supported MCP client (Claude, Codex, Copilot, opencode, Pi…). */
export function ConnectSnippets({ secret }: { secret?: string }) {
  const url = mcpUrl();
  const key = secret ?? "<YOUR_API_KEY>";
  const [clientId, setClientId] = useState(() => {
    try {
      return localStorage.getItem("mcpClient") ?? MCP_CLIENTS[0].id;
    } catch {
      return MCP_CLIENTS[0].id;
    }
  });
  const client = MCP_CLIENTS.find((c) => c.id === clientId) ?? MCP_CLIENTS[0];
  // The plugin (hooks + skills + agent) is the recommended way; right after creating a key, show key setup.
  const [mode, setMode] = useState<"plugin" | "oauth" | "key">(secret ? "key" : "plugin");
  const plugins = useQuery({ queryKey: ["plugins"], queryFn: api.plugins.list, staleTime: 5 * 60_000 });
  const plugin = client.plugin ? plugins.data?.find((p) => p.id === client.plugin) : undefined;
  const usePlugin = mode === "plugin" && !!client.plugin;
  const useOAuth = !usePlugin && mode !== "key" && !!client.oauth;
  const steps = usePlugin ? [] : useOAuth ? client.oauth!(url) : client.steps(url, key);
  const modes = [
    ...(client.plugin ? ([["plugin", "Install plugin (recommended)"]] as const) : []),
    ...(client.oauth ? ([["oauth", "Sign in with browser"]] as const) : []),
    ["key", "Use an API key"] as const,
  ];
  const active = usePlugin ? "plugin" : useOAuth ? "oauth" : "key";
  const pick = (id: string) => {
    setClientId(id);
    try {
      localStorage.setItem("mcpClient", id);
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="MCP client">
        {MCP_CLIENTS.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={c.id === client.id}
            onClick={() => pick(c.id)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              c.id === client.id ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {client.blurb}{" "}
        <a href={client.docs} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          Docs
        </a>
      </p>
      {modes.length > 1 && (
        <div className="inline-flex flex-wrap rounded-lg border p-0.5 text-xs" role="radiogroup" aria-label="How to connect">
          {modes.map(([m, label]) => (
            <button
              key={m}
              role="radio"
              aria-checked={active === m}
              onClick={() => setMode(m)}
              className={cn("rounded-md px-2.5 py-1 transition-colors", active === m ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {usePlugin && (
        <div className="space-y-3">
          {plugin ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {plugin.includes.map((x) => (
                  <span key={x} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                    {x}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                The plugin makes {client.name} record its plans as epics, stories and tasks here (per the agent's planning mode) and keep them updated while it works.
              </p>
              <div className="space-y-1.5">
                <p className="text-xs font-medium">macOS / Linux</p>
                <Snippet code={plugin.install.bash} />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium">Windows (PowerShell)</p>
                <Snippet code={plugin.install.powershell} />
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Then:</span> {plugin.after} Re-run to update; add <code className="rounded bg-muted px-1">--uninstall</code>{" "}
                (<code className="rounded bg-muted px-1">-Uninstall</code> on Windows) to remove.{" "}
                <a href={plugin.download} className="text-primary hover:underline">
                  Download the bundle
                </a>
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Loading plugin…</p>
          )}
        </div>
      )}
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={`${client.id}-${i}`} className="space-y-1.5">
            <p className="text-xs font-medium">{step.title}</p>
            <Snippet code={step.code} />
            {step.note && <p className="text-xs text-muted-foreground">{step.note}</p>}
          </li>
        ))}
      </ol>
      {usePlugin ? null : useOAuth ? (
        <p className="text-xs text-muted-foreground">
          No key to copy: the client registers itself and you approve it in Flowboard. Its key (“OAuth · …”) then appears under the agent's API keys, where you can revoke it.
        </p>
      ) : !secret && (
        <p className="text-xs text-muted-foreground">
          Replace <code className="rounded bg-muted px-1">{"<YOUR_API_KEY>"}</code> with the agent's key (create a new one below if you didn't keep it). Tip: one key per
          machine or tool, so each can be revoked on its own.
        </p>
      )}
    </div>
  );
}

function KeyDialog({ agentName, created, onClose }: { agentName: string; created: CreatedApiKey; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" /> API key for {agentName}
          </DialogTitle>
          <DialogDescription>Copy it now — for your security it won't be shown again. Anyone with this key can act as the agent.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border bg-amber-500/10 p-2">
          <code className="min-w-0 flex-1 truncate font-mono text-sm">{created.secret}</code>
          <CopyButton value={created.secret} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Connect over MCP</p>
          <ConnectSnippets secret={created.secret} />
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I've saved the key</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentSheet({ agent, onClose, onKey }: { agent: Agent; onClose: () => void; onKey: (k: CreatedApiKey) => void }) {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useAgentsMutation((patch: Parameters<typeof api.agents.update>[1]) => api.agents.update(agent.id, patch));
  const remove = useAgentsMutation(() => api.agents.remove(agent.id), () => {
    toast.success(`${agent.name} deleted`);
    onClose();
  });
  const newKey = useAgentsMutation(() => api.agents.createKey(agent.id, { name: `Key ${agent.keys.length + 1}` }), onKey);
  const revoke = useAgentsMutation((keyId: string) => api.agents.revokeKey(agent.id, keyId), () => toast.success("Key revoked"));
  const dirty = name.trim() !== agent.name || description !== agent.description;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-3">
            <ActorAvatar name={agent.name} type="agent" className="size-8" />
            {agent.name}
          </SheetTitle>
          <SheetDescription>
            Created {agent.createdByName ? `by ${agent.createdByName} ` : ""}
            {ago(agent.createdAt)} · last active {ago(agent.lastUsedAt)}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-8 p-5">
          <section className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ag-name">Name</Label>
              <Input id="ag-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ag-desc">Description</Label>
              <Textarea id="ag-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={!dirty || !name.trim() || update.isPending} onClick={() => update.mutate({ name: name.trim(), description })}>
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => update.mutate({ disabled: !agent.disabled })}>
                <Power className="size-4" /> {agent.disabled ? "Enable" : "Disable"}
              </Button>
              <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" /> Delete agent
              </Button>
            </div>
            {agent.disabled && <p className="text-xs text-amber-600">Disabled: its keys are rejected until you enable it again.</p>}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">What it may do</h3>
            <label className="flex items-start gap-3 rounded-xl border p-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Can create projects</span>
                <span className="block text-xs text-muted-foreground">
                  Lets it start a new project when a plan needs one. It gets full access to projects it creates; everyone in the org sees them.
                </span>
              </span>
              <button
                role="switch"
                aria-checked={agent.canCreateProjects}
                aria-label="Can create projects"
                onClick={() => update.mutate({ canCreateProjects: !agent.canCreateProjects })}
                className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", agent.canCreateProjects ? "bg-primary" : "bg-muted-foreground/30")}
              >
                <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", agent.canCreateProjects ? "left-4.5" : "left-0.5")} />
              </button>
            </label>
            <div className="rounded-xl border p-3">
              <p className="text-sm font-medium">When it plans work</p>
              <p className="mb-2 text-xs text-muted-foreground">How it records plans and requirements as epics, stories and tasks in Flowboard.</p>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="When it plans work">
                {AGENT_PLANNING_MODES.map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={agent.planningMode === m}
                    onClick={() => agent.planningMode !== m && update.mutate({ planningMode: m })}
                    className={cn(
                      "rounded-lg border p-2.5 text-left transition-colors hover:bg-muted/50",
                      agent.planningMode === m && "border-primary bg-primary/5 ring-1 ring-primary",
                    )}
                  >
                    <span className="block text-sm font-medium">{AGENT_PLANNING_MODE_LABELS[m].label}</span>
                    <span className="block text-xs text-muted-foreground">{AGENT_PLANNING_MODE_LABELS[m].hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <ProjectAccess agent={agent} />

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Docs</h3>
            <p className="text-xs text-muted-foreground">Project spaces follow the project toggles above. This controls the organization-wide spaces.</p>
            <Select value={agent.docAccess} onValueChange={(v) => update.mutate({ docAccess: v as AgentDocAccess })}>
              <SelectTrigger className="w-80">
                <SelectValue>{DOC_ACCESS[agent.docAccess]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DOC_ACCESS) as AgentDocAccess[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {DOC_ACCESS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">API keys</h3>
              <Button size="sm" variant="outline" onClick={() => newKey.mutate(undefined)} disabled={newKey.isPending}>
                <Plus className="size-4" /> New key
              </Button>
            </div>
            <div className="divide-y overflow-hidden rounded-xl border">
              {agent.keys.map((k) => (
                <div key={k.id} className={cn("flex items-center gap-3 px-3 py-2 text-sm", k.revokedAt && "opacity-50")}>
                  <KeyRound className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{k.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{k.prefix}_••••••</span>
                  </span>
                  <span className="text-right text-xs text-muted-foreground">
                    {k.revokedAt ? `Revoked ${ago(k.revokedAt)}` : `Used ${ago(k.lastUsedAt)}`}
                    {k.expiresAt && !k.revokedAt && <span className="block">Expires {ago(k.expiresAt)}</span>}
                  </span>
                  {!k.revokedAt && (
                    <Button size="sm" variant="ghost" className="h-7 text-destructive hover:text-destructive" onClick={() => revoke.mutate(k.id)}>
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
              {!agent.keys.length && <p className="px-3 py-2 text-sm text-muted-foreground">No keys.</p>}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Plug className="size-4" /> Connect
            </h3>
            <p className="text-xs text-muted-foreground">
              MCP endpoint: <code className="rounded bg-muted px-1">{mcpUrl()}</code> — paste one of these with the agent's key.
            </p>
            <ConnectSnippets />
          </section>

          <AgentActivity agentId={agent.id} />
        </div>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {agent.name}?</AlertDialogTitle>
              <AlertDialogDescription>Its keys stop working immediately and its project access is removed. Its past activity stays in the history.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => remove.mutate(undefined)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

/** One row per project: an access switch plus permission toggles. Changes save immediately. */
function ProjectAccess({ agent }: { agent: Agent }) {
  const { data: projects = [] } = useProjects();
  const setGrant = useAgentsMutation(({ projectId, permissions }: { projectId: string; permissions: AgentPermission[] }) =>
    api.agents.setGrant(agent.id, projectId, permissions),
  );
  const toggles = AGENT_PERMISSIONS.filter((p) => p !== "project.read");

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Project access</h3>
      <p className="text-xs text-muted-foreground">Agents never see a project until you switch it on here. They can't change project settings or access.</p>
      <div className="divide-y overflow-hidden rounded-xl border">
        {projects.map((p) => {
          const grant = agent.grants.find((g) => g.projectId === p.id);
          const perms = new Set(grant?.permissions ?? []);
          const save = (next: AgentPermission[]) => setGrant.mutate({ projectId: p.id, permissions: next });
          return (
            <div key={p.id} className="space-y-2 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <ProjectIcon icon={p.icon} color={p.color} size="sm" />
                <Link to={paths.project(p.key)} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                  {p.name} <span className="font-mono text-xs text-muted-foreground">{p.key}</span>
                </Link>
                <button
                  role="switch"
                  aria-checked={!!grant}
                  aria-label={`Access to ${p.name}`}
                  onClick={() => save(grant ? [] : DEFAULT_AGENT_PERMISSIONS)}
                  className={cn("relative h-5 w-9 rounded-full transition-colors", grant ? "bg-primary" : "bg-muted-foreground/30")}
                >
                  <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", grant ? "left-4.5" : "left-0.5")} />
                </button>
              </div>
              {grant && (
                <div className="flex flex-wrap gap-1.5 pl-7">
                  {toggles.map((perm) => {
                    const on = perms.has(perm);
                    return (
                      <button
                        key={perm}
                        title={AGENT_PERMISSION_LABELS[perm].hint}
                        onClick={() => save(on ? [...perms].filter((x) => x !== perm) : [...perms, perm])}
                        className={cn(
                          "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                          on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                          perm === "item.delete" && on && "border-destructive bg-destructive/10 text-destructive",
                        )}
                      >
                        {on && <Check className="size-3" />}
                        {AGENT_PERMISSION_LABELS[perm].label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {!projects.length && <p className="px-3 py-2 text-sm text-muted-foreground">No projects yet.</p>}
      </div>
    </section>
  );
}

function AgentActivity({ agentId }: { agentId: string }) {
  const { data = [] } = useQuery({ queryKey: ["agents", agentId, "activity"], queryFn: () => api.agents.activity(agentId) });
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Recent activity</h3>
      {data.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing yet — once connected, everything the agent changes shows up here.</p>
      ) : (
        <ol className="divide-y overflow-hidden rounded-xl border text-sm">
          {data.slice(0, 20).map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2">
              <span className="text-muted-foreground">{a.action === "moved" ? "Moved" : a.action === "commented" ? "Commented on" : a.action === "created" ? "Created" : "Updated"}</span>
              <Link to={paths.item(a.item.projectKey, a.item)} className="min-w-0 flex-1 truncate hover:underline">
                <span className="font-mono text-xs text-muted-foreground">{a.item.key}</span> {a.item.title}
              </Link>
              <span className="shrink-0 text-xs text-muted-foreground">{ago(a.createdAt)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
