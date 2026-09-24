import { NavLink, Outlet, useParams } from "react-router-dom";
import { LayoutGrid, ListTree, Plus, Settings, SquareKanban } from "lucide-react";
import { PROJECT_ROLE_LABELS, type Project, type WorkItemSummary } from "@flowboard/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectIcon } from "@/components/common";
import { useCreateItemDialog } from "@/components/create/CreateItemDialog";
import { useProject, useProjectTree } from "@/hooks/queries";
import { ProjectScope } from "@/lib/project";
import { cn } from "@/lib/utils";

export interface ProjectOutletContext {
  project: Project;
  tree: WorkItemSummary[];
}

const tabs = [
  { to: "", label: "Overview", icon: LayoutGrid, end: true },
  { to: "board", label: "Board", icon: SquareKanban },
  { to: "list", label: "List", icon: ListTree },
  { to: "settings", label: "Settings", icon: Settings },
];

export function ProjectLayout() {
  const { projectKey = "" } = useParams();
  const { data: project, error } = useProject(projectKey);
  const { data: tree } = useProjectTree(projectKey);
  const openCreate = useCreateItemDialog();

  if (error) return <div className="p-10 text-sm text-muted-foreground">{error.message}</div>;
  if (!project || !tree) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <ProjectScope project={project}>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="shrink-0 border-b px-6 pt-5">
          <div className="flex items-center gap-3">
            <ProjectIcon icon={project.icon} color={project.color} size="md" />
            <div className="min-w-0">
              <h1 className="truncate text-lg leading-tight font-semibold tracking-tight">{project.name}</h1>
              <p className="truncate text-xs text-muted-foreground">{project.description || project.key}</p>
            </div>
            <span className="ml-auto rounded-full border px-2 py-0.5 text-xs text-muted-foreground" title="Your access to this project">
              {PROJECT_ROLE_LABELS[project.access.role]}
            </span>
            {project.access.permissions.includes("item.create") && (
              <Button size="sm" onClick={() => openCreate({ projectKey })}>
                <Plus className="size-4" /> Create
              </Button>
            )}
          </div>
          <nav className="mt-4 flex gap-1">
            {tabs.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={label}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "-mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 pb-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                    isActive && "border-primary font-medium text-foreground",
                  )
                }
              >
                <Icon className="size-4" /> {label}
              </NavLink>
            ))}
          </nav>
        </header>

        <Outlet context={{ project, tree } satisfies ProjectOutletContext} />
      </div>
    </ProjectScope>
  );
}
