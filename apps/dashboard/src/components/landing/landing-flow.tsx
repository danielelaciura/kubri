"use client";

import { useCallback, useRef, useState } from "react";
import { FileUp, MessageCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/provider";
import type { LandingErrorCode } from "@/lib/landing/flow";
import type { ContactPrefill } from "@/lib/landing/contact";
import {
  confirmLandingImportAction,
  registerLandingUploadAction,
  requestLandingUploadAction,
  runLandingExtractionAction,
} from "@/app/(public)/candidati/[slug]/actions";
import { ContactForm, type ContactSubmission } from "./contact-form";
import { TurnstileWidget } from "./turnstile-widget";

const ACCEPT =
  ".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".jpg", ".jpeg", ".png"];
const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = "candidate-documents";
/** IN_PROGRESS (another request is extracting): poll every 4 s, ~60 s in all. */
const POLL_INTERVAL_MS = 4000;
const POLL_ATTEMPTS = 15;

type Step =
  | { kind: "choose" }
  | { kind: "upload" }
  | { kind: "working"; label: "uploading" | "reading" }
  | { kind: "contact"; prefill: ContactPrefill }
  | { kind: "done" };

type ErrorKey = "busy" | "badFile" | "notCv" | "generic" | "expired";

/** Generic on purpose: never tell an abuser which check fired. */
function errorKey(code: LandingErrorCode): ErrorKey {
  switch (code) {
    case "CAPTCHA_FAILED":
    case "RATE_LIMITED":
    case "BUDGET_EXHAUSTED":
    case "UNAVAILABLE":
      return "busy";
    case "FILE_TOO_LARGE":
    case "UNSUPPORTED_TYPE":
    case "REJECTED_FILE":
      return "badFile";
    case "FILE_UNREADABLE":
    case "NO_TEXT":
    case "NOT_A_CV":
      return "notCv";
    case "SESSION_EXPIRED":
    case "NOT_FOUND":
      return "expired";
    // IN_PROGRESS only reaches here once polling has given up.
    case "IN_PROGRESS":
    default:
      return "generic";
  }
}

const RETRYABLE_EXTRACTION: ReadonlySet<LandingErrorCode> = new Set<LandingErrorCode>([
  "LLM_TIMEOUT",
  "LLM_ERROR",
  "INTERNAL_ERROR",
  "IN_PROGRESS",
]);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface LandingFlowProps {
  slug: string;
  locale: string;
  orgName: string;
  waLink: string | null;
  privacyPolicyUrl: string;
  showShare: boolean;
  turnstileSiteKey: string;
}

export function LandingFlow(props: LandingFlowProps) {
  const t = useT().landing;
  const org = (s: string) => s.replace("{org}", props.orgName);
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [error, setError] = useState<ErrorKey | null>(null);
  const [canRetryExtraction, setCanRetryExtraction] = useState(false);
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileKey, setTurnstileKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const onToken = useCallback((token: string) => setTurnstileToken(token), []);

  function showError(code: LandingErrorCode, back: Step) {
    const key = errorKey(code);
    setError(key);
    setCanRetryExtraction(RETRYABLE_EXTRACTION.has(code));
    setStep(key === "expired" ? { kind: "upload" } : back);
  }

  async function extract() {
    setError(null);
    setCanRetryExtraction(false);
    setStep({ kind: "working", label: "reading" });
    try {
      // First call, then up to POLL_ATTEMPTS more while another request extracts.
      for (let attempt = 0; attempt <= POLL_ATTEMPTS; attempt++) {
        if (attempt > 0) await wait(POLL_INTERVAL_MS);
        const r = await runLandingExtractionAction(props.slug);
        if (r.ok) return setStep({ kind: "contact", prefill: r.data });
        if (r.error !== "IN_PROGRESS") return showError(r.error, { kind: "upload" });
      }
      showError("IN_PROGRESS", { kind: "upload" });
    } catch {
      showError("INTERNAL_ERROR", { kind: "upload" });
    }
  }

  async function upload(file: File) {
    setError(null);
    setCanRetryExtraction(false);
    if (!ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext)) || file.size > MAX_BYTES) {
      setError("badFile");
      return;
    }
    setStep({ kind: "working", label: "uploading" });
    try {
      const ticket = await requestLandingUploadAction(props.slug, {
        fileName: file.name,
        fileSize: file.size,
        turnstileToken,
      });
      // Turnstile tokens are single-use: get a fresh one for any next attempt.
      setTurnstileToken("");
      setTurnstileKey((k) => k + 1);
      if (!ticket.ok) return showError(ticket.error, { kind: "upload" });

      // Straight to Storage: Vercel caps request bodies at 4.5 MB.
      const { error: upErr } = await createSupabaseBrowserClient()
        .storage.from(BUCKET)
        .uploadToSignedUrl(ticket.data.storagePath, ticket.data.token, file, {
          contentType: file.type || undefined,
        });
      if (upErr) return showError("STORAGE_ERROR", { kind: "upload" });

      const reg = await registerLandingUploadAction(props.slug, file.name);
      if (!reg.ok) return showError(reg.error, { kind: "upload" });
    } catch {
      return showError("INTERNAL_ERROR", { kind: "upload" });
    }
    await extract();
  }

  async function confirm(values: ContactSubmission, prefill: ContactPrefill) {
    setBusy(true);
    setError(null);
    try {
      const r = await confirmLandingImportAction(props.slug, values);
      if (r.ok) setStep({ kind: "done" });
      else showError(r.error, { kind: "contact", prefill });
    } catch {
      showError("INTERNAL_ERROR", { kind: "contact", prefill });
    } finally {
      setBusy(false);
    }
  }

  // A real link styled as a button (base-ui Button would add role="button").
  const whatsappButton = props.waLink && (
    <a href={props.waLink} target="_blank" rel="noreferrer" className={buttonVariants({ className: "w-full" })}>
      <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
      {t.whatsappCta}
    </a>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p>{t.errors[error]}</p>
          {canRetryExtraction && (
            <Button size="sm" variant="outline" onClick={() => void extract()}>{t.retry}</Button>
          )}
          {props.waLink && (error === "busy" || error === "notCv" || error === "generic") && (
            <a href={props.waLink} target="_blank" rel="noreferrer" className="block underline">
              {t.orWhatsapp}
            </a>
          )}
        </div>
      )}

      {step.kind === "choose" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {props.waLink && (
            <Card>
              <CardHeader><CardTitle>{t.whatsappTitle}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{t.whatsappBody}</p>
                {whatsappButton}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>{t.uploadTitle}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{org(t.uploadBody)}</p>
              <Button variant="outline" className="w-full" onClick={() => setStep({ kind: "upload" })}>
                <FileUp className="mr-2 h-4 w-4" aria-hidden="true" />
                {t.uploadCta}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {step.kind === "upload" && (
        <Card>
          <CardHeader><CardTitle>{t.uploadTitle}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center">
              <FileUp className="h-10 w-10 text-muted-foreground/60" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">{t.dropzoneHint}</p>
              <input
                ref={inputRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}
              />
              <Button type="button" onClick={() => inputRef.current?.click()}>{t.chooseFile}</Button>
            </div>
            <TurnstileWidget
              key={turnstileKey} siteKey={props.turnstileSiteKey} locale={props.locale} onToken={onToken}
            />
            <Button variant="ghost" onClick={() => { setError(null); setStep({ kind: "choose" }); }}>
              {t.back}
            </Button>
          </CardContent>
        </Card>
      )}

      {step.kind === "working" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Spinner aria-label={step.label === "reading" ? t.reading : t.uploading} />
            <p className="font-medium">{step.label === "reading" ? t.reading : t.uploading}</p>
            {step.label === "reading" && <p className="text-sm text-muted-foreground">{t.readingHint}</p>}
          </CardContent>
        </Card>
      )}

      {step.kind === "contact" && (
        <Card>
          <CardHeader><CardTitle>{t.contactTitle}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{org(t.contactBody)}</p>
            <ContactForm
              orgName={props.orgName} prefill={step.prefill} privacyPolicyUrl={props.privacyPolicyUrl}
              showShare={props.showShare} busy={busy}
              onSubmit={(values) => void confirm(values, step.prefill)}
            />
          </CardContent>
        </Card>
      )}

      {step.kind === "done" && (
        <Card>
          <CardContent className="space-y-2 py-12 text-center">
            <p className="text-xl font-medium">{t.doneTitle}</p>
            <p className="text-muted-foreground">{org(t.doneBody)}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
