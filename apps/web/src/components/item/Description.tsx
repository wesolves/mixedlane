import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichEditor, RichText, isEmptyHtml } from "@/components/editor/RichEditor";

export function Description({ value, onSave, readOnly }: { value: string; onSave: (html: string) => Promise<unknown> | void; readOnly?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const editRef = useRef<HTMLDivElement>(null);

  // The editor fills the screen while editing — bring all of it into view.
  useEffect(() => {
    if (editing) editRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [editing]);

  const start = () => {
    setDraft(value);
    setEditing(true);
  };
  const save = async () => {
    await onSave(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <div ref={editRef} className="scroll-mt-4 space-y-2">
        <RichEditor
          value={draft}
          onChange={setDraft}
          autofocus
          onSubmit={save}
          onCancel={() => setEditing(false)}
          placeholder="Describe the goal, context and acceptance criteria…"
          fill="screen"
          fillOffset="5.5rem"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          <span className="ml-auto text-xs text-muted-foreground">Ctrl+Enter to save · Esc to cancel</span>
        </div>
      </div>
    );
  }

  if (readOnly) {
    return isEmptyHtml(value) ? <p className="text-sm text-muted-foreground">No description.</p> : <RichText html={value} />;
  }

  if (isEmptyHtml(value)) {
    return (
      <button
        onClick={start}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-left text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40"
      >
        <Pencil className="size-4" /> Add a description…
      </button>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        // Let links, checkboxes, images (zoom) and video controls behave normally.
        if ((e.target as HTMLElement).closest("a,input,img,video")) return;
        start();
      }}
      onKeyDown={(e) => e.key === "Enter" && start()}
      className="group relative -mx-2 cursor-text rounded-lg px-2 py-1 transition-colors hover:bg-muted/50"
    >
      <RichText html={value} />
      <Pencil className="absolute top-2 right-2 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}
