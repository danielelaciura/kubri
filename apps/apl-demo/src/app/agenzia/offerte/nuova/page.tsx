"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Megaphone, Sparkles } from "lucide-react";
import { ASSOCIATIONS, DEMO_OFFER_TEMPLATE, SECTORS } from "@/lib/data";
import { sectorOf } from "@/lib/format";
import { associationsFor, matchesFor } from "@/lib/matching";
import { type OfferDraft, useDemo } from "@/lib/store";
import type { ItalianLevel } from "@/lib/types";
import { Button, Field, PageHeader, Section, inputClass } from "@/components/ui";

const CITIES = ["Torino", "Settimo Torinese", "Moncalieri", "Collegno", "Nichelino", "Rivoli", "Grugliasco", "Chieri"];
const START = ["Immediata", "Entro 2 settimane", "Entro 1 mese"];
const ITALIAN: ItalianLevel[] = ["Base", "Intermedio", "Avanzato"];

const EMPTY: OfferDraft = {
  clientCompany: "",
  title: "",
  description: "",
  city: "Torino",
  province: "TO",
  positions: 1,
  contract: "",
  schedule: "",
  skills: [],
  requirements: "",
  italian: "Base",
  startBy: "Immediata",
};

export default function NewOfferPage() {
  return (
    <Suspense>
      <NewOffer />
    </Suspense>
  );
}

function NewOffer() {
  const params = useSearchParams();
  const router = useRouter();
  const { publishOffer, candidates } = useDemo();
  const [draft, setDraft] = useState<OfferDraft>(params.get("esempio") ? DEMO_OFFER_TEMPLATE : EMPTY);
  const set = <K extends keyof OfferDraft>(key: K, value: OfferDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const preview = useMemo(() => {
    const offer = { ...draft, id: "anteprima", status: "pubblicata" as const, publishedAt: "" };
    const matches = draft.skills.length ? matchesFor(offer, candidates) : [];
    const assocs = draft.skills.length ? associationsFor(offer, matches, ASSOCIATIONS, sectorOf(draft.skills)) : [];
    return { matches: matches.length, withCandidates: assocs.filter((a) => a.compatible > 0).length, total: assocs.length };
  }, [draft, candidates]);

  const ready = draft.clientCompany.trim() && draft.title.trim() && draft.skills.length > 0 && draft.positions > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    const id = publishOffer(draft);
    router.push(`/agenzia/offerte/pubblicazione?id=${id}`);
  };

  const toggleSkill = (s: string) =>
    set("skills", draft.skills.includes(s) ? draft.skills.filter((x) => x !== s) : [...draft.skills, s]);

  return (
    <form onSubmit={submit}>
      <PageHeader
        back={{ href: "/agenzia/offerte", label: "Offerte e appelli" }}
        title="Nuova offerta"
        description="Inserisci la richiesta ricevuta dall'azienda. Quando pubblichi, Kubri lancia l'appello alle associazioni compatibili."
        actions={
          draft === EMPTY ? (
            <Button variant="secondary" onClick={() => setDraft(DEMO_OFFER_TEMPLATE)}>
              <Sparkles className="size-4" aria-hidden="true" />
              Compila con l&apos;esempio
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="space-y-6">
          <Section title="L'azienda e la posizione">
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Azienda cliente" hint="Visibile solo all'agenzia, non alle associazioni.">
                <input className={inputClass} value={draft.clientCompany} onChange={(e) => set("clientCompany", e.target.value)} placeholder="Es. LogiNord S.p.A." />
              </Field>
              <Field label="Posizione">
                <input className={inputClass} value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Es. Addetto/a magazzino" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Descrizione">
                  <textarea rows={3} className={inputClass} value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="Mansioni principali e contesto di lavoro" />
                </Field>
              </div>
              <Field label="Comune della sede">
                <select className={inputClass} value={draft.city} onChange={(e) => set("city", e.target.value)}>
                  {CITIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Risorse cercate">
                <input type="number" min={1} max={50} className={`${inputClass} tabular`} value={draft.positions} onChange={(e) => set("positions", Number(e.target.value))} />
              </Field>
            </div>
          </Section>

          <Section title="Contratto e tempi">
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Tipologia contrattuale">
                <input className={inputClass} value={draft.contract} onChange={(e) => set("contract", e.target.value)} placeholder="Es. Tempo determinato, 6 mesi" />
              </Field>
              <Field label="Orario di lavoro">
                <input className={inputClass} value={draft.schedule} onChange={(e) => set("schedule", e.target.value)} placeholder="Es. Full time su turni" />
              </Field>
              <Field label="Inserimento">
                <select className={inputClass} value={draft.startBy} onChange={(e) => set("startBy", e.target.value)}>
                  {START.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Livello di italiano richiesto">
                <select className={inputClass} value={draft.italian} onChange={(e) => set("italian", e.target.value as ItalianLevel)}>
                  {ITALIAN.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          <Section title="Competenze e requisiti">
            <div className="space-y-4 p-5">
              <fieldset>
                <legend className="mb-2 text-[13px] font-medium text-ink-2">Competenze richieste</legend>
                <div className="space-y-3">
                  {Object.entries(SECTORS).map(([sector, profile]) => (
                    <div key={sector} className="flex flex-wrap items-center gap-1.5">
                      <span className="w-28 shrink-0 text-[12px] text-ink-3">{sector}</span>
                      {profile.skills.map((s) => {
                        const on = draft.skills.includes(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleSkill(s)}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                              on
                                ? "border-primary bg-primary-soft font-medium text-primary-strong"
                                : "border-line-strong text-ink-2 hover:border-primary-line hover:text-ink"
                            }`}
                          >
                            {on ? <Check className="size-3" aria-hidden="true" /> : null}
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </fieldset>
              <Field label="Altri requisiti">
                <input className={inputClass} value={draft.requirements} onChange={(e) => set("requirements", e.target.value)} placeholder="Es. Disponibilità ai turni" />
              </Field>
            </div>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-20">
          <Section title="Anteprima dell'appello">
            <div className="p-5">
              {draft.skills.length === 0 ? (
                <p className="text-ink-2">Scegli almeno una competenza: Kubri ti mostra subito quanti candidati compatibili ci sono nella rete.</p>
              ) : (
                <>
                  <p className="tabular text-[30px] leading-none font-semibold tracking-[-0.02em]">{preview.matches}</p>
                  <p className="mt-1 text-ink-2">candidati compatibili nel database della rete</p>
                  <p className="mt-4 text-[13px] text-ink-2">
                    L&apos;appello arriverà a <strong className="text-ink">{preview.total} associazioni</strong>
                    {preview.total > preview.withCandidates
                      ? `: ${preview.withCandidates} con candidati già nel database, ${preview.total - preview.withCandidates} per affinità di settore.`
                      : "."}
                  </p>
                </>
              )}
              <Button type="submit" className="mt-5 w-full" disabled={!ready}>
                <Megaphone className="size-4" aria-hidden="true" />
                Pubblica e lancia l&apos;appello
              </Button>
              {!ready ? (
                <p className="mt-2 text-[12px] text-ink-3">Servono azienda, posizione, risorse e almeno una competenza.</p>
              ) : null}
            </div>
          </Section>
        </aside>
      </div>
    </form>
  );
}
