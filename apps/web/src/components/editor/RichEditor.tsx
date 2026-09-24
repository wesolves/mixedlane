import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  FileCode2,
  Film,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Quote,
  SquareCode,
  Strikethrough,
  Table as TableIcon,
  Underline as UnderlineIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { editorExtensions } from "@/components/editor/extensions";
import { isMentionMenuOpen, setMentionCandidates } from "@/components/editor/mention";
import { useMembers } from "@/components/pickers";
import { IMAGE_TYPES, VIDEO_TYPES, isMedia, uploadFile, validateFile } from "@/lib/upload";
import { cn } from "@/lib/utils";

const proseClass =
  "rich-text prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-headings:mb-2 prose-headings:mt-4 prose-li:my-0.5 prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-a:text-primary prose-img:my-2 prose-img:rounded-lg";

export const isEmptyHtml = (html: string) => !html || (html.replace(/<[^>]*>/g, "").trim() === "" && !/<(img|video)\b/.test(html));

const markdownOf = (editor: Editor): string =>
  (editor.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();

interface RichEditorProps {
  /** Initial content — the editor is uncontrolled; remount (via key) to reset it. */
  value: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  autofocus?: boolean;
  className?: string;
  /** Ctrl/Cmd+Enter */
  onSubmit?: () => void;
  onCancel?: () => void;
  compact?: boolean;
  /**
   * "screen": fill the viewport height (minus `fillOffset`) — used while editing.
   * "parent": fill the remaining space of a flex-column parent (e.g. the create dialog).
   * Omitted: grow with content up to 60% of the screen.
   * In every mode the toolbar stays put and the content scrolls inside the editor.
   */
  fill?: "screen" | "parent";
  /** Space to leave for surrounding UI in "screen" mode (CSS length). */
  fillOffset?: string;
}

interface PendingUpload {
  id: number;
  name: string;
  progress: number;
}

export function RichEditor({ value, onChange, placeholder, autofocus, className, onSubmit, onCancel, compact, fill, fillOffset = "6rem" }: RichEditorProps) {
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [source, setSource] = useState<string | null>(null); // raw Markdown while in source mode
  const uploadId = useRef(0);
  // Editor callbacks are created once; refs keep them pointing at the latest props/state.
  const latest = useRef({ onSubmit, onCancel, onChange });
  latest.current = { onSubmit, onCancel, onChange };
  const insertRef = useRef<(files: File[], pos?: number) => void>(() => {});
  // @mention suggestions: the org's members.
  const { data: members } = useMembers();
  useEffect(() => {
    if (members) setMentionCandidates(members.map((m) => ({ id: m.userId, label: m.name, detail: m.email })));
  }, [members]);

  const editor = useEditor({
    extensions: editorExtensions(placeholder ?? "Write, paste Markdown, or drop images and videos…"),
    content: value,
    autofocus: autofocus ? "end" : false,
    editorProps: {
      attributes: { class: cn(proseClass, "tiptap px-3 py-2", fill ? "flex-1" : compact ? "min-h-[72px]" : "min-h-[140px]") },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          latest.current.onSubmit?.();
          return true;
        }
        if (event.key === "Escape" && !isMentionMenuOpen()) {
          latest.current.onCancel?.();
          return true;
        }
        return false;
      },
      // Screenshots and copied files arrive as clipboard files.
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter(isMedia);
        if (!files.length) return false;
        event.preventDefault();
        insertRef.current(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (moved || !files.length) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        insertRef.current(files, pos);
        return true;
      },
    },
    onUpdate: ({ editor }) => latest.current.onChange?.(editor.isEmpty && !/<(img|video)\b/.test(editor.getHTML()) ? "" : editor.getHTML()),
  });

  const insertFiles = useCallback(
    async (files: File[], pos?: number) => {
      if (!editor) return;
      for (const file of files) {
        const problem = validateFile(file);
        if (problem) {
          toast.error(problem);
          continue;
        }
        const id = ++uploadId.current;
        const name = file.name || (file.type.startsWith("image/") ? "Pasted image" : "Pasted video");
        setUploads((u) => [...u, { id, name, progress: 0 }]);
        try {
          const res = await uploadFile(file, (p) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))));
          const node = res.kind === "image" ? { type: "image", attrs: { src: res.url, alt: name } } : { type: "video", attrs: { src: res.url, title: name } };
          const at = pos ?? editor.state.selection.to;
          editor.chain().focus().insertContentAt(Math.min(at, editor.state.doc.content.size), node).run();
          pos = undefined; // subsequent files follow the cursor
        } catch (err) {
          toast.error((err as Error).message);
        } finally {
          setUploads((u) => u.filter((x) => x.id !== id));
        }
      }
    },
    [editor],
  );
  insertRef.current = insertFiles;

  const toggleSource = () => {
    if (!editor) return;
    if (source === null) {
      setSource(markdownOf(editor));
    } else {
      editor.commands.setContent(source, true); // tiptap-markdown parses Markdown in setContent
      setSource(null);
      editor.commands.focus("end");
    }
  };

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border bg-card focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
        fill === "parent" && "min-h-40 flex-1",
        !fill && "max-h-[60dvh]",
        dragging && "border-primary ring-2 ring-primary/30",
        className,
      )}
      style={fill === "screen" ? { height: `calc(100dvh - ${fillOffset})`, minHeight: 280 } : undefined}
      onDragEnter={(e) => e.dataTransfer.types.includes("Files") && setDragging(true)}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        // Drops outside the ProseMirror surface (e.g. on the toolbar) still upload.
        if (source === null && e.dataTransfer.files.length && !(e.target as HTMLElement).closest(".ProseMirror")) {
          e.preventDefault();
          insertFiles([...e.dataTransfer.files]);
        }
      }}
    >
      {editor && <Toolbar editor={editor} onFiles={insertFiles} sourceMode={source !== null} onToggleSource={toggleSource} />}

      {uploads.length > 0 && (
        <div className="shrink-0 space-y-1 border-b bg-muted/30 px-3 py-1.5">
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              <span className="truncate">Uploading {u.name}</span>
              <div className="ml-auto h-1 w-24 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(u.progress * 100)}%` }} />
              </div>
              <span className="w-8 text-right tabular-nums">{Math.round(u.progress * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      {source !== null ? (
        <textarea
          autoFocus
          value={source}
          spellCheck={false}
          onChange={(e) => {
            setSource(e.target.value);
            // Keep the hidden rich document (and the parent's draft) in sync while editing Markdown.
            editor?.commands.setContent(e.target.value, true);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onSubmit?.();
            }
            if (e.key === "Escape") onCancel?.();
          }}
          className={cn(
            "block w-full bg-transparent px-3 py-2 font-mono text-[13px] leading-relaxed outline-none",
            fill ? "h-full resize-none" : cn("resize-y [field-sizing:content]", compact ? "min-h-[72px]" : "min-h-[140px]"),
          )}
          placeholder="Markdown…"
        />
      ) : (
        // In fill modes the ProseMirror surface stretches, so clicking empty space still focuses it.
        <EditorContent editor={editor} className={cn(fill && "flex min-h-full flex-col")} />
      )}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-primary/5 text-sm font-medium text-primary">
          Drop images or videos to upload
        </div>
      )}
    </div>
  );
}

