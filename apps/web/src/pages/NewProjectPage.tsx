import { ProjectForm } from "@/components/project/ProjectForm";

export function NewProjectPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <header className="border-b px-6 py-5">
        <h1 className="text-lg font-semibold tracking-tight">New project</h1>
        <p className="text-sm text-muted-foreground">Set it up your way — everything here can be changed later except the code.</p>
      </header>
      <ProjectForm />
    </div>
  );
}
