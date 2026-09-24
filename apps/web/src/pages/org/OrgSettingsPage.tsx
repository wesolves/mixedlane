import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bot, Building2, Check, Copy, Link2, LogOut, Mail, Plug, Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { ORG_ROLES, ORG_ROLE_HINTS, ORG_ROLE_LABELS, type OrgRole, type Team } from "@flowboard/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, UserAvatar } from "@/components/common";
import { IntegrationsPage } from "@/pages/IntegrationsPage";
import { AgentsTab } from "@/pages/org/AgentsTab";
import { api } from "@/lib/api";
import { useAuth, useOrg } from "@/lib/auth";
import { paths, type OrgSettingsTab } from "@/lib/project";
import { setCurrentOrg } from "@/lib/session";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";

const TABS: { id: OrgSettingsTab; label: string; icon: typeof Users }[] = [
  { id: "general", label: "General", icon: Building2 },
  { id: "members", label: "Members", icon: Users },
  { id: "teams", label: "Teams", icon: Users },
  { id: "agents", label: "AI agents", icon: Bot },
  { id: "integrations", label: "Integrations", icon: Plug },
];

const onError = (e: Error) => toast.error(e.message);

export function OrgSettingsPage() {
  const { tab = "general" } = useParams();
  const { org, can } = useOrg();
  const tabs = TABS.filter((t) => t.id !== "agents" || can("agent.manage"));
  if (!tabs.some((t) => t.id === tab)) return <Navigate to={paths.orgSettings()} replace />;
  return (
    <div className="flex-1 overflow-y-auto">
      <header className="border-b px-6 pt-5">
        <h1 className="text-lg font-semibold tracking-tight">{org?.name} settings</h1>
        <p className="text-sm text-muted-foreground">Members, teams, AI agents and integrations for the whole organization.</p>
        <nav className="mt-4 flex gap-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <Link
              key={id}
              to={paths.orgSettings(id)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 pb-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                tab === id && "border-primary font-medium text-foreground",
              )}
            >
              <Icon className="size-4" /> {label}
            </Link>
          ))}
        </nav>
      </header>
      {tab === "general" && <GeneralTab />}
      {tab === "members" && <MembersTab />}
      {tab === "teams" && <TeamsTab />}
      {tab === "agents" && <AgentsTab />}
      {tab === "integrations" && <IntegrationsPage embedded />}
    </div>
  );
}

/* ---------- General ---------- */

