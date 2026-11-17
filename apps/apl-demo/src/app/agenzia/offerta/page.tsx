"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock, FileText, Lock, MapPin, Users } from "lucide-react";
import { ASSOCIATIONS } from "@/lib/data";
import { APPEAL_STATE_LABEL, STATUS_LABEL, STATUS_ORDER, anonymousName, fullName, relativeDay } from "@/lib/format";
import { matchesFor, shortReasons } from "@/lib/matching";
import { useDemo, useIsShared } from "@/lib/store";
import type { ApplicationStatus } from "@/lib/types";
import { Avatar, Badge, Empty, PageHeader, Score, Section, Tabs } from "@/components/ui";

type Tab = "matching" | "proposti" | "associazioni";

export default function OfferPage() {
  return (
    <Suspense>
      <Offer />
    </Suspense>
  );
}

const assocName = (id: string) => ASSOCIATIONS.find((a) => a.id === id)?.name ?? "";

function Offer() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");
  const tab = (params.get("tab") as Tab | null) ?? "matching";
  const { offers, candidates, proposals, appealResponses, setStatus } = useDemo();
  const isShared = useIsShared();
  const offer = offers.find((o) => o.id === id);
  if (!offer) return <Empty title="Offerta non trovata" />;

  const matches = matchesFor(offer, candidates);
  const props = proposals.filter((p) => p.offerId === offer.id);
  const responses = appealResponses.filter((r) => r.offerId === offer.id);
  const setTab = (t: Tab) => router.replace(`/agenzia/offerta?id=${offer.id}&tab=${t}`, { scroll: false });

  return (
    <>
      <PageHeader
        back={{ href: "/agenzia/offerte", label: "Offerte e appelli" }}
        title={offer.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>{offer.clientCompany}</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5 text-ink-3" aria-hidden="true" />
              {offer.city}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5 text-ink-3" aria-hidden="true" />
              {offer.positions} risorse
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5 text-ink-3" aria-hidden="true" />
              pubblicata {relativeDay(offer.publishedAt)}
            </span>
          </span>
        }
        actions={<Badge tone="good">Appello attivo</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px] lg:items-start">
        <Section>
          <Tabs<Tab>
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "matching", label: "Candidati dal matching", count: matches.length },
              { id: "proposti", label: "Proposti dalle associazioni", count: props.length },
              { id: "associazioni", label: "Associazioni coinvolte", count: responses.length },
            ]}
          />

          {tab === "matching" ? (
            <>
              <p className="flex items-center gap-2 border-b border-line bg-sidebar/60 px-5 py-2.5 text-[12px] text-ink-2">
                <Lock className="size-3.5 shrink-0 text-ink-3" aria-hidden="true" />
                Nome e contatti restano riservati finché l&apos;associazione non invia il candidato.
              </p>
              <table className="w-full text-left text-[13px]">
                <thead className="text-[12px] text-ink-3">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2.5 font-medium">Candidato</th>
                    <th className="px-3 py-2.5 font-medium">Compatibilità</th>
                    <th className="px-3 py-2.5 font-medium">Perché</th>
                    <th className="px-5 py-2.5 font-medium">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map(({ candidate: c, score, reasons }) => {
                    const sent = props.find((p) => p.candidateId === c.id);
                    const visible = isShared(c.id);
                    return (
                      <tr key={c.id} className="border-b border-line align-top last:border-0 hover:bg-primary-soft/30">
                        <td className="px-5 py-3">
                          <Link href={`/agenzia/candidato?id=${c.id}&offerta=${offer.id}`} className="flex items-center gap-3">
                            <Avatar candidate={c} hidden={!visible} />
                            <span>
                              <span className="block font-semibold hover:text-primary-strong">{visible ? fullName(c) : anonymousName(c)}</span>
                              <span className="block text-[12px] text-ink-3">{assocName(c.associationId)}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <Score value={score} />
                        </td>
                        <td className="max-w-[320px] px-3 py-3 text-[12px] text-ink-2">{shortReasons(reasons)}</td>
                        <td className="px-5 py-3">
                          {sent ? <Badge tone="good">Inviato</Badge> : <Badge>In attesa</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {matches.length === 0 ? <Empty title="Nessun candidato compatibile nel database">Le associazioni notificate possono comunque proporre profili.</Empty> : null}
            </>
          ) : null}

          {tab === "proposti" ? (
            props.length === 0 ? (
              <Empty title="Ancora nessun candidato proposto">
                Le associazioni hanno ricevuto l&apos;appello. Riceverai una notifica appena qualcuna invia dei candidati.
              </Empty>
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead className="text-[12px] text-ink-3">
                  <tr className="border-b border-line">
                    <th className="px-5 py-2.5 font-medium">Candidato</th>
                    <th className="px-3 py-2.5 font-medium">Associazione</th>
                    <th className="px-3 py-2.5 font-medium">Inviato</th>
                    <th className="px-5 py-2.5 font-medium">Stato della candidatura</th>
                  </tr>
                </thead>
                <tbody>
                  {props.map((p) => {
                    const c = candidates.find((x) => x.id === p.candidateId);
                    if (!c) return null;
                    return (
                      <tr key={p.candidateId} className="border-b border-line last:border-0 hover:bg-primary-soft/30">
                        <td className="px-5 py-3">
                          <Link href={`/agenzia/candidato?id=${c.id}&offerta=${offer.id}`} className="flex items-center gap-3">
                            <Avatar candidate={c} />
                            <span>
                              <span className="block font-semibold hover:text-primary-strong">{fullName(c)}</span>
                              <span className="block text-[12px] text-ink-3">
                                {c.city} · {c.phone}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-ink-2">
                          {assocName(p.associationId)}
                          {p.addedForAppeal ? <span className="block text-[12px] text-ink-3">Profilo aggiunto per questo appello</span> : null}
                        </td>
                        <td className="px-3 py-3 text-ink-2">{relativeDay(p.sentAt)}</td>
                        <td className="px-5 py-3">
                          <select
                            aria-label={`Stato di ${fullName(c)}`}
                            value={p.status}
                            onChange={(e) => setStatus(offer.id, c.id, e.target.value as ApplicationStatus)}
                            className="rounded-md border border-line-strong bg-panel px-2 py-1 text-[13px] hover:border-primary-line"
                          >
                            {STATUS_ORDER.map((s) => (
                              <option key={s} value={s}>
                                {STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : null}

          {tab === "associazioni" ? (
            <table className="w-full text-left text-[13px]">
              <thead className="text-[12px] text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5 font-medium">Associazione</th>
                  <th className="px-3 py-2.5 text-right font-medium">Compatibili</th>
                  <th className="px-3 py-2.5 text-right font-medium">Proposti</th>
                  <th className="px-5 py-2.5 font-medium">Risposta</th>
                </tr>
              </thead>
              <tbody>
                {responses.map((r) => {
                  const a = ASSOCIATIONS.find((x) => x.id === r.associationId);
                  if (!a) return null;
                  const tone = r.state === "ha_risposto" ? "good" : r.state === "vista" ? "primary" : "neutral";
                  return (
                    <tr key={r.associationId} className="border-b border-line last:border-0">
                      <td className="px-5 py-3">
                        <span className="block font-semibold">{a.name}</span>
                        <span className="block text-[12px] text-ink-3">
                          {a.kind} · {a.city}
                        </span>
                      </td>
                      <td className="tabular px-3 py-3 text-right">{matches.filter((m) => m.candidate.associationId === a.id).length}</td>
                      <td className="tabular px-3 py-3 text-right">{props.filter((p) => p.associationId === a.id).length}</td>
                      <td className="px-5 py-3">
                        <Badge tone={tone}>{APPEAL_STATE_LABEL[r.state]}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </Section>

        <Section title="L'offerta">
          <dl className="space-y-3 p-5 text-[13px]">
            <Detail label="Descrizione">{offer.description}</Detail>
            <Detail label="Contratto">{offer.contract}</Detail>
            <Detail label="Orario">{offer.schedule}</Detail>
            <Detail label="Inserimento">{offer.startBy}</Detail>
            <Detail label="Italiano">{offer.italian}</Detail>
            <Detail label="Competenze">
              <span className="mt-1 flex flex-wrap gap-1">
                {offer.skills.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </span>
            </Detail>
            {offer.requirements ? <Detail label="Altri requisiti">{offer.requirements}</Detail> : null}
          </dl>
          <div className="flex items-center gap-2 border-t border-line px-5 py-3 text-[12px] text-ink-3">
            <FileText className="size-3.5" aria-hidden="true" />
            Le associazioni non vedono il nome dell&apos;azienda cliente.
          </div>
        </Section>
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
