import { z } from "zod";
import { ITEM_TYPES, PRIORITIES } from "./hierarchy";
import { AI_PROVIDERS, whatsappSettingsSchema } from "./whatsapp";

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
  sharedProviders: Record<string, { model: string; configured: boolean; url?: string }>;
};
export const mixdiModelTestSchema = z.object({
  providerMode: z.enum(["shared", "dedicated"]),
  providers: whatsappSettingsSchema.shape.providers.optional(),
  provider: z.enum(AI_PROVIDERS).optional(),
});
export type MixdiModelTestInput = z.infer<typeof mixdiModelTestSchema>;
export type MixdiModelTestCategory = "configuration" | "credentials" | "model" | "rate_limit" | "timeout" | "network" | "invalid_output" | "provider_error";
export interface MixdiModelTestResult {
  provider: typeof AI_PROVIDERS[number]; model: string; ok: boolean; durationMs: number;
  category?: MixdiModelTestCategory; status?: number; message: string;
}
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
  conversationId: z.string().uuid().optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) })).min(1).max(30),
}).refine((v) => v.messages.at(-1)?.role === "user", "End with a user message");
export type MixdiChat = z.infer<typeof mixdiChatSchema>;
export type MixdiReply = z.infer<typeof mixdiReplySchema> & { draftId?: string; conversationId?: string };
export interface MixdiConversationSummary {
  id: string; title: string; kind: "ticket" | "document"; destination: string; parentId: string | null; updatedAt: string;
}
export interface MixdiConversation extends MixdiConversationSummary {
  messages: MixdiChat["messages"]; reply: MixdiReply | null; result: MixdiResult | null;
}
export interface MixdiResult { url: string; title: string }
export interface MixdiAccess { allowed: boolean; createTickets: boolean; createDocuments: boolean; projectIds: string[]; spaceIds: string[] }