/** Read-only renderer; content passes through the editor schema, so arbitrary HTML is stripped. */
export function RichText({ html, className }: { html: string; className?: string }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const editor = useEditor(
    {
      extensions: editorExtensions(),
      content: html,
      editable: false,
      editorProps: { attributes: { class: cn(proseClass, "tiptap") } },
    },
    [html],
  );
  return (
    <>
      <EditorContent
        editor={editor}
        className={className}
        onClick={(e) => {
          const img = (e.target as HTMLElement).closest("img");
          if (img) {
            e.stopPropagation();
            setZoom(img.getAttribute("src"));
          }
        }}
      />
      <Dialog open={!!zoom} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogContent className="max-h-[92vh] w-auto max-w-[92vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[92vw]">
          <DialogTitle className="sr-only">Image preview</DialogTitle>
          {zoom && <img src={zoom} alt="" className="max-h-[88vh] max-w-[90vw] rounded-lg object-contain" />}
        </DialogContent>
      </Dialog>
    </>
  );
}

type Btn = { icon: LucideIcon; label: string; active?: boolean; run: () => void; disabled?: boolean };

function ToolbarButton({ icon: Icon, label, active, run, disabled }: Btn) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        active && "bg-background text-foreground shadow-sm",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function Toolbar({
  editor,
  onFiles,
  sourceMode,
  onToggleSource,
}: {
  editor: Editor;
  onFiles: (files: File[]) => void;
  sourceMode: boolean;
  onToggleSource: () => void;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);
  // Re-render on selection changes so active states stay current.
  useEffect(() => {
    const update = () => force((n) => n + 1);
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const c = () => editor.chain().focus();
  const off = sourceMode;
  const groups: Btn[][] = [
    [
      { icon: Heading2, label: "Heading (## )", active: editor.isActive("heading", { level: 2 }), run: () => c().toggleHeading({ level: 2 }).run() },
      { icon: Heading3, label: "Subheading (### )", active: editor.isActive("heading", { level: 3 }), run: () => c().toggleHeading({ level: 3 }).run() },
    ],
    [
      { icon: Bold, label: "Bold (Ctrl+B, **text**)", active: editor.isActive("bold"), run: () => c().toggleBold().run() },
      { icon: Italic, label: "Italic (Ctrl+I, *text*)", active: editor.isActive("italic"), run: () => c().toggleItalic().run() },
      { icon: UnderlineIcon, label: "Underline (Ctrl+U)", active: editor.isActive("underline"), run: () => c().toggleUnderline().run() },
      { icon: Strikethrough, label: "Strikethrough (~~text~~)", active: editor.isActive("strike"), run: () => c().toggleStrike().run() },
      { icon: Code, label: "Inline code (`code`)", active: editor.isActive("code"), run: () => c().toggleCode().run() },
      { icon: LinkIcon, label: "Link", active: editor.isActive("link"), run: setLink },
    ],
    [
      { icon: List, label: "Bullet list (- )", active: editor.isActive("bulletList"), run: () => c().toggleBulletList().run() },
      { icon: ListOrdered, label: "Numbered list (1. )", active: editor.isActive("orderedList"), run: () => c().toggleOrderedList().run() },
      { icon: ListChecks, label: "Checklist ([ ] )", active: editor.isActive("taskList"), run: () => c().toggleTaskList().run() },
      { icon: Quote, label: "Quote (> )", active: editor.isActive("blockquote"), run: () => c().toggleBlockquote().run() },
      { icon: SquareCode, label: "Code block (```lang)", active: editor.isActive("codeBlock"), run: () => c().toggleCodeBlock().run() },
    ],
    [
      { icon: ImagePlus, label: "Upload image (or paste / drop)", run: () => imageInput.current?.click() },
      { icon: Film, label: "Upload video (or paste / drop)", run: () => videoInput.current?.click() },
    ],
  ];

  const inTable = editor.isActive("table");

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
      {groups.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && <span className="mx-1 h-4 w-px bg-border" />}
          {group.map((b) => (
            <ToolbarButton key={b.label} {...b} disabled={off} />
          ))}
        </div>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={off}>
          <button
            type="button"
            title="Table"
            aria-label="Table"
            onMouseDown={(e) => e.preventDefault()}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40",
              inTable && "bg-background text-foreground shadow-sm",
            )}
          >
            <TableIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuItem onSelect={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Insert 3×3 table</DropdownMenuItem>
          {inTable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => c().addRowAfter().run()}>Add row below</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => c().addColumnAfter().run()}>Add column right</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => c().deleteRow().run()}>Delete row</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => c().deleteColumn().run()}>Delete column</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => c().deleteTable().run()}>
                Delete table
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggleSource}
        aria-pressed={sourceMode}
        title={sourceMode ? "Back to rich text" : "Edit as Markdown"}
        className={cn(
          "ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-background hover:text-foreground",
          sourceMode && "bg-background text-foreground shadow-sm",
        )}
      >
        <FileCode2 className="size-4" /> Markdown
      </button>

      <input
        ref={imageInput}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        multiple
        hidden
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <input
        ref={videoInput}
        type="file"
        accept={VIDEO_TYPES.join(",")}
        multiple
        hidden
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
