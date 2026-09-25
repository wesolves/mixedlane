import { useState, type ReactNode } from "react";
import { FaGithub } from "react-icons/fa";
import { AlertTriangle, Check, Copy, ExternalLink, Eye, EyeOff, Radio, RefreshCw, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrg } from "@/lib/auth";
import { copyText } from "@/lib/clipboard";
import {
  useConnectGithub,
  useDisconnectGithub,
  useGithubConnection,
  useUpdateGithubSettings,
} from "@/hooks/queries";

const POLL_OPTIONS = [30, 60, 120, 300, 900];

const TOKEN_PERMISSIONS: [string, string][] = [
  ["Metadata", "Read"],
  ["Pull requests", "Read"],
  ["Contents", "Read (Read & write to create branches from items)"],
  ["Deployments", "Read"],
  ["Actions", "Read"],
  ["Webhooks", "Read & write (optional — lets Flowboard register webhooks for you)"],
];

/** Rendered inside Organization settings → Integrations (`embedded`), or standalone. */
export function IntegrationsPage({ embedded }: { embedded?: boolean }) {
  const { data: conn, isLoading } = useGithubConnection();
  const { can } = useOrg();
  const manage = can("integration.manage");
  const body = (
      <div className="space-y-6">
        {!manage && (
          <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Only organization owners and admins can connect or change integrations.
          </p>
        )}
        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center gap-3 border-b px-5 py-4">
            <FaGithub className="size-7" />
            <div>
              <h2 className="font-semibold">GitHub</h2>
              <p className="text-sm text-muted-foreground">
                Link branches, commits, pull requests and deployments to work items — and move items automatically.
              </p>
            </div>
            {conn?.connected && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <Check className="size-3.5" /> Connected
              </span>
            )}
          </div>
          <div className="p-5">
            {isLoading || !conn ? (
              <Skeleton className="h-40" />
            ) : conn.connected ? (
              manage ? <Connected /> : <p className="text-sm">Connected as <strong>@{conn.login}</strong>.</p>
            ) : manage ? (
              <ConnectForm />
            ) : (
              <p className="text-sm text-muted-foreground">Not connected yet.</p>
            )}
          </div>
        </section>
      </div>
  );
  if (embedded) return body;
  return (
    <div className="flex-1 overflow-y-auto">
      <header className="border-b">
        <div className="mx-auto w-full max-w-5xl px-6 py-5">
          <h1 className="text-lg font-semibold tracking-tight">Integrations</h1>
          <p className="text-sm text-muted-foreground">Connect tools once for the whole organization, then link them per project.</p>
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl px-6 py-8">{body}</div>
    </div>
  );
}

