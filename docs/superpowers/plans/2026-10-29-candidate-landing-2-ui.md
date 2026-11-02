# Candidate Landing — Plan 2: UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The public page `/candidati/[slug]` (WhatsApp or CV upload → contact confirmation → thank you), the `ADMIN_KUBRI` card that configures it, and the landing link/QR on the organization's "QR code" page.

**Architecture:** Thin `"use server"` actions in `src/app/(public)/candidati/[slug]/actions.ts` read the client IP and the signed import cookie, call `src/lib/landing/flow.ts` (Plan 1), and set/clear the cookie. The page is a Server Component that resolves the landing (404 otherwise) and the locale, then renders a Client Component state machine under its own `<I18nProvider>`. Uploads go browser → Supabase Storage with the signed token, as in the operator flow. Turnstile is loaded from Cloudflare's script, no npm dependency.

**Tech Stack:** Next.js 16 App Router (Server Components, server actions, `next/script`), React 19, Tailwind + shadcn/ui, `@supabase/ssr` browser client, `qrcode.react`, vitest + Testing Library where useful.

**Prerequisite:** Plan 1 (`2026-10-29-candidate-landing-1-backend.md`) fully executed on this branch.

**Spec:** `docs/superpowers/specs/2026-10-29-candidate-landing-cv-upload-design.md`

---

## Conventions for every task

- Commands run from `apps/dashboard/`. Single test file: `pnpm exec vitest run <path>`.
- Every user-visible string goes through the dictionaries (`it.ts` + `en.ts`, key-for-key). Client Components use `useT()`; they render under an `<I18nProvider>` (the admin/dashboard shells provide one; the public page renders its own).
- Don't re-export types from a `"use server"` file (Turbopack treats them as runtime exports). Import shared types from `@/lib/landing/flow`.
- Never log personal data (names, phones, CV text). Log codes and messages only.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/i18n/dictionaries/{it,en}.ts` | modify | `landing.*` (public) and `landingAdmin.*` (admin + QR page) |
| `src/lib/landing/locale.ts` | create | `resolvePublicLocale` |
| `src/app/(public)/candidati/[slug]/actions.ts` | create | server actions: request / register / extract / confirm |
| `src/components/landing/turnstile-widget.tsx` | create | explicit-render Turnstile widget |
| `src/components/landing/landing-flow.tsx` | create | client state machine (choose → upload → reading → contact → done) |
| `src/components/landing/contact-form.tsx` | create | minimal confirmation form |
| `src/app/(public)/candidati/[slug]/page.tsx` | create | landing Server Component, metadata, `maxDuration` |
| `src/components/landing/landing-qr-dialog.tsx` | create | link + QR + copy + PNG download |
| `src/app/(admin)/admin/organizations/[id]/page.tsx` | modify | "Landing candidati" card + save action |
| `src/app/(dashboard)/dashboard/qr-codes/page.tsx` | modify | landing link/QR section |
| `CLAUDE.md` (repo root) | modify | new write path + public prefix |

---

### Task 1: Dictionaries

**Files:**
- Modify: `src/lib/i18n/dictionaries/it.ts`, `src/lib/i18n/dictionaries/en.ts`

- [ ] **Step 1: Add the `landing` group**

In `it.ts`, add a top-level group after `candidateCreate: { … },`:

```ts
  landing: {
    metaTitle: "Candidati con {org}",
    intro: "Stai cercando lavoro? Candidati con {org} in due modi.",
    whatsappTitle: "Fai il colloquio su WhatsApp",
    whatsappBody: "Rispondi a qualche domanda in chat, anche con messaggi vocali, nella tua lingua.",
    whatsappCta: "Apri WhatsApp",
    uploadTitle: "Hai già un curriculum?",
    uploadBody: "Caricalo qui: leggiamo noi i dati e li inviamo a {org}.",
    uploadCta: "Carica il tuo CV",
    dropzoneHint: "PDF, Word o foto · massimo 5 MB",
    chooseFile: "Scegli file",
    uploading: "Caricamento…",
    reading: "Stiamo leggendo il tuo CV…",
    readingHint: "Ci vuole meno di un minuto. Non chiudere la pagina.",
    contactTitle: "Controlla i tuoi dati",
    contactBody: "Li abbiamo letti dal CV. Correggili se serve: servono a {org} per contattarti.",
    firstName: "Nome",
    lastName: "Cognome",
    phone: "Telefono",
    email: "Email (facoltativa)",
    privacyLabel: "Ho letto l'informativa privacy e acconsento al trattamento dei miei dati da parte di {org}.",
    privacyLink: "Leggi l'informativa",
    shareLabel: "Acconsento a essere visibile anche ad altre aziende che usano Kubri.",
    submit: "Invia candidatura",
    submitting: "Invio…",
    doneTitle: "Grazie!",
    doneBody: "Abbiamo ricevuto la tua candidatura. {org} ti contatterà se il tuo profilo è adatto.",
    back: "Indietro",
    startOver: "Ricomincia",
    retry: "Riprova",
    orWhatsapp: "Oppure fai il colloquio su WhatsApp",
    languageLabel: "Lingua",
    fieldRequired: "Campo obbligatorio",
    phoneInvalid: "Numero di telefono non valido",
    emailInvalid: "Email non valida",
    privacyRequired: "Serve il consenso per inviare la candidatura",
    errors: {
      busy: "Troppi tentativi in questo momento. Riprova più tardi.",
      badFile: "Possiamo leggere solo PDF, Word o foto fino a 5 MB.",
      notCv: "Non riusciamo a leggere un curriculum in questo file.",
      generic: "Qualcosa è andato storto. Riprova.",
      expired: "La sessione è scaduta. Ricomincia dal caricamento del CV.",
    },
  },
  landingAdmin: {
    cardTitle: "Landing candidati",
    cardDescription: "Pagina pubblica dove i candidati scelgono tra il colloquio WhatsApp e il caricamento del CV.",
    slug: "Indirizzo (slug)",
    slugHint: "Lettere minuscole, numeri e trattini. Es. coop-sole",
    pool: "Pool di destinazione",
    noEligiblePools: "Aggancia prima un pool non globale a questa organizzazione.",
    privacyPolicyUrl: "URL informativa privacy (https)",
    enabled: "Pagina attiva",
    save: "Salva landing",
    publicLink: "Link pubblico",
    disabled: "Disattivata",
    showQr: "QR landing",
    qrTitle: "QR landing — {name}",
    qrDescription: "Inquadra il QR per aprire la pagina di candidatura.",
    copyLink: "Copia link",
    copied: "Copiato!",
    downloadPng: "Scarica PNG",
    qrPageTitle: "Pagina di candidatura",
    qrPageDescription: "Condividi questo link o QR: i candidati scelgono tra WhatsApp e il caricamento del CV.",
    errors: {
      INVALID_POOL: "Il pool scelto non è agganciato o è globale.",
      SLUG_TAKEN: "Questo indirizzo è già usato da un'altra organizzazione.",
      VALIDATION: "Controlla slug e URL dell'informativa (deve iniziare con https://).",
    },
  },
