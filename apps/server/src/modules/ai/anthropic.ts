// Native Messages API; Anthropic does not use Chat Completions request/response shapes.
export const ANTHROPIC_VERSION = "2026-10-21";
export const anthropicHeaders = (apiKey: string) => ({ authorization: `Bearer ${apiKey}`, "anthropic-version": ANTHROPIC_VERSION });
export function anthropicText(data: { content?: { type: string; text?: string }[] }): string | undefined {
  return data.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
}
