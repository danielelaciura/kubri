"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import { relativeDay } from "@/lib/format";
import { useDemo } from "@/lib/store";
import { Badge, Empty } from "./ui";

/** Elenco delle offerte con lo stato dell'appello: usato in panoramica e nella pagina Offerte. */
export function OffersTable({ limit }: { limit?: number }) {
  const { offers, proposals, appealResponses } = useDemo();
  const rows = limit ? offers.slice(0, limit) : offers;
  if (rows.length === 0) return <Empty title="Nessuna offerta">Crea la prima offerta per attivare la rete.</Empty>;

  return (
    <table className="w-full text-left text-[13px]">
      <thead className="text-[12px] text-ink-3">
        <tr className="border-b border-line">
          <th className="px-5 py-2.5 font-medium">Posizione</th>
          <th className="px-3 py-2.5 font-medium">Luogo</th>
          <th className="px-3 py-2.5 text-right font-medium">Risorse</th>
          <th className="px-3 py-2.5 font-medium">Associazioni</th>
          <th className="px-5 py-2.5 text-right font-medium">Candidati proposti</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => {
          const resp = appealResponses.filter((r) => r.offerId === o.id);
          const answered = resp.filter((r) => r.state === "ha_risposto").length;
          const props = proposals.filter((p) => p.offerId === o.id);
          const toReview = props.filter((p) => p.status === "proposto").length;
          return (
            <tr key={o.id} className="group border-b border-line last:border-0 hover:bg-primary-soft/40">
              <td className="px-5 py-3">
                <Link href={`/agenzia/offerta?id=${o.id}`} className="font-semibold text-ink group-hover:text-primary-strong">
                  {o.title}
                </Link>
                <div className="text-[12px] text-ink-3">
                  {o.clientCompany} · pubblicata {relativeDay(o.publishedAt)}
                </div>
              </td>
              <td className="px-3 py-3 text-ink-2">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5 text-ink-3" aria-hidden="true" />
                  {o.city}
                </span>
              </td>
              <td className="tabular px-3 py-3 text-right">{o.positions}</td>
              <td className="px-3 py-3 text-ink-2">
                <span className="tabular">
                  {answered} su {resp.length}
                </span>{" "}
                <span className="text-ink-3">hanno risposto</span>
              </td>
              <td className="px-5 py-3 text-right">
                <span className="tabular font-semibold">{props.length}</span>
                {toReview ? (
                  <span className="ml-2">
                    <Badge tone="primary">{toReview} da valutare</Badge>
                  </span>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
