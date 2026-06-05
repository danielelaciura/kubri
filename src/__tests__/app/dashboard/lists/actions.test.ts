import { describe, it, expect, vi } from "vitest";

const member = {
  id: "00000000-0000-0000-0000-0000000000a1",
  email: "member@kubri.test",
  name: "Test Member",
  role: "ORG_MEMBER" as const,
  organizationId: "00000000-0000-0000-0000-0000000000b1",
  termsAcceptedAt: null,
};

vi.mock("@/lib/auth-utils", () => ({
  getCurrentUser: vi.fn(async () => member),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// SKIPPED: come i test pool, le mutazioni toccano il DB dev.
// Abilitare con un DB di test dedicato.
describe.skip("list actions", () => {
  it("createList rejects a duplicate name in the same org", async () => {
    const { createList } = await import(
      "@/app/(dashboard)/dashboard/lists/actions"
    );
    const fd = new FormData();
    fd.set("name", "Camerieri");
    await createList(fd);
    const fd2 = new FormData();
    fd2.set("name", "Camerieri");
    await expect(createList(fd2)).rejects.toThrow(/già una lista/);
  });
});