function ConnectForm() {
  const connect = useConnectGithub();
  const [token, setToken] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [advanced, setAdvanced] = useState(false);

  const submit = async () => {
    const info = await connect.mutateAsync({ token: token.trim(), apiUrl: apiUrl.trim() || undefined });
    toast.success(`Connected as @${info.login}`);
  };

  return (
    <form
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="token">Personal access token</Label>
          <Input
            id="token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="github_pat_… or ghp_…"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">Stored encrypted on this server. Never sent to the browser again.</p>
        </div>
        {advanced ? (
          <div className="grid gap-1.5">
            <Label htmlFor="api">API URL (GitHub Enterprise Server)</Label>
            <Input id="api" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://github.example.com/api/v3" />
          </div>
        ) : (
          <button type="button" onClick={() => setAdvanced(true)} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            Using GitHub Enterprise Server?
          </button>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={token.trim().length < 10 || connect.isPending}>
            <FaGithub /> {connect.isPending ? "Checking token…" : "Connect GitHub"}
          </Button>
          <Button variant="outline" asChild>
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
              Create a token <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>
      <div className="rounded-lg bg-muted/50 p-4 text-sm">
        <p className="mb-2 font-medium">Fine-grained token permissions</p>
        <p className="mb-3 text-xs text-muted-foreground">Give it access to the repositories you'll link, with these repository permissions:</p>
        <ul className="space-y-1.5 text-xs">
          {TOKEN_PERMISSIONS.map(([name, level]) => (
            <li key={name} className="flex gap-2">
              <span className="w-24 shrink-0 font-medium">{name}</span>
              <span className="text-muted-foreground">{level}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Classic tokens: the <code className="rounded bg-muted px-1">repo</code> scope (+ <code className="rounded bg-muted px-1">admin:repo_hook</code> for webhooks).</p>
      </div>
    </form>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b py-4 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[180px_minmax(0,1fr)]">
      <span className="text-sm font-medium">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function CopyField({ value, secret }: { value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  return (
    <div className="flex items-center gap-1.5">
      <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-2.5 py-1.5 font-mono text-xs">
        {shown ? value : "•".repeat(32)}
      </code>
      {secret && (
        <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide" : "Show"}>
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
      )}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label="Copy"
        onClick={() => {
          void copyText(value).then((ok) => (ok ? toast.success("Copied") : toast.error("Couldn't copy — select the text and copy it manually")));
        }}
      >
        <Copy className="size-4" />
      </Button>
    </div>
  );
}

function Connected() {
  const { data: conn } = useGithubConnection();
  const update = useUpdateGithubSettings();
  const disconnect = useDisconnectGithub();
  const [publicUrl, setPublicUrl] = useState(conn?.publicUrl ?? "");
  if (!conn) return null;

  return (
    <div>
      {conn.lastError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{conn.lastError}. Reconnect with a new token below.</span>
        </div>
      )}
      <Row label="Account">
        <div className="flex items-center gap-3">
          {conn.avatarUrl && <img src={conn.avatarUrl} alt="" className="size-8 rounded-full" />}
          <div className="min-w-0">
            <p className="font-medium">@{conn.login}</p>
            <p className="truncate text-xs text-muted-foreground">
              {conn.apiUrl}
              {conn.scopes && ` · scopes: ${conn.scopes}`}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto text-destructive hover:bg-destructive/10"
            onClick={async () => {
              if (!confirm("Disconnect GitHub? Linked repos stay configured, but syncing stops and Flowboard-created webhooks are removed.")) return;
              await disconnect.mutateAsync(undefined);
              toast.success("GitHub disconnected");
            }}
          >
            Disconnect
          </Button>
        </div>
      </Row>

      <Row label="Polling">
        <div className="flex flex-wrap items-center gap-3">
          <RefreshCw className="size-4 text-muted-foreground" />
          <span className="text-sm">Check linked repos every</span>
          <Select value={String(conn.pollSeconds)} onValueChange={(v) => update.mutate({ pollSeconds: Number(v) })}>
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POLL_OPTIONS.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s < 60 ? `${s} seconds` : `${s / 60} minute${s > 60 ? "s" : ""}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Works on plain localhost — no public URL needed. Webhooks (below) make updates instant.
        </p>
      </Row>

      <Row label="Webhooks">
        <div className="space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <Radio className={conn.webhookUrl ? "mt-0.5 size-4 text-emerald-500" : "mt-0.5 size-4 text-muted-foreground"} />
            <span>
              {conn.webhookUrl
                ? "Instant updates are on for repos with a registered webhook."
                : "Optional. GitHub needs a public URL to reach this server — e.g. a tunnel:"}
            </span>
          </div>
          {!conn.webhookUrl && (
            <code className="block rounded-md bg-muted px-3 py-2 font-mono text-xs">cloudflared tunnel --url http://localhost:3001</code>
          )}
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await update.mutateAsync({ publicUrl: publicUrl.trim() });
              toast.success(publicUrl.trim() ? "Public URL saved — register webhooks from each project's GitHub settings" : "Public URL cleared");
            }}
          >
            <Input value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://your-tunnel.trycloudflare.com" />
            <Button type="submit" variant="outline" disabled={publicUrl.trim() === conn.publicUrl || update.isPending}>
              Save
            </Button>
          </form>
          {conn.webhookUrl && (
            <div className="grid gap-2 rounded-lg bg-muted/40 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <Webhook className="size-3.5" /> For manual setup (Repo → Settings → Webhooks, content type application/json):
              </p>
              <CopyField value={conn.webhookUrl} />
              <CopyField value={conn.webhookSecret ?? ""} secret />
              <p className="text-xs text-muted-foreground">
                Events: Pull requests, Pushes, Branch or tag creation, Deployment statuses, Workflow runs, Releases.
              </p>
            </div>
          )}
        </div>
      </Row>
    </div>
  );
}
