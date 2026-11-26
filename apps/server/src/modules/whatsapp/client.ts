import { AppError } from "../../core/http";

export class OpenWaClient {
  constructor(private baseUrl: string, private key: string) {}
  async whileTyping<T>(session: string, chatId: string, work: () => Promise<T>): Promise<T> {
    let pending: Promise<void> | undefined;
    const presence = (state: "typing" | "paused") => this.call(`/sessions/${session}/chats/typing`, "POST", { chatId, state }, undefined, 3000).then(() => {}, () => {});
    // Presence is best effort: an unsupported or offline gateway must not block reports.
    const refresh = () => { if (!pending) pending = presence("typing").finally(() => { pending = undefined; }); };
    refresh();
    const timer = setInterval(refresh, 8000);
    try { return await work(); }
    finally { clearInterval(timer); await pending; await presence("paused"); }
  }
  async call<T = any>(path: string, method = "GET", body?: unknown, idempotencyKey?: string, timeoutMs = 35000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api${path}`, {
        method, headers: { "content-type": "application/json", "X-API-Key": this.key, ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs), redirect: "error",
      });
    } catch (error) {
      const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
      throw new AppError(502, timedOut
        ? "OpenWA gateway timed out. Check that the gateway is running and reachable from the Mixedlane API server."
        : "Cannot reach the OpenWA gateway. Check the OpenWA URL, DNS, TLS, and network access from the Mixedlane API server (or API container).");
    }
    if (!res.ok) {
      const guidance = res.status === 401 || res.status === 403
        ? "Check the saved OpenWA API key and its session permissions."
        : res.status === 404
          ? "The requested gateway endpoint or account was not found. Check the OpenWA URL and that the account still exists; this integration requires the session-based /api/sessions API."
          : "Check gateway connectivity, permissions, and session status.";
      throw new AppError(res.status === 501 ? 501 : 502, `OpenWA request failed (${res.status}). ${guidance}`);
    }
    if (res.status === 204) return undefined as T;
    try { return await res.json() as T; }
    catch {
      throw new AppError(502, "OpenWA returned an invalid JSON response. Check the OpenWA URL points to the session-based gateway API, rather than a login page or web interface.");
    }
  }
  async text(session: string, chatId: string, text: string, key: string, quote?: string) {
    return this.call(`/sessions/${session}/messages/${quote ? "reply" : "send-text"}`, "POST", { chatId, text: text.slice(0, 4096), ...(quote ? { quotedMessageId: quote } : {}) }, key);
  }
  async interactive(session: string, route: "send-list" | "send-buttons", body: Record<string, unknown>, fallback: string, key: string, quote?: string) {
    try { return await this.call(`/sessions/${session}/messages/${route}`, "POST", body, key); }
    catch (e) {
      // Only a definite unsupported-engine response is safe to replace; timeouts may have delivered.
      if (!(e instanceof AppError) || e.status !== 501) throw e;
      return this.text(session, String(body.chatId), fallback, `${key}:text`, quote);
    }
  }
}