function GeneralTab() {
  const { org, can } = useOrg();
  const { reload, user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(org?.name ?? "");
  const [slug, setSlug] = useState(org?.slug ?? "");
  const [confirmDelete, setConfirmDelete] = useState("");
  const canManage = can("org.manage");

  const save = useMutation({
    mutationFn: () => api.orgs.update({ name: name.trim(), slug: slug.trim() }),
    onSuccess: async (o) => {
      await reload();
      toast.success("Organization updated");
      if (o.slug !== org?.slug) {
        setCurrentOrg(o.slug);
        navigate(paths.orgSettings("general"), { replace: true });
      }
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.orgs.remove(),
    onSuccess: async () => {
      await reload();
      toast.success("Organization deleted");
      navigate("/", { replace: true });
    },
    onError,
  });
  const leave = useMutation({
    mutationFn: () => api.orgs.removeMember(user!.id),
    onSuccess: async () => {
      await reload();
      toast.success(`You left ${org?.name}`);
      navigate("/", { replace: true });
    },
    onError,
  });

  return (
    <div className="max-w-2xl space-y-8 px-6 py-6">
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="grid gap-1.5">
          <Label htmlFor="org-name">Name</Label>
          <Input id="org-name" value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="org-slug">URL</Label>
          <div className="flex items-center rounded-md border bg-muted/40 pl-3 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring/30">
            {location.host}/
            <input
              id="org-slug"
              value={slug}
              disabled={!canManage}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              className="h-9 flex-1 bg-transparent px-1 text-foreground outline-none"
            />
          </div>
          <p className="text-xs text-muted-foreground">Changing the URL breaks links people have bookmarked.</p>
        </div>
        {canManage && (
          <Button disabled={save.isPending || (name === org?.name && slug === org?.slug) || !name.trim()} onClick={() => save.mutate()}>
            Save changes
          </Button>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-destructive/30 p-5">
        <h2 className="font-semibold text-destructive">Danger zone</h2>
        {org?.role !== "owner" && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">Leave this organization. You'll lose access to its projects.</p>
            <Button variant="outline" onClick={() => confirm(`Leave ${org?.name}?`) && leave.mutate()}>
              <LogOut className="size-4" /> Leave
            </Button>
          </div>
        )}
        {can("org.delete") && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Delete the organization and <strong>everything</strong> in it. Type <code className="rounded bg-muted px-1">{org?.slug}</code> to confirm.
            </p>
            <div className="flex gap-2">
              <Input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} placeholder={org?.slug} className="max-w-60" />
              <Button variant="destructive" disabled={confirmDelete !== org?.slug || remove.isPending} onClick={() => remove.mutate()}>
                <Trash2 className="size-4" /> Delete organization
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------- Members ---------- */

function RoleSelect({ value, onChange, disabled, allowOwner }: { value: OrgRole; onChange: (r: OrgRole) => void; disabled?: boolean; allowOwner?: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as OrgRole)} disabled={disabled}>
      <SelectTrigger size="sm" className="w-32">
        <SelectValue>{ORG_ROLE_LABELS[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ORG_ROLES.filter((r) => allowOwner || r !== "owner" || value === "owner").map((r) => (
          <SelectItem key={r} value={r} disabled={r === "owner" && !allowOwner}>
            <div>
              <div>{ORG_ROLE_LABELS[r]}</div>
              <div className="text-xs text-muted-foreground">{ORG_ROLE_HINTS[r]}</div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MembersTab() {
  const qc = useQueryClient();
  const { org, can } = useOrg();
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const { data: members, isLoading } = useQuery({ queryKey: ["org", "members"], queryFn: api.orgs.members });
  const { data: invites = [] } = useQuery({ queryKey: ["org", "invites"], queryFn: api.orgs.invites, enabled: can("org.invite") });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["org"] });

  const setRole = useMutation({ mutationFn: (v: { userId: string; role: OrgRole }) => api.orgs.setRole(v.userId, v.role), onSuccess: invalidate, onError });
  const remove = useMutation({ mutationFn: (userId: string) => api.orgs.removeMember(userId), onSuccess: invalidate, onError });
  const revoke = useMutation({ mutationFn: (id: string) => api.orgs.revokeInvite(id), onSuccess: invalidate, onError });
  const canManage = can("org.manage");
  const isOwner = org?.role === "owner";

  return (
    <div className="max-w-4xl space-y-6 px-6 py-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{members?.length ?? 0} members</p>
        {can("org.invite") && (
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" /> Invite people
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {members?.map((m) => (
            <div key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <UserAvatar name={m.name} className="size-8 text-xs" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.name} {m.userId === user?.id && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {m.email}
                  {m.teams.length > 0 && ` · ${m.teams.map((t) => t.name).join(", ")}`}
                </p>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                joined {formatDistanceToNow(new Date(m.joinedAt), { addSuffix: true })}
              </span>
              <RoleSelect
                value={m.role}
                disabled={!canManage || (m.role === "owner" && !isOwner)}
                allowOwner={isOwner}
                onChange={(role) => setRole.mutate({ userId: m.userId, role })}
              />
              {canManage && m.userId !== user?.id && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${m.name}`}
                  disabled={m.role === "owner" && !isOwner}
                  onClick={() => confirm(`Remove ${m.name} from ${org?.name}?`) && remove.mutate(m.userId)}
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {can("org.invite") && invites.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Pending invitations</h2>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {invites.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Mail className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{i.email}</span>
                <span className="text-xs text-muted-foreground">
                  {ORG_ROLE_LABELS[i.role]} · expires {formatDistanceToNow(new Date(i.expiresAt), { addSuffix: true })}
                </span>
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)} />}
    </div>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const { data: teams = [] } = useQuery({ queryKey: ["org", "teams"], queryFn: api.orgs.teams });
  const send = useMutation({
    mutationFn: () => api.orgs.invite(email.trim(), role, teamIds),
    onSuccess: (res) => {
      setLink(res.url);
      qc.invalidateQueries({ queryKey: ["org", "invites"] });
      toast.success(`Invitation sent to ${email}`);
    },
    onError,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite to the organization</DialogTitle>
          <DialogDescription>They'll get an email with a link. You can also copy the link and share it yourself.</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm">
              <Check className="size-4 text-emerald-500" /> Invitation created for <strong>{email}</strong>
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-2.5 py-1.5 text-xs">{link}</code>
              <Button
                size="icon"
                variant="outline"
                aria-label="Copy link"
                onClick={() => {
                  void copyText(link).then((ok) => (ok ? toast.success("Link copied") : toast.error("Couldn't copy the link")));
                }}
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => { setLink(null); setEmail(""); }}>
                Invite another
              </Button>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              send.mutate();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Role</Label>
              <RoleSelect value={role} onChange={setRole} />
            </div>
            {teams.length > 0 && (
              <div className="grid gap-1.5">
                <Label>Teams (optional)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {teams.map((t) => {
                    const on = teamIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTeamIds((ids) => (on ? ids.filter((x) => x !== t.id) : [...ids, t.id]))}
                        className={cn("rounded-full border px-2.5 py-1 text-xs", on && "border-primary bg-primary/10 text-primary")}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={send.isPending || !email.trim()}>
                <Link2 className="size-4" /> Create invitation
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Teams ---------- */

function TeamsTab() {
  const qc = useQueryClient();
  const { can } = useOrg();
  const { data: teams, isLoading } = useQuery({ queryKey: ["org", "teams"], queryFn: api.orgs.teams });
  const { data: members = [] } = useQuery({ queryKey: ["org", "members"], queryFn: api.orgs.members });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["org"] });
  const create = useMutation({
    mutationFn: () => api.orgs.createTeam(name.trim(), description.trim()),
    onSuccess: () => {
      setName("");
      setDescription("");
      invalidate();
    },
    onError,
  });
  const manage = can("team.manage");

  return (
    <div className="max-w-4xl space-y-6 px-6 py-6">
      <p className="text-sm text-muted-foreground">Teams group people so you can give them access to projects together.</p>
      {manage && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <div className="grid min-w-48 flex-1 gap-1.5">
            <Label htmlFor="team-name">New team</Label>
            <Input id="team-name" placeholder="e.g. Mobile" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid min-w-64 flex-[2] gap-1.5">
            <Label htmlFor="team-desc">Description</Label>
            <Textarea id="team-desc" rows={1} className="min-h-9" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            <Plus className="size-4" /> Create
          </Button>
        </form>
      )}
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : !teams?.length ? (
        <EmptyState icon={<Users className="size-5" />} title="No teams yet" description="Create a team, add people, then grant it access to projects." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map((t) => (
            <TeamCard key={t.id} team={t} members={members} manage={manage} onChange={invalidate} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamCard({ team, members, manage, onChange }: { team: Team; members: { userId: string; name: string; email: string }[]; manage: boolean; onChange: () => void }) {
  const [adding, setAdding] = useState("");
  const add = useMutation({ mutationFn: (userId: string) => api.orgs.addTeamMember(team.id, userId), onSuccess: onChange, onError });
  const remove = useMutation({ mutationFn: (userId: string) => api.orgs.removeTeamMember(team.id, userId), onSuccess: onChange, onError });
  const del = useMutation({ mutationFn: () => api.orgs.deleteTeam(team.id), onSuccess: onChange, onError });
  const candidates = members.filter((m) => !team.members.some((tm) => tm.userId === m.userId));

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-start gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{team.name}</p>
          {team.description && <p className="truncate text-xs text-muted-foreground">{team.description}</p>}
        </div>
        {manage && (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground hover:text-destructive"
            aria-label={`Delete ${team.name}`}
            onClick={() => confirm(`Delete team ${team.name}? Project access granted to it is removed.`) && del.mutate()}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      <ul className="divide-y">
        {team.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2 px-4 py-2 text-sm">
            <UserAvatar name={m.name} />
            <span className="min-w-0 flex-1 truncate">{m.name}</span>
            {m.role === "lead" && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Lead</span>}
            {manage && (
              <button className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${m.name}`} onClick={() => remove.mutate(m.userId)}>
                <X className="size-4" />
              </button>
            )}
          </li>
        ))}
        {team.members.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No members yet.</li>}
      </ul>
      {manage && candidates.length > 0 && (
        <div className="border-t p-3">
          <Select
            value={adding}
            onValueChange={(v) => {
              setAdding("");
              add.mutate(v);
            }}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Add a member…" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name} <span className="text-muted-foreground">{m.email}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
