import { useCallback, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  BookOpen,
  Bot,
  Check,
  ChevronsUpDown,
  Home,
  LogOut,
  MailWarning,
  UserCog,
  WifiOff,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Sun,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ORG_ROLE_LABELS, SESSION_DAY_OPTIONS } from "@mixedlane/shared";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd, ProjectIcon, UserAvatar } from "@/components/common";
import { useCreateItemDialog } from "@/components/create/CreateItemDialog";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ItemSheet } from "@/components/item/ItemSheet";
import { useProjects } from "@/hooks/queries";
import { useHotkey, useTheme } from "@/hooks/ui";
import { api } from "@/lib/api";
import { useAuth, useOffline, useOrg } from "@/lib/auth";
import { paths } from "@/lib/project";
import { cn } from "@/lib/utils";

export function AppLayout() {
  // The layout sits above the project routes, so read the key from the path.
  const match = useLocation().pathname.match(/^\/[^/]+\/projects\/([^/]+)/)?.[1];
  const projectKey = match === "new" ? undefined : match;
  const navigate = useNavigate();
  const { data: projects = [] } = useProjects();
  const { user } = useAuth();
  const { can } = useOrg();
  const { dark, toggle } = useTheme();
  const openCreate = useCreateItemDialog();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar") === "collapsed";
    } catch {
      return false;
    }
  });

  const toggleSidebar = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("sidebar", c ? "open" : "collapsed");
      } catch {
        /* ignore */
      }
      return !c;
    });

  const canCreateItems = projects.some((p) => p.access.permissions.includes("item.create"));
  const create = useCallback(() => {
    if (canCreateItems) openCreate({ projectKey });
  }, [openCreate, projectKey, canCreateItems]);
  useHotkey("c", create);
  useHotkey("k", useCallback(() => setPaletteOpen((o) => !o), []), { mod: true });
  useHotkey("/", useCallback(() => setPaletteOpen(true), []));

  const navItem = (active: boolean) =>
    cn(
      "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
      active && "bg-sidebar-accent font-medium text-sidebar-foreground",
      collapsed && "justify-center px-0",
    );

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200",
          collapsed ? "w-14" : "w-64",
        )}
      >
        <div className={cn("px-3 pt-3 pb-2", collapsed && "px-2")}>
          <OrgSwitcher collapsed={collapsed} />
        </div>

        <div className={cn("space-y-1 px-3", collapsed && "px-2")}>
          {canCreateItems && (
            <Button onClick={create} className={cn("w-full justify-start gap-2", collapsed && "justify-center px-0")} size="sm">
              <Plus className="size-4" />
              {!collapsed && (
                <>
                  Create <span className="ml-auto"><Kbd>C</Kbd></span>
                </>
              )}
            </Button>
          )}
          <button onClick={() => setPaletteOpen(true)} className={cn(navItem(false), "w-full border border-sidebar-border bg-background/60")}>
            <Search className="size-4" />
            {!collapsed && (
              <>
                <span className="text-muted-foreground">Search…</span>
                <span className="ml-auto"><Kbd>Ctrl K</Kbd></span>
              </>
            )}
          </button>
        </div>

        <nav className={cn("mt-4 flex-1 overflow-y-auto px-3 scroll-thin", collapsed && "px-2")}>
          <NavLink to={paths.projects()} end className={({ isActive }) => navItem(isActive)}>
            <Home className="size-4" />
            {!collapsed && "All projects"}
          </NavLink>
          <NotificationBell collapsed={collapsed} className={cn(navItem(false), "mt-0.5 w-full")} />
          <NavLink to={paths.docs()} className={({ isActive }) => cn(navItem(isActive), "mt-0.5")}>
            <BookOpen className="size-4" />
            {!collapsed && "Docs"}
          </NavLink>

          {!collapsed && (
            <div className="mt-5 mb-1 flex items-center justify-between px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Projects
              {can("project.create") && (
                <button onClick={() => navigate(paths.newProject())} className="rounded p-0.5 hover:bg-sidebar-accent" aria-label="New project">
                  <Plus className="size-3.5" />
                </button>
              )}
            </div>
          )}
          <div className={cn("space-y-0.5", collapsed && "mt-3")}>
            {projects.map((p) => {
              const link = (
                <NavLink key={p.id} to={paths.project(p.key)} className={() => navItem(p.key === projectKey)}>
                  <ProjectIcon icon={p.icon} color={p.color} size="sm" />
                  {!collapsed && <span className="truncate">{p.name}</span>}
                </NavLink>
              );
              return collapsed ? (
                <Tooltip key={p.id}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{p.name}</TooltipContent>
                </Tooltip>
              ) : (
                link
              );
            })}
          </div>
        </nav>

        <div className={cn("space-y-1 border-t border-sidebar-border p-3", collapsed && "px-2")}>
          {can("agent.manage") && (
            <NavLink to={paths.orgSettings("agents")} className={({ isActive }) => cn(navItem(isActive), "w-full")}>
              <Bot className="size-4" />
              {!collapsed && "AI agents"}
            </NavLink>
          )}
          <button onClick={toggle} className={cn(navItem(false), "w-full")}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {!collapsed && (dark ? "Light mode" : "Dark mode")}
          </button>
          <button onClick={toggleSidebar} className={cn(navItem(false), "w-full")}>
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && "Collapse"}
          </button>
          <UserMenu collapsed={collapsed} />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <OfflineBanner />
        {user && !user.emailVerified && <VerifyEmailBanner />}
        <Outlet />
      </main>

      <ItemSheet />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onCreateItem={create}
        onCreateProject={() => navigate(paths.newProject())}
        onToggleTheme={toggle}
        dark={dark}
      />
    </div>
  );
}

