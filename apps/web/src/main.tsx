import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CreateItemProvider } from "@/components/create/CreateItemDialog";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthProvider } from "@/lib/auth";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectLayout } from "@/pages/ProjectLayout";
import { OverviewPage } from "@/pages/OverviewPage";
import { BoardPage } from "@/pages/BoardPage";
import { ListPage } from "@/pages/ListPage";
import { ItemPage } from "@/pages/ItemPage";
import { NewProjectPage } from "@/pages/NewProjectPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { OrgSettingsPage } from "@/pages/org/OrgSettingsPage";
import { RequireOrg, RootRedirect } from "@/pages/OrgGate";
import { OAuthConsentPage } from "@/pages/OAuthConsentPage";
import { DocsHome } from "@/pages/docs/DocsHome";
import { SpaceHome, SpaceLayout } from "@/pages/docs/SpaceLayout";
import { PageRoute } from "@/pages/docs/PageView";
import {
  ForgotPasswordPage,
  InvitePage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from "@/pages/auth/AuthPages";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // Don't hammer the API on permission errors.
      retry: (count, err) => count < 1 && ![401, 403, 404].includes((err as { status?: number }).status ?? 0),
    },
  },
});

/** Providers that need router context (the create dialog navigates). */
function Root() {
  return (
    <AuthProvider>
      <CreateItemProvider>
        <Outlet />
      </CreateItemProvider>
    </AuthProvider>
  );
}

const notFound = <div className="p-10 text-sm text-muted-foreground">Page not found.</div>;

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { index: true, element: <RootRedirect /> },
      { path: "login", element: <LoginPage /> },
      { path: "register", element: <RegisterPage /> },
      { path: "forgot-password", element: <ForgotPasswordPage /> },
      { path: "reset-password", element: <ResetPasswordPage /> },
      { path: "verify-email", element: <VerifyEmailPage /> },
      { path: "invite/:token", element: <InvitePage /> },
      { path: "oauth/authorize", element: <OAuthConsentPage /> },
      {
        path: ":org",
        element: <RequireOrg />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <Navigate to="projects" replace /> },
              { path: "projects", element: <ProjectsPage /> },
              { path: "projects/new", element: <NewProjectPage /> },
              { path: "settings", element: <Navigate to="general" replace /> },
              { path: "settings/:tab", element: <OrgSettingsPage /> },
              { path: "docs", element: <DocsHome /> },
              {
                path: "docs/:spaceKey",
                element: <SpaceLayout />,
                children: [
                  { index: true, element: <SpaceHome /> },
                  { path: ":pageId", element: <PageRoute /> },
                ],
              },
              {
                path: "projects/:projectKey",
                children: [
                  {
                    element: <ProjectLayout />,
                    children: [
                      { index: true, element: <OverviewPage /> },
                      { path: "board", element: <BoardPage /> },
                      { path: "list", element: <ListPage /> },
                      { path: "settings", element: <SettingsPage /> },
                      { path: "settings/github", element: <SettingsPage section="github" /> },
                      { path: "settings/access", element: <SettingsPage section="access" /> },
                    ],
                  },
                  { path: ":itemType/:itemKey", element: <ItemPage /> },
                ],
              },
              { path: "*", element: notFound },
            ],
          },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <Toaster richColors position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
