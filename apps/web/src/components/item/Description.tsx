import { useEffect, useRef, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichEditor, RichText, isEmptyHtml } from "@/components/editor/RichEditor";

export function Description({ value, onSave, readOnly }: { value: string; onSave: (html: string) => Promise<unknown> | void; readOnly?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const editRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (readOnly) setEditing(false);
  }, [readOnly]);

  // The editor fills the screen while editing — bring all of it into view.
  useEffect(() => {
    if (editing) editRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [editing]);

  const start = () => {
    setError(null);
    setDraft(value);
    setEditing(true);
  };
  const save = async () => {
    if (readOnly || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the description. Try again.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  const cancel = () => { if (!inFlight.current) setEditing(false); };

  if (editing && !readOnly) {
    return (
      <div ref={editRef} aria-busy={saving} className="scroll-mt-4 space-y-2">
        <RichEditor
          value={draft}
          onChange={setDraft}
          autofocus
          onSubmit={save}
          onCancel={cancel}
          disabled={saving}
          placeholder="Describe the goal, context and acceptance criteria…"
          fill="screen"
          fillOffset="5.5rem"
        />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={saving} onClick={save}>{saving && <Loader2 className="size-4 animate-spin" />}{saving ? "Saving…" : "Save"}</Button>
          <Button size="sm" variant="ghost" disabled={saving} onClick={cancel}>Cancel</Button>
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
