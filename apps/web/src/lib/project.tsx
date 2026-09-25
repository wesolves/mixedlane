import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ItemType, Project, ProjectAccessInfo, ProjectPermission, StatusDef } from "@mixedlane/shared";
import { getCurrentOrg } from "./session";

interface Scope {
  project: Project;
  statusById: (id: string) => StatusDef;
  /** What the signed-in user may do in this project. */
  can: (permission: ProjectPermission) => boolean;
}

const ProjectContext = createContext<Scope | null>(null);

const UNKNOWN = (id: string): StatusDef => ({ id, name: id, color: "#a1a1aa", category: "todo" });

/** Makes the current project's configuration (statuses, types, access) available to item components. */
export function ProjectScope({ project, children }: { project: Project & { access?: ProjectAccessInfo }; children: ReactNode }) {
  const value = useMemo<Scope>(() => {
    const map = new Map(project.statuses.map((s) => [s.id, s]));
    const perms = new Set(project.access?.permissions ?? []);
    return { project, statusById: (id) => map.get(id) ?? UNKNOWN(id), can: (p) => perms.has(p) };
  }, [project]);
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectScope(): Scope {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjectScope must be used inside <ProjectScope>");
  return ctx;
}

/* ---------- Routes (every app page lives under the selected org) ---------- */

const org = () => `/${getCurrentOrg() ?? ""}`;

export type OrgSettingsTab = "general" | "members" | "teams" | "agents" | "integrations";

export const paths = {
  projects: () => `${org()}/projects`,
  newProject: () => `${org()}/projects/new`,
  project: (key: string, tab?: "board" | "list" | "settings") => `${org()}/projects/${key}${tab ? `/${tab}` : ""}`,
  projectSettings: (key: string, section?: "github" | "access") => `${org()}/projects/${key}/settings${section ? `/${section}` : ""}`,
  item: (projectKey: string, item: { key: string; type: ItemType }) => `${org()}/projects/${projectKey}/${item.type}/${item.key}`,
  orgSettings: (tab: OrgSettingsTab = "general") => `${org()}/settings/${tab}`,
  docs: () => `${org()}/docs`,
  space: (spaceKey: string) => `${org()}/docs/${spaceKey}`,
  page: (spaceKey: string, pageId: string) => `${org()}/docs/${spaceKey}/${pageId}`,
  /** Links stored server-side (notifications) are relative to the org. */
  inOrg: (link: string) => `${org()}${link}`,
};

export const projectKeyOf = (itemKey: string) => itemKey.slice(0, itemKey.lastIndexOf("-"));
