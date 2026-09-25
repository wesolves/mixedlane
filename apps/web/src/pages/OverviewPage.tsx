import { useMemo } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { CalendarClock, CircleCheck, CircleDot, ListTodo } from "lucide-react";
import { TYPE_LABELS, TYPE_PLURALS, defaultChildType } from "@mixedlane/shared";
import { Button } from "@/components/ui/button";
import { EmptyState, StatusIcon, TypeIcon } from "@/components/common";
import { DueDate, ItemCard, ItemRow, QuickAdd } from "@/components/item/ItemViews";
import { useCreateItemDialog } from "@/components/create/CreateItemDialog";
import { paths, useProjectScope } from "@/lib/project";
import type { ProjectOutletContext } from "./ProjectLayout";

export function OverviewPage() {
  const { project, tree } = useOutletContext<ProjectOutletContext>();
  const { statusById, can } = useProjectScope();
  const navigate = useNavigate();
  const openCreate = useCreateItemDialog();
  const open = (item: { key: string; type: (typeof tree)[number]["type"] }) => navigate(paths.item(project.key, item));

  const topType = defaultChildType(null, project.itemTypes)!;
  const roots = tree.filter((i) => i.parentId === null && i.type === topType);
  const cat = (s: string) => statusById(s).category;
  // Container levels (epics, milestones) are shown as cards; work items as rows.
  const asCards = topType === "epic" || topType === "milestone";

  const stats = [
    { label: "Work items", value: tree.length, icon: <ListTodo className="size-4 text-sky-500" /> },
    { label: "In progress", value: tree.filter((i) => cat(i.status) === "in_progress").length, icon: <CircleDot className="size-4 text-blue-500" /> },
    { label: "Done", value: tree.filter((i) => cat(i.status) === "done").length, icon: <CircleCheck className="size-4 text-emerald-500" /> },
    { label: TYPE_PLURALS[topType], value: roots.length, icon: <TypeIcon type={topType} /> },
  ];

  const upcoming = useMemo(
    () =>
      tree
        .filter((i) => i.dueDate && statusById(i.status).category !== "done")
        .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
        .slice(0, 6),
    [tree, statusById],
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-8 px-6 py-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {s.icon}
                {s.label}
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <TypeIcon type={topType} /> {TYPE_PLURALS[topType]}
              </h2>
              {roots.length > 0 && can("item.create") && (
                <Button variant="ghost" size="sm" onClick={() => openCreate({ projectKey: project.key, type: topType })}>
                  New {TYPE_LABELS[topType].toLowerCase()}
                </Button>
              )}
            </div>
            {roots.length === 0 ? (
              <EmptyState
                icon={<TypeIcon type={topType} />}
                title={`Create your first ${TYPE_LABELS[topType].toLowerCase()}`}
                description={`${TYPE_PLURALS[topType]} are the top level of this project.`}
                action={can("item.create") ? <Button onClick={() => openCreate({ projectKey: project.key, type: topType })}>Create {TYPE_LABELS[topType].toLowerCase()}</Button> : undefined}
              />
            ) : asCards ? (
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {roots.map((e) => (
                  <ItemCard key={e.id} item={e} onOpen={open} />
                ))}
                <div className="flex min-h-32 flex-col justify-center rounded-xl border border-dashed">
                  <QuickAdd projectId={project.id} parentId={null} type={topType} />
                </div>
              </div>
            ) : (
              <div className="divide-y overflow-hidden rounded-xl border bg-card">
                {roots.map((it) => (
                  <ItemRow key={it.id} item={it} onOpen={open} />
                ))}
                <QuickAdd projectId={project.id} parentId={null} type={topType} />
              </div>
            )}
          </section>

          <aside>
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              <CalendarClock className="size-4 text-amber-500" /> Upcoming
            </h2>
            {upcoming.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing due. Set due dates to see them here.</p>
            ) : (
              <ol className="divide-y overflow-hidden rounded-xl border bg-card">
                {upcoming.map((m) => (
                  <li key={m.id}>
                    <button onClick={() => open(m)} className="flex w-full items-center gap-2 p-3 text-left text-sm transition-colors hover:bg-muted/50">
                      <StatusIcon status={statusById(m.status)} />
                      <TypeIcon type={m.type} className="size-3.5" />
                      <span className="min-w-0 flex-1 truncate font-medium">{m.title}</span>
                      <DueDate date={m.dueDate!} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