```

In `en.ts`, the same keys:

```ts
  landing: {
    metaTitle: "Apply with {org}",
    intro: "Looking for work? Apply with {org} in two ways.",
    whatsappTitle: "Do the interview on WhatsApp",
    whatsappBody: "Answer a few questions in chat, voice messages too, in your language.",
    whatsappCta: "Open WhatsApp",
    uploadTitle: "Already have a CV?",
    uploadBody: "Upload it here: we read your details and send them to {org}.",
    uploadCta: "Upload your CV",
    dropzoneHint: "PDF, Word or photo · up to 5 MB",
    chooseFile: "Choose file",
    uploading: "Uploading…",
    reading: "Reading your CV…",
    readingHint: "It takes less than a minute. Please keep this page open.",
    contactTitle: "Check your details",
    contactBody: "We read them from your CV. Fix them if needed: {org} uses them to contact you.",
    firstName: "First name",
    lastName: "Last name",
    phone: "Phone",
    email: "Email (optional)",
    privacyLabel: "I have read the privacy notice and consent to {org} processing my data.",
    privacyLink: "Read the privacy notice",
    shareLabel: "I agree to be visible to other companies using Kubri too.",
    submit: "Send application",
    submitting: "Sending…",
    doneTitle: "Thank you!",
    doneBody: "We received your application. {org} will contact you if your profile is a fit.",
    back: "Back",
    startOver: "Start over",
    retry: "Try again",
    orWhatsapp: "Or do the interview on WhatsApp",
    languageLabel: "Language",
    fieldRequired: "Required field",
    phoneInvalid: "Invalid phone number",
    emailInvalid: "Invalid email",
    privacyRequired: "Consent is needed to send the application",
    errors: {
      busy: "Too many attempts right now. Please try again later.",
      badFile: "We can only read PDF, Word or photos up to 5 MB.",
      notCv: "We can't read a CV in this file.",
      generic: "Something went wrong. Please try again.",
      expired: "Your session expired. Start again from the CV upload.",
    },
  },
  landingAdmin: {
    cardTitle: "Candidate landing",
    cardDescription: "Public page where candidates choose between the WhatsApp interview and uploading a CV.",
    slug: "Address (slug)",
    slugHint: "Lowercase letters, digits and dashes. E.g. coop-sole",
    pool: "Target pool",
    noEligiblePools: "First attach a non-global pool to this organization.",
    privacyPolicyUrl: "Privacy notice URL (https)",
    enabled: "Page enabled",
    save: "Save landing",
    publicLink: "Public link",
    disabled: "Disabled",
    showQr: "Landing QR",
    qrTitle: "Landing QR — {name}",
    qrDescription: "Scan the QR to open the application page.",
    copyLink: "Copy link",
    copied: "Copied!",
    downloadPng: "Download PNG",
    qrPageTitle: "Application page",
    qrPageDescription: "Share this link or QR: candidates choose between WhatsApp and uploading a CV.",
    errors: {
      INVALID_POOL: "The selected pool is not attached or is global.",
      SLUG_TAKEN: "This address is already used by another organization.",
      VALIDATION: "Check the slug and the privacy notice URL (it must start with https://).",
    },
  },
```

- [ ] **Step 2: Run the parity test and typecheck**

Run: `pnpm exec vitest run src/lib/i18n && pnpm exec tsc --noEmit -p .`
Expected: PASS; tsc exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n/dictionaries
git commit -m "feat(i18n): strings for the candidate landing and its admin card"
```

---

### Task 2: Public locale resolution

