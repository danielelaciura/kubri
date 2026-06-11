import { describe, it as test, expect, vi, beforeEach } from "vitest";

const { getUser, findUnique } = vi.hoisted(() => ({
  getUser: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique } } }));

import { getServerLocale } from "../locale";

beforeEach(() => {
  getUser.mockReset();
  findUnique.mockReset();
});

describe("getServerLocale", () => {
  test("returns the user's language when valid", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    findUnique.mockResolvedValue({ language: "en" });
    expect(await getServerLocale()).toBe("en");
  });

  test("falls back to it when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getServerLocale()).toBe("it");
  });

  test("falls back to it when language invalid", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    findUnique.mockResolvedValue({ language: "xx" });
    expect(await getServerLocale()).toBe("it");
  });
});
