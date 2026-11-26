import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenWaClient } from "../src/modules/whatsapp/client";

afterEach(() => vi.unstubAllGlobals());

describe("OpenWA gateway errors", () => {
  it.each([
    [401, "API key"], [403, "permissions"], [404, "/api/sessions"], [503, "gateway connectivity"],
  ])("explains upstream HTTP %s without exposing the response body", async (status, guidance) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private gateway details", { status })));
    const error = await new OpenWaClient("http://gateway.test", "secret").call("/sessions").catch((e) => e);
    expect(error).toMatchObject({ status: 502, message: expect.stringContaining(guidance) });
    expect(error.message).not.toContain("private gateway details");
    expect(error.message).not.toContain("secret");
  });

  it.each([
    [new TypeError("fetch failed: private-host secret"), "Cannot reach"],
    [new DOMException("private-host secret", "TimeoutError"), "timed out"],
  ])("maps transport failures to safe actionable errors", async (failure, guidance) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
    await expect(new OpenWaClient("http://gateway.test", "secret").call("/sessions"))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining(guidance) });
  });

  it("explains a successful HTML response from the wrong gateway URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>private login page</html>")));
    await expect(new OpenWaClient("http://gateway.test", "secret").call("/sessions"))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining("invalid JSON") });
  });

  it("preserves unsupported-engine errors for interactive fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 501 })));
    await expect(new OpenWaClient("http://gateway.test", "secret").call("/sessions"))
      .rejects.toMatchObject({ status: 501 });
  });
});
