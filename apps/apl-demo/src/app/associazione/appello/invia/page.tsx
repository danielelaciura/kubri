"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Send } from "lucide-react";
import { AGENCY, DEMO_ASSOCIATION_ID } from "@/lib/data";
import { fullName } from "@/lib/format";
import { useDemo } from "@/lib/store";
import { Avatar, Button, ButtonLink, Empty, PageHeader, Section } from "@/components/ui";

export default function SendPage() {
  return (
    <Suspense>
      <Send_ />
    </Suspense>
  );
}

function Send_() {
  const params = useSearchParams();
  const { offers, candidates, proposals, sendCandidates } = useDemo();
  const offer = offers.find((o) => o.id === params.get("id"));
  const ids = (params.get("c") ?? "").split(",").filter(Boolean);
  const added = (params.get("nuovi") ?? "").split(",").filter(Boolean);
  const chosen = ids.map((id) => candidates.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const [approved, setApproved] = useState(false);
  const alreadySent = offer
    ? chosen.length > 0 && chosen.every((c) => proposals.some((p) => p.offerId === offer.id && p.candidateId === c.id))
    : false;
  const [sent, setSent] = useState(alreadySent);

  if (!offer) return <Empty title="Appello non trovato" />;
  if (chosen.length === 0 && !sent) {
    return (
      <Empty title="Nessun candidato selezionato">
        <Link className="text-primary-strong underline" href={`/associazione/appello?id=${offer.id}`}>
          Torna all&apos;appello
        </Link>
      </Empty>
    );
  }

  const send = () => {
    sendCandidates(offer.id, DEMO_ASSOCIATION_ID, ids, added);
    setSent(true);
  };

  if (sent) {
    return (
      <div className="animate-rise mx-auto max-w-[560px] pt-10 text-center">
        <CheckCircle2 className="mx-auto size-12 text-good" aria-hidden="true" />
        <h1 className="mt-4 text-[22px] font-semibold">
          {chosen.length === 1 ? "Candidato inviato" : `${chosen.length} candidati inviati`} a {AGENCY.name}
        </h1>
        <p className="mt-2 text-ink-2">
          L&apos;agenzia ora vede profilo completo e contatti, collegati all&apos;offerta «{offer.title}». Riceverai un aggiornamento a ogni
          passo: colloquio, presentazione all&apos;azienda, esito.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <ButtonLink variant="secondary" href="/associazione/appelli">
            Torna agli appelli
          </ButtonLink>
          <ButtonLink href={`/agenzia/offerta?id=${offer.id}&tab=proposti`}>Guarda dal lato agenzia</ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: `/associazione/appello?id=${offer.id}`, label: `${offer.positions} × ${offer.title}` }}
        title="Conferma l'invio"
        description={`Questi profili arriveranno a ${AGENCY.name} per l'offerta «${offer.title}» a ${offer.city}.`}
      />
      <div className="max-w-[720px] space-y-4">
        <Section title={`${chosen.length} ${chosen.length === 1 ? "persona" : "persone"}`}>
          <ul>
            {chosen.map((c) => (
              <li key={c.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
                <Avatar candidate={c} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{fullName(c)}</span>
                  <span className="block text-[12px] text-ink-3">
                    {c.roles.join(", ")} · {c.phone}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section>
          <div className="p-5">
            <p className="text-[13px] text-ink-2">L&apos;agenzia riceverà nome, contatti e scheda completa di ogni persona.</p>
            <label className="mt-3 flex cursor-pointer items-start gap-3 text-[14px]">
              <input type="checkbox" className="mt-1 size-4" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
              <span>Approvo l&apos;invio: ho verificato che queste persone sono pronte e interessate a questa offerta.</span>
            </label>
            <Button className="mt-5" disabled={!approved} onClick={send}>
              <Send className="size-4" aria-hidden="true" />
              {chosen.length === 1 ? "Invia il candidato all'agenzia" : `Invia ${chosen.length} candidati all'agenzia`}
            </Button>
          </div>
        </Section>
      </div>
    </>
  );
}