function OrgBadge({ name }: { name: string }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function OrgSwitcher({ collapsed }: { collapsed: boolean }) {
  const { orgs, reload } = useAuth();
  const { org, can } = useOrg();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api.orgs.create(name.trim()),
    onSuccess: async (o) => {
      await reload();
      setCreating(false);
      setName("");
      toast.success(`${o.name} created`);
      navigate(`/${o.slug}/projects`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!org) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex w-full items-center gap-2 rounded-lg p-1 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring",
              collapsed && "justify-center",
            )}
          >
            <OrgBadge name={org.name} />
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{org.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{ORG_ROLE_LABELS[org.role]}</span>
                </span>
                <ChevronsUpDown className="size-4 text-muted-foreground" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Organizations</DropdownMenuLabel>
          {orgs.map((o) => (
            <DropdownMenuItem key={o.id} onSelect={() => navigate(`/${o.slug}/projects`)}>
              <OrgBadge name={o.name} />
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              {o.slug === org.slug && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus /> Create organization
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate(paths.orgSettings("general"))}>
            <Settings /> Organization settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate(paths.orgSettings("members"))}>
            <Users /> {can("org.invite") ? "Members & invites" : "Members"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
            <DialogDescription>A separate workspace with its own members, projects and integrations.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
            className="grid gap-4"
          >
            <Input autoFocus placeholder="e.g. Acme Inc" value={name} onChange={(e) => setName(e.target.value)} />
            <DialogFooter>
              <Button type="submit" disabled={!name.trim() || create.isPending}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const daysLabel = (d: number) => (d === 365 ? "1 year" : `${d} days`);

/** Profile + "Stay signed in for". The session renews on every use, so it only ends after that long idle. */
function AccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user, reload } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [days, setDays] = useState(user?.sessionDays ?? 30);
  const save = useMutation({
    mutationFn: () => api.auth.updateMe({ name: name.trim(), sessionDays: days }),
    onSuccess: async () => {
      await reload();
      toast.success("Account updated");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!user) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setName(user.name);
          setDays(user.sessionDays ?? 30);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="acct-name">Name</Label>
            <Input id="acct-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Stay signed in for</Label>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger>
                <SelectValue>{daysLabel(days)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SESSION_DAY_OPTIONS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {daysLabel(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              You stay signed in on each device until you haven't used Mixedlane for this long (it renews every time you use it). Applies from your next token
              refresh.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OfflineBanner() {
  const offline = useOffline();
  if (!offline) return null;
  return (
    <div className="flex items-center gap-2 border-b bg-muted px-6 py-1.5 text-xs text-muted-foreground">
      <WifiOff className="size-3.5" /> Reconnecting to Mixedlane… you're still signed in; changes will load when it's back.
    </div>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [account, setAccount] = useState(false);
  if (!user) return null;
  const signOut = async (everywhere: boolean) => {
    await logout(everywhere);
    navigate("/login", { replace: true });
  };
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn("mt-1 flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-sidebar-accent", collapsed && "justify-center")}>
          <UserAvatar name={user.name} className="size-7 text-[11px]" />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setAccount(true)}>
          <UserCog /> Account settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut(false)}>
          <LogOut /> Sign out
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut(true)}>
          <LogOut /> Sign out of all devices
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <AccountDialog open={account} onOpenChange={setAccount} />
    </>
  );
}

function VerifyEmailBanner() {
  const resend = useMutation({
    mutationFn: () => api.auth.resendVerification(),
    onSuccess: () => toast.success("Verification email sent"),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex items-center gap-2 border-b bg-amber-500/10 px-6 py-2 text-sm text-amber-800 dark:text-amber-200">
      <MailWarning className="size-4 shrink-0" />
      <span className="flex-1">Please confirm your email address — check your inbox for the link.</span>
      <Button size="sm" variant="ghost" className="h-7" disabled={resend.isPending || resend.isSuccess} onClick={() => resend.mutate()}>
        {resend.isSuccess ? "Sent" : "Resend email"}
      </Button>
    </div>
  );
}
