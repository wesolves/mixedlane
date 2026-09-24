import { useMemo } from "react";
import { diffWords } from "diff";
import { cn } from "@/lib/utils";

/** Plain text of editor HTML, keeping paragraph breaks (for diffs). */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html.replace(/<\/(p|h[1-6]|li|tr|blockquote|pre)>/gi, "$&\n"), "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Word-level diff: removed text struck through in red, added text in green. */
export function TextDiff({ before, after, className }: { before: string; after: string; className?: string }) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  const changed = parts.some((p) => p.added || p.removed);
  return (
    <div className={cn("rounded-lg border bg-card p-4 text-sm leading-relaxed whitespace-pre-wrap", className)}>
      {!changed && <p className="mb-2 text-xs text-muted-foreground">No text changes (formatting or media only).</p>}
      {parts.map((p, i) =>
        p.added ? (
          <ins key={i} className="rounded-sm bg-emerald-500/15 text-emerald-700 no-underline dark:text-emerald-300">
            {p.value}
          </ins>
        ) : p.removed ? (
          <del key={i} className="rounded-sm bg-rose-500/15 text-rose-700 dark:text-rose-300">
            {p.value}
          </del>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </div>
  );
}
