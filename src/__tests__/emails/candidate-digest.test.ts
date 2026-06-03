import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { CandidateDigestEmail } from "@/emails/candidate-digest";

describe("CandidateDigestEmail", () => {
  it("renders total, per-pool breakdown and dashboard link", async () => {
    const html = await render(
      CandidateDigestEmail({
        orgName: "Coop X",
        total: 3,
        byPool: [
          { poolId: "p1", poolName: "Magazzino", count: 2 },
          { poolId: "p2", poolName: "Sala", count: 1 },
        ],
        dashboardUrl: "https://app.example/dashboard/candidates",
      }),
    );
    expect(html).toContain("Magazzino");
    expect(html).toContain("Sala");
    expect(html).toContain("https://app.example/dashboard/candidates");
  });

  it("uses singular Italian copy when there is exactly one new candidate", async () => {
    const html = await render(
      CandidateDigestEmail({
        orgName: "Coop X",
        total: 1,
        byPool: [{ poolId: "p1", poolName: "Magazzino", count: 1 }],
        dashboardUrl: "https://app.example/dashboard/candidates",
      }),
    );
    expect(html).toContain("è entrato 1 nuovo candidato");
    expect(html).not.toContain("nuovi candidati");
  });
});
