import { z } from "zod";
import { ITEM_TYPES, PRIORITIES } from "./hierarchy";

export const MODEL_PROVIDERS = ["ollama", "gemini", "grok", "openai", "anthropic"] as const;
export const AI_PROVIDERS = [...MODEL_PROVIDERS, "custom"] as const;
export type AiProvider = typeof AI_PROVIDERS[number];
export const providerOrderSchema = z.array(z.enum(AI_PROVIDERS)).max(AI_PROVIDERS.length).refine((order) => new Set(order).size === order.length, "Each provider may appear only once");
export function normalizeProviderOrder(order?: readonly AiProvider[] | null): AiProvider[] {
  return [...new Set([...(order ?? []), ...AI_PROVIDERS])];
}
export const aiModelListSchema = z.object({ provider: z.enum(MODEL_PROVIDERS), apiKey: z.string().trim().max(1000).optional() });
export type AiModelListInput = z.infer<typeof aiModelListSchema>;
export interface AiModelOption { id: string; name: string }
const httpUrl = z.string().url().refine((v) => { const u = new URL(v); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash; }, "Use an HTTP(S) URL without credentials, query, or fragment");
const providerSchema = z.object({ model: z.string().trim().max(120).regex(/^[a-zA-Z0-9._:/-]*$/).default(""), apiKey: z.string().max(1000).optional(), removeCredentials: z.boolean().optional() });
export const whatsappSettingsSchema = z.object({
  baseUrl: z.string().url().refine((v) => { const u = new URL(v); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password; }),
  apiKey: z.string().max(1000).optional(),
  callbackUrl: z.string().url(),
  defaultProjectId: z.string().uuid().nullable().default(null),
  askProjectEveryTime: z.boolean().default(true),
  providerOrder: providerOrderSchema.optional(),
  providers: z.preprocess((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([provider, config]) => [provider,
      config && typeof config === "object" && (config as { removeCredentials?: boolean }).removeCredentials === true
        ? { removeCredentials: true, model: "", ...(provider === "custom" ? { url: "" } : {}) } : config]));
  }, z.object({ ollama: providerSchema, gemini: providerSchema, grok: providerSchema,
    openai: providerSchema.default({ model: "" }),
    anthropic: providerSchema.default({ model: "" }),
    custom: providerSchema.extend({ url: z.union([z.literal(""), httpUrl]).optional() }).default({ model: "" }),
  })),
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
  providerOrder: AiProvider[];
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
