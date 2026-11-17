"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { AGENCY, ASSOCIATIONS } from "@/lib/data";
import { relativeDay } from "@/lib/format";
import { useDemo } from "@/lib/store";
import { OffersTable } from "@/components/offers-table";
import { ButtonLink, PageHeader, Section, Stat } from "@/components/ui";

export default function AgencyHome() {
  const { offers, proposals, candidates, notifications } = useDemo();
  const active = offers.filter((o) => o.status === "pubblicata").length;
  const toReview = proposals.filter((p) => p.status === "proposto").length;
  const feed = notifications.filter((n) => n.audience === "agenzia").slice(0, 6);

  return (
    <>
      <PageHeader
        title={`Buongiorno, ${AGENCY.userName.split(" ")[0]}`}
        description="Le offerte aperte, le risposte della rete e i candidati che ti aspettano."
        actions={
          <ButtonLink href="/agenzia/offerte/nuova">
            <Plus className="size-4" aria-hidden="true" />
            Nuova offerta
          </ButtonLink>
        }
      />

      <Section className="mb-6 grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
        <Stat label="Offerte attive" value={active} href="/agenzia/offerte" />
        <Stat label="Candidati da valutare" value={toReview} hint="proposti dalle associazioni" href="/agenzia/offerte" />
        <Stat label="Associazioni nella rete" value={ASSOCIATIONS.length} hint="area di Torino" href="/agenzia/rete" />
        <Stat label="Candidati nel database" value={candidates.length} hint="condivisi dalla rete" href="/agenzia/candidati" />
      </Section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Section
          title="Offerte e appelli"
          aside={
            <Link href="/agenzia/offerte" className="text-[13px] text-primary-strong hover:underline">
              Vedi tutte
            </Link>
          }
        >
          <OffersTable limit={5} />
        </Section>

        <Section title="Dalla rete">
          <ul>
            {feed.map((n) => (
              <li key={n.id} className="border-b border-line last:border-0">
                <Link href={n.href} className="block px-5 py-3 hover:bg-primary-soft/40">
                  <span className="flex gap-2">
                    {!n.read ? <span aria-label="Nuova" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" /> : null}
                    <span className="text-[13px]">{n.text}</span>
                  </span>
                  <span className="mt-0.5 block text-[12px] text-ink-3">{relativeDay(n.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
