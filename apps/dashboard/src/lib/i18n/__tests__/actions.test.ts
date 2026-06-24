import { describe, it as test, expect, vi, beforeEach } from "vitest";

const { getCurrentUser, update, revalidatePath } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  update: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-utils", () => ({ getCurrentUser }));
vi.mock("@/lib/db", () => ({ prisma: { user: { update } } }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { setLanguage } from "../actions";

function fd(language: unknown): FormData {
  const f = new FormData();
  if (language !== undefined) f.set("language", language as string);
  return f;
}

beforeEach(() => {
  getCurrentUser.mockReset();
  update.mockReset();
  revalidatePath.mockReset();
  getCurrentUser.mockResolvedValue({ id: "u1" });
});

describe("setLanguage", () => {
  test("updates the user's language and revalidates", async () => {
    await setLanguage(fd("en"));
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { language: "en" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  test("rejects an invalid language", async () => {
    await expect(setLanguage(fd("xx"))).rejects.toThrow("Lingua non valida");
    expect(update).not.toHaveBeenCalled();
  });
});
