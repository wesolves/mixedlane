import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, FolderKanban, Loader2, MailCheck } from "lucide-react";
import { ORG_ROLE_LABELS } from "@flowboard/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { lastOrg } from "@/lib/session";

/* ---------- Layout ---------- */

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <FolderKanban className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Flowboard</span>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <p className="mt-4 text-center text-sm text-muted-foreground">{footer}</p>}
      </div>
    </div>
  );
}

function Field({ id, label, children, hint }: { id: string; label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {hint}
      </div>
      {children}
    </div>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" /> {message}
    </p>
  );
}

/**
 * Where to land once signed in: the page they were sent away from, else their last org.
 * Pages render <Navigate to={target} /> as soon as the session exists — one redirect path.
 */
function usePostAuthTarget() {
  const from = (useLocation().state as { from?: string } | null)?.from;
  const { orgs } = useAuth();
  if (from && from !== "/") return from;
  const preferred = lastOrg();
  const slug = orgs.find((o) => o.slug === preferred)?.slug ?? orgs[0]?.slug;
  return slug ? `/${slug}/projects` : "/";
}

function useSubmit<T>(fn: () => Promise<T>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (e?: FormEvent) => {
    e?.preventDefault();
    setPending(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };
  return { pending, error, run };
}

/* ---------- Pages ---------- */

export function LoginPage() {
  const { login, status } = useAuth();
  const target = usePostAuthTarget();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submit = useSubmit(() => login(email, password));
  if (status === "authenticated") return <Navigate to={target} replace />;

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your Flowboard workspace."
      footer={
        <>
          New here?{" "}
          <Link to="/register" className="font-medium text-foreground underline-offset-2 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form className="grid gap-4" onSubmit={submit.run}>
        <Field id="email" label="Email">
          <Input id="email" type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field
          id="password"
          label="Password"
          hint={
            <Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">
              Forgot password?
            </Link>
          }
        >
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorNote message={submit.error} />
        <Button type="submit" disabled={submit.pending}>
          {submit.pending && <Loader2 className="size-4 animate-spin" />} Sign in
        </Button>
        {import.meta.env.DEV && (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Demo: <code>alice@flowboard.dev</code> / <code>Flowboard123</code> (also bob, priya, sam, guest)
          </p>
        )}
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register, status } = useAuth();
  const target = usePostAuthTarget();
  const [form, setForm] = useState({ name: "", email: "", password: "", orgName: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = useSubmit(() => register(form));
  if (status === "authenticated") return <Navigate to={target} replace />;

  return (
    <AuthShell
      title="Create your workspace"
      subtitle="Start free — invite your team afterwards."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-foreground underline-offset-2 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="grid gap-4" onSubmit={submit.run}>
        <Field id="name" label="Your name">
          <Input id="name" autoComplete="name" autoFocus required value={form.name} onChange={set("name")} />
        </Field>
        <Field id="email" label="Work email">
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
        </Field>
        <Field id="password" label="Password">
          <Input id="password" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set("password")} />
        </Field>
        <p className="-mt-2 text-xs text-muted-foreground">At least 8 characters, with a letter and a number.</p>
        <Field id="org" label="Organization name">
          <Input id="org" placeholder="e.g. Acme Inc" required value={form.orgName} onChange={set("orgName")} />
        </Field>
        <ErrorNote message={submit.error} />
        <Button type="submit" disabled={submit.pending}>
          {submit.pending && <Loader2 className="size-4 animate-spin" />} Create account
        </Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const submit = useSubmit(async () => {
    await api.auth.forgot(email);
    setSent(true);
  });
  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={
        <Link to="/login" className="font-medium text-foreground underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <p className="flex items-start gap-2 text-sm">
          <MailCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          If an account exists for <strong>{email}</strong>, a reset link is on its way. It works for one hour.
        </p>
      ) : (
        <form className="grid gap-4" onSubmit={submit.run}>
          <Field id="email" label="Email">
            <Input id="email" type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorNote message={submit.error} />
          <Button type="submit" disabled={submit.pending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const submit = useSubmit(async () => {
    await api.auth.reset(token, password);
    setDone(true);
  });
  return (
    <AuthShell title="Choose a new password">
      {done ? (
        <div className="grid gap-4">
          <p className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> Password updated. You've been signed out everywhere else.
          </p>
          <Button onClick={() => navigate("/login")}>Sign in</Button>
        </div>
      ) : (
        <form className="grid gap-4" onSubmit={submit.run}>
          <Field id="password" label="New password">
            <Input id="password" type="password" autoComplete="new-password" autoFocus required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorNote message={token ? submit.error : "This link is missing its token — request a new one."} />
          <Button type="submit" disabled={submit.pending || !token}>
            Update password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { status, reload } = useAuth();
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [error, setError] = useState("");
  useEffect(() => {
    api.auth
      .verifyEmail(token)
      .then(() => setState("ok"))
      .catch((e: Error) => {
        setError(e.message);
        setState("error");
      });
  }, [token]);
  useEffect(() => {
    if (state === "ok" && status === "authenticated") void reload();
  }, [state, status, reload]);

  return (
    <AuthShell title="Email verification">
      {state === "working" && <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />}
      {state === "ok" && (
        <div className="grid gap-4">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-emerald-500" /> Your email is confirmed.
          </p>
          <Button asChild>
            <Link to="/">Continue</Link>
          </Button>
        </div>
      )}
      {state === "error" && <ErrorNote message={error} />}
    </AuthShell>
  );
}

export function InvitePage() {
  const { token = "" } = useParams();
  const { status, user, adopt, reload } = useAuth();
  const navigate = useNavigate();
  const { data: invite, error: loadError, isLoading } = useQuery({ queryKey: ["invite", token], queryFn: () => api.invites.preview(token), retry: false });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const submit = useSubmit(async () => {
    const res = await api.invites.accept(token, status === "authenticated" ? {} : { name, password });
    if (res.accessToken) adopt(res as Parameters<typeof adopt>[0]);
    else await reload();
    navigate(`/${invite!.orgSlug}/projects`, { replace: true });
  });

  if (isLoading) return <AuthShell title="Invitation">{<Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />}</AuthShell>;
  if (loadError || !invite) {
    return (
      <AuthShell title="Invitation" footer={<Link to="/login" className="font-medium text-foreground hover:underline">Go to sign in</Link>}>
        <ErrorNote message={(loadError as Error | null)?.message ?? "This invitation is invalid or has expired"} />
      </AuthShell>
    );
  }

  const intro = (
    <>
      {invite.invitedBy ?? "Someone"} invited <strong>{invite.email}</strong> to join <strong>{invite.orgName}</strong> as{" "}
      {ORG_ROLE_LABELS[invite.role].toLowerCase()}.
    </>
  );

  // Signed in: accept with one click (must be the invited address).
  if (status === "authenticated") {
    const mismatch = user?.email !== invite.email;
    return (
      <AuthShell title={`Join ${invite.orgName}`} subtitle={intro}>
        <div className="grid gap-4">
          {mismatch && <ErrorNote message={`You're signed in as ${user?.email}. Sign out and sign in as ${invite.email} to accept.`} />}
          <ErrorNote message={submit.error} />
          <Button onClick={() => submit.run()} disabled={submit.pending || mismatch}>
            Accept invitation
          </Button>
        </div>
      </AuthShell>
    );
  }

  // Existing account: sign in first, then come back here.
  if (invite.accountExists) {
    return (
      <AuthShell title={`Join ${invite.orgName}`} subtitle={intro}>
        <Button asChild className="w-full">
          <Link to="/login" state={{ from: `/invite/${token}` }}>
            Sign in as {invite.email}
          </Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={`Join ${invite.orgName}`} subtitle={intro}>
      <form className="grid gap-4" onSubmit={submit.run}>
        <Field id="email" label="Email">
          <Input id="email" value={invite.email} disabled />
        </Field>
        <Field id="name" label="Your name">
          <Input id="name" autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="password" label="Choose a password">
          <Input id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorNote message={submit.error} />
        <Button type="submit" disabled={submit.pending}>
          Create account & join
        </Button>
      </form>
    </AuthShell>
  );
}
