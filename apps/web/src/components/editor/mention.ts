import Mention from "@tiptap/extension-mention";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";

export interface MentionCandidate {
  id: string;
  label: string;
  detail?: string;
}

/** Where @-suggestions come from (org members); set by the editor component. */
let candidates: MentionCandidate[] = [];
export const setMentionCandidates = (list: MentionCandidate[]) => {
  candidates = list;
};

let menuOpen = false;
/** True while the suggestion menu is showing (the editor then leaves Escape/Enter to it). */
export const isMentionMenuOpen = () => menuOpen;

/**
 * A small DOM popup for suggestions. Inside a dialog it is attached to the dialog (Radix blocks
 * pointer events outside it); otherwise to <body>.
 */
function renderMenu() {
  let el: HTMLDivElement | null = null;
  let props: SuggestionProps<MentionCandidate> | null = null;
  let index = 0;

  const select = (i: number) => {
    const item = props?.items[i];
    if (item) props!.command({ id: item.id, label: item.label });
  };

  const draw = () => {
    if (!el || !props) return;
    el.replaceChildren();
    if (!props.items.length) {
      const empty = document.createElement("div");
      empty.className = "mention-empty";
      empty.textContent = "No matching people";
      el.append(empty);
      return;
    }
    props.items.forEach((item, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `mention-item${i === index ? " is-active" : ""}`;
      const name = document.createElement("span");
      name.textContent = item.label;
      b.append(name);
      if (item.detail) {
        const d = document.createElement("small");
        d.textContent = item.detail;
        b.append(d);
      }
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        select(i);
      });
      el!.append(b);
    });
  };

  const place = () => {
    const rect = props?.clientRect?.();
    if (!el || !rect) return;
    const container = el.parentElement!;
    if (container === document.body) {
      el.style.position = "fixed";
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.bottom + 4}px`;
    } else {
      const c = container.getBoundingClientRect();
      el.style.position = "absolute";
      el.style.left = `${rect.left - c.left + container.scrollLeft}px`;
      el.style.top = `${rect.bottom - c.top + container.scrollTop + 4}px`;
    }
  };

  return {
    onStart: (p: SuggestionProps<MentionCandidate>) => {
      props = p;
      index = 0;
      el = document.createElement("div");
      el.className = "mention-menu";
      const host = (p.editor.view.dom.closest('[role="dialog"]') as HTMLElement | null) ?? document.body;
      host.append(el);
      menuOpen = true;
      draw();
      place();
    },
    onUpdate: (p: SuggestionProps<MentionCandidate>) => {
      props = p;
      index = 0;
      draw();
      place();
    },
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      const n = props?.items.length ?? 0;
      if (event.key === "ArrowDown" && n) index = (index + 1) % n;
      else if (event.key === "ArrowUp" && n) index = (index - 1 + n) % n;
      else if ((event.key === "Enter" || event.key === "Tab") && n) {
        select(index);
        return true;
      } else if (event.key === "Escape") {
        el?.remove();
        el = null;
        menuOpen = false;
        return true;
      } else return false;
      draw();
      return true;
    },
    onExit: () => {
      el?.remove();
      el = null;
      props = null;
      menuOpen = false;
    },
  };
}

/** `@name` mentions stored as `<span data-type="mention" data-id="<userId>" data-label="Name">`. */
export const MentionExtension = Mention.configure({
  HTMLAttributes: { class: "mention" },
  renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
  renderHTML: ({ options, node }) => ["span", options.HTMLAttributes, `@${node.attrs.label ?? node.attrs.id}`],
  suggestion: {
    items: ({ query }) => {
      const q = query.toLowerCase();
      return candidates.filter((c) => c.label.toLowerCase().includes(q) || c.detail?.toLowerCase().includes(q)).slice(0, 8);
    },
    render: renderMenu,
  },
});
