import { describe, it, expect, vi, beforeAll } from "vitest";

// Mock Prisma at module level before any imports
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock Supabase
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { hasMinimumRole } from "@/lib/auth-utils";

describe("hasMinimumRole", () => {
  it("ADMIN_KUBRI passes ORG_ADMIN requirement", () => {
    expect(hasMinimumRole("ADMIN_KUBRI", "ORG_ADMIN")).toBe(true);
  });

  it("ORG_ADMIN passes ORG_MEMBER requirement", () => {
    expect(hasMinimumRole("ORG_ADMIN", "ORG_MEMBER")).toBe(true);
  });

  it("ORG_MEMBER fails ORG_ADMIN requirement", () => {
    expect(hasMinimumRole("ORG_MEMBER", "ORG_ADMIN")).toBe(false);
  });

  it("ORG_MEMBER passes ORG_MEMBER requirement", () => {
    expect(hasMinimumRole("ORG_MEMBER", "ORG_MEMBER")).toBe(true);
  });
});
