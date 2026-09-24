import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FolderPlus, Moon, Plus, Sun } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { ProjectIcon, TypeIcon } from "@/components/common";
import { paths } from "@/lib/project";
import { useProjects } from "@/hooks/queries";
import { api } from "@/lib/api";

export function CommandPalette({
  open,
  onOpenChange,
  onCreateItem,
  onCreateProject,
  onToggleTheme,
  dark,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreateItem: () => void;
  onCreateProject: () => void;
  onToggleTheme: () => void;
  dark: boolean;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const { data: projects = [] } = useProjects();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 150);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const { data: results } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length > 0,
  });

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search projects and work items">
      <CommandInput placeholder="Search work items, projects or type a command…" value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>No results for “{q}”.</CommandEmpty>
        {!!results?.items.length && (
          <CommandGroup heading="Work items">
            {results.items.map((it) => (
              <CommandItem
                key={it.id}
                value={`${it.key} ${it.title}`}
                onSelect={() => run(() => navigate(paths.item(it.projectKey, it)))}
              >
                <TypeIcon type={it.type} />
                <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{it.key}</span>
                <span className="truncate">{it.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Projects">
          {projects.map((p) => (
            <CommandItem key={p.id} value={`project ${p.key} ${p.name}`} onSelect={() => run(() => navigate(paths.project(p.key)))}>
              <ProjectIcon icon={p.icon} color={p.color} size="sm" />
              {p.name}
              <span className="ml-auto text-xs text-muted-foreground">{p.key}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="create new work item issue task story epic" onSelect={() => run(onCreateItem)}>
            <Plus /> Create work item
          </CommandItem>
          <CommandItem value="create new project" onSelect={() => run(onCreateProject)}>
            <FolderPlus /> Create project
          </CommandItem>
          <CommandItem value="toggle theme dark light mode" onSelect={() => run(onToggleTheme)}>
            {dark ? <Sun /> : <Moon />} Switch to {dark ? "light" : "dark"} mode
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
