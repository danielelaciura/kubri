import { describe, it, expect, afterEach, vi } from "vitest";
import { verifyTurnstile } from "@/lib/landing/turnstile";

describe("verifyTurnstile", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts secret, token and ip and returns success", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "sec");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyTurnstile("tok", "1.2.3.4")).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("sec");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });

  it("returns false on success=false, HTTP error, network error or empty token", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "sec");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }))));
    await expect(verifyTurnstile("tok", null)).resolves.toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 500 })));
    await expect(verifyTurnstile("tok", null)).resolves.toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    await expect(verifyTurnstile("tok", null)).resolves.toBe(false);
    await expect(verifyTurnstile("", null)).resolves.toBe(false);
  });

  it("without a secret: refuses in production, allows in development", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(verifyTurnstile("tok", null)).resolves.toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    await expect(verifyTurnstile("", null)).resolves.toBe(true);
  });

  it("rejects oversized tokens without calling fetch", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "sec");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyTurnstile("x".repeat(2049), null)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns false on a 200 with invalid JSON", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "sec");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json")));
    await expect(verifyTurnstile("tok", null)).resolves.toBe(false);
  });
});
