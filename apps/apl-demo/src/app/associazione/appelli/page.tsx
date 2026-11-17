"use client";

import { useMyAppeals } from "@/lib/appeals";
import { AppealsTable } from "@/components/appeals-table";
import { PageHeader, Section } from "@/components/ui";

export default function AppealsPage() {
  const appeals = useMyAppeals();
  return (
    <>
      <PageHeader
        title="Appelli ricevuti"
        description="Ogni appello è un'offerta di lavoro di un'agenzia della rete. Scegli tu quali persone proporre."
      />
      <Section>
        <AppealsTable appeals={appeals} />
      </Section>
    </>
  );
}
