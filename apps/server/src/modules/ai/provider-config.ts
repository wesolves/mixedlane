import { AI_PROVIDERS, type WhatsappSettingsInput } from "@mixedlane/shared";
import type { ProviderConfig } from "../whatsapp/triage";

/** Empty password fields keep saved keys; explicit removal clears the entire provider. */
export function resolveProviderConfig(input: WhatsappSettingsInput["providers"], previous: ProviderConfig = {}): ProviderConfig {
  return Object.fromEntries(AI_PROVIDERS.map((provider) => {
    const next = input[provider];
    if (next.removeCredentials) return [provider, { model: "", apiKey: "", ...(provider === "custom" ? { url: "" } : {}) }];
    return [provider, { model: next.model, apiKey: next.apiKey || previous[provider]?.apiKey || "",
      ...(provider === "custom" ? { url: input.custom.url ?? previous.custom?.url ?? "" } : {}) }];
  }));
}
