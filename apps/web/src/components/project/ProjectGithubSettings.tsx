import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { FaGithub } from "react-icons/fa";
import { AlertTriangle, ArrowRight, Lock, Plus, Radio, RefreshCw, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import {
  DEPLOY_SOURCES,
  DEPLOY_SOURCE_LABELS,
  GIT_TRIGGER_LABELS,
  type DeploySource,
  type GitAutomation,
  type GitTrigger,
  type LinkedRepo,
  type Project,
} from "@mixedlane/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, StatusIcon } from "@/components/common";
import {
  useGithubConnection,
  useLinkRepo,
  useProjectGithub,
  useRegisterWebhook,
  useSaveAutomation,
  useSyncProject,
  useUnlinkRepo,
} from "@/hooks/queries";
import { api } from "@/lib/api";
import { paths } from "@/lib/project";
import { cn } from "@/lib/utils";

const NONE = "__none__";

function Section({ title, description, children, action }: { title: string; description: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="grid gap-4 border-b py-8 last:border-b-0 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <div className="mt-1 text-sm text-muted-foreground">{description}</div>
        {action && <div className="mt-3">{action}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function ProjectGithubSettings({ project }: { project: Project }) {
  const { data: conn } = useGithubConnection();
  const { data, isLoading } = useProjectGithub(project.key);

  if (conn && !conn.connected) {
    return (
      <div className="px-6 py-8">
        <EmptyState
          className="max-w-2xl"
          icon={<FaGithub className="size-5" />}
          title="Connect GitHub first"
          description="Add a GitHub token once for the workspace, then link repositories to this project."
          action={
            <Button asChild>
              <Link to={paths.orgSettings("integrations")}>
                Open integrations <ArrowRight className="size-4" />
              </Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (isLoading || !data || !conn) return <Skeleton className="m-6 h-64" />;

  return (
    <div className="px-6">
      <div className="max-w-5xl">
        <Repositories project={project} repos={data.repos} webhookUrl={conn.webhookUrl} />
        <HowTo project={project} />
        <AutomationEditor key={JSON.stringify(data.automation)} project={project} saved={data.automation} />
      </div>
    </div>
  );
}

/* ---------- Repositories ---------- */

function Repositories({ project, repos, webhookUrl }: { project: Project; repos: LinkedRepo[]; webhookUrl: string }) {
  const sync = useSyncProject(project.key);
  const unlink = useUnlinkRepo(project.key);
  const register = useRegisterWebhook(project.key);

  return (
    <Section
      title="Repositories"
      description="Activity in these repos is matched to this project's items by key."
      action={
        repos.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            disabled={sync.isPending}
            onClick={async () => {
              const res = await sync.mutateAsync(undefined);
              const failed = res.filter((r) => !r.ok);
              if (failed.length) toast.error(failed.map((f) => `${f.repo}: ${f.error}`).join("\n"));
              else toast.success("Synced with GitHub");
            }}
          >
            <RefreshCw className={cn("size-4", sync.isPending && "animate-spin")} /> Sync now
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {repos.length > 0 && (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {repos.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <FaGithub className="size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                    {r.fullName}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    Default branch <code className="font-mono">{r.defaultBranch}</code> ·{" "}
                    {r.lastSyncedAt ? `synced ${formatDistanceToNow(new Date(r.lastSyncedAt), { addSuffix: true })}` : "first sync in progress…"}
                  </p>
                  {r.lastError && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="size-3.5" /> {r.lastError}
                    </p>
                  )}
                </div>
                {r.webhookId ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    <Webhook className="size-3.5" /> Webhook
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    <Radio className="size-3.5" /> Polling
                  </span>
                )}
                {!r.webhookId && webhookUrl && (
                  <Button size="sm" variant="outline" disabled={register.isPending} onClick={() => register.mutate(r.id, { onSuccess: () => toast.success("Webhook registered") })}>
                    Add webhook
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Unlink ${r.fullName}`}
                  onClick={() => {
                    if (confirm(`Unlink ${r.fullName}? Its linked PRs, branches and commits disappear from items.`)) unlink.mutate(r.id);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <RepoPicker project={project} linked={repos.map((r) => r.fullName.toLowerCase())} />
        {!webhookUrl && repos.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Updates arrive by polling. For instant updates, set a public URL in{" "}
            <Link to={paths.orgSettings("integrations")} className="underline underline-offset-2">
              Integrations
            </Link>
            .
          </p>
        )}
      </div>
    </Section>
  );
}

function RepoPicker({ project, linked }: { project: Project; linked: string[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const link = useLinkRepo(project.key);
  const { data: repos = [], isFetching, error } = useQuery({
    queryKey: ["github", "search", q],
    queryFn: () => api.github.searchRepos(q),
    enabled: open,
    staleTime: 60_000,
  });
  const manual = /^[\w.-]+\/[\w.-]+$/.test(q.trim()) && !repos.some((r) => r.fullName.toLowerCase() === q.trim().toLowerCase());

  const pick = async (fullName: string) => {
    setOpen(false);
    const repo = await link.mutateAsync(fullName);
    toast.success(`Linked ${repo.fullName}`, {
      description: repo.webhookId ? "Webhook registered — updates are instant." : "Importing history now; new activity is checked by polling.",
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={link.isPending}>
          <Plus className="size-4" /> {link.isPending ? "Linking…" : "Link repository"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search your repositories or type owner/repo" value={q} onValueChange={setQ} />
          <CommandList>
            {error ? (
              <div className="p-3 text-sm text-destructive">{(error as Error).message}</div>
            ) : (
              <CommandEmpty>{isFetching ? "Loading repositories…" : "No repositories found."}</CommandEmpty>
            )}
            {manual && (
              <CommandGroup heading="Link by name">
                <CommandItem value={`manual ${q}`} onSelect={() => pick(q.trim())}>
                  <FaGithub /> {q.trim()}
                </CommandItem>
              </CommandGroup>
            )}
            {repos.length > 0 && (
              <CommandGroup heading="Your repositories">
                {repos.map((r) => {
                  const done = linked.includes(r.fullName.toLowerCase());
                  return (
                    <CommandItem key={r.fullName} value={r.fullName} disabled={done} onSelect={() => pick(r.fullName)}>
                      <FaGithub />
                      <span className="truncate">{r.fullName}</span>
                      {r.private && <Lock className="size-3 text-muted-foreground" />}
                      {done && <span className="ml-auto text-xs text-muted-foreground">Linked</span>}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ---------- How-to ---------- */

function HowTo({ project }: { project: Project }) {
  const key = `${project.key}-${"1".padStart(project.keyDigits, "0")}`;
  const examples: [string, string][] = [
    ["Branch", `git checkout -b ${key}-add-login`],
    ["Commit", `git commit -m "${key} Add login form"`],
    ["Pull request title", `${key}: Add login form`],
    ["Smart commit", `git commit -m "${key} #comment Ready for QA #in-review"`],
  ];
  return (
    <Section
      title="How linking works"
      description={
        <>
          Mention an item key anywhere below. <code className="font-mono">{project.key}-1</code> works too — keys are case-insensitive and padding is optional.
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {examples.map(([label, code]) => (
          <div key={label} className="rounded-lg border bg-card p-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
            <code className="block truncate font-mono text-xs" title={code}>
              {code}
            </code>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ---------- Automation ---------- */

const TRIGGERS: GitTrigger[] = ["branchCreated", "commitPushed", "prOpened", "prMerged", "prClosed"];

const MATCH_HINT: Record<DeploySource, string> = {
  deployment: "Environment, e.g. production or prod* (empty = any)",
  workflow: "Workflow name, e.g. Deploy* (empty = any)",
  release: "Tag pattern, e.g. v* (empty = any, pre-releases skipped)",
};

function StatusSelect({ project, value, onChange, allowNone = true }: { project: Project; value: string | null; onChange: (v: string | null) => void; allowNone?: boolean }) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger size="sm" className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>Do nothing</SelectItem>}
        {project.statuses.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <StatusIcon status={s} /> {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} aria-pressed={checked} className="flex w-full items-start gap-3 rounded-lg border p-3 text-left hover:bg-muted/40">
      <span className={cn("mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors", checked ? "bg-primary" : "bg-muted-foreground/30")}>
        <span className={cn("size-4 rounded-full bg-white shadow transition-transform", checked && "translate-x-4")} />
      </span>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

function AutomationEditor({ project, saved }: { project: Project; saved: GitAutomation }) {
  const [draft, setDraft] = useState(saved);
  const save = useSaveAutomation(project.key);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<GitAutomation>) => setDraft((d) => ({ ...d, ...patch }));

  // Warn before leaving with unsaved rules.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const doneStatus = project.statuses.find((s) => s.category === "done")?.id ?? project.statuses[0].id;
  const addRule = (source: DeploySource) =>
    set({ deployRules: [...draft.deployRules, { id: crypto.randomUUID().slice(0, 8), source, match: source === "deployment" ? "production" : "", status: doneStatus }] });

  return (
    <>
      <Section
        title="Automation"
        description="Move items through your workflow as work happens on GitHub. Each rule fires once per real change — replays and duplicate deliveries are ignored."
      >
        <div className="space-y-3">
          <Toggle checked={draft.enabled} onChange={(enabled) => set({ enabled })} label="Automations enabled" hint="Turn off to only link GitHub activity without moving items." />
          <div className={cn("divide-y overflow-hidden rounded-xl border bg-card", !draft.enabled && "pointer-events-none opacity-50")}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
              <span>When…</span>
              <span className="w-48">Move linked items to</span>
            </div>
            {TRIGGERS.map((t) => (
              <div key={t} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5">
                <span className="text-sm">{GIT_TRIGGER_LABELS[t]}</span>
                <StatusSelect project={project} value={draft[t]} onChange={(v) => set({ [t]: v } as Partial<GitAutomation>)} />
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section
        title="Deploy rules"
        description="When code reaches an environment, move every item that shipped — Mixedlane compares the deployed commit with the previous deploy to find them."
      >
        <div className={cn("space-y-3", !draft.enabled && "pointer-events-none opacity-50")}>
          {draft.deployRules.length > 0 && (
            <div className="divide-y overflow-hidden rounded-xl border bg-card">
              {draft.deployRules.map((rule, i) => (
                <div key={rule.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <span className="text-sm text-muted-foreground">When</span>
                  <Select
                    value={rule.source}
                    onValueChange={(v) => set({ deployRules: draft.deployRules.map((r, j) => (j === i ? { ...r, source: v as DeploySource } : r)) })}
                  >
                    <SelectTrigger size="sm" className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEPLOY_SOURCES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {DEPLOY_SOURCE_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={rule.match}
                    placeholder={MATCH_HINT[rule.source]}
                    title={MATCH_HINT[rule.source]}
                    onChange={(e) => set({ deployRules: draft.deployRules.map((r, j) => (j === i ? { ...r, match: e.target.value } : r)) })}
                    className="h-8 min-w-40 flex-1"
                  />
                  <span className="text-sm text-muted-foreground">→</span>
                  <StatusSelect
                    project={project}
                    value={rule.status}
                    allowNone={false}
                    onChange={(v) => v && set({ deployRules: draft.deployRules.map((r, j) => (j === i ? { ...r, status: v } : r)) })}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    aria-label="Remove rule"
                    onClick={() => set({ deployRules: draft.deployRules.filter((_, j) => j !== i) })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {DEPLOY_SOURCES.map((s) => (
              <Button key={s} variant="outline" size="sm" onClick={() => addRule(s)}>
                <Plus className="size-4" /> {DEPLOY_SOURCE_LABELS[s]}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Tip: add a status like “Released” (Done group) in General settings, map “PR merged” to a review/QA status, and let the production deploy finish the job.
          </p>
        </div>
      </Section>

      <Section title="Options" description="Fine-tune how automations behave.">
        <div className={cn("grid gap-3", !draft.enabled && "pointer-events-none opacity-50")}>
          <Toggle
            checked={draft.onlyForward}
            onChange={(onlyForward) => set({ onlyForward })}
            label="Only move items forward"
            hint="Never move an item back to an earlier status (e.g. a new commit on a Done item won't reopen it)."
          />
          <Toggle
            checked={draft.smartCommits}
            onChange={(smartCommits) => set({ smartCommits })}
            label="Smart commits"
            hint="“KEY #comment text” adds a comment; “KEY #done” or “#in-review” moves the item to that status."
          />
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-6 flex items-center justify-end gap-2 border-t bg-background/90 px-6 py-3 backdrop-blur">
        {dirty && <span className="mr-auto text-sm text-muted-foreground">Unsaved changes</span>}
        <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(saved)}>
          Reset
        </Button>
        <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(draft, { onSuccess: () => toast.success("Automation saved") })}>
          Save automation
        </Button>
      </div>
    </>
  );
}
