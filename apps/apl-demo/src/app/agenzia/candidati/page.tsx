"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Lock, Search } from "lucide-react";
import { ASSOCIATIONS } from "@/lib/data";
import { anonymousName, fullName } from "@/lib/format";
import { useDemo, useIsShared } from "@/lib/store";
import { Avatar, Badge, Empty, PageHeader, Section, inputClass } from "@/components/ui";

const ALL = "Tutte";

export default function CandidatesPage() {
  const { candidates } = useDemo();
  const isShared = useIsShared();
  const [q, setQ] = useState("");
  const [city, setCity] = useState(ALL);
  const [availability, setAvailability] = useState(ALL);
  const [assoc, setAssoc] = useState(ALL);
  const [minYears, setMinYears] = useState(0);

  const cities = useMemo(() => [...new Set(candidates.map((c) => c.city))].sort(), [candidates]);

  const rows = candidates.filter((c) => {
    const text = `${c.roles.join(" ")} ${c.skills.join(" ")}`.toLowerCase();
    return (
      (!q || text.includes(q.toLowerCase())) &&
      (city === ALL || c.city === city) &&
      (availability === ALL || c.availability === availability) &&
      (assoc === ALL || c.associationId === assoc) &&
      c.experienceYears >= minYears
    );
  });

  return (
    <>
      <PageHeader
        title="Database candidati"
        description="Tutti i profili caricati dalle associazioni della rete. Ogni candidato resta legato all'associazione che lo segue."
      />

      <Section>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr_0.9fr]">
          <label className="relative">
            <span className="sr-only">Cerca per competenza o ruolo</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <input className={`${inputClass} pl-9`} placeholder="Competenza o ruolo, es. muletto" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select aria-label="Comune" className={inputClass} value={city} onChange={(e) => setCity(e.target.value)}>
            <option value={ALL}>Tutti i comuni</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select aria-label="Disponibilità" className={inputClass} value={availability} onChange={(e) => setAvailability(e.target.value)}>
            <option value={ALL}>Ogni disponibilità</option>
            <option>Immediata</option>
            <option>Entro 2 settimane</option>
            <option>Entro 1 mese</option>
          </select>
          <select aria-label="Associazione" className={inputClass} value={assoc} onChange={(e) => setAssoc(e.target.value)}>
            <option value={ALL}>Tutte le associazioni</option>
            {ASSOCIATIONS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select aria-label="Esperienza minima" className={inputClass} value={minYears} onChange={(e) => setMinYears(Number(e.target.value))}>
            <option value={0}>Ogni esperienza</option>
            <option value={1}>Almeno 1 anno</option>
            <option value={3}>Almeno 3 anni</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-2.5 text-[12px] text-ink-2">
          <span className="tabular">
            {rows.length} candidati su {candidates.length}
          </span>
          <span className="inline-flex items-center gap-1.5 text-ink-3">
            <Lock className="size-3.5" aria-hidden="true" />
            Nome e contatti visibili dopo l&apos;invio dell&apos;associazione
          </span>
        </div>

        {rows.length === 0 ? (
          <Empty title="Nessun candidato con questi filtri">Prova ad allargare il comune o la disponibilità.</Empty>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="text-[12px] text-ink-3">
              <tr className="border-y border-line">
                <th className="px-5 py-2.5 font-medium">Candidato</th>
                <th className="px-3 py-2.5 font-medium">Ruoli e competenze</th>
                <th className="px-3 py-2.5 text-right font-medium">Esperienza</th>
                <th className="px-3 py-2.5 font-medium">Disponibilità</th>
                <th className="px-5 py-2.5 font-medium">Comune</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const visible = isShared(c.id);
                return (
                  <tr key={c.id} className="border-b border-line align-top last:border-0 hover:bg-primary-soft/30">
                    <td className="px-5 py-3">
                      <Link href={`/agenzia/candidato?id=${c.id}`} className="flex items-center gap-3">
                        <Avatar candidate={c} hidden={!visible} />
                        <span>
                          <span className="block font-semibold hover:text-primary-strong">{visible ? fullName(c) : anonymousName(c)}</span>
                          <span className="block text-[12px] text-ink-3">{ASSOCIATIONS.find((a) => a.id === c.associationId)?.name}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <span className="block text-ink">{c.roles.join(", ")}</span>
                      <span className="block text-[12px] text-ink-3">{c.skills.slice(0, 3).join(" · ")}</span>
                    </td>
                    <td className="tabular px-3 py-3 text-right text-ink-2">{c.experienceYears ? `${c.experienceYears} anni` : "—"}</td>
                    <td className="px-3 py-3">
                      <Badge tone={c.availability === "Immediata" ? "good" : "neutral"}>{c.availability}</Badge>
                    </td>
                    <td className="px-5 py-3 text-ink-2">{c.city}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}
