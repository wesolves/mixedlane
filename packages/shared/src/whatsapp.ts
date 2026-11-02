import { z } from "zod";
import { ITEM_TYPES, PRIORITIES } from "./hierarchy";

export const AI_PROVIDERS = ["ollama", "gemini", "grok", "openai", "custom"] as const;
const httpUrl = z.string().url().refine((v) => { const u = new URL(v); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash; }, "Use an HTTP(S) URL without credentials, query, or fragment");
const providerSchema = z.object({ model: z.string().trim().max(120).regex(/^[a-zA-Z0-9._:/-]*$/), apiKey: z.string().max(1000).optional() });
export const whatsappSettingsSchema = z.object({
  baseUrl: z.string().url().refine((v) => { const u = new URL(v); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password; }),
  apiKey: z.string().max(1000).optional(),
  callbackUrl: z.string().url(),
  defaultProjectId: z.string().uuid().nullable().default(null),
  askProjectEveryTime: z.boolean().default(true),
  providers: z.object({ ollama: providerSchema, gemini: providerSchema, grok: providerSchema,
    openai: providerSchema.default({ model: "" }),
    custom: providerSchema.extend({ url: z.union([z.literal(""), httpUrl]).optional() }).default({ model: "" }),
  }),
});
export type WhatsappSettingsInput = z.infer<typeof whatsappSettingsSchema>;
export const ticketDraftSchema = z.object({
  type: z.enum(ITEM_TYPES), title: z.string().trim().min(1).max(300),
  description: z.string().min(1).max(30000), priority: z.enum(PRIORITIES),
  category: z.enum(["bug", "feature", "issue"]),
  parentId: z.string().uuid().nullable(),
  reason: z.string().min(1).max(2000),
  duplicateId: z.string().uuid().nullable(),
});
export type TicketDraft = z.infer<typeof ticketDraftSchema>;
export interface WhatsappSettingsInfo {
  configured: boolean; baseUrl: string; callbackUrl: string; hasApiKey: boolean;
  defaultProjectId: string | null; askProjectEveryTime: boolean;
  providers: Record<typeof AI_PROVIDERS[number], { model: string; configured: boolean; url?: string }>;
}
export interface WhatsappSession { id: string; name: string; status: string; phone?: string | null; lastError?: string | null; defaultProjectId?: string | null; }
export interface WhatsappContact { id: string; phone: string; userId: string; }
export interface WhatsappDraft {
  item?: { key: string; type: TicketDraft["type"]; projectKey: string };
  id: string; sessionId: string; chatId: string; userId: string; projectId: string | null;
  report: string; proposal: TicketDraft | null; provider: string | null;
  status: string; itemId: string | null; error: string | null; createdAt: string;
}
