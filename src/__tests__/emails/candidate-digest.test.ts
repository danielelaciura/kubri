import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { CandidateDigestEmail } from "@/emails/candidate-digest";
import { getDictionary } from "@/lib/i18n";

const it_dict = getDictionary("it");
const en_dict = getDictionary("en");

describe("CandidateDigestEmail", () => {
  it("renders the logo, org name, total and dashboard link (Italian)", async () => {
    const html = await render(
      CandidateDigestEmail({
        orgName: "Coop X",
        total: 3,
        byPool: [
          { poolId: "p1", poolName: "Magazzino", count: 2 },
          { poolId: "p2", poolName: "Sala", count: 1 },
        ],
        dashboardUrl: "https://app.example/dashboard/candidates",
        logoUrl: "https://app.example/kubri-logo.png",
        dictionary: it_dict,
      }),
    );
    expect(html).toContain("https://app.example/kubri-logo.png");
    expect(html).toContain('alt="Kubri"');
    expect(html).toContain("Coop X");
    expect(html).toContain(it_dict.email.digestLabelPlural);
    expect(html).toContain("3");
    expect(html).toContain("https://app.example/dashboard/candidates");
  });

  it("uses singular copy when there is exactly one new candidate (Italian)", async () => {
    const html = await render(
      CandidateDigestEmail({
        orgName: "Coop X",
        total: 1,
        byPool: [{ poolId: "p1", poolName: "Magazzino", count: 1 }],
        dashboardUrl: "https://app.example/dashboard/candidates",
        logoUrl: "https://app.example/kubri-logo.png",
        dictionary: it_dict,
      }),
    );
    expect(html).toContain(it_dict.email.digestLabelSingular);
    expect(html).toContain(it_dict.email.digestEntered);
    expect(html).not.toContain(it_dict.email.digestEnteredPlural);
  });

  it("renders in English when the English dictionary is passed", async () => {
    const html = await render(
      CandidateDigestEmail({
        orgName: "Coop X",
        total: 3,
        byPool: [{ poolId: "p1", poolName: "Magazzino", count: 3 }],
        dashboardUrl: "https://app.example/dashboard/candidates",
        logoUrl: "https://app.example/kubri-logo.png",
        dictionary: en_dict,
      }),
    );
    expect(html).toContain(en_dict.email.digestCta);
    expect(html).toContain(en_dict.email.digestLabelPlural);
  });
});
