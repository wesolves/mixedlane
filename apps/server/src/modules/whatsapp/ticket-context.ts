import { htmlToMarkdown } from "../../core/markdown";

/** Editor media stays in storage; only the surrounding ticket text goes to AI. */
export function ticketText(html: string) {
  const media: string[] = [];
  const text = html.replace(/<(video|audio|picture|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>|<(?:img|embed|source)\b[^>]*\/?\s*>|<a\b[^>]*href=["'][^"']*\/api\/uploads\/[^"']*["'][^>]*>[\s\S]*?<\/a\s*>/gi, (element) => {
    media.push(element);
    return "";
  });
  return { description: htmlToMarkdown(text), media };
}
