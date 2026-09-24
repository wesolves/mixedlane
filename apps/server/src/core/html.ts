const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Plain text of editor HTML (for search, snippets, key detection and notification bodies). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e.startsWith("#x") || e.startsWith("#X")) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#") && e !== "#39") return String.fromCodePoint(Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Short single-line excerpt. */
export const excerpt = (html: string, max = 140) => {
  const text = htmlToText(html).replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** User ids mentioned in editor HTML: `<span data-type="mention" data-id="<uuid>">@Name</span>`. */
export function extractMentionIds(html: string): string[] {
  const ids = new Set<string>();
  for (const [tag] of html.matchAll(/<span\b[^>]*data-type="mention"[^>]*>/gi)) {
    const id = /data-id="([^"]+)"/i.exec(tag)?.[1];
    if (id && UUID.test(id)) ids.add(id.toLowerCase());
  }
  return [...ids];
}
