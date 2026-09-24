import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { FaGithub } from "react-icons/fa";
import {
  Copy,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { DevPullRequest, DeploySource } from "@flowboard/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateBranch, useDevelopment, useGithubConnection } from "@/hooks/queries";
import { paths, useProjectScope } from "@/lib/project";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";

export const PR_META: Record<DevPullRequest["state"] | "draft", { icon: LucideIcon; color: string; label: string }> = {
  open: { icon: GitPullRequest, color: "text-emerald-600 dark:text-emerald-400", label: "Open" },
  draft: { icon: GitPullRequestDraft, color: "text-muted-foreground", label: "Draft" },
  merged: { icon: GitMerge, color: "text-violet-600 dark:text-violet-400", label: "Merged" },
  closed: { icon: GitPullRequestClosed, color: "text-red-600 dark:text-red-400", label: "Closed" },
};

const DEPLOY_LABEL: Record<DeploySource, string> = { deployment: "Deployed to", workflow: "Workflow", release: "Release" };

const copy = (text: string, what = "Copied") => {
  void copyText(text).then((ok) => (ok ? toast.success(what) : toast.error("Couldn't copy — select the text and copy it manually")));
};

export function DevelopmentPanel({ itemId }: { itemId: string }) {
  const { project, can } = useProjectScope();
  const { data: conn } = useGithubConnection();
  const { data: dev } = useDevelopment(itemId);
  const [showCommits, setShowCommits] = useState(false);
  if (!dev) return null;

  const empty = !dev.pullRequests.length && !dev.branches.length && !dev.commits.length && !dev.deployments.length;
  const commits = showCommits ? dev.commits : dev.commits.slice(0, 3);

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <FaGithub className="size-4" />
        <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Development</h3>
        {dev.repos.length > 0 && conn?.connected && can("item.update") && <CreateBranch itemId={itemId} suggested={dev.suggestedBranch} repos={dev.repos} />}
      </div>

      {dev.repos.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <Link to={`${paths.project(project.key, "settings")}/github`} className="font-medium text-foreground underline-offset-2 hover:underline">
            Link a GitHub repo
          </Link>{" "}
          to see branches, PRs and deploys here.
        </p>
      ) : (
        empty && (
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>Nothing linked yet. Start a branch:</p>
            <button
              onClick={() => copy(`git checkout -b ${dev.suggestedBranch}`, "Git command copied")}
              className="group flex w-full items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-left font-mono text-[11px] text-foreground hover:bg-muted"
            >
              <span className="truncate">git checkout -b {dev.suggestedBranch}</span>
              <Copy className="ml-auto size-3.5 shrink-0 opacity-60 group-hover:opacity-100" />
            </button>
          </div>
        )
      )}

      {dev.pullRequests.length > 0 && (
        <ul className="space-y-1.5">
          {dev.pullRequests.map((pr) => {
            const meta = PR_META[pr.draft && pr.state === "open" ? "draft" : pr.state];
            return (
              <li key={pr.id}>
                <a href={pr.htmlUrl} target="_blank" rel="noreferrer" className="group flex items-start gap-2 rounded-md p-1.5 -mx-1.5 hover:bg-muted/60">
                  <meta.icon className={cn("mt-0.5 size-4 shrink-0", meta.color)} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 font-medium group-hover:underline">{pr.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      #{pr.number} · {meta.label} · {pr.headRef} → {pr.baseRef}
                    </span>
                  </span>
                  <ExternalLink className="mt-0.5 size-3.5 shrink-0 opacity-0 group-hover:opacity-60" />
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {dev.branches.length > 0 && (
        <ul className="space-y-1">
          {dev.branches.map((b) => (
            <li key={b.id} className="flex items-center gap-2">
              <GitBranch className="size-4 shrink-0 text-muted-foreground" />
              <a href={b.htmlUrl} target="_blank" rel="noreferrer" className="truncate font-mono text-xs hover:underline" title={`${b.repo}: ${b.name}`}>
                {b.name}
              </a>
              <button onClick={() => copy(b.name, "Branch name copied")} className="ml-auto shrink-0 text-muted-foreground hover:text-foreground" aria-label="Copy branch name">
                <Copy className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {dev.commits.length > 0 && (
        <div>
          <ul className="space-y-1">
            {commits.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <GitCommitHorizontal className="size-4 shrink-0 text-muted-foreground" />
                <a href={c.htmlUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-muted-foreground hover:underline">
                  {c.sha.slice(0, 7)}
                </a>
                <span className="truncate text-xs" title={c.message}>
                  {c.message.split("\n")[0]}
                </span>
              </li>
            ))}
          </ul>
          {dev.commits.length > 3 && (
            <button onClick={() => setShowCommits((s) => !s)} className="mt-1 text-xs text-muted-foreground hover:text-foreground">
              {showCommits ? "Show fewer" : `Show all ${dev.commits.length} commits`}
            </button>
          )}
        </div>
      )}

      {dev.deployments.length > 0 && (
        <ul className="space-y-1">
          {dev.deployments.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <Rocket className={cn("size-4 shrink-0", d.state === "success" ? "text-emerald-500" : "text-muted-foreground")} />
              <span className="truncate text-xs">
                {DEPLOY_LABEL[d.source]} <span className="font-medium">{d.name}</span>
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground" title={new Date(d.at).toLocaleString()}>
                {d.state !== "success" && `${d.state} · `}
                {formatDistanceToNow(new Date(d.at), { addSuffix: true })}
              </span>
              {d.htmlUrl && (
                <a href={d.htmlUrl} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Open deployment">
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateBranch({ itemId, suggested, repos }: { itemId: string; suggested: string; repos: { id: string; fullName: string; defaultBranch: string }[] }) {
  const [open, setOpen] = useState(false);
  const [repoId, setRepoId] = useState(repos[0].id);
  const [name, setName] = useState(suggested);
  const repo = repos.find((r) => r.id === repoId) ?? repos[0];
  const [from, setFrom] = useState(repo.defaultBranch);
  const create = useCreateBranch(itemId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="ml-auto h-7 text-xs">
          <GitBranch className="size-3.5" /> Create branch
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        {repos.length > 1 && (
          <div className="grid gap-1.5">
            <Label className="text-xs">Repository</Label>
            <Select
              value={repoId}
              onValueChange={(v) => {
                setRepoId(v);
                setFrom(repos.find((r) => r.id === v)!.defaultBranch);
              }}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {repos.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label className="text-xs">Branch name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value.replace(/\s+/g, "-"))} className="h-8 font-mono text-xs" />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">From</Label>
          <Input value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 font-mono text-xs" />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            disabled={!name.trim() || create.isPending}
            onClick={async () => {
              await create.mutateAsync({ repoId, name: name.trim(), from: from.trim() || undefined });
              toast.success(`Branch ${name} created on ${repo.fullName}`);
              setOpen(false);
            }}
          >
            <FaGithub /> Create on GitHub
          </Button>
          <Button size="sm" variant="outline" onClick={() => copy(`git checkout -b ${name.trim()}`, "Git command copied")} title="Copy git checkout command">
            <Copy className="size-3.5" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
