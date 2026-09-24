import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PAGE_TEMPLATES } from "@/components/docs/templates";
import { useCreatePage } from "@/hooks/docs";
import { paths } from "@/lib/project";
import { cn } from "@/lib/utils";

/** Pick a template and title; the new page opens in edit mode. */
export function NewPageDialog({
  spaceKey,
  parentId,
  parentTitle,
  open,
  onOpenChange,
}: {
  spaceKey: string;
  parentId: string | null;
  parentTitle?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const create = useCreatePage(spaceKey);
  const [templateId, setTemplateId] = useState("blank");
  const [title, setTitle] = useState("");
  const template = PAGE_TEMPLATES.find((t) => t.id === templateId)!;

  useEffect(() => {
    if (open) {
      setTemplateId("blank");
      setTitle("");
    }
  }, [open]);

  const submit = async () => {
    const page = await create.mutateAsync({ title: title.trim() || template.title.trim() || "Untitled", parentId, contentHtml: template.html() });
    onOpenChange(false);
    navigate(paths.page(spaceKey, page.id), { state: { edit: true } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New page</DialogTitle>
          <DialogDescription>{parentTitle ? `Inside “${parentTitle}”` : "At the top level of this space"}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {PAGE_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTemplateId(t.id);
                  if (!title || PAGE_TEMPLATES.some((x) => x.title === title)) setTitle(t.title === "Untitled" ? "" : t.title);
                }}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60",
                  t.id === templateId && "border-primary bg-primary/5 ring-1 ring-primary",
                )}
              >
                <t.icon className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-medium">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">{t.description}</span>
                </span>
              </button>
            ))}
          </div>
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Page title" />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Create page
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
