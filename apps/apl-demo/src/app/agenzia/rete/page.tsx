"use client";

import { ASSOCIATIONS } from "@/lib/data";
import { useDemo } from "@/lib/store";
import { Badge, PageHeader, Section } from "@/components/ui";

export default function NetworkPage() {
  const { candidates, appealResponses } = useDemo();

  return (
    <>
      <PageHeader
        title="Rete associazioni"
        description="Le organizzazioni del territorio che lavorano con te. Alcune condividono il loro database di candidati, altre rispondono solo agli appelli."
      />
      <Section>
        <table className="w-full text-left text-[13px]">
          <thead className="text-[12px] text-ink-3">
            <tr className="border-b border-line">
              <th className="px-5 py-2.5 font-medium">Associazione</th>
              <th className="px-3 py-2.5 font-medium">Settori</th>
              <th className="px-3 py-2.5 font-medium">Partecipazione</th>
              <th className="px-3 py-2.5 text-right font-medium">Candidati</th>
              <th className="px-3 py-2.5 text-right font-medium">Risposta agli appelli</th>
              <th className="px-5 py-2.5 font-medium">Ultima attività</th>
            </tr>
          </thead>
          <tbody>
            {ASSOCIATIONS.map((a) => {
              const count = candidates.filter((c) => c.associationId === a.id).length;
              const appeals = appealResponses.filter((r) => r.associationId === a.id).length;
              return (
                <tr key={a.id} className="border-b border-line last:border-0 hover:bg-primary-soft/30">
                  <td className="px-5 py-3">
                    <span className="block font-semibold">{a.name}</span>
                    <span className="block text-[12px] text-ink-3">
                      {a.kind} · {a.city} · referente {a.contactName}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex flex-wrap gap-1">
                      {a.sectors.map((s) => (
                        <Badge key={s}>{s}</Badge>
                      ))}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {a.mode === "integrato" ? <Badge tone="primary">Database integrato</Badge> : <Badge>Solo appelli</Badge>}
                  </td>
                  <td className="tabular px-3 py-3 text-right">{count}</td>
                  <td className="px-3 py-3 text-right">
                    <span className="tabular font-medium">{a.responseRate}%</span>
                    <span className="block text-[12px] text-ink-3">
                      {appeals} {appeals === 1 ? "appello" : "appelli"} ricevuti
                    </span>
                  </td>
                  <td className="px-5 py-3 text-ink-2">{a.lastActivity}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>
      <p className="mt-3 max-w-[80ch] text-[13px] text-ink-3">
        <strong className="font-medium text-ink-2">Database integrato</strong>: i beneficiari caricati dall&apos;associazione entrano nel
        database della rete e partecipano al matching. <strong className="font-medium text-ink-2">Solo appelli</strong>: l&apos;associazione
        riceve gli appelli del suo settore e propone candidati di volta in volta.
      </p>
    </>
  );
}
