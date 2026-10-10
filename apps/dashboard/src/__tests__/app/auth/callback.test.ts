import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { verifyOtp, exchangeCodeForSession },
  })),
}));

async function get(search: string): Promise<Response> {
  const { GET } = await import("@/app/auth/callback/route");
  return GET(new NextRequest(new URL(`http://localhost/auth/callback${search}`)));
}

describe("GET /auth/callback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not consume invite tokens on GET — forwards to the accept-invite page", async () => {
    const res = await get("?token_hash=abc123&type=invite&next=/auth/set-password");

    expect(verifyOtp).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/accept-invite");
    expect(location.searchParams.get("token_hash")).toBe("abc123");
    expect(location.searchParams.get("type")).toBe("invite");
  });

  it("still verifies recovery tokens server-side", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await get("?token_hash=abc123&type=recovery&next=/auth/reset-password");

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc123", type: "recovery" });
    expect(new URL(res.headers.get("location")!).pathname).toBe("/auth/reset-password");
  });

  it("redirects to /login with the Supabase error code when verification fails", async () => {
    verifyOtp.mockResolvedValue({ error: { code: "otp_expired" } });
    const res = await get("?token_hash=abc123&type=recovery");

    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("otp_expired");
  });
});
