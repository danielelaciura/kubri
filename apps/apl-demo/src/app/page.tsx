"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, HandHeart, PlayCircle } from "lucide-react";
import { AGENCY, ASSOCIATIONS, DEMO_ASSOCIATION_ID } from "@/lib/data";
import { useDemo } from "@/lib/store";
import { asset } from "@/lib/asset";

const FLOW = [
  "L'azienda chiede personale all'agenzia",
  "L'agenzia pubblica l'offerta su Kubri",
  "Kubri trova le associazioni con candidati compatibili",
  "Le associazioni scelgono e inviano i candidati",
  "L'agenzia riceve profili completi e contatti",
];

export default function Home() {
  const router = useRouter();
  const { setTourStep, reset } = useDemo();
  const assoc = ASSOCIATIONS.find((a) => a.id === DEMO_ASSOCIATION_ID);

  const startTour = () => {
    reset();
    setTourStep(0);
    router.push("/agenzia");
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1040px] flex-col px-6 py-10">
      <div className="flex items-center gap-2">
        <Image src={asset("/kubri-logo.png")} alt="" width={108} height={112} className="h-7 w-auto" priority />
        <span className="text-[18px] font-semibold text-primary-strong">kubri</span>
        <span className="ml-2 rounded-md bg-warn-soft px-2 py-0.5 text-[12px] font-medium text-warn">Demo · dati dimostrativi</span>
      </div>

      <div className="mt-16 grid gap-12 md:grid-cols-[1.1fr_1fr] md:items-start">
        <div>
          <h1 className="text-[40px] leading-[1.1] font-semibold tracking-[-0.025em] text-balance">
            La tua rete di associazioni, attivata con un clic.
          </h1>
          <p className="mt-4 max-w-[52ch] text-[16px] text-ink-2">
            Con Kubri l&apos;agenzia per il lavoro pubblica un&apos;offerta e raggiunge subito le cooperative e le
            associazioni del territorio che hanno le persone giuste. Loro scelgono chi proporre; tu ricevi profili
            completi e pronti da presentare.
          </p>
          <button
            type="button"
            onClick={startTour}
            className="mt-8 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-medium text-white transition-colors hover:bg-primary-strong"
          >
            <PlayCircle className="size-5" aria-hidden="true" />
            Avvia il tour guidato
          </button>
          <p className="mt-2 text-[13px] text-ink-3">9 passi, circa 5 minuti. Si può uscire in ogni momento.</p>
        </div>

        <ol className="rounded-2xl border border-line bg-panel p-6">
          {FLOW.map((step, i) => (
            <li key={step} className="relative flex gap-4 pb-5 last:pb-0">
              {i < FLOW.length - 1 ? (
                <span aria-hidden="true" className="absolute top-8 left-[15px] h-[calc(100%-24px)] w-px bg-line-strong" />
              ) : null}
              <span className="tabular relative flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary-strong">
                {i + 1}
              </span>
              <span className="pt-1 text-[14px]">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-16">
        <h2 className="text-[15px] font-semibold">Oppure esplora liberamente</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <RoleLink
            href="/agenzia"
            icon={<Building2 className="size-5" aria-hidden="true" />}
            title={`Entra come agenzia · ${AGENCY.name}`}
            body="Offerte, appelli, rete di associazioni, database candidati."
          />
          <RoleLink
            href="/associazione"
            icon={<HandHeart className="size-5" aria-hidden="true" />}
            title={`Entra come associazione · ${assoc?.name ?? ""}`}
            body="Appelli ricevuti, candidati suggeriti, invio all'agenzia."
          />
        </div>
      </div>
    </main>
  );
}

function RoleLink({ href, icon, title, body }: { href: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-xl border border-line bg-panel px-5 py-4 transition-colors hover:border-primary-line hover:bg-primary-soft/40"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-strong">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-[13px] text-ink-2">{body}</span>
      </span>
      <ArrowRight className="size-4 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
    </Link>
  );
}
