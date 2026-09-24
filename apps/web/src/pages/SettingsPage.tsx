import { Link, useOutletContext } from "react-router-dom";
import { FaGithub } from "react-icons/fa";
import { Shield, SlidersHorizontal } from "lucide-react";
import { ProjectForm } from "@/components/project/ProjectForm";
import { ProjectGithubSettings } from "@/components/project/ProjectGithubSettings";
import { ProjectAccessSettings } from "@/components/project/ProjectAccessSettings";
import { paths, useProjectScope } from "@/lib/project";
import { cn } from "@/lib/utils";
import type { ProjectOutletContext } from "./ProjectLayout";

type Section = "general" | "access" | "github";

export function SettingsPage({ section = "general" }: { section?: Section }) {
  const { project, tree } = useOutletContext<ProjectOutletContext>();
  const { can } = useProjectScope();
  const tabs: { id: Section; to: string; label: string; icon: React.ReactNode }[] = [
    { id: "general", to: paths.projectSettings(project.key), label: "General", icon: <SlidersHorizontal className="size-4" /> },
    { id: "access", to: paths.projectSettings(project.key, "access"), label: "Access", icon: <Shield className="size-4" /> },
    { id: "github", to: paths.projectSettings(project.key, "github"), label: "GitHub", icon: <FaGithub className="size-4" /> },
  ];
  return (
    <div className="flex-1 overflow-y-auto">
      <nav className="flex gap-1 px-6 pt-4">
        {tabs.map((t) => (
          <Link
            key={t.id}
            to={t.to}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              section === t.id && "bg-muted font-medium text-foreground",
            )}
          >
            {t.icon} {t.label}
          </Link>
        ))}
      </nav>
      {section === "github" ? (
        <ProjectGithubSettings project={project} />
      ) : section === "access" ? (
        <ProjectAccessSettings project={project} />
      ) : can("project.admin") ? (
        // Remount when the saved project changes so the form shows server state.
        <ProjectForm key={project.updatedAt} project={project} tree={tree} />
      ) : (
        <p className="m-6 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">Only project admins can change project settings.</p>
      )}
    </div>
  );
}
