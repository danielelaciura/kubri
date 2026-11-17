"use client";

import Link from "next/link";
import { ASSOCIATIONS, DEMO_ASSOCIATION_ID } from "@/lib/data";
import { useMyAppeals } from "@/lib/appeals";
import { useDemo } from "@/lib/store";
import { AppealsTable } from "@/components/appeals-table";
import { PageHeader, Section, Stat } from "@/components/ui";

export default function AssociationHome() {
  const { candidates, proposals } = useDemo();
  const appeals = useMyAppeals();
  const assoc = ASSOCIATIONS.find((a) => a.id === DEMO_ASSOCIATION_ID);
  const own = candidates.filter((c) => c.associationId === DEMO_ASSOCIATION_ID).length;
  const fresh = appeals.filter((a) => a.response.state === "notificata").length;
  const compatible = appeals.filter((a) => a.suggestions.length > 0).length;
  const sent = proposals.filter((p) => p.associationId === DEMO_ASSOCIATION_ID).length;
  const toReview = appeals.filter((a) => a.sent === 0 && a.suggestions.length > 0).length;

  return (
    <>
      <PageHeader
        title={`Ciao, ${assoc?.contactName.split(" ")[0] ?? ""}`}
        description="Gli appelli delle agenzie della tua rete e le persone che segui."
      />

      <Section className="mb-6 grid grid-cols-2 lg:grid-cols-5 lg:divide-x lg:divide-line">
        <Stat label="I tuoi candidati" value={own} href="/associazione/candidati" />
        <Stat label="Nuovi appelli" value={fresh} href="/associazione/appelli" />
        <Stat label="Appelli compatibili" value={compatible} hint="con almeno un tuo candidato" href="/associazione/appelli" />
        <Stat label="Candidati proposti" value={sent} />
        <Stat label="Matching da valutare" value={toReview} href="/associazione/appelli" />
      </Section>

      <Section
        title="Appelli ricevuti"
        aside={
          <Link href="/associazione/appelli" className="text-[13px] text-primary-strong hover:underline">
            Vedi tutti
          </Link>
        }
      >
        <AppealsTable appeals={appeals.slice(0, 5)} />
      </Section>
    </>
  );
}
