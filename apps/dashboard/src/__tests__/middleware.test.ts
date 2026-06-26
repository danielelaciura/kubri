import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(),
}));

async function run(pathname: string, user: unknown): Promise<Response> {
  const { updateSession } = await import("@/lib/supabase/middleware");
  (updateSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    response: NextResponse.next(),
    user,
  });
  const { middleware } = await import("@/middleware");
  return middleware(new NextRequest(new URL(`http://localhost${pathname}`)));
}

describe("middleware auth gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets unauthenticated cron requests through (they self-auth via CRON_SECRET)", async () => {
    const res = await run("/api/cron/notifications", null);
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets unauthenticated webhook requests through (shared-secret auth)", async () => {
    const res = await run("/api/webhooks/make/candidate", null);
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets unauthenticated assessment report requests through (shared-secret auth)", async () => {
    const res = await run("/api/assessment/report", null);
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects unauthenticated access to a protected route to /login", async () => {
    const res = await run("/dashboard/profile", null);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