**Files:**
- Create: `src/lib/landing/locale.ts`
- Test: `src/__tests__/lib/landing/locale.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolvePublicLocale } from "@/lib/landing/locale";

describe("resolvePublicLocale", () => {
  it("prefers an explicit ?lang", () => {
    expect(resolvePublicLocale("en", "it-IT,it;q=0.9")).toBe("en");
    expect(resolvePublicLocale(["it", "en"], "en-US")).toBe("it");
  });
  it("falls back to an English browser", () => {
    expect(resolvePublicLocale(undefined, "en-GB,en;q=0.9")).toBe("en");
  });
  it("defaults to Italian otherwise", () => {
    expect(resolvePublicLocale(undefined, "fr-FR,fr;q=0.9")).toBe("it");
    expect(resolvePublicLocale("de", null)).toBe("it");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/__tests__/lib/landing/locale.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/landing/locale.ts`:

```ts
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";

/**
 * Locale for the public landing, which has no user: `?lang=` wins, then an
 * English browser gets English, everyone else the default (Italian).
 */
export function resolvePublicLocale(
  lang: string | string[] | undefined,
  acceptLanguage: string | null,
): Locale {
  const requested = Array.isArray(lang) ? lang[0] : lang;
  if (isLocale(requested)) return requested;
  const first = acceptLanguage?.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return first === "en" ? "en" : DEFAULT_LOCALE;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/__tests__/lib/landing/locale.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/locale.ts src/__tests__/lib/landing/locale.test.ts
git commit -m "feat(landing): public locale resolution"
```

---

### Task 3: Public server actions

**Files:**
- Create: `src/app/(public)/candidati/[slug]/actions.ts`
- Test: `src/__tests__/app/candidati/actions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const cookieJar = new Map<string, string>();
const cookieStore = {
  get: vi.fn((name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined)),
  set: vi.fn((name: string, value: string) => void cookieJar.set(name, value)),
  delete: vi.fn((name: string) => void cookieJar.delete(name)),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })),
}));
vi.mock("@/lib/landing/service", () => ({ getActiveLandingBySlug: vi.fn() }));
vi.mock("@/lib/landing/flow", () => ({
  requestLandingUpload: vi.fn(),
  registerLandingUpload: vi.fn(),
  runLandingExtraction: vi.fn(),
  confirmLandingImport: vi.fn(),
}));

import { getActiveLandingBySlug } from "@/lib/landing/service";
import {
  confirmLandingImport,
  registerLandingUpload,
  requestLandingUpload,
  runLandingExtraction,
} from "@/lib/landing/flow";
import { LANDING_COOKIE_NAME, hashIp, signImportCookie } from "@/lib/landing/import-cookie";
import {
  confirmLandingImportAction,
  registerLandingUploadAction,
  requestLandingUploadAction,
  runLandingExtractionAction,
} from "@/app/(public)/candidati/[slug]/actions";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const IMPORT_ID = "22222222-2222-4222-8222-222222222222";
const LANDING = { id: "33333333-3333-4333-8333-333333333333", pool: { id: "p-1" } };

describe("landing server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieJar.clear();
    vi.stubEnv("LANDING_COOKIE_SECRET", "s".repeat(32));
    m(getActiveLandingBySlug).mockResolvedValue(LANDING);
  });

  it("returns NOT_FOUND for an unknown slug", async () => {
    m(getActiveLandingBySlug).mockResolvedValueOnce(null);
    await expect(requestLandingUploadAction("nope", { fileName: "a", fileSize: 1, turnstileToken: "" }))
      .resolves.toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("request: passes the first forwarded IP and binds the import in a cookie, without exposing its id", async () => {
    m(requestLandingUpload).mockResolvedValueOnce({ ok: true, data: { importId: IMPORT_ID, storagePath: "p-1/x/cv.pdf", token: "t" } });
    const r = await requestLandingUploadAction("coop-sole", { fileName: "cv.pdf", fileSize: 10, turnstileToken: "tok" });
    expect(r).toEqual({ ok: true, data: { storagePath: "p-1/x/cv.pdf", token: "t" } });
    expect(m(requestLandingUpload).mock.calls[0]![2]).toEqual({ ip: "1.2.3.4", ipHash: hashIp("1.2.3.4") });
    const [, , opts] = cookieStore.set.mock.calls[0]!;
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/candidati" });
    expect(cookieJar.get(LANDING_COOKIE_NAME)).toContain(IMPORT_ID);
  });

  it("later steps read the import id only from a valid cookie of this landing", async () => {
    await expect(runLandingExtractionAction("coop-sole")).resolves.toEqual({ ok: false, error: "SESSION_EXPIRED" });
    cookieJar.set(LANDING_COOKIE_NAME, signImportCookie({ importId: IMPORT_ID, landingId: "44444444-4444-4444-8444-444444444444" }));
    await expect(runLandingExtractionAction("coop-sole")).resolves.toEqual({ ok: false, error: "SESSION_EXPIRED" });
    expect(m(runLandingExtraction)).not.toHaveBeenCalled();

    cookieJar.set(LANDING_COOKIE_NAME, signImportCookie({ importId: IMPORT_ID, landingId: LANDING.id }));
    m(registerLandingUpload).mockResolvedValueOnce({ ok: true, data: null });
    await registerLandingUploadAction("coop-sole", "cv.pdf");
    expect(m(registerLandingUpload)).toHaveBeenCalledWith(LANDING, IMPORT_ID, "cv.pdf");
  });

  it("confirm clears the cookie on success", async () => {
    cookieJar.set(LANDING_COOKIE_NAME, signImportCookie({ importId: IMPORT_ID, landingId: LANDING.id }));
    m(confirmLandingImport).mockResolvedValueOnce({ ok: true, data: null });
    await confirmLandingImportAction("coop-sole", { firstName: "A" });
    expect(m(confirmLandingImport).mock.calls[0]!.slice(0, 3)).toEqual([LANDING, IMPORT_ID, { firstName: "A" }]);
    expect(cookieStore.delete).toHaveBeenCalledWith(LANDING_COOKIE_NAME);
  });

  it("rejects a non-string slug", async () => {
    await expect(runLandingExtractionAction({} as never)).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m(getActiveLandingBySlug)).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/__tests__/app/candidati/actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/app/(public)/candidati/[slug]/actions.ts`:

