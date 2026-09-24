import MarkdownIt from "markdown-it";
import TurndownService from "turndown";

/**
 * Agents read and write Markdown; the app stores editor HTML. Raw HTML in agent input is escaped
 * (markdown-it `html: false`), and everything is rendered through the editor schema anyway.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

/** `- [ ] todo` / `- [x] done` lists → the editor's task list markup. */
function taskLists(html: string): string {
  return html.replace(/<ul>\n?((?:<li>\[[ xX]\][\s\S]*?<\/li>\n?)+)<\/ul>/g, (_m, items: string) => {
    const lis = items.replace(/<li>\[([ xX])\]\s?([\s\S]*?)<\/li>/g, (_l, mark: string, body: string) => {
      const inner = body.trim().startsWith("<p>") ? body.trim() : `<p>${body.trim()}</p>`;
      return `<li data-type="taskItem" data-checked="${mark !== " "}">${inner}</li>`;
    });
    return `<ul data-type="taskList">${lis}</ul>`;
  });
}

export function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  return taskLists(md.render(markdown)).trim();
}

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
turndown.addRule("taskItem", {
  filter: (node) => node.nodeName === "LI" && node.getAttribute("data-type") === "taskItem",
  replacement: (content, node) => `- [${(node as HTMLElement).getAttribute("data-checked") === "true" ? "x" : " "}] ${content.trim().replace(/\n+/g, " ")}\n`,
});
turndown.addRule("mention", {
  filter: (node) => node.nodeName === "SPAN" && node.getAttribute("data-type") === "mention",
  replacement: (_c, node) => `@${(node as HTMLElement).getAttribute("data-label") ?? node.textContent?.replace(/^@/, "") ?? ""}`,
});
turndown.addRule("video", {
  filter: "video",
  replacement: (_c, node) => `[video](${(node as HTMLElement).getAttribute("src") ?? ""})`,
});
// Task-list wrappers and labels (checkboxes) carry no text of their own.
turndown.addRule("taskList", {
  filter: (node) => node.nodeName === "UL" && node.getAttribute("data-type") === "taskList",
  replacement: (content) => `\n${content}\n`,
});
turndown.remove(["label", "input"] as never);

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return "";
  return turndown.turndown(html).trim();
}
