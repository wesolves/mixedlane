import { z } from "zod";
import { ITEM_TYPES, PRIORITIES } from "./hierarchy";
import { whatsappSettingsSchema } from "./whatsapp";

export const mixdiSettingsSchema = z.object({
  enabled: z.boolean(),
  providerMode: z.enum(["shared", "dedicated"]),
  providers: whatsappSettingsSchema.shape.providers,
  userIds: z.array(z.string().uuid()).max(1000),
  createTickets: z.boolean(),
  createDocuments: z.boolean(),
  projectIds: z.array(z.string().uuid()).max(1000),
  spaceIds: z.array(z.string().uuid()).max(1000),
});
export type MixdiSettingsInput = z.infer<typeof mixdiSettingsSchema>;
export type MixdiSettings = Omit<MixdiSettingsInput, "providers"> & {
  providers: Record<string, { model: string; configured: boolean; url?: string }>;
};
export const mixdiDraftSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(30000),
  type: z.enum(ITEM_TYPES).default("task"),
  priority: z.enum(PRIORITIES).default("medium"),
});
export const mixdiReplySchema = z.object({
  message: z.string().min(1).max(4000),
  draft: mixdiDraftSchema.nullable(),
});
export const mixdiChatSchema = z.object({
  kind: z.enum(["ticket", "document"]),
  destination: z.string().uuid(),
  parentId: z.string().uuid().nullable().default(null),
  previousDraftId: z.string().uuid().optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) })).min(1).max(30),
}).refine((v) => v.messages.at(-1)?.role === "user", "End with a user message");
export type MixdiChat = z.infer<typeof mixdiChatSchema>;
export type MixdiReply = z.infer<typeof mixdiReplySchema> & { draftId?: string };
export interface MixdiResult { url: string; title: string }
export interface MixdiAccess { allowed: boolean; createTickets: boolean; createDocuments: boolean; projectIds: string[]; spaceIds: string[] }
