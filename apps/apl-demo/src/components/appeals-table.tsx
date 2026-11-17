"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import { relativeDay } from "@/lib/format";
import type { AppealView } from "@/lib/appeals";
import { Badge, Empty } from "./ui";

export function AppealsTable({ appeals }: { appeals: AppealView[] }) {
  if (appeals.length === 0) {
    return <Empty title="Nessun appello per ora">Quando un&apos;agenzia pubblica un&apos;offerta adatta ai tuoi candidati, la trovi qui.</Empty>;
  }
  return (
    <table className="w-full text-left text-[13px]">
      <thead className="text-[12px] text-ink-3">
        <tr className="border-b border-line">
          <th className="px-5 py-2.5 font-medium">Offerta</th>
          <th className="px-3 py-2.5 font-medium">Luogo</th>
          <th className="px-3 py-2.5 text-right font-medium">Tuoi compatibili</th>
          <th className="px-5 py-2.5 font-medium">La tua risposta</th>
        </tr>
      </thead>
      <tbody>
        {appeals.map(({ offer, response, suggestions, sent }) => (
          <tr key={offer.id} className="group border-b border-line last:border-0 hover:bg-primary-soft/40">
            <td className="px-5 py-3">
              <Link href={`/associazione/appello?id=${offer.id}`} className="flex items-center gap-2 font-semibold group-hover:text-primary-strong">
                {response.state === "notificata" ? <span aria-label="Nuovo" className="size-1.5 rounded-full bg-primary" /> : null}
                {offer.positions} × {offer.title}
              </Link>
              <div className="text-[12px] text-ink-3">
                {offer.contract} · ricevuto {relativeDay(offer.publishedAt)}
              </div>
            </td>
            <td className="px-3 py-3 text-ink-2">
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5 text-ink-3" aria-hidden="true" />
                {offer.city}
              </span>
            </td>
            <td className="tabular px-3 py-3 text-right font-semibold">{suggestions.length}</td>
            <td className="px-5 py-3">
              {sent > 0 ? (
                <Badge tone="good">
                  <span className="tabular">{sent}</span> {sent === 1 ? "candidato inviato" : "candidati inviati"}
                </Badge>
              ) : response.state === "notificata" ? (
                <Badge tone="primary">Nuovo</Badge>
              ) : (
                <Badge>Da valutare</Badge>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
