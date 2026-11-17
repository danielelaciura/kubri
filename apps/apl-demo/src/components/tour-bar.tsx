"use client";

// Tour guidato: i 9 passi del flusso operativo (PDF §5). "Avanti" porta alla
// schermata giusta e, se serve, compie l'azione al posto del presentatore
// (pubblica l'offerta demo, invia i candidati), così la demo non si inceppa.
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { DEMO_ASSOCIATION_ID, DEMO_OFFER_TEMPLATE } from "@/lib/data";
import { matchesFor } from "@/lib/matching";
import { useDemo } from "@/lib/store";

type Api = ReturnType<typeof useDemo>;

interface Step {
  actor: "Azienda" | "Agenzia" | "Kubri" | "Associazione";
  title: string;
  body: string;
  href: (api: Api) => string;
}

function demoOfferId(api: Api): string {
  return api.ensureDemoOffer();
}

export const TOUR: Step[] = [
  {
    actor: "Azienda",
    title: "Un'azienda chiede personale all'agenzia",
    body: "LogiNord cerca 3 addetti di magazzino a Settimo Torinese, entro due settimane. L'agenzia apre Kubri.",
    href: () => "/agenzia",
  },
  {
    actor: "Agenzia",
    title: "L'agenzia inserisce l'offerta",
    body: "Azienda cliente, posizione, numero di risorse, contratto, orario, competenze e tempi: tutto in un unico modulo.",
    href: () => "/agenzia/offerte/nuova?esempio=1",
  },
  {
    actor: "Agenzia",
    title: "Un clic: l'offerta è pubblicata e l'appello parte",
    body: "Pubblicare l'offerta e lanciare l'appello alla rete sono la stessa azione.",
    href: (api) => `/agenzia/offerte/pubblicazione?id=${demoOfferId(api)}`,
  },
  {
    actor: "Kubri",
    title: "Kubri trova candidati e associazioni compatibili",
    body: "Il matching guarda competenze, ruolo, territorio, disponibilità e italiano su tutto il database della rete.",
    href: (api) => `/agenzia/offerta?id=${demoOfferId(api)}&tab=matching`,
  },
  {
    actor: "Associazione",
    title: "L'associazione riceve la notifica",
    body: "Solo le associazioni con profili adatti vengono avvisate, via email o WhatsApp.",
    href: (api) => `/associazione/notifica?id=${demoOfferId(api)}`,
  },
  {
    actor: "Associazione",
    title: "Vede i candidati suggeriti e può aggiungerne altri",
    body: "L'associazione conosce le persone: sceglie chi è pronto e aggiunge chi non è ancora nel database.",
    href: (api) => `/associazione/appello?id=${demoOfferId(api)}`,
  },
  {
    actor: "Associazione",
    title: "Approva e invia i candidati",
    body: "Nulla arriva all'agenzia senza l'approvazione dell'associazione.",
    href: (api) => {
      const id = demoOfferId(api);
      const offer = api.offers.find((o) => o.id === id) ?? { ...DEMO_OFFER_TEMPLATE, id, status: "pubblicata" as const, publishedAt: "" };
      const own = api.candidates.filter((c) => c.associationId === DEMO_ASSOCIATION_ID);
      const top = matchesFor(offer, own).slice(0, 2).map((m) => m.candidate.id);
      return `/associazione/appello/invia?id=${id}&c=${top.join(",")}`;
    },
  },
  {
    actor: "Agenzia",
    title: "L'agenzia riceve i profili completi",
    body: "Nome, contatti e scheda completa diventano visibili solo dopo l'invio.",
    href: (api) => {
      const id = demoOfferId(api);
      api.ensureDemoProposals(id);
      return `/agenzia/offerta?id=${id}&tab=proposti`;
    },
  },
  {
    actor: "Agenzia",
    title: "L'agenzia presenta i candidati all'azienda",
    body: "Fuori dalla piattaforma, con la scheda del candidato pronta da condividere.",
    href: (api) => {
      const id = demoOfferId(api);
      const p = api.proposals.find((x) => x.offerId === id && x.associationId === DEMO_ASSOCIATION_ID);
      return p ? `/agenzia/candidato?id=${p.candidateId}&offerta=${id}` : `/agenzia/offerta?id=${id}&tab=proposti`;
    },
  },
];

export function TourBar() {
  const api = useDemo();
  const router = useRouter();
  const step = api.tourStep;
  if (step === null) return null;
  const current = TOUR[step];
  if (!current) return null;

  const goTo = (i: number) => {
    const target = TOUR[i];
    if (!target) return;
    api.setTourStep(i);
    router.push(target.href(api));
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 md:pl-64">
      <div
        role="region"
        aria-label="Tour guidato"
        className="animate-rise flex w-full max-w-[860px] items-center gap-5 rounded-2xl bg-ink px-5 py-4 text-white shadow-[0_16px_40px_-12px_oklch(0.2_0.05_291/0.5)]"
      >
        <div className="flex shrink-0 flex-col items-center">
          <span className="tabular text-[22px] font-semibold leading-none">{step + 1}</span>
          <span className="tabular text-[11px] text-white/60">di {TOUR.length}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-[oklch(0.82_0.08_291)]">{current.actor}</div>
          <div className="text-[15px] font-semibold">{current.title}</div>
          <p className="text-[13px] text-white/75">{current.body}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => goTo(step - 1)}
            disabled={step === 0}
            aria-label="Passo precedente"
            className="inline-flex size-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 disabled:opacity-30"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </button>
          {step < TOUR.length - 1 ? (
            <button
              type="button"
              onClick={() => goTo(step + 1)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-4 text-[13px] font-semibold text-ink hover:bg-[oklch(0.95_0.03_291)]"
            >
              Avanti
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => api.setTourStep(null)}
              className="inline-flex h-9 items-center rounded-lg bg-white px-4 text-[13px] font-semibold text-ink hover:bg-[oklch(0.95_0.03_291)]"
            >
              Fine del tour
            </button>
          )}
          <button
            type="button"
            onClick={() => api.setTourStep(null)}
            aria-label="Chiudi il tour"
            className="inline-flex size-9 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
