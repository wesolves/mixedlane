import type { LucideIcon } from "lucide-react";
import { ClipboardList, FileText, Lightbulb, RefreshCcw, Wrench } from "lucide-react";

export interface PageTemplate {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  title: string;
  html: () => string;
}

const today = () => new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
const tasks = (...items: string[]) =>
  `<ul data-type="taskList">${items.map((t) => `<li data-type="taskItem" data-checked="false"><p>${t}</p></li>`).join("")}</ul>`;

/** Starting points for new pages. Plain editor HTML, so everything stays editable. */
export const PAGE_TEMPLATES: PageTemplate[] = [
  { id: "blank", name: "Blank page", description: "Start from scratch", icon: FileText, title: "Untitled", html: () => "" },
  {
    id: "prd",
    name: "Product requirements",
    description: "Problem, goals, scope and success metrics",
    icon: Lightbulb,
    title: "PRD: ",
    html: () =>
      [
        "<h2>Problem</h2><p>What problem are we solving, and for whom?</p>",
        "<h2>Goals</h2><ul><li><p></p></li></ul>",
        "<h2>Non-goals</h2><ul><li><p></p></li></ul>",
        "<h2>User stories</h2><table><tbody><tr><th><p>As a…</p></th><th><p>I want to…</p></th><th><p>So that…</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>",
        "<h2>Requirements</h2><ol><li><p></p></li></ol>",
        "<h2>Success metrics</h2><ul><li><p></p></li></ul>",
        "<h2>Open questions</h2>",
        tasks(""),
      ].join(""),
  },
  {
    id: "spec",
    name: "Technical spec",
    description: "Design, alternatives, rollout and risks",
    icon: Wrench,
    title: "Tech spec: ",
    html: () =>
      [
        "<h2>Summary</h2><p></p>",
        "<h2>Background</h2><p>Link the related work items (e.g. APP-0001) — they'll show up on the items too.</p>",
        "<h2>Proposed design</h2><p></p>",
        "<h3>Data model</h3><pre><code></code></pre>",
        "<h3>API</h3><p></p>",
        "<h2>Alternatives considered</h2><ul><li><p></p></li></ul>",
        "<h2>Rollout plan</h2><ol><li><p></p></li></ol>",
        "<h2>Risks &amp; mitigations</h2><ul><li><p></p></li></ul>",
      ].join(""),
  },
  {
    id: "meeting",
    name: "Meeting notes",
    description: "Agenda, notes and action items",
    icon: ClipboardList,
    title: `Meeting notes — ${today()}`,
    html: () =>
      [
        `<p><strong>Date:</strong> ${today()}</p><p><strong>Attendees:</strong> </p>`,
        "<h2>Agenda</h2><ol><li><p></p></li></ol>",
        "<h2>Notes</h2><p></p>",
        "<h2>Decisions</h2><ul><li><p></p></li></ul>",
        "<h2>Action items</h2>",
        tasks("@owner — "),
      ].join(""),
  },
  {
    id: "retro",
    name: "Retrospective",
    description: "What went well, what didn't, what's next",
    icon: RefreshCcw,
    title: `Retro — ${today()}`,
    html: () =>
      [
        "<h2>😀 What went well</h2><ul><li><p></p></li></ul>",
        "<h2>😕 What didn't go well</h2><ul><li><p></p></li></ul>",
        "<h2>💡 Ideas</h2><ul><li><p></p></li></ul>",
        "<h2>Action items</h2>",
        tasks(""),
      ].join(""),
  },
];