```ts
"use server";

import { cookies, headers } from "next/headers";
// Don't re-export types from this "use server" file: import them from
// @/lib/landing/flow (Turbopack treats type re-exports as runtime exports).
import { getActiveLandingBySlug, type ActiveLanding } from "@/lib/landing/service";
import {
  confirmLandingImport,
  registerLandingUpload,
  requestLandingUpload,
  runLandingExtraction,
  type LandingResult,
  type RequestContext,
} from "@/lib/landing/flow";
import type { ContactPrefill } from "@/lib/landing/contact";
import {
  hashIp,
  LANDING_COOKIE_NAME,
  LANDING_COOKIE_TTL_SEC,
  signImportCookie,
  verifyImportCookie,
} from "@/lib/landing/import-cookie";

// Public endpoints: every argument is untrusted.

async function landingFor(slug: unknown): Promise<ActiveLanding | null> {
  return typeof slug === "string" ? getActiveLandingBySlug(slug) : null;
}

async function requestContext(): Promise<RequestContext> {
  // Vercel sets x-forwarded-for; the first hop is the client.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  return { ip, ipHash: hashIp(ip) };
}

async function boundImportId(landing: ActiveLanding): Promise<string | null> {
  const value = (await cookies()).get(LANDING_COOKIE_NAME)?.value;
  const binding = verifyImportCookie(value);
  return binding && binding.landingId === landing.id ? binding.importId : null;
}

export async function requestLandingUploadAction(
  slug: string,
  input: { fileName: string; fileSize: number; turnstileToken: string },
): Promise<LandingResult<{ storagePath: string; token: string }>> {
  const landing = await landingFor(slug);
  if (!landing) return { ok: false, error: "NOT_FOUND" };
  const r = await requestLandingUpload(landing, input, await requestContext());
  if (!r.ok) return r;

  (await cookies()).set(
    LANDING_COOKIE_NAME,
    signImportCookie({ importId: r.data.importId, landingId: landing.id }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/candidati",
      maxAge: LANDING_COOKIE_TTL_SEC,
    },
  );
  return { ok: true, data: { storagePath: r.data.storagePath, token: r.data.token } };
}

export async function registerLandingUploadAction(
  slug: string,
  fileName: string,
): Promise<LandingResult<null>> {
  const landing = await landingFor(slug);
  if (!landing) return { ok: false, error: "NOT_FOUND" };
  const importId = await boundImportId(landing);
  if (!importId) return { ok: false, error: "SESSION_EXPIRED" };
  return registerLandingUpload(landing, importId, typeof fileName === "string" ? fileName : "");
}

export async function runLandingExtractionAction(slug: string): Promise<LandingResult<ContactPrefill>> {
  const landing = await landingFor(slug);
  if (!landing) return { ok: false, error: "NOT_FOUND" };
  const importId = await boundImportId(landing);
  if (!importId) return { ok: false, error: "SESSION_EXPIRED" };
  return runLandingExtraction(landing, importId);
}

export async function confirmLandingImportAction(
  slug: string,
  contact: unknown,
): Promise<LandingResult<null>> {
  const landing = await landingFor(slug);
  if (!landing) return { ok: false, error: "NOT_FOUND" };
  const importId = await boundImportId(landing);
  if (!importId) return { ok: false, error: "SESSION_EXPIRED" };
  const r = await confirmLandingImport(landing, importId, contact, await requestContext());
  if (r.ok) (await cookies()).delete(LANDING_COOKIE_NAME);
  return r;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/__tests__/app/candidati/actions.test.ts && pnpm exec tsc --noEmit -p .`
