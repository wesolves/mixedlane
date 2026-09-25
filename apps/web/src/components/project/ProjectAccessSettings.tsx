import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe2, Lock, Plus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { AGENT_PERMISSION_LABELS, PROJECT_ROLES, PROJECT_ROLE_HINTS, PROJECT_ROLE_LABELS, type AgentPermission, type Project, type ProjectAccessOverview, type ProjectRole } from "@mixedlane/shared";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ActorAvatar } from "@/components/common";
import { api } from "@/lib/api";
import { paths, useProjectScope } from "@/lib/project";
import { cn } from "@/lib/utils";

const onError = (e: Error) => toast.error(e.message);

function RoleSelect({ value, onChange, disabled }: { value: ProjectRole; onChange: (r: ProjectRole) => void; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ProjectRole)} disabled={disabled}>
      <SelectTrigger size="sm" className="w-36">
        <SelectValue>{PROJECT_ROLE_LABELS[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {PROJECT_ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            <div>
              <div>{PROJECT_ROLE_LABELS[r]}</div>
              <div className="text-xs text-muted-foreground">{PROJECT_ROLE_HINTS[r]}</div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Who can see and change this project: visibility, default role for members, and explicit grants. */
export function ProjectAccessSettings({ project }: { project: Project }) {
  const qc = useQueryClient();
  const { can } = useProjectScope();
  const admin = can("project.admin");
  const key = ["access", project.key];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.access.get(project.key) });
  const { data: members = [] } = useQuery({ queryKey: ["org", "members"], queryFn: api.orgs.members });
  const { data: teams = [] } = useQuery({ queryKey: ["org", "teams"], queryFn: api.orgs.teams });
  const set = (next: ProjectAccessOverview) => {
    qc.setQueryData(key, next);
    // Everyone's effective access may have changed.
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["project"] });
  };
  const settings = useMutation({ mutationFn: (p: { visibility?: "org" | "private"; defaultRole?: ProjectRole }) => api.access.settings(project.key, p), onSuccess: set, onError });
  const grant = useMutation({
    mutationFn: (g: { principalType: "user" | "team"; principalId: string; role: ProjectRole }) => api.access.grant(project.key, g),
    onSuccess: set,
    onError,
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.access.revoke(project.key, id), onSuccess: set, onError });

  const [adding, setAdding] = useState("");
  const [addRole, setAddRole] = useState<ProjectRole>("editor");

  if (!data) return <Skeleton className="m-6 h-64" />;

  const granted = new Set(data.grants.map((g) => `${g.principalType}:${g.principalId}`));
  const options = [
    ...teams.filter((t) => !granted.has(`team:${t.id}`)).map((t) => ({ value: `team:${t.id}`, label: t.name, detail: `Team · ${t.members.length} people` })),
    ...members
      .filter((m) => !granted.has(`user:${m.userId}`) && m.role !== "owner" && m.role !== "admin")
      .map((m) => ({ value: `user:${m.userId}`, label: m.name, detail: `${m.email}${m.role === "guest" ? " · guest" : ""}` })),
  ];

  return (
    <div className="max-w-3xl space-y-8 px-6 py-6">
      {!admin && (
        <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">Only project admins can change access.</p>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">Visibility</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              { v: "org", icon: Globe2, title: "Organization", hint: "Every member can open it with the default role below. Guests still need an invite." },
              { v: "private", icon: Lock, title: "Private", hint: "Only admins and the people or teams listed below." },
            ] as const
          ).map(({ v, icon: Icon, title, hint }) => (
            <button
              key={v}
              type="button"
              disabled={!admin}
              onClick={() => settings.mutate({ visibility: v })}
              className={cn(
                "flex gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed",
                data.visibility === v ? "border-primary bg-primary/5" : "hover:bg-muted/40",
              )}
            >
              <Icon className={cn("mt-0.5 size-5", data.visibility === v ? "text-primary" : "text-muted-foreground")} />
              <span>
                <span className="block font-medium">{title}</span>
                <span className="block text-sm text-muted-foreground">{hint}</span>
              </span>
            </button>
          ))}
        </div>
        {data.visibility === "org" && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
            <span className="text-sm">Members get</span>
            <RoleSelect value={data.defaultRole} disabled={!admin} onChange={(defaultRole) => settings.mutate({ defaultRole })} />
            <span className="text-sm text-muted-foreground">access by default.</span>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">People and teams</h2>
        <p className="text-sm text-muted-foreground">
          Grants add to the default — someone gets the highest role that applies to them. Org owners and admins always have admin access.
        </p>
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {data.grants.map((g) => (
            <div key={g.id} className="flex items-center gap-3 px-4 py-2.5">
              {g.principalType === "team" ? (
                <span className="flex size-6 items-center justify-center rounded-full bg-muted">
                  <Users className="size-3.5" />
                </span>
              ) : (
                <ActorAvatar name={g.name} type={g.principalType === "agent" ? "agent" : "user"} />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{g.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {g.principalType === "agent"
                    ? `AI agent · ${(g.permissions ?? []).map((p) => AGENT_PERMISSION_LABELS[p as AgentPermission]?.label ?? p).join(", ")}`
                    : g.detail}
                </p>
              </div>
              {g.principalType === "agent" ? (
                <Link to={paths.orgSettings("agents")} className="text-xs text-primary hover:underline">
                  Manage
                </Link>
              ) : (
                <RoleSelect
                  value={g.role}
                  disabled={!admin}
                  onChange={(role) => grant.mutate({ principalType: g.principalType as "user" | "team", principalId: g.principalId, role })}
                />
              )}
              {admin && (
                <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" aria-label={`Remove ${g.name}`} onClick={() => revoke.mutate(g.id)}>
                  <X className="size-4" />
                </Button>
              )}
            </div>
          ))}
          {data.grants.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No explicit grants.</p>}
          {admin && options.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 bg-muted/30 px-4 py-3">
              <Select value={adding} onValueChange={setAdding}>
                <SelectTrigger size="sm" className="min-w-64 flex-1">
                  <SelectValue placeholder="Add a person or team…" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label} <span className="text-muted-foreground">{o.detail}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <RoleSelect value={addRole} onChange={setAddRole} />
              <Button
                size="sm"
                disabled={!adding || grant.isPending}
                onClick={() => {
                  const [principalType, principalId] = adding.split(":") as ["user" | "team", string];
                  grant.mutate({ principalType, principalId, role: addRole }, { onSuccess: () => setAdding("") });
                }}
              >
                <Plus className="size-4" /> Add
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
