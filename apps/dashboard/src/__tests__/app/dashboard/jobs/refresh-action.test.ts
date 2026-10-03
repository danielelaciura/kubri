import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG = "00000000-0000-0000-0000-0000000000b1";
const JD = "3f1c2b7e-8a4d-4c6e-9b2a-1d5e7f9a0c3b";

const { mockUser } = vi.hoisted(() => ({
  mockUser: { value: { id: "u1", role: "ORG_ADMIN", organizationId: "00000000-0000-0000-0000-0000000000b1" } as
    | { id: string; role: string; organizationId: string }
    | null },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
  })),
}));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: vi.fn(async () => mockUser.value) } },
}));
vi.mock("@/lib/jobs/service", () => ({
  getJobDescription: vi.fn(),
  updateJobDescription: vi.fn(),
  deleteJobDescription: vi.fn(),
  JobNameAlreadyExistsError: class extends Error {},
  JobNotFoundError: class extends Error {},
}));
vi.mock("@/lib/llm/rerank", () => ({ invalidateRerankCacheForJd: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/i18n/locale", () => ({ getServerLocale: vi.fn(async () => "it") }));

import { getJobDescription } from "@/lib/jobs/service";
import { invalidateRerankCacheForJd } from "@/lib/llm/rerank";
import { revalidatePath } from "next/cache";
import { refreshCandidatesForJob } from "@/app/(dashboard)/dashboard/jobs/[id]/actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.value = { id: "u1", role: "ORG_ADMIN", organizationId: ORG };
});

describe("refreshCandidatesForJob", () => {
  it("invalidates only the given JD of the user's org", async () => {
    vi.mocked(getJobDescription).mockResolvedValue({ id: JD } as never);
    await refreshCandidatesForJob(JD);
    expect(getJobDescription).toHaveBeenCalledWith({ id: JD, organizationId: ORG });
    expect(invalidateRerankCacheForJd).toHaveBeenCalledWith(JD);
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/jobs/${JD}`);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/jobs");
  });

  it("does nothing for a JD outside the user's org", async () => {
    vi.mocked(getJobDescription).mockResolvedValue(null);
    await refreshCandidatesForJob(JD);
    expect(invalidateRerankCacheForJd).not.toHaveBeenCalled();
  });

  it("does nothing for a non-admin", async () => {
    mockUser.value = { id: "u1", role: "ORG_MEMBER", organizationId: ORG };
    await refreshCandidatesForJob(JD);
    expect(getJobDescription).not.toHaveBeenCalled();
    expect(invalidateRerankCacheForJd).not.toHaveBeenCalled();
  });

  it("does nothing for a malformed id", async () => {
    await refreshCandidatesForJob("not-a-uuid");
    expect(getJobDescription).not.toHaveBeenCalled();
    expect(invalidateRerankCacheForJd).not.toHaveBeenCalled();
  });
});