Expected: PASS; tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(public)/candidati/[slug]/actions.ts" src/__tests__/app/candidati/actions.test.ts
git commit -m "feat(landing): public server actions with cookie-bound imports"
```

---

### Task 4: Turnstile widget

**Files:**
- Create: `src/components/landing/turnstile-widget.tsx`

No unit test: it only bridges Cloudflare's script (verified manually in Task 9).

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      appearance: "interaction-only";
      language: string;
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Invisible-unless-needed Cloudflare Turnstile. Reports a fresh token (or ""
 * when it expires / errors). Tokens are single-use: remount it (change `key`)
 * after each upload attempt. Without a site key (local dev) it renders nothing
 * and the server accepts the empty token outside production.
 */
export function TurnstileWidget({
  siteKey,
  locale,
  onToken,
}: {
  siteKey: string;
  locale: string;
  onToken: (token: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(
    () => typeof window !== "undefined" && window.turnstile !== undefined,
  );

  useEffect(() => {
    if (!siteKey || !scriptReady || !ref.current || !window.turnstile) return;
    const id = window.turnstile.render(ref.current, {
      sitekey: siteKey,
      callback: onToken,
      "expired-callback": () => onToken(""),
      "error-callback": () => onToken(""),
      appearance: "interaction-only",
      language: locale,
    });
    return () => window.turnstile?.remove(id);
  }, [siteKey, scriptReady, locale, onToken]);

  if (!siteKey) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div ref={ref} />
    </>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `pnpm exec tsc --noEmit -p .` — Expected: exit 0.

```bash
git add src/components/landing/turnstile-widget.tsx
git commit -m "feat(landing): Turnstile widget"
```

---

### Task 5: Contact confirmation form

**Files:**
- Create: `src/components/landing/contact-form.tsx`
- Test: `src/__tests__/components/landing/contact-form.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { ContactForm } from "@/components/landing/contact-form";

const PREFILL = { firstName: "Ahmed", lastName: "", phone: "333 1234567", email: "" };

function setup(showShare = true) {
  const onSubmit = vi.fn();
  render(
    <I18nProvider locale="it">
      <ContactForm
        orgName="Coop Sole" prefill={PREFILL} privacyPolicyUrl="https://x.it/p"
        showShare={showShare} busy={false} onSubmit={onSubmit}
      />
    </I18nProvider>,
  );
  return onSubmit;
}

