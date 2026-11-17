"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Mail, MessageCircle } from "lucide-react";
import { AGENCY, ASSOCIATIONS, DEMO_ASSOCIATION_ID } from "@/lib/data";
import { useMyAppeals } from "@/lib/appeals";
import { ButtonLink, Empty, PageHeader, Section } from "@/components/ui";

export default function NotificationPage() {
  return (
    <Suspense>
      <NotificationPreview />
    </Suspense>
  );
}

function NotificationPreview() {
  const id = useSearchParams().get("id");
  const appeal = useMyAppeals().find((a) => a.offer.id === id);
  const assoc = ASSOCIATIONS.find((a) => a.id === DEMO_ASSOCIATION_ID);
  if (!appeal) return <Empty title="Appello non trovato" />;
  const { offer, suggestions } = appeal;
  const n = suggestions.length;
  const link = `kubri.it/appello/${offer.id.slice(-6)}`;

  return (
    <>
      <PageHeader
        back={{ href: "/associazione/appelli", label: "Appelli ricevuti" }}
        title="Così arriva un nuovo appello"
        description={`Kubri avvisa ${assoc?.name ?? "l'associazione"} sul canale che preferisce. Il messaggio dice già quante persone seguite sono adatte.`}
        actions={<ButtonLink href={`/associazione/appello?id=${offer.id}`}>Apri l&apos;appello</ButtonLink>}
      />

      <div className="grid gap-6 lg:grid-cols-[340px_1fr] lg:items-start">
        <div>
          <h2 className="mb-2 flex items-center gap-2 text-[13px] font-medium text-ink-2">
            <MessageCircle className="size-4" aria-hidden="true" />
            WhatsApp
          </h2>
          <div className="rounded-[28px] border border-line-strong bg-[oklch(0.95_0.012_120)] p-4">
            <div className="mb-3 text-center text-[12px] text-ink-3">oggi</div>
            <div className="ml-auto max-w-[92%] rounded-xl rounded-tr-sm bg-whatsapp px-3.5 py-2.5 text-[13px] leading-relaxed text-ink shadow-[0_1px_1px_oklch(0.3_0.02_150/0.12)]">
              <p className="font-semibold">Kubri · Nuovo appello</p>
              <p className="mt-1">
                {AGENCY.name} cerca <strong>{offer.positions} × {offer.title}</strong> a {offer.city}. {offer.contract}, inizio{" "}
                {offer.startBy.toLowerCase()}.
              </p>
              <p className="mt-2">
                {n > 0 ? (
                  <>
                    Tra le persone che segui, <strong>{n} sono compatibili</strong>. Vuoi proporle?
                  </>
                ) : (
                  <>Hai qualcuno adatto da proporre?</>
                )}
              </p>
              <p className="mt-2 text-primary-strong underline underline-offset-2">{link}</p>
              <p className="mt-1 text-right text-[11px] text-ink-3">09:41</p>
            </div>
          </div>
        </div>

        <div>
          <h2 className="mb-2 flex items-center gap-2 text-[13px] font-medium text-ink-2">
            <Mail className="size-4" aria-hidden="true" />
            Email
          </h2>
          <Section>
            <div className="border-b border-line px-5 py-3 text-[13px]">
              <div>
                <span className="text-ink-3">Da:</span>{" "}Kubri &lt;appelli@kubri.it&gt;
              </div>
              <div>
                <span className="text-ink-3">A:</span>{" "}{assoc?.contactEmail}
              </div>
              <div className="mt-1 font-semibold">
                Nuovo appello: {offer.positions} × {offer.title} a {offer.city}
              </div>
            </div>
            <div className="space-y-3 px-5 py-4 text-[14px] leading-relaxed">
              <p>Ciao {assoc?.contactName.split(" ")[0]},</p>
              <p>
                {AGENCY.name} ha pubblicato un&apos;offerta che può interessare le persone che segui:{" "}
                <strong>
                  {offer.positions} × {offer.title}
                </strong>{" "}
                a {offer.city} ({offer.contract.toLowerCase()}, {offer.schedule.toLowerCase()}).
              </p>
              <p>
                {n > 0
                  ? `Kubri ha trovato ${n} candidati compatibili nel vostro database. Puoi vederli, aggiungerne altri e decidere chi inviare all'agenzia.`
                  : "Non abbiamo trovato candidati nel vostro database, ma potete proporre persone che seguite."}
              </p>
              <ButtonLink href={`/associazione/appello?id=${offer.id}`}>Vedi i candidati suggeriti</ButtonLink>
              <p className="text-[12px] text-ink-3">Nessun dato del candidato viene condiviso finché non lo approvi tu.</p>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
