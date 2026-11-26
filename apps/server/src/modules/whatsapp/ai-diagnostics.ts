import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

export type FailureCategory = "credentials" | "model" | "rate_limit" | "timeout" | "network" | "invalid_output" | "provider_error" | "configuration";
const guidance: Record<FailureCategory, string> = {
  credentials: "Check the provider API key and account permissions.",
  model: "Check that the model exists and is enabled for this account.",
  rate_limit: "Check the provider quota or retry after the rate limit clears.",
  timeout: "The provider timed out. Retry or configure another provider.",
  network: "Check server connectivity and the provider endpoint.",
  invalid_output: "The provider returned an invalid ticket. Retry or choose another model.",
  provider_error: "The provider failed. Check its service status or configure a fallback.",
  configuration: "Configure at least one AI provider in WhatsApp settings.",
};
export class ProviderFailure extends Error {
  constructor(readonly category: FailureCategory, readonly status?: number, readonly code?: string) { super(guidance[category]); }
}
export class TriageFailure extends Error {
  constructor(readonly reference: string, category: FailureCategory) {
    super(`AI could not prepare a ticket. ${guidance[category]} Reference: ${reference}`);
  }
}
export function httpFailure(status: number, code?: string) {
  const category: FailureCategory = status === 401 || status === 403 ? "credentials"
    : status === 404 || code === "model_not_found" || code === "invalid_model" ? "model"
    : status === 429 ? "rate_limit" : status === 408 || status === 504 ? "timeout" : "provider_error";
  return new ProviderFailure(category, status, code);
}

// Arbitrary provider messages can echo private prompts or keys; retain known machine codes only.
export function providerCode(value: unknown): string | undefined {
  return typeof value === "string" && ["model_not_found", "invalid_model", "invalid_api_key", "insufficient_quota", "rate_limit_exceeded", "permission_denied", "invalid_request_error"].includes(value) ? value : undefined;
}
const logger = new Logger("AIIntegration");
export function diagnostics(context: { orgId: string; draftId?: string; operation?: "ticket_triage" | "mixdi_chat" }, secrets: string[]) {
  const reference = randomUUID();
  const safe = (s: string) => secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join("[redacted]"), s).replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 160);
  return {
    reference,
    record(event: string, fields: { stage?: string; providerMode?: "shared" | "dedicated"; provider?: string; model?: string; attempt?: number; durationMs?: number; category?: FailureCategory | "backend"; status?: number; code?: string; detail?: string } = {}) {
      const entry = JSON.stringify({ event: `ai.${event}`, timestamp: new Date().toISOString(), operation: "ticket_triage", reference, ...context, ...fields, ...(fields.model ? { model: safe(fields.model) } : {}) });
      if (fields.category) logger.warn(entry); else logger.log(entry);
    },
  };
}
