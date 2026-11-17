"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, MapPin, Plus, UserPlus, X } from "lucide-react";
import { DEMO_ASSOCIATION_ID } from "@/lib/data";
import { fullName } from "@/lib/format";
import { scoreCandidate, shortReasons } from "@/lib/matching";
import { useMyAppeals } from "@/lib/appeals";
import { useDemo } from "@/lib/store";
import type { Availability } from "@/lib/types";
import { Avatar, Badge, Button, Empty, Field, PageHeader, Score, Section, inputClass } from "@/components/ui";

export default function AppealPage() {
  return (
    <Suspense>
      <Appeal />
    </Suspense>
  );
}

function Appeal() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const { candidates, proposals, markAppealSeen } = useDemo();
  const appeal = useMyAppeals().find((a) => a.offer.id === id);
  const [selected, setSelected] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (id) markAppealSeen(id, DEMO_ASSOCIATION_ID);
  }, [id, markAppealSeen]);

  if (!appeal) return <Empty title="Appello non trovato" />;
  const { offer, suggestions } = appeal;
  const alreadySent = new Set(proposals.filter((p) => p.offerId === offer.id).map((p) => p.candidateId));
  const extra = added
    .map((cid) => candidates.find((c) => c.id === cid))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => scoreCandidate(offer, c));
  const rows = [...extra, ...suggestions.filter((m) => !added.includes(m.candidate.id))];

  const toggle = (cid: string) => setSelected((s) => (s.includes(cid) ? s.filter((x) => x !== cid) : [...s, cid]));

  const proceed = () => {
    const q = new URLSearchParams({ id: offer.id, c: selected.join(",") });
    const newOnes = selected.filter((s) => added.includes(s));
    if (newOnes.length) q.set("nuovi", newOnes.join(","));
    router.push(`/associazione/appello/invia?${q.toString()}`);
  };

  return (
    <>
      <PageHeader
        back={{ href: "/associazione/appelli", label: "Appelli ricevuti" }}
        title={`${offer.positions} × ${offer.title}`}
        description={
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5 text-ink-3" aria-hidden="true" />
            {offer.city} · {offer.contract} · inizio {offer.startBy.toLowerCase()}
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px] lg:items-start">
        <div className="space-y-4">
          <Section
            title="Candidati suggeriti da Kubri"
            aside={
              <Button variant="ghost" onClick={() => setAdding(true)} disabled={adding}>
                <UserPlus className="size-4" aria-hidden="true" />
                Aggiungi un profilo
              </Button>
            }
          >
            {adding ? (
              <AddCandidate
                skills={offer.skills}
                role={offer.title}
                city={offer.city}
                onCancel={() => setAdding(false)}
                onAdded={(cid) => {
                  setAdded((a) => [cid, ...a]);
                  setSelected((s) => [...s, cid]);
                  setAdding(false);
                }}
              />
            ) : null}
            {rows.length === 0 ? (
              <Empty title="Nessuno dei tuoi candidati è compatibile">Puoi comunque aggiungere una persona che segui e proporla.</Empty>
            ) : (
              <ul>
                {rows.map(({ candidate: c, score, reasons }) => {
                  const sent = alreadySent.has(c.id);
                  const on = selected.includes(c.id);
                  return (
                    <li key={c.id} className="border-b border-line last:border-0">
                      <label
                        className={`flex cursor-pointer items-start gap-4 px-5 py-3.5 transition-colors ${
                          sent ? "cursor-default opacity-70" : on ? "bg-primary-soft/50" : "hover:bg-primary-soft/25"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-2 size-4 shrink-0"
                          checked={sent || on}
                          disabled={sent}
                          onChange={() => toggle(c.id)}
                          aria-label={`Seleziona ${fullName(c)}`}
                        />
                        <Avatar candidate={c} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{fullName(c)}</span>
                            {added.includes(c.id) ? <Badge tone="primary">Aggiunto ora</Badge> : null}
                            {sent ? <Badge tone="good">Già inviato</Badge> : null}
                          </span>
                          <span className="block text-[12px] text-ink-3">
                            {c.roles.join(", ")} · {c.city} · disponibilità {c.availability.toLowerCase()}
                          </span>
                          <span className="mt-1 block text-[12px] text-ink-2">{shortReasons(reasons)}</span>
                        </span>
                        <Score value={score} />
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <Section title="Invio all'agenzia">
            <div className="p-5">
              <p className="text-ink-2">
                {selected.length === 0
                  ? "Seleziona le persone pronte per questa offerta."
                  : `${selected.length} ${selected.length === 1 ? "persona selezionata" : "persone selezionate"}.`}
              </p>
              <Button className="mt-4 w-full" disabled={selected.length === 0} onClick={proceed}>
                Prosegui
              </Button>
              <p className="mt-2 text-[12px] text-ink-3">Nessun dato arriva all&apos;agenzia finché non confermi l&apos;invio.</p>
            </div>
          </Section>
          <Section title="L'offerta">
            <dl className="space-y-3 p-5 text-[13px]">
              <div>
                <dt className="text-[12px] text-ink-3">Mansioni</dt>
                <dd>{offer.description}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-3">Orario</dt>
                <dd>{offer.schedule}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-3">Italiano</dt>
                <dd>{offer.italian}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-3">Competenze</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {offer.skills.map((s) => (
                    <Badge key={s}>{s}</Badge>
                  ))}
                </dd>
              </div>
            </dl>
          </Section>
        </aside>
      </div>
    </>
  );
}

function AddCandidate({
  skills,
  role,
  city,
  onCancel,
  onAdded,
}: {
  skills: string[];
  role: string;
  city: string;
  onCancel: () => void;
  onAdded: (id: string) => void;
}) {
  const { addCandidate } = useDemo();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [availability, setAvailability] = useState<Availability>("Immediata");
  const ok = firstName.trim() && lastName.trim() && phone.trim();

  const save = () => {
    if (!ok) return;
    const id = addCandidate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      age: 30,
      city,
      associationId: DEMO_ASSOCIATION_ID,
      roles: [role],
      skills: picked,
      experienceYears: 1,
      experience: "Esperienza raccontata all'operatore dell'associazione",
      availability,
      italian: "Base",
      languages: [],
      licenses: [],
      phone: phone.trim(),
      email: "",
      source: "Inserito a mano",
    });
    onAdded(id);
  };

  return (
    <div className="animate-rise border-b border-line bg-sidebar/60 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Aggiungi una persona che segui</h3>
        <button type="button" onClick={onCancel} aria-label="Annulla" className="rounded-md p-1 text-ink-3 hover:bg-panel hover:text-ink">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Nome">
          <input className={inputClass} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label="Cognome">
          <input className={inputClass} value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label="Telefono">
          <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+39" />
        </Field>
      </div>
      <fieldset className="mt-3">
        <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Competenze richieste che possiede</legend>
        <div className="flex flex-wrap gap-1.5">
          {skills.map((s) => {
            const on = picked.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s) : [...p, s]))}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] ${
                  on ? "border-primary bg-primary-soft font-medium text-primary-strong" : "border-line-strong bg-panel text-ink-2 hover:border-primary-line"
                }`}
              >
                {on ? <Check className="size-3" aria-hidden="true" /> : null}
                {s}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <Field label="Disponibilità">
          <select className={inputClass} value={availability} onChange={(e) => setAvailability(e.target.value as Availability)}>
            <option>Immediata</option>
            <option>Entro 2 settimane</option>
            <option>Entro 1 mese</option>
          </select>
        </Field>
        <Button onClick={save} disabled={!ok}>
          <Plus className="size-4" aria-hidden="true" />
          Aggiungi e seleziona
        </Button>
      </div>
      <p className="mt-2 text-[12px] text-ink-3">Il profilo entra nel tuo database e partecipa anche ai prossimi appelli.</p>
    </div>
  );
}
