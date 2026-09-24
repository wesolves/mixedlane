import { z } from "zod";
import { ITEM_TYPES, PRIORITIES, STATUS_CATEGORIES } from "./hierarchy";

const dateStr = z.string().nullable().optional();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value like #6366f1");

export const statusDefSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/, "Status id must be lowercase letters, digits or _"),
  name: z.string().trim().min(1, "Status name is required").max(40),
  color: hexColor,
  category: z.enum(STATUS_CATEGORIES),
});

const statusesSchema = z
  .array(statusDefSchema)
  .min(1, "Add at least one status")
  .max(20)
  .refine((s) => new Set(s.map((x) => x.id)).size === s.length, "Status ids must be unique")
  .refine((s) => new Set(s.map((x) => x.name.toLowerCase())).size === s.length, "Status names must be unique");

const itemTypesSchema = z
  .array(z.enum(ITEM_TYPES))
  .min(1, "Enable at least one work item type")
  .refine((t) => new Set(t).size === t.length, "Duplicate item types");

/** "lucide:<name>" or "emoji:<char>" */
const iconSchema = z
  .string()
  .max(64)
  .regex(/^(lucide|emoji):.+$/, "Icon must be lucide:<name> or emoji:<char>");

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,4}$/, "Project code must be 2-5 letters/digits, starting with a letter"),
  keyDigits: z.number().int().min(4).max(6).optional().default(4),
  description: z.string().max(20000).optional().default(""),
  color: hexColor.optional().default("#6366f1"),
  icon: iconSchema.optional().default("lucide:rocket"),
  itemTypes: itemTypesSchema.optional(),
  statuses: statusesSchema.optional(),
});
export const projectUpdateSchema = projectCreateSchema.omit({ key: true, keyDigits: true }).partial();

export const itemCreateSchema = z.object({
  projectId: z.string().min(1),
  parentId: z.string().nullable().optional(),
  type: z.enum(ITEM_TYPES),
  title: z.string().trim().min(1, "Title is required").max(300),
  description: z.string().max(200000).optional().default(""),
  /** Defaults to the project's first status. */
  status: z.string().max(40).optional(),
  priority: z.enum(PRIORITIES).optional().default("medium"),
  assignee: z.string().max(120).nullable().optional(),
  /** A member of the org; sets the display name too. */
  assigneeId: z.string().uuid().nullable().optional(),
  labels: z.array(z.string().max(40)).optional().default([]),
  startDate: dateStr,
  dueDate: dateStr,
  estimate: z.number().min(0).max(1000).nullable().optional(),
});

export const itemUpdateSchema = z
  .object({
    parentId: z.string().nullable(),
    title: z.string().trim().min(1).max(300),
    description: z.string().max(200000),
    status: z.string().max(40),
    priority: z.enum(PRIORITIES),
    assignee: z.string().max(120).nullable(),
    assigneeId: z.string().uuid().nullable(),
    labels: z.array(z.string().max(40)),
    startDate: z.string().nullable(),
    dueDate: z.string().nullable(),
    estimate: z.number().min(0).max(1000).nullable(),
  })
  .partial();

export const itemMoveSchema = z.object({
  status: z.string().max(40),
  sortOrder: z.number(),
});

export const commentCreateSchema = z.object({
  body: z.string().trim().min(1, "Comment cannot be empty").max(50000),
  author: z.string().max(120).optional(),
});
export const commentUpdateSchema = commentCreateSchema.pick({ body: true });

export type ProjectCreate = z.input<typeof projectCreateSchema>;
export type ProjectUpdate = z.input<typeof projectUpdateSchema>;
export type ItemCreate = z.input<typeof itemCreateSchema>;
export type ItemUpdate = z.input<typeof itemUpdateSchema>;
export type ItemMove = z.input<typeof itemMoveSchema>;
export type CommentCreate = z.input<typeof commentCreateSchema>;
