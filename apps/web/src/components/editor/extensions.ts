import { Node, mergeAttributes, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Markdown } from "tiptap-markdown";
import { common, createLowlight } from "lowlight";
import { MentionExtension } from "./mention";

const lowlight = createLowlight(common);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    video: { setVideo: (attrs: { src: string; title?: string }) => ReturnType };
  }
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Block-level <video>. Markdown has no video syntax, so it round-trips as inline HTML. */
export const Video = Node.create({
  name: "video",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [
      { tag: "video[src]" },
      { tag: "video", getAttrs: (el) => ({ src: (el as HTMLElement).querySelector("source")?.getAttribute("src") ?? null }) },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["video", mergeAttributes({ controls: "true", preload: "metadata", playsinline: "true" }, HTMLAttributes)];
  },

  addCommands() {
    return {
      setVideo:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; ensureNewLine: () => void; closeBlock: (n: unknown) => void },
          node: { attrs: { src: string } },
        ) {
          state.ensureNewLine();
          state.write(`<video src="${escapeAttr(node.attrs.src ?? "")}" controls></video>`);
          state.closeBlock(node);
        },
        parse: {
          /* handled by parseHTML via markdown-it's html option */
        },
      },
    };
  },
});

/** One schema for editing and read-only rendering, so everything that can be written can be shown. */
export function editorExtensions(placeholder?: string): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
    Underline,
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }),
    Image.configure({ inline: false, allowBase64: false }),
    Video,
    MentionExtension,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    Placeholder.configure({ placeholder: placeholder ?? "Write something…" }),
    // Markdown in and out: typing shortcuts, pasting Markdown text, and a raw source view.
    Markdown.configure({
      html: true,
      tightLists: true,
      bulletListMarker: "-",
      linkify: true,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: false,
    }),
  ];
}
