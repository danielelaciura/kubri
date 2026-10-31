"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, MessageCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/provider";
import type { LandingErrorCode, LandingResult } from "@/lib/landing/flow";
import type { LandingPrefill } from "@/lib/landing/contact";
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
/** Give up waiting for a Turnstile token after this long (blocked script, network). */
const CAPTCHA_TIMEOUT_MS = 15_000;

type Step =
  | { kind: "choose" }
  // Turnstile first, as its own step: the visitor sees why they wait.
  | { kind: "verify" }
  | { kind: "upload" }
  | { kind: "working"; label: "uploading" | "reading" }
  | { kind: "contact"; prefill: LandingPrefill }
  | { kind: "done" };

type ErrorKey = "busy" | "badFile" | "notCv" | "generic" | "expired" | "verifyFailed" | "placeInvalid";

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
    case "PLACE_INVALID":
      return "placeInvalid";
    // IN_PROGRESS only reaches here once polling has given up.
    case "IN_PROGRESS":
    default:
      return "generic";
  }
}

/** Extraction failures worth retrying in place (no re-upload). */
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
  const [placeResetKey, setPlaceResetKey] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileKey, setTurnstileKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const firstRender = useRef(true);
  const [captchaFailed, setCaptchaFailed] = useState(false);
  const captchaFailedRef = useRef(false);
  useEffect(() => {
    captchaFailedRef.current = captchaFailed;
  }, [captchaFailed]);
  // Cloudflare is showing its checkbox: the visitor may take a while, no timeout.
  const [captchaInteractive, setCaptchaInteractive] = useState(false);
  const onToken = useCallback((token: string) => {
    setTurnstileToken(token);
    // A late token (after the timeout fired) means Turnstile works after all.
    if (token && captchaFailedRef.current) {
      setCaptchaFailed(false);
      setError((current) => (current === "verifyFailed" ? null : current));
    }
  }, []);
  const onCaptchaInteractive = useCallback(() => setCaptchaInteractive(true), []);
  // Turnstile starts in the background on the choose step; a failure there
  // stays silent until the visitor opens the verify step.
  const stepKindRef = useRef(step.kind);
  useEffect(() => {
    stepKindRef.current = step.kind;
  });
  // Turnstile unusable: say so (with the WhatsApp fallback); upload stays out of reach.
  const onCaptchaError = useCallback(() => {
    setCaptchaFailed(true);
    if (stepKindRef.current !== "verify") return;
    setCanRetryExtraction(false);
    setError("verifyFailed");
  }, []);
  const retryCaptcha = () => {
    setCaptchaFailed(false);
    setError(null);
    setTurnstileKey((k) => k + 1);
  };

  // Without a site key (local dev) the server accepts the empty token.
  const waitingForCaptcha = Boolean(props.turnstileSiteKey) && !turnstileToken;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Entering the verify step after a failure (in the background, or Back → upload)
  // gives Turnstile a fresh start with a new widget.
  useEffect(() => {
    if (step.kind !== "verify" || !captchaFailedRef.current) return;
    setCaptchaFailed(false);
    setTurnstileKey((k) => k + 1);
  }, [step.kind]);

  // A token moves the visitor on to the upload; an expired one sends them back.
  useEffect(() => {
    if (step.kind === "verify" && !waitingForCaptcha) setStep({ kind: "upload" });
    else if (step.kind === "upload" && waitingForCaptcha) setStep({ kind: "verify" });
  }, [step.kind, waitingForCaptcha]);

  // Each new widget (fresh mount after an upload attempt) starts non-interactive.
  useEffect(() => {
    setCaptchaInteractive(false);
  }, [turnstileKey]);

  // No token in time on the verify step: treat it like a Turnstile failure —
  // unless Cloudflare is waiting for the visitor to tick its checkbox.
  useEffect(() => {
    if (step.kind !== "verify" || !waitingForCaptcha || captchaFailed || captchaInteractive) return;
    const timer = setTimeout(onCaptchaError, CAPTCHA_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [step.kind, waitingForCaptcha, captchaFailed, captchaInteractive, onCaptchaError]);

  // Move focus to the new step's heading, or to the alert when an error shows.
  // Not on first render: don't steal focus on page load.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    (error ? alertRef.current : headingRef.current)?.focus();
  }, [step.kind, error]);

  /**
   * `back` is the step to show (null = stay, e.g. keep the contact form with
   * the typed values). Retry is offered only for extraction failures.
   */
  function showError(code: LandingErrorCode, back: Step | null, opts: { retryExtraction: boolean }) {
    const key = errorKey(code);
    setError(key);
    setCanRetryExtraction(opts.retryExtraction && RETRYABLE_EXTRACTION.has(code));
    if (key === "expired") setStep({ kind: "verify" });
    else if (back) setStep(back);
  }

  async function extract() {
    setError(null);
    setCanRetryExtraction(false);
    setStep({ kind: "working", label: "reading" });
    // Back to verify: a new file needs a new (single-use) Turnstile token.
    const fail = (code: LandingErrorCode) => showError(code, { kind: "verify" }, { retryExtraction: true });
    try {
      // First call, then up to POLL_ATTEMPTS more while another request extracts.
      for (let attempt = 0; attempt <= POLL_ATTEMPTS; attempt++) {
        if (attempt > 0) await wait(POLL_INTERVAL_MS);
        if (!mounted.current) return;
        const r = await runLandingExtractionAction(props.slug);
        if (!mounted.current) return;
        if (r.ok) return setStep({ kind: "contact", prefill: r.data });
        if (r.error !== "IN_PROGRESS") return fail(r.error);
      }
      fail("IN_PROGRESS");
    } catch {
      if (mounted.current) fail("INTERNAL_ERROR");
    }
  }

  async function upload(file: File) {
    if (waitingForCaptcha) return;
    setError(null);
    setCanRetryExtraction(false);
    const fail = (code: LandingErrorCode) => showError(code, { kind: "verify" }, { retryExtraction: false });
    if (!ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext)) || file.size > MAX_BYTES) {
      setError("badFile");
      return;
    }
    setStep({ kind: "working", label: "uploading" });
    try {
      let ticket: LandingResult<{ storagePath: string; token: string }>;
      try {
        ticket = await requestLandingUploadAction(props.slug, {
          fileName: file.name,
          fileSize: file.size,
          turnstileToken,
        });
      } finally {
        // Turnstile tokens are single-use, even when the request throws:
        // get a fresh one for any next attempt.
        setTurnstileToken("");
        setTurnstileKey((k) => k + 1);
      }
      if (!ticket.ok) return fail(ticket.error);

      // Straight to Storage: Vercel caps request bodies at 4.5 MB.
      const { error: upErr } = await createSupabaseBrowserClient()
        .storage.from(BUCKET)
        .uploadToSignedUrl(ticket.data.storagePath, ticket.data.token, file, {
          contentType: file.type || undefined,
        });
      if (upErr) return fail("STORAGE_ERROR");

      const reg = await registerLandingUploadAction(props.slug, file.name);
      if (!reg.ok) return fail(reg.error);
    } catch {
      return fail("INTERNAL_ERROR");
    }
    await extract();
  }

  async function confirm(values: ContactSubmission) {
    // The error (if any) is replaced only when the result arrives, so focus
    // doesn't jump. On failure stay on the form (null): the typed values
    // survive and the candidate resubmits with the form's own button.
    setBusy(true);
    try {
      const r = await confirmLandingImportAction(props.slug, values);
      if (r.ok) {
        setError(null);
        setStep({ kind: "done" });
      } else {
        if (r.error === "PLACE_INVALID") setPlaceResetKey((k) => k + 1);
        showError(r.error, null, { retryExtraction: false });
      }
    } catch {
      showError("INTERNAL_ERROR", null, { retryExtraction: false });
    } finally {
      setBusy(false);
    }
  }

  const workingText = step.kind === "working" ? (step.label === "reading" ? t.reading : t.uploading) : "";
  const headingClass = "outline-none";

  // A real link styled as a button (base-ui Button would add role="button").
  const whatsappButton = props.waLink && (
    <a href={props.waLink} target="_blank" rel="noreferrer" className={buttonVariants({ className: "w-full" })}>
      <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
      {t.whatsappCta}
    </a>
  );

  return (
    <div className="space-y-4">
      {/* Always mounted so screen readers announce progress changes. */}
      <p role="status" aria-live="polite" className="sr-only">{workingText}</p>

      {error && (
        <div
          ref={alertRef} tabIndex={-1} role="alert"
          className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm outline-none"
        >
          <p>{t.errors[error]}</p>
          {canRetryExtraction && (
            <Button size="sm" variant="outline" onClick={() => void extract()}>{t.retry}</Button>
          )}
          {props.waLink && (error === "busy" || error === "notCv" || error === "generic" || error === "verifyFailed") && (
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
              <CardHeader>
                <CardTitle ref={headingRef} tabIndex={-1} className={headingClass}>{t.whatsappTitle}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{t.whatsappBody}</p>
                {whatsappButton}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              {props.waLink ? (
                <CardTitle>{t.uploadTitle}</CardTitle>
              ) : (
                <CardTitle ref={headingRef} tabIndex={-1} className={headingClass}>{t.uploadTitle}</CardTitle>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{org(t.uploadBody)}</p>
              <Button variant="outline" className="w-full" onClick={() => setStep({ kind: "verify" })}>
                <FileUp className="mr-2 h-4 w-4" aria-hidden="true" />
                {t.uploadCta}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {(step.kind === "choose" || step.kind === "verify" || step.kind === "upload") && (
        // Mounted (hidden) from the choose step so the check runs while the visitor
        // reads the page, and on the upload step so Turnstile can report an
        // expired token, which brings the visitor back here.
        <div hidden={step.kind !== "verify"}>
          <Card>
            <CardHeader>
              {step.kind === "verify" ? (
                <CardTitle ref={headingRef} tabIndex={-1} className={headingClass}>{t.verifyTitle}</CardTitle>
              ) : (
                <CardTitle>{t.verifyTitle}</CardTitle>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{t.verifyBody}</p>
              {/* Reserve the widget's height so the card doesn't jump while the script loads. */}
              <div className="flex min-h-[65px] items-center justify-center">
                <TurnstileWidget
                  key={turnstileKey} siteKey={props.turnstileSiteKey} locale={props.locale} onToken={onToken}
                  onError={onCaptchaError} onInteractive={onCaptchaInteractive}
                  placeholder={
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Spinner aria-hidden="true" role={undefined} />
                      {t.verifyLoading}
                    </p>
                  }
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => { setError(null); setStep({ kind: "choose" }); }}>
                  {t.back}
                </Button>
                {captchaFailed && (
                  <Button variant="outline" onClick={retryCaptcha}>{t.verifyRetry}</Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step.kind === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle ref={headingRef} tabIndex={-1} className={headingClass}>{t.uploadTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center">
              <FileUp className="h-10 w-10 text-muted-foreground/60" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">{t.dropzoneHint}</p>
              <input
                ref={inputRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}
              />
              <Button type="button" disabled={waitingForCaptcha} onClick={() => inputRef.current?.click()}>
                {t.chooseFile}
              </Button>
            </div>
            <Button variant="ghost" onClick={() => { setError(null); setStep({ kind: "choose" }); }}>
              {t.back}
            </Button>
          </CardContent>
        </Card>
      )}

      {step.kind === "working" && (
        // Focus lands on the card; the always-mounted status region announces the text.
        <Card ref={headingRef} tabIndex={-1} className={headingClass}>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Spinner aria-hidden="true" role={undefined} />
            <p aria-hidden="true" className="font-medium">{workingText}</p>
            {step.label === "reading" && <p className="text-sm text-muted-foreground">{t.readingHint}</p>}
          </CardContent>
        </Card>
      )}

      {step.kind === "contact" && (
        <Card>
          <CardHeader>
            <CardTitle ref={headingRef} tabIndex={-1} className={headingClass}>{t.contactTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{org(t.contactBody)}</p>
            <ContactForm
              slug={props.slug} orgName={props.orgName} prefill={step.prefill} privacyPolicyUrl={props.privacyPolicyUrl}
              showShare={props.showShare} busy={busy} placeResetKey={placeResetKey}
              onSubmit={(values) => void confirm(values)}
            />
          </CardContent>
        </Card>
      )}

      {step.kind === "done" && (
        <Card>
          <CardContent className="space-y-2 py-12 text-center">
            <p ref={headingRef} tabIndex={-1} className={`text-xl font-medium ${headingClass}`}>{t.doneTitle}</p>
            <p className="text-muted-foreground">{org(t.doneBody)}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
