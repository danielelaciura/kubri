"use client";

import { Plus } from "lucide-react";
import { OffersTable } from "@/components/offers-table";
import { ButtonLink, PageHeader, Section } from "@/components/ui";

export default function OffersPage() {
  return (
    <>
      <PageHeader
        title="Offerte e appelli"
        description="Ogni offerta pubblicata è anche un appello alla rete: qui vedi chi ha risposto e quanti candidati sono arrivati."
        actions={
          <ButtonLink href="/agenzia/offerte/nuova">
            <Plus className="size-4" aria-hidden="true" />
            Nuova offerta
          </ButtonLink>
        }
      />
      <Section>
        <OffersTable />
      </Section>
    </>
  );
}
