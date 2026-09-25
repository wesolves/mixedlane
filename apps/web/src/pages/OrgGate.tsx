import { useEffect, useRef } from "react";
import { Link, Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, useOffline } from "@/lib/auth";
import { RealtimeProvider } from "@/lib/realtime";
import { lastOrg, setCurrentOrg } from "@/lib/session";

function FullScreenSpinner() {
  const offline = useOffline();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      {offline && <p className="text-sm text-muted-foreground">Reconnecting to Mixedlane… you're still signed in.</p>}
    </div>
  );
}

/** `/` → the last org you used (or your first), or sign in. */
export function RootRedirect() {
  const { status, orgs } = useAuth();
  if (status === "loading") return <FullScreenSpinner />;
  if (status === "anonymous") return <Navigate to="/login" replace />;
  const preferred = lastOrg();
  const slug = orgs.find((o) => o.slug === preferred)?.slug ?? orgs[0]?.slug;
  return slug ? <Navigate to={`/${slug}/projects`} replace /> : <NoOrgs />;
}

function NoOrgs() {
  const { logout } = useAuth();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="font-medium">You're not a member of any organization.</p>
      <p className="text-sm text-muted-foreground">Ask an admin for an invite link, or sign out and create a new workspace.</p>
      <Button variant="outline" onClick={() => void logout()}>
        Sign out
      </Button>
    </div>
  );
}

/**
 * Everything under /:org requires a session and membership of that org. It also scopes the API
 * client (X-Org header) and clears cached data when switching orgs, so nothing leaks between them.
 */
export function RequireOrg() {
  const { org: slug = "" } = useParams();
  const { status, orgs } = useAuth();
  const location = useLocation();
  const qc = useQueryClient();
  const previous = useRef<string | null>(null);
  const member = orgs.find((o) => o.slug === slug);

  // Set before children render so their first requests carry the right X-Org.
  if (member) setCurrentOrg(member.slug);

  useEffect(() => {
    if (!member) return;
    if (previous.current && previous.current !== member.slug) qc.clear();
    previous.current = member.slug;
  }, [member, qc]);

  if (status === "loading") return <FullScreenSpinner />;
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!member) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-center">
        <p className="font-medium">Organization not found</p>
        <p className="text-sm text-muted-foreground">It doesn't exist or you're not a member of “{slug}”.</p>
        <Button asChild variant="outline">
          <Link to="/">Go to my workspace</Link>
        </Button>
      </div>
    );
  }
  // Keyed by org: switching orgs opens a fresh socket scoped to the new one.
  return (
    <RealtimeProvider key={member.slug} org={member.slug}>
      <Outlet />
    </RealtimeProvider>
  );
}
