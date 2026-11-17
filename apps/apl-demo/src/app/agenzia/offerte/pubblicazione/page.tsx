"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { ASSOCIATIONS } from "@/lib/data";
import { sectorOf } from "@/lib/format";
import { associationsFor, matchesFor } from "@/lib/matching";
import { useDemo } from "@/lib/store";
import { Badge, ButtonLink, Empty, PageHeader, Section } from "@/components/ui";

export default function PublishPage() {
  return (
    <Suspense>
      <Publish />
    </Suspense>
  );
}

function Publish() {
  const id = useSearchParams().get("id");
  const { offers, candidates } = useDemo();
  const offer = offers.find((o) => o.id === id);
  const [done, setDone] = useState(0);

  useEffect(() => {
    setDone(0);
    const timers = [1, 2, 3, 4, 5].map((n) => window.setTimeout(() => setDone(n), n * 650));
    return () => timers.forEach(window.clearTimeout);
  }, [id]);

  if (!offer) return <Empty title="Offerta non trovata">Torna all&apos;elenco delle offerte.</Empty>;

  const matches = matchesFor(offer, candidates);
  const involved = associationsFor(offer, matches, ASSOCIATIONS, sectorOf(offer.skills));
  const withCandidates = involved.filter((a) => a.compatible > 0).length;

  const steps = [
    `Offerta «${offer.title}» registrata`,
    `Matching su ${candidates.length} candidati del database della rete`,
    `${matches.length} candidati compatibili in ${withCandidates} associazioni`,
    `Notifica inviata a ${involved.length} associazioni`,
    "Appello visibile nelle loro aree riservate",
  ];

  return (
    <>
      <PageHeader
        title={done >= 5 ? "Appello lanciato" : "Pubblicazione in corso…"}
        description={`${offer.positions} × ${offer.title} per ${offer.clientCompany}, ${offer.city}`}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-start">
        <Section>
          <ol className="p-5">
            {steps.map((label, i) => {
              const state = done > i ? "done" : done === i ? "running" : "waiting";
              return (
                <li key={label} className="flex items-center gap-3 py-2.5">
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${
                      state === "done" ? "bg-good text-white" : state === "running" ? "bg-primary-soft text-primary" : "bg-sidebar text-ink-3"
                    }`}
                  >
                    {state === "done" ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : state === "running" ? (
                      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : (
                      <span className="tabular text-[12px]">{i + 1}</span>
                    )}
                  </span>
                  <span className={`text-[14px] transition-colors ${state === "waiting" ? "text-ink-3" : "text-ink"}`}>{label}</span>
                </li>
              );
            })}
          </ol>
        </Section>

        <Section title="Associazioni coinvolte" className={`transition-opacity duration-300 ${done >= 4 ? "opacity-100" : "opacity-40"}`}>
          <ul>
            {involved.map(({ association: a, compatible, byAffinity }) => (
              <li key={a.id} className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 last:border-0">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className="block text-[12px] text-ink-3">
                    {a.kind} · {a.city}
                  </span>
                </span>
                {byAffinity ? (
                  <Badge>Per affinità di settore</Badge>
                ) : (
                  <Badge tone="primary">
                    <span className="tabular">{compatible}</span> compatibili
                  </Badge>
                )}
              </li>
            ))}
          </ul>
          {done >= 5 ? (
            <div className="border-t border-line p-5">
              <ButtonLink href={`/agenzia/offerta?id=${offer.id}&tab=matching`} className="w-full">
                Vai all&apos;offerta
              </ButtonLink>
            </div>
          ) : null}
        </Section>
      </div>
    </>
  );
}
