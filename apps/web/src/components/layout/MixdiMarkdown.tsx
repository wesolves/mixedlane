import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
// AI output cannot insert raw HTML or cause generated image URLs to load.
markdown.disable("image");

export function MixdiMarkdown({ content }: { content: string }) {
  const html = markdown.render(content).replace(/<li>\[([ xX])\]\s*/g, (_match, checked: string) => `<li style="list-style:none"><input type="checkbox" disabled ${checked.toLowerCase() === "x" ? "checked" : ""} aria-label="Acceptance criterion" style="margin-right:0.5rem">`);
  return <div className="prose prose-sm dark:prose-invert max-w-none break-words text-inherit prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2 prose-li:my-0.5 prose-pre:overflow-x-auto prose-pre:bg-muted prose-a:text-primary" dangerouslySetInnerHTML={{ __html: html }} />;
}
