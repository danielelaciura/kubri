"use client";

import { useState } from "react";
import { ASSESSMENT_SECTIONS, allQuestions, assessmentContactSchema } from "@kubri/contracts";
import { QuestionRenderer } from "./questionnaire/QuestionRenderer";
import { submitCommunity } from "@/lib/submit";
import { ComuneSelect } from "./questionnaire/ComuneSelect";
import { comuneLabel, type Comune } from "@/lib/comuni";

type Phase = "intro" | "questions" | "done";

/**
 * Seed scale questions with their default so what the slider shows (its default
 * position) is what gets submitted — even if the user never touches it.
 * Without this, an untouched scale stays `undefined` and is dropped on mapping.
 */
function initialAnswers(): Record<string, unknown> {
  const init: Record<string, unknown> = {};
  for (const q of allQuestions()) {
    if (q.component === "scale" && q.scale) init[q.id] = q.scale.default;
  }
  return init;
}

type ContactFormState = {
  firstName: string;
  lastName: string;
  phone: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  email: string;
  privacyAccepted: boolean;
};

export function AssessmentFlow() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>(initialAnswers);

  // Done screen state
  const [showForm, setShowForm] = useState(false);
  const [contact, setContact] = useState<ContactFormState>({
    firstName: "",
    lastName: "",
    phone: "",
    location: "",
    latitude: null,
    longitude: null,
    email: "",
    privacyAccepted: false,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "success" | "error">("idle");
  const [reportState, setReportState] = useState<"idle" | "loading" | "error">("idle");

  const totalSections = ASSESSMENT_SECTIONS.length;
  const currentSection = ASSESSMENT_SECTIONS[sectionIndex]!;
  const isFirstSection = sectionIndex === 0;
  const isLastSection = sectionIndex === totalSections - 1;
  // Stepper progress: the 5 sections map across 0–100% (0 · 25 · 50 · 75 · 100),
  // so the last section reads as a full bar rather than stalling at 80%.
  const progressPercent =
    totalSections > 1 ? Math.round((sectionIndex / (totalSections - 1)) * 100) : 100;

  function handleNext() {
    if (isLastSection) {
      setPhase("done");
    } else {
      setSectionIndex((i) => i + 1);
    }
    window.scrollTo(0, 0);
  }

  function handleBack() {
    if (!isFirstSection) {
      setSectionIndex((i) => i - 1);
      window.scrollTo(0, 0);
    }
  }

  // From the completion screen, return to the questionnaire (last section) to
  // review/edit answers. Answers persist in state, so nothing is lost.
  function handleReview() {
    setShowForm(false);
    setPhase("questions");
    setSectionIndex(totalSections - 1);
    window.scrollTo(0, 0);
  }

  async function downloadReport(name?: string) {
    setReportState("loading");
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessment: answers, name }),
      });
      if (!res.ok) throw new Error(`report ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "competenze-kubri.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setReportState("idle");
    } catch {
      setReportState("error");
    }
  }

  async function handleContactSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});

    const payload = {
      firstName: contact.firstName.trim(),
      lastName: contact.lastName.trim(),
      // Accept the format the placeholder shows ("+39 333 1234567"): strip
      // spaces and common separators, keeping a leading + and the digits.
      phone: contact.phone.trim().replace(/[\s().\-/]/g, ""),
      location: contact.location,
      latitude: contact.latitude ?? undefined,
      longitude: contact.longitude ?? undefined,
      email: contact.email.trim() || undefined,
      privacyAccepted: contact.privacyAccepted as true,
    };

    const result = assessmentContactSchema.safeParse(payload);
    if (!result.success) {
      const messages: Record<string, string> = {
        firstName: "Inserisci il nome.",
        lastName: "Inserisci il cognome.",
        phone: "Inserisci un numero di telefono valido (es. +39 333 1234567).",
        location: "Seleziona un comune dalla lista.",
        latitude: "Seleziona un comune dalla lista.",
        longitude: "Seleziona un comune dalla lista.",
        email: "L'email non sembra valida.",
        privacyAccepted: "Devi accettare la privacy policy per continuare.",
      };
      const next: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = String(issue.path[0] ?? "");
        if (field && !next[field]) next[field] = messages[field] ?? "Campo non valido.";
      }
      setFieldErrors(next);
      return;
    }

    setSubmitting(true);
    try {
      const ok = await submitCommunity({ contact: result.data, assessment: answers });
      setSubmitState(ok ? "success" : "error");
      if (ok) {
        void downloadReport(`${result.data.firstName} ${result.data.lastName}`.trim());
      }
    } catch {
      setSubmitState("error");
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Intro ----
  if (phase === "intro") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[620px] flex-col items-center justify-center gap-8 px-6 py-16 text-center">
        <div className="flex flex-col items-center gap-4">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl text-3xl"
            style={{ backgroundColor: "#EEEDFE" }}
            aria-hidden="true"
          >
            🧭
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900">
            Scopri dove puoi arrivare davvero
          </h1>
          <p className="max-w-md text-lg text-neutral-600">
            In pochi minuti risponderai a domande sul tuo modo di lavorare, le tue
            esperienze e i tuoi interessi. Al termine scoprirai i tuoi punti di forza
            e potrai unirti alla community Kubri.
          </p>
        </div>
        <button
          onClick={() => { setPhase("questions"); window.scrollTo(0, 0); }}
          className="rounded-xl px-10 py-4 text-lg font-semibold text-white shadow-sm transition-colors"
          style={{ backgroundColor: "#534AB7" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#3C3489"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#534AB7"; }}
        >
          Inizia
        </button>
        <p className="text-sm text-neutral-400">Circa 8–12 minuti · nessuna risposta giusta o sbagliata</p>
      </main>
    );
  }

  // ---- Questions ----
  if (phase === "questions") {
    return (
      <div className="mx-auto min-h-dvh max-w-[620px] px-4 pb-24 pt-6">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="mb-2 flex items-center justify-between text-sm text-neutral-500">
            <span>
              Sezione {sectionIndex + 1} di {totalSections}
            </span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%`, backgroundColor: "#534AB7" }}
            />
          </div>
        </div>

        {/* Section title */}
        <h2 className="mb-6 text-2xl font-bold text-neutral-900">{currentSection.title}</h2>

        {/* Questions */}
        <div className="flex flex-col gap-4">
          {currentSection.questions.map((q) => (
            <div
              key={q.id}
              className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
            >
              <p className="mb-1 font-semibold text-neutral-900">{q.text}</p>
              {q.hint && (
                <p className="mb-4 text-sm text-neutral-500">{q.hint}</p>
              )}
              <div className="mt-3">
                <QuestionRenderer
                  question={q}
                  value={answers[q.id]}
                  onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Navigation */}
        <div className="mt-8 flex items-center justify-between gap-4">
          {!isFirstSection ? (
            <button
              onClick={handleBack}
              className="rounded-xl border border-neutral-300 px-6 py-3 font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
            >
              Indietro
            </button>
          ) : (
            <div />
          )}
          <button
            onClick={handleNext}
            className="rounded-xl px-8 py-3 font-semibold text-white shadow-sm transition-colors"
            style={{ backgroundColor: "#534AB7" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#3C3489"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#534AB7"; }}
          >
            {isLastSection ? "Completa" : "Continua"}
          </button>
        </div>
      </div>
    );
  }

  // ---- Done ----
  return (
    <main className="mx-auto min-h-dvh max-w-[620px] px-4 pb-24 pt-12">
      <div className="mb-10 text-center">
        <div
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-3xl"
          style={{ backgroundColor: "#EEEDFE" }}
          aria-hidden="true"
        >
          ✅
        </div>
        <h1 className="text-3xl font-bold text-neutral-900">Assessment completato!</h1>
        <p className="mt-2 text-neutral-600">
          Hai risposto a tutte le sezioni. Ottimo lavoro.
        </p>
        {submitState !== "success" && (
          <button
            type="button"
            onClick={handleReview}
            className="mt-3 rounded text-sm font-medium text-neutral-500 underline-offset-2 transition-colors hover:text-neutral-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#534AB7] focus-visible:ring-offset-2"
          >
            ← Rivedi le tue risposte
          </button>
        )}
      </div>

      {/* CTAs */}
      <div className="flex flex-col gap-4">
        {/* CTA 1 — Download only */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-neutral-900">Scarica il questionario</p>
              <p className="mt-0.5 text-sm text-neutral-500">Ricevi subito il tuo report PDF delle competenze.</p>
            </div>
            <button
              onClick={() => downloadReport()}
              disabled={reportState === "loading"}
              className="shrink-0 rounded-xl border border-[#534AB7] px-5 py-2.5 text-sm font-medium text-[#534AB7] transition-colors hover:bg-[#EEEDFE] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {reportState === "loading" ? "Generazione…" : "Scarica PDF"}
            </button>
          </div>
          {reportState === "error" && (
            <p className="mt-3 text-sm text-red-600">Qualcosa è andato storto. Riprova tra qualche secondo.</p>
          )}
        </div>

        {/* CTA 2 — Join community */}
        <div
          className="rounded-2xl border-2 p-5"
          style={{ borderColor: "#534AB7", backgroundColor: "#EEEDFE" }}
        >
          <p className="font-semibold text-neutral-900">
            Scarica il questionario e unisciti alla community
          </p>
          <p className="mt-1 text-sm text-neutral-600">
            Entra nella rete Kubri e vieni scoperto da aziende in cerca di talenti.
          </p>
          {!showForm && submitState === "idle" && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 w-full rounded-xl py-3 font-semibold text-white transition-colors"
              style={{ backgroundColor: "#534AB7" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#3C3489"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#534AB7"; }}
            >
              Unisciti alla community →
            </button>
          )}

          {/* Success state */}
          {submitState === "success" && (
            <div className="mt-4 rounded-xl bg-green-50 p-4 text-center">
              <p className="font-semibold text-green-700">Grazie! Sei nella community.</p>
              <p className="mt-1 text-sm text-green-600">
                Ti contatteremo presto con opportunità su misura per te.
              </p>
            </div>
          )}

          {/* Contact form */}
          {showForm && submitState !== "success" && (
            <form onSubmit={handleContactSubmit} noValidate className="mt-5 flex flex-col gap-4">
              <p className="text-sm text-neutral-700">
                Se ti va di entrare nella nostra community per scoprire come
                valorizzare le tue competenze ed entrare in contatto con una rete
                di aziende in cerca di talenti, lasciaci i tuoi dati.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-neutral-700">
                    Nome <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={contact.firstName}
                    onChange={(e) => setContact((c) => ({ ...c, firstName: e.target.value }))}
                    placeholder="Mario"
                    aria-invalid={!!fieldErrors.firstName}
                    className={`rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#534AB7]/20 ${
                      fieldErrors.firstName ? "border-red-400 focus:border-red-500" : "border-neutral-300 focus:border-[#534AB7]"
                    }`}
                    required
                  />
                  {fieldErrors.firstName && (
                    <p className="text-xs text-red-600">{fieldErrors.firstName}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-neutral-700">
                    Cognome <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={contact.lastName}
                    onChange={(e) => setContact((c) => ({ ...c, lastName: e.target.value }))}
                    placeholder="Rossi"
                    aria-invalid={!!fieldErrors.lastName}
                    className={`rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#534AB7]/20 ${
                      fieldErrors.lastName ? "border-red-400 focus:border-red-500" : "border-neutral-300 focus:border-[#534AB7]"
                    }`}
                    required
                  />
                  {fieldErrors.lastName && (
                    <p className="text-xs text-red-600">{fieldErrors.lastName}</p>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-neutral-700">
                  Telefono <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={contact.phone}
                  onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
                  placeholder="+39 333 1234567"
                  aria-invalid={!!fieldErrors.phone}
                  className={`rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#534AB7]/20 ${
                    fieldErrors.phone ? "border-red-400 focus:border-red-500" : "border-neutral-300 focus:border-[#534AB7]"
                  }`}
                  required
                />
                {fieldErrors.phone && (
                  <p className="text-xs text-red-600">{fieldErrors.phone}</p>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-neutral-700">
                  Comune di residenza <span className="text-red-500">*</span>
                </label>
                <ComuneSelect
                  value={contact.location}
                  error={!!(fieldErrors.location || fieldErrors.latitude || fieldErrors.longitude)}
                  onSelect={(c: Comune) =>
                    setContact((s) => ({
                      ...s,
                      location: comuneLabel(c),
                      latitude: c.lat,
                      longitude: c.lon,
                    }))
                  }
                  onClear={() =>
                    setContact((s) => ({ ...s, location: "", latitude: null, longitude: null }))
                  }
                />
                {(fieldErrors.location || fieldErrors.latitude || fieldErrors.longitude) && (
                  <p className="text-xs text-red-600">
                    {fieldErrors.location || fieldErrors.latitude || fieldErrors.longitude}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-neutral-700">
                  Email <span className="text-neutral-400">(opzionale)</span>
                </label>
                <input
                  type="email"
                  value={contact.email}
                  onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
                  placeholder="mario@esempio.it"
                  aria-invalid={!!fieldErrors.email}
                  className={`rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#534AB7]/20 ${
                    fieldErrors.email ? "border-red-400 focus:border-red-500" : "border-neutral-300 focus:border-[#534AB7]"
                  }`}
                />
                {fieldErrors.email && (
                  <p className="text-xs text-red-600">{fieldErrors.email}</p>
                )}
              </div>

              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={contact.privacyAccepted}
                  onChange={(e) => setContact((c) => ({ ...c, privacyAccepted: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 accent-[#534AB7]"
                  required
                />
                <span className="text-sm text-neutral-700">
                  Accetto la{" "}
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    style={{ color: "#534AB7" }}
                  >
                    privacy policy
                  </a>{" "}
                  <span className="text-red-500">*</span>
                </span>
              </label>
              {fieldErrors.privacyAccepted && (
                <p className="text-xs text-red-600">{fieldErrors.privacyAccepted}</p>
              )}

              <p className="text-xs text-neutral-500">no spam promesso!</p>

              {submitState === "error" && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  Qualcosa è andato storto. Riprova tra qualche secondo.
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-1 w-full rounded-xl py-3 font-semibold text-white transition-colors disabled:opacity-60"
                style={{ backgroundColor: "#534AB7" }}
                onMouseEnter={(e) => {
                  if (!submitting) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#3C3489";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#534AB7";
                }}
              >
                {submitting ? "Invio in corso…" : "Invia"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
