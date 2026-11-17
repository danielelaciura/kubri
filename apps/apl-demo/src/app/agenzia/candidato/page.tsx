"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Download, Lock, Mail, Phone } from "lucide-react";
import { ASSOCIATIONS } from "@/lib/data";
import { STATUS_LABEL, anonymousName, fullName, relativeDay } from "@/lib/format";
import { scoreCandidate } from "@/lib/matching";
import { useDemo } from "@/lib/store";
import { CandidateFacts, CandidateHeading } from "@/components/candidate-profile";
import { Badge, Button, Empty, Score, Section } from "@/components/ui";
import Link from "next/link";

export default function CandidatePage() {
  return (
    <Suspense>
      <CandidateView />
    </Suspense>
  );
}

function CandidateView() {
  const params = useSearchParams();
  const { candidates, proposals, offers } = useDemo();
  const [downloaded, setDownloaded] = useState(false);
  const c = candidates.find((x) => x.id === params.get("id"));
  const offer = offers.find((o) => o.id === params.get("offerta"));
  if (!c) return <Empty title="Candidato non trovato" />;

  const assoc = ASSOCIATIONS.find((a) => a.id === c.associationId);
  const mine = proposals.filter((p) => p.candidateId === c.id);
  const shared = mine.length > 0;
  const match = offer ? scoreCandidate(offer, c) : null;

  return (
    <>
      <Link
        href={offer ? `/agenzia/offerta?id=${offer.id}&tab=${shared ? "proposti" : "matching"}` : "/agenzia/candidati"}
        className="mb-4 inline-block text-[13px] text-ink-3 hover:text-primary-strong"
      >
        ← {offer ? offer.title : "Database candidati"}
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <CandidateHeading
          candidate={c}
          hidden={!shared}
          name={shared ? fullName(c) : `Candidato ${anonymousName(c)}`}
          sub={`${c.roles.join(", ")} · seguito da ${assoc?.name ?? ""}`}
        />
        {shared ? (
          <Button variant="secondary" onClick={() => setDownloaded(true)}>
            {downloaded ? <Check className="size-4 text-good" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
            {downloaded ? "Scheda pronta per l'azienda" : "Scarica la scheda per l'azienda"}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="space-y-6">
          {match && offer ? (
            <Section title={`Compatibilità con «${offer.title}»`} aside={<Score value={match.score} />}>
              <ul className="space-y-1.5 p-5 text-[13px]">
                {match.reasons.map((r) => (
                  <li key={r} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-good" aria-hidden="true" />
                    {r}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <CandidateFacts candidate={c} />
        </div>

        <div className="space-y-6">
          <Section title="Contatti">
            {shared ? (
              <ul className="space-y-2 p-5 text-[13px]">
                <li className="flex items-center gap-2">
                  <Phone className="size-4 text-ink-3" aria-hidden="true" />
                  <span className="tabular">{c.phone}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Mail className="size-4 text-ink-3" aria-hidden="true" />
                  {c.email}
                </li>
              </ul>
            ) : (
              <div className="flex gap-3 p-5 text-[13px] text-ink-2">
                <Lock className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden="true" />
                <p>
                  Nome e contatti diventano visibili quando {assoc?.name ?? "l'associazione"} invia il candidato in risposta a un
                  tuo appello.
                </p>
              </div>
            )}
          </Section>

          <Section title="Provenienza">
            <dl className="space-y-3 p-5 text-[13px]">
              <div>
                <dt className="text-[12px] text-ink-3">Associazione</dt>
                <dd>{assoc?.name}</dd>
                <dd className="text-[12px] text-ink-3">
                  Referente {assoc?.contactName} · {assoc?.contactEmail}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-3">Profilo raccolto con</dt>
                <dd>{c.source}</dd>
              </div>
            </dl>
          </Section>

          {shared ? (
            <Section title="Candidature">
              <ul>
                {mine.map((p) => {
                  const o = offers.find((x) => x.id === p.offerId);
                  return (
                    <li key={p.offerId} className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 last:border-0">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{o?.title}</span>
                        <span className="block text-[12px] text-ink-3">inviato {relativeDay(p.sentAt)}</span>
                      </span>
                      <Badge tone={p.status === "assunto" ? "good" : p.status === "non_selezionato" ? "bad" : "primary"}>
                        {STATUS_LABEL[p.status]}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>
    </>
  );
}