describe("ContactForm", () => {
  it("prefills from the CV", () => {
    setup();
    expect(screen.getByLabelText("Nome")).toHaveValue("Ahmed");
    expect(screen.getByLabelText("Telefono")).toHaveValue("333 1234567");
  });

  it("blocks submit without last name and consent", () => {
    const onSubmit = setup();
    fireEvent.click(screen.getByRole("button", { name: "Invia candidatura" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText("Campo obbligatorio").length).toBeGreaterThan(0);
    expect(screen.getByText("Serve il consenso per inviare la candidatura")).toBeInTheDocument();
  });

  it("submits the confirmed contact", () => {
    const onSubmit = setup();
    fireEvent.change(screen.getByLabelText("Cognome"), { target: { value: "Benali" } });
    fireEvent.click(screen.getByLabelText(/Ho letto l'informativa/));
    fireEvent.click(screen.getByRole("button", { name: "Invia candidatura" }));
    expect(onSubmit).toHaveBeenCalledWith({
      firstName: "Ahmed", lastName: "Benali", phone: "333 1234567", email: "",
      privacyAccepted: true, shareWithGlobal: false,
    });
  });

  it("hides the sharing checkbox when not applicable", () => {
    setup(false);
    expect(screen.queryByLabelText(/altre aziende/)).toBeNull();
  });
});
```

If `@testing-library/jest-dom` matchers (`toHaveValue`, `toBeInTheDocument`) are not set up in `vitest.setup.ts`, check how existing component tests assert and use the same style.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/__tests__/components/landing/contact-form.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/components/landing/contact-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n/provider";
import { normalizePhone } from "@/lib/candidates/phone";
import type { ContactPrefill } from "@/lib/landing/contact";

export interface ContactSubmission extends ContactPrefill {
  privacyAccepted: boolean;
  shareWithGlobal: boolean;
}

type FieldKey = keyof ContactPrefill | "privacyAccepted";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ContactForm({
  orgName,
  prefill,
  privacyPolicyUrl,
  showShare,
  busy,
  onSubmit,
}: {
  orgName: string;
  prefill: ContactPrefill;
  privacyPolicyUrl: string;
  showShare: boolean;
  busy: boolean;
  onSubmit: (values: ContactSubmission) => void;
}) {
  const t = useT().landing;
  const [values, setValues] = useState<ContactPrefill>(prefill);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [shareWithGlobal, setShareWithGlobal] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const org = (s: string) => s.replace("{org}", orgName);

  function validate(): boolean {
    const e: Partial<Record<FieldKey, string>> = {};
    if (!values.firstName.trim()) e.firstName = t.fieldRequired;
    if (!values.lastName.trim()) e.lastName = t.fieldRequired;
    if (!values.phone.trim()) e.phone = t.fieldRequired;
    else if (!normalizePhone(values.phone)) e.phone = t.phoneInvalid;
    if (values.email.trim() && !EMAIL_RE.test(values.email.trim())) e.email = t.emailInvalid;
    if (!privacyAccepted) e.privacyAccepted = t.privacyRequired;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function field(key: keyof ContactPrefill, label: string, type = "text", autoComplete?: string) {
    const id = `landing-${key}`;
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id} type={type} autoComplete={autoComplete} value={values[key]}
          aria-invalid={errors[key] ? true : undefined}
          aria-describedby={errors[key] ? `${id}-error` : undefined}
          onChange={(ev) => setValues((v) => ({ ...v, [key]: ev.target.value }))}
        />
        {errors[key] && <p id={`${id}-error`} className="text-sm text-destructive">{errors[key]}</p>}
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (validate()) onSubmit({ ...values, privacyAccepted, shareWithGlobal });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {field("firstName", t.firstName, "text", "given-name")}
        {field("lastName", t.lastName, "text", "family-name")}
      </div>
      {field("phone", t.phone, "tel", "tel")}
      {field("email", t.email, "email", "email")}

      <div className="space-y-1.5">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox" className="mt-1 h-4 w-4" checked={privacyAccepted}
            onChange={(ev) => setPrivacyAccepted(ev.target.checked)}
          />
          <span>
            {org(t.privacyLabel)}{" "}
            <a href={privacyPolicyUrl} target="_blank" rel="noreferrer" className="underline">
              {t.privacyLink}
            </a>
          </span>
        </label>
        {errors.privacyAccepted && <p className="text-sm text-destructive">{errors.privacyAccepted}</p>}
      </div>

      {showShare && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox" className="mt-1 h-4 w-4" checked={shareWithGlobal}
            onChange={(ev) => setShareWithGlobal(ev.target.checked)}
          />
          <span>{t.shareLabel}</span>
        </label>
      )}

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? t.submitting : t.submit}
      </Button>
    </form>
  );
}
```

Note: `getByLabelText(/Ho letto l'informativa/)` resolves the checkbox through its wrapping `<label>`; the link inside the label is fine.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run src/__tests__/components/landing/contact-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/contact-form.tsx src/__tests__/components/landing/contact-form.test.tsx
git commit -m "feat(landing): contact confirmation form"
```

---

### Task 6: Landing flow component

**Files:**
- Create: `src/components/landing/landing-flow.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { FileUp, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    default:
      return "generic";
  }
}

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
    setCanRetryExtraction(code === "LLM_TIMEOUT" || code === "LLM_ERROR" || code === "INTERNAL_ERROR");
    setStep(key === "expired" ? { kind: "upload" } : back);
  }

  async function extract() {
    setError(null);
    setStep({ kind: "working", label: "reading" });
    const r = await runLandingExtractionAction(props.slug);
    if (r.ok) setStep({ kind: "contact", prefill: r.data });
    else showError(r.error, { kind: "upload" });
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
      await extract();
    } catch {
      showError("INTERNAL_ERROR", { kind: "upload" });
    }
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

  const whatsappButton = props.waLink && (
    <Button render={<a href={props.waLink} target="_blank" rel="noreferrer" />} className="w-full">
      <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
      {t.whatsappCta}
    </Button>
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
```

`Button` in this project is the base-ui variant that takes a `render` prop (see `TooltipTrigger render={…}` in `pool-qr-dialog.tsx`). If `Button` does not accept `render`, use a plain `<a>` with `buttonVariants()` classes from `@/components/ui/button` instead.

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm exec tsc --noEmit -p . && pnpm lint`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/landing-flow.tsx
git commit -m "feat(landing): candidate-facing flow (choose, upload, read, confirm, done)"
```

---

### Task 7: Public page

**Files:**
- Create: `src/app/(public)/candidati/[slug]/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { I18nProvider } from "@/lib/i18n/provider";
import { getDictionary } from "@/lib/i18n";
import { getActiveLandingBySlug } from "@/lib/landing/service";
import { resolvePublicLocale } from "@/lib/landing/locale";
import { buildWaLink } from "@/lib/whatsapp/build-link";
import { LandingFlow } from "@/components/landing/landing-flow";

// Server actions invoked from this page (CV extraction) inherit this budget.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}

async function resolve({ params, searchParams }: Props) {
  const [{ slug }, sp, h] = await Promise.all([params, searchParams, headers()]);
  const landing = await getActiveLandingBySlug(slug);
  if (!landing) notFound();
  return { landing, locale: resolvePublicLocale(sp.lang, h.get("accept-language")) };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { landing, locale } = await resolve(props);
  const t = getDictionary(locale).landing;
  // Shared by link/QR only; keep it out of search engines (less bot traffic).
  return { title: t.metaTitle.replace("{org}", landing.organization.name), robots: { index: false } };
}

export default async function CandidateLandingPage(props: Props) {
  const { landing, locale } = await resolve(props);
  const t = getDictionary(locale).landing;

  const waNumber = process.env.KUBRI_WHATSAPP_NUMBER ?? "";
  const waTemplate = process.env.KUBRI_WHATSAPP_MESSAGE_TEMPLATE ?? "";
  const waLink = waNumber && waTemplate ? buildWaLink(landing.pool, waNumber, waTemplate) : null;
  const otherLocale = locale === "it" ? "en" : "it";

  return (
    <I18nProvider locale={locale}>
      <main lang={locale} className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl tracking-tight">{landing.organization.name}</h1>
            <p className="mt-1 text-muted-foreground">
              {t.intro.replace("{org}", landing.organization.name)}
            </p>
          </div>
          <a
            href={`?lang=${otherLocale}`} className="text-sm underline"
            aria-label={`${t.languageLabel}: ${otherLocale.toUpperCase()}`}
          >
            {otherLocale.toUpperCase()}
          </a>
        </header>
        <LandingFlow
          slug={landing.slug}
          locale={locale}
          orgName={landing.organization.name}
          waLink={waLink}
          privacyPolicyUrl={landing.privacyPolicyUrl}
          showShare={landing.pool.globalSharing === "WEBHOOK"}
          turnstileSiteKey={process.env.TURNSTILE_SITE_KEY ?? ""}
        />
      </main>
    </I18nProvider>
  );
}
```

`resolve` runs twice per request (metadata + page); `getActiveLandingBySlug` is two cheap indexed lookups. If that matters later, wrap it in React `cache()`.

- [ ] **Step 2: Typecheck and build**

Run: `pnpm exec tsc --noEmit -p . && pnpm --filter kubri-dashboard build`
Expected: exit 0; the build lists `ƒ /candidati/[slug]`. (The build needs env values; if it fails only for missing env in this worktree, note it and rely on Task 9.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(public)/candidati/[slug]/page.tsx"
git commit -m "feat(landing): public /candidati/[slug] page"
```

---

### Task 8: Admin card, QR dialog and QR page section

**Files:**
- Create: `src/components/landing/landing-qr-dialog.tsx`
- Modify: `src/app/(admin)/admin/organizations/[id]/page.tsx`
- Modify: `src/app/(dashboard)/dashboard/qr-codes/page.tsx`

- [ ] **Step 1: QR dialog**

`src/components/landing/landing-qr-dialog.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/provider";

export function LandingQrDialog({ name, url }: { name: string; url: string }) {
  const t = useT().landingAdmin;
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `kubri-landing-${url.split("/").pop() ?? "qr"}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm">{t.showQr}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.qrTitle.replace("{name}", name)}</DialogTitle>
          <DialogDescription>{t.qrDescription}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-md bg-white p-4">
            <QRCodeCanvas ref={canvasRef} value={url} size={240} level="M" marginSize={2} />
          </div>
          <a
            href={url} target="_blank" rel="noreferrer"
            className="block w-full break-all rounded border bg-muted/40 p-2 font-mono text-xs hover:underline"
          >
            {url}
          </a>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={copy}>{copied ? t.copied : t.copyLink}</Button>
            <Button type="button" variant="outline" onClick={downloadPng}>{t.downloadPng}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Admin card on the organization page**

In `src/app/(admin)/admin/organizations/[id]/page.tsx`:

Imports — add:

```ts
import { getLandingForOrg, saveLandingPage } from "@/lib/landing/service";
import { landingPageInputSchema } from "@/lib/validations/landing-page";
import { LandingQrDialog } from "@/components/landing/landing-qr-dialog";
```

After `const attachablePools = …`, add:

```ts
  const landing = await getLandingForOrg(id);
  const eligiblePools = org.pools.map((op) => op.pool).filter((p) => !p.isGlobal);
  const landingUrl = landing ? `${await getAppOrigin()}/candidati/${landing.slug}` : null;
```

Next to the other inline actions, add:

```ts
  async function saveLandingAction(formData: FormData) {
    "use server";
    const s = await getCurrentUser();
    if (s.role !== Role.ADMIN_KUBRI) {
      throw new Error(t.common.insufficientPermissions);
    }

    const parsed = landingPageInputSchema.safeParse({
      slug: formData.get("slug"),
      poolId: formData.get("poolId"),
      privacyPolicyUrl: formData.get("privacyPolicyUrl"),
      enabled: formData.get("enabled") === "on",
    });
    if (!parsed.success) throw new Error(t.landingAdmin.errors.VALIDATION);

    const result = await saveLandingPage(id, parsed.data);
    if (!result.ok) throw new Error(t.landingAdmin.errors[result.error]);

    await logAudit({
      userId: s.id,
      organizationId: id,
      action: "landing_page.save",
      resourceType: "CandidateLandingPage",
      resourceId: result.id,
      metadata: { slug: parsed.data.slug, poolId: parsed.data.poolId, enabled: parsed.data.enabled },
    });

    revalidatePath(`/admin/organizations/${id}`);
  }
```

In the JSX, inside the `<div className="grid gap-6 md:grid-cols-2">`, after the pools `<Card className="md:col-span-2">…</Card>`, add:

```tsx
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{t.landingAdmin.cardTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t.landingAdmin.cardDescription}</p>

            {landing && landingUrl && (
              <div className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm">
                <span className="text-muted-foreground">{t.landingAdmin.publicLink}:</span>
                <a href={landingUrl} target="_blank" rel="noreferrer" className="font-mono hover:underline">
                  {landingUrl}
                </a>
                {!landing.enabled && <Badge variant="secondary">{t.landingAdmin.disabled}</Badge>}
                <LandingQrDialog name={org.name} url={landingUrl} />
              </div>
            )}

            {eligiblePools.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.landingAdmin.noEligiblePools}</p>
            ) : (
              <form action={saveLandingAction} className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span>{t.landingAdmin.slug}</span>
                  <Input name="slug" defaultValue={landing?.slug ?? org.slug} required />
                  <span className="text-xs text-muted-foreground">{t.landingAdmin.slugHint}</span>
                </label>
                <label className="space-y-1 text-sm">
                  <span>{t.landingAdmin.pool}</span>
                  <select
                    name="poolId" required defaultValue={landing?.poolId ?? eligiblePools[0]!.id}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  >
                    {eligiblePools.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm md:col-span-2">
                  <span>{t.landingAdmin.privacyPolicyUrl}</span>
                  <Input
                    name="privacyPolicyUrl" type="url" required placeholder="https://"
                    defaultValue={landing?.privacyPolicyUrl ?? ""}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="enabled" defaultChecked={landing?.enabled ?? true} className="h-4 w-4" />
                  {t.landingAdmin.enabled}
                </label>
                <div className="md:col-span-2">
                  <SubmitButton>{t.landingAdmin.save}</SubmitButton>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
```

Throwing from the inline action surfaces in the route's error boundary — same pattern as `updateOrgName` and `inviteOrgMember` on this page.

- [ ] **Step 3: Landing section on the organization's QR page**

In `src/app/(dashboard)/dashboard/qr-codes/page.tsx` add imports:

```ts
import { getLandingForOrg } from "@/lib/landing/service";
import { getAppOrigin } from "@/lib/origin";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n";
import { LandingQrDialog } from "@/components/landing/landing-qr-dialog";
```

After `const pools = …`:

```ts
  const t = getDictionary(await getServerLocale());
  const landing = me.organizationId ? await getLandingForOrg(me.organizationId) : null;
  const landingUrl =
    landing?.enabled ? `${await getAppOrigin()}/candidati/${landing.slug}` : null;
```

Right after the page header `<div>…</div>` and before `<Table>`:

```tsx
      {landingUrl && (
        <div className="space-y-2 rounded-md border p-4">
          <h2 className="text-lg">{t.landingAdmin.qrPageTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.landingAdmin.qrPageDescription}</p>
          <div className="flex flex-wrap items-center gap-2">
            <a href={landingUrl} target="_blank" rel="noreferrer" className="font-mono text-sm hover:underline">
              {landingUrl}
            </a>
            <LandingQrDialog name={t.landingAdmin.qrPageTitle} url={landingUrl} />
          </div>
        </div>
      )}
```

The landing may point at a pool the organization can no longer use if it was detached; `getActiveLandingBySlug` 404s in that case, so the link here would 404 too. Acceptable: the admin card is where it gets fixed.

- [ ] **Step 4: Typecheck, lint, tests**

Run: `pnpm exec tsc --noEmit -p . && pnpm lint && pnpm exec vitest run`
Expected: tsc/lint exit 0; tests PASS (DB-backed pool tests excepted).

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/landing-qr-dialog.tsx "src/app/(admin)/admin/organizations/[id]/page.tsx" "src/app/(dashboard)/dashboard/qr-codes/page.tsx"
git commit -m "feat(landing): admin landing card and link/QR on the QR codes page"
```

---

### Task 9: CLAUDE.md and manual verification

**Files:**
- Modify: `CLAUDE.md` (repo root)

- [ ] **Step 1: Update CLAUDE.md**

In the paragraph that starts "Every write to `Candidate` goes through `src/lib/candidates/ingest.ts`", extend the "Sanctioned callers" list with "the public candidate landing (`src/lib/landing/`)". Then in "Candidate ingestion" (Code Conventions), after the `ingestCandidate` / `upsertCandidate` bullet, add:

```markdown
- The public candidate landing (`/candidati/[slug]`, `src/lib/landing/`) is a sanctioned write path: it creates `Candidate` rows with `channel = "landing_cv"` (or attaches the CV to an existing same-phone candidate of the same pool) through `confirmImport`. Every public upload goes through Turnstile, Upstash rate limits (fail-closed in production), `inspectPublicDocument` and the pre-LLM quality gate — never bypass them.
```

In "Security — Non-Negotiable Rules", add:

```markdown
7. Public endpoints (`/candidati`) never trust a request-supplied import id: the import is bound to the browser by the signed `kubri_landing_import` cookie
```

- [ ] **Step 2: Manual verification (dev)**

With `.env.local` pointing at the dev DB (no Turnstile keys needed in dev; Upstash optional in dev):

1. `cd apps/dashboard && pnpm exec prisma migrate deploy` (dev DB), then `pnpm dev:dashboard` from the repo root.
2. As `ADMIN_KUBRI`: open an organization with a non-global pool, save a landing (slug `test-landing`, an https privacy URL, enabled). Expect the public link and the QR dialog.
3. In a private window, open `/candidati/test-landing`: expect organization name, WhatsApp card (if the `KUBRI_WHATSAPP_*` vars are set) and upload card, no redirect to `/login`. `?lang=en` switches to English.
4. Upload a real text PDF CV: expect "reading", then the contact form pre-filled. Confirm with consent → "Grazie!". In the dashboard the candidate appears in the pool with the CV in "Documenti", channel `landing_cv`.
5. Upload the same CV again with the same phone → thank-you screen; the existing candidate gains a second document, no new row.
6. Upload a `.txt` renamed `.pdf`, a PDF with JavaScript, and a photo of a landscape → generic error messages; no candidate created; nothing left in the bucket for the rejected files.
7. Disable the landing in admin → `/candidati/test-landing` is 404.
8. Delete the `kubri_landing_import` cookie between upload and confirm → "La sessione è scaduta".

Record any deviation as a fix commit before opening the PR.

- [ ] **Step 3: Commit**

```bash
git add ../../CLAUDE.md
git commit -m "docs: CLAUDE.md covers the public candidate landing"
```

---

## PR checklist (both plans)

- Base PR `feat/create-candidate-ui` merged first (its migration + `candidate-documents` bucket in dev and prod).
- Apply `20261029120000_add_candidate_landing_page` to prod **before** merging.
- Vercel env (prod + preview): `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `LANDING_COOKIE_SECRET`, `LANDING_IP_SALT`; confirm `UPSTASH_REDIS_REST_URL` / `_TOKEN` are set in prod.
- Cloudflare Turnstile site created with the production and preview hostnames.
- Bucket `candidate-documents` file-size limit ≥ 10 MB (operators); the 5 MB public cap is enforced server-side.
- Privacy notice URL set on each landing before enabling it.
