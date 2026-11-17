"use client";

import { DEMO_ASSOCIATION_ID } from "@/lib/data";
import { fullName, relativeDay } from "@/lib/format";
import { useDemo } from "@/lib/store";
import { Avatar, Badge, PageHeader, Section } from "@/components/ui";

export default function OwnCandidatesPage() {
  const { candidates, proposals } = useDemo();
  const own = candidates
    .filter((c) => c.associationId === DEMO_ASSOCIATION_ID)
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt));

  return (
    <>
      <PageHeader
        title="I miei candidati"
        description="Le persone che segui. Arrivano dal chatbot WhatsApp di Kubri, dal caricamento del vostro database o le inserite a mano."
      />
      <Section>
        <table className="w-full text-left text-[13px]">
          <thead className="text-[12px] text-ink-3">
            <tr className="border-b border-line">
              <th className="px-5 py-2.5 font-medium">Persona</th>
              <th className="px-3 py-2.5 font-medium">Ruoli</th>
              <th className="px-3 py-2.5 font-medium">Disponibilità</th>
              <th className="px-3 py-2.5 font-medium">Origine</th>
              <th className="px-5 py-2.5 font-medium">Proposto</th>
            </tr>
          </thead>
          <tbody>
            {own.map((c) => {
              const n = proposals.filter((p) => p.candidateId === c.id).length;
              return (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-3">
                      <Avatar candidate={c} />
                      <span>
                        <span className="block font-semibold">{fullName(c)}</span>
                        <span className="block text-[12px] text-ink-3">
                          {c.city} · aggiunto {relativeDay(c.addedAt)}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-ink-2">{c.roles.join(", ")}</td>
                  <td className="px-3 py-3">
                    <Badge tone={c.availability === "Immediata" ? "good" : "neutral"}>{c.availability}</Badge>
                  </td>
                  <td className="px-3 py-3 text-ink-2">{c.source}</td>
                  <td className="px-5 py-3 text-ink-2">{n ? `${n} ${n === 1 ? "offerta" : "offerte"}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
    </>
  );
}
