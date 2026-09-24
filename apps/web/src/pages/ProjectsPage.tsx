import { Link } from "react-router-dom";
import { ChevronRight, FolderPlus, Plus } from "lucide-react";
import { sortTypes } from "@flowboard/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ProgressBar, ProjectIcon, TypeIcon } from "@/components/common";
import { useProjects } from "@/hooks/queries";
import { paths } from "@/lib/project";
import { useOrg } from "@/lib/auth";

export function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();
  const canCreate = useOrg().can("project.create");

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Each project has its own item types, workflow and look.</p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link to={paths.newProject()}>
              <Plus className="size-4" /> New project
            </Link>
          </Button>
        )}
      </header>

      <div className="px-6 py-6">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-48 rounded-xl" />
            ))}
          </div>
        ) : !projects?.length ? (
          <EmptyState
            icon={<FolderPlus className="size-5" />}
            title={canCreate ? "Create your first project" : "No projects yet"}
            description={canCreate ? "Pick the item types and workflow that fit — from a full Epic → Subtask hierarchy to a simple task list." : "You haven't been added to any project. Ask an admin to give you access."}
            action={
              canCreate && <Button asChild>
                <Link to={paths.newProject()}>
                  <Plus className="size-4" /> New project
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {projects.map((p) => {
              const pct = p.stats.total ? Math.round((p.stats.done / p.stats.total) * 100) : 0;
              return (
                <Link
                  key={p.id}
                  to={paths.project(p.key)}
                  className="group flex flex-col rounded-xl border bg-card p-5 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <ProjectIcon icon={p.icon} color={p.color} size="lg" />
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold group-hover:text-primary">{p.name}</h2>
                      <p className="font-mono text-xs text-muted-foreground">{p.key}</p>
                    </div>
                  </div>
                  {p.description && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {sortTypes(p.itemTypes).map((t, i) => (
                      <span key={t} className="flex items-center gap-1">
                        {i > 0 && <ChevronRight className="size-3" />}
                        <TypeIcon type={t} className="size-3.5" />
                      </span>
                    ))}
                    <span className="ml-1.5">· {p.statuses.length} statuses</span>
                  </div>
                  <div className="mt-auto pt-5">
                    <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                      <span>
                        {p.stats.total} items · {p.stats.inProgress} in progress
                      </span>
                      <span className="font-medium tabular-nums text-foreground">{pct}%</span>
                    </div>
                    <ProgressBar progress={p.stats} />
                  </div>
                </Link>
              );
            })}
            {canCreate && <Link
              to={paths.newProject()}
              className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40 hover:text-foreground"
            >
              <Plus className="size-5" /> New project
            </Link>}
          </div>
        )}
      </div>
    </div>
  );
}
