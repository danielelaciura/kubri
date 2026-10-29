# Piano 10 — Integrazioni: webhook verso Kubri, CV e geocoding

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Far arrivare in dashboard i candidati intervistati dal chatbot, con il profilo
completo e il CV scaricabile. Il contratto del payload diventa uno schema Zod condiviso in
`@kubri/contracts`; il chatbot lo costruisce e lo invia (job `kubri-webhook`); la dashboard lo
valida e legge `channel` e `cv_link_pdf`. Il chatbot genera il CV in PDF (job `cv`), lo salva in
uno storage privato Supabase e ne manda un link firmato al candidato e alla dashboard.

**Architecture:** Il codice che parla con l'esterno sta in `src/integrations/`: client HTTP
verso Kubri, client REST di Supabase Storage, rendering del PDF. Il runtime li usa solo come
**interfacce** (`KubriClient`, `CvStorage`, `renderCv`), così i test usano doppioni e non
toccano la rete. I due job (`src/runtime/jobs/`) leggono lo stato dal database *al momento
dell'invio*, quindi l'ordine in cui arrivano non conta. Lo schema Zod dei `data` del chatbot sta
in `packages/contracts`, insieme a un payload di esempio usato dai test di entrambe le app: è il
test di contratto della spec (§14).

**Tech Stack:** TypeScript strict, Zod 4, `fetch` di Node 22, Prisma 7, pg-boss (piano 08),
`pdfkit` (nuova dipendenza), Vitest 4. Lato dashboard: Next.js 14+, Vitest.

**Spec:** §10.3 (`CvDocument`), §10.6, §12.1 (webhook), §12.2 (CV), §12.3 (geocoding), §13
(errori), §14 (test di contratto), §16.3 (segreti), D19–D24, D57, D102, D103.

**Prerequisito:** piani 01–06 e 08 implementati (il 09 non serve: i job funzionano anche senza
WhatsApp, con il canale a console del piano 08). Il piano 07 non serve. Si lavora **direttamente
sul branch ombrello `docs/chatbot-spec-into-monorepo`**: nessun branch nuovo, nessuna PR, niente
merge su `main`. I comandi del chatbot si eseguono da `apps/chatbot/`, quelli della dashboard da
`apps/dashboard/`, quelli del contratto dalla radice del monorepo.

```bash
git switch docs/chatbot-spec-into-monorepo
pnpm install
(cd apps/chatbot && pnpm db:up && pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check)
(cd apps/dashboard && pnpm test && pnpm exec tsc --noEmit)
pnpm test        # radice: contratti e assessment
```

Expected: tutto verde prima di iniziare.

**Regola valida per ogni task:** un task si chiude solo quando i controlli dell'app toccata sono
verdi (chatbot: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`, più
`pnpm test:integration` se tocca il database; dashboard: `pnpm test` e `pnpm exec tsc --noEmit`;
contratti: `pnpm test` dalla radice). **I test non chiamano mai Kubri, Supabase, Meta né un LLM.**
Nessun dato personale nei log.

**Ordine di rilascio.** La dashboard va in produzione **prima** del chatbot (Task 2): le sue
modifiche sono compatibili con i payload di Make e non richiedono migrazioni.

---

## Decisioni prese in questo piano (da riportare nella spec, §2, come D122–D131)

Il piano 09 ha preso D112–D121.

- **D122 — Contratto condiviso.** `@kubri/contracts` contiene la busta (`key`, `externalKey`,
  `data`, invariata: accetta ancora i payload di Make) e lo schema tipizzato dei `data` del
  chatbot (`source_organization = kubri-chatbot`). La dashboard valida strettamente solo i
  payload del chatbot, tollerando chiavi nuove (`.loose()`); il chatbot li valida in uscita
  (`strict`): una deriva del contratto è un errore di test o di tipi, mai un 400 in produzione.
  Un payload di esempio nel pacchetto è usato dai test di entrambe le app.
- **D123 — Mappatura.** Come la tabella del §12.1; i campi assenti si **omettono** (la dashboard
  riscrive il record intero a ogni invio, quindi un campo omesso diventa vuoto); `learning_preferences`
  è un'aggiunta (la dashboard la conserva nel `rawPayload`); `interview_status` vale
  `in_progress` / `completed` / `stopped`; `lat` e `lng` non si inviano (D124); `birthday` esce
  come `gg/mm/aaaa`.
- **D124 — Geocoding delegato.** Il chatbot non geocodifica: la dashboard ricava le coordinate
  dal comune con i dati ISTAT quando `lat` e `lng` mancano (`geocodeFromAddress`), come fa oggi per
  Make. Nessun fornitore esterno, nessun dato personale in uscita, costo zero. Il job `geocoding`
  esiste (il motore lo accoda) e ha un gestore che lo chiude registrando il motivo. Un geocodificatore
  proprio è uno sviluppo successivo.
- **D125 — Quando e cosa si invia.** Il job `kubri-webhook` legge il profilo dal database nel
  momento dell'invio, quindi manda sempre lo stato più recente, in qualunque ordine arrivino i
  job. Si salta (con un log) se la sessione non esiste più o se è `stopped` con il profilo
  svuotato (cancellazione): mai sovrascrivere un candidato in dashboard con un record vuoto.
  `consents.accepted` crea il candidato (D24). L'evento `cv.generated` si aggiunge a `KubriEvent`.
- **D126 — Ritentativi e scarti.** 2xx: fatto. 5xx, 429, timeout, rete: il job lancia un errore e
  pg-boss ritenta con attesa crescente (poi la coda `kubri-webhook-dead`). 4xx (`unauthorized`,
  `validation_failed`, `unknown_pool`…): definitivo, il job va subito nella coda `kubri-webhook-dead`
  con il motivo, si registra un log `error` (l'avviso vero è del piano 11) e il job originale
  termina senza ritentativi.
- **D127 — CV.** PDF con `pdfkit` (niente browser, niente React): un modello predefinito unico, in
  italiano. Un template per campagna, come dice il §12.2, è rinviato (Punti aperti). Il testo usa
  i font standard del PDF (alfabeto latino europeo): i caratteri fuori da quell'insieme, per
  esempio un nome in arabo, escono come `?` (limite noto, Punti aperti). Layout puro e testabile,
  disegno separato.
- **D128 — Link firmato.** Scadenza `CV_LINK_TTL_DAYS` (14). Il link si ricalcola a **ogni** invio a
  Kubri (`cv_link_pdf`) e si manda al candidato come testo (`cv.ready`); l'invio del PDF come
  documento WhatsApp è rinviato. Limite: il link salvato in dashboard scade; un endpoint di rinnovo
  è un punto aperto.
- **D129 — Storage.** Bucket privato `bot-cv` (nome configurabile), creato da `storage init`;
  accesso con la chiave di servizio di Supabase, che vive **solo** nell'ambiente del worker (mai
  nel processo web, mai nel database). Oggetti `cv/<sessionId>/<timestamp>.pdf`: una rigenerazione
  crea un oggetto nuovo e un `CvDocument` nuovo; il più recente vale.
- **D130 — Dashboard.** Nessuna migrazione. `channel` si legge per primo, con ripiego su
  `source_organization` per Make; `cv_link_pdf` si legge da `rawPayload.data` e compare nella
  scheda CV che c'è già; il link deve essere `https:`.
- **D131 — Fallimento del CV.** Generazione o caricamento falliti: il job si riaccoda da solo (3
  tentativi, attesa crescente, contatore nel payload); esauriti, il candidato riceve `cv.failed`
  una volta sola e la sessione ottiene un flag `cv_failed` (senza `needs_attention`).

## Contratto con gli altri piani

- **Piano 08 (si modifica):** `KubriEvent`, schemi dei job e `JobQueue` (+`deadLetter`),
  `MemoryJobQueue`, `startWorker`, catalogo i18n e `resolveKey` (+parametri, dal 09).
- **Piano 09:** `resolveKey`, il canale e i messaggi in uscita non cambiano: il job `cv` accoda un
  messaggio come fa un turno.
- **Piano 11:** cancellazione degli oggetti nello storage con `delete-contact` (qui si salvano le
  chiavi); scadenza dei payload; avvisi sulle code `*-dead`; guida di migrazione.

## Mappa dei file

| File | Responsabilità |
|---|---|
| `packages/contracts/src/candidate-webhook.ts` | busta, schema dei `data` del chatbot, esempio |
| `apps/dashboard/src/lib/validations/webhook-candidate.ts`, `app/api/webhooks/make/candidate/route.ts` | usa il contratto; valida i payload del chatbot |
| `apps/dashboard/src/lib/make/normalize.ts`, `lib/candidates/cv-link.ts`, `service.ts` | `channel` esplicito; link del CV |
| `src/integrations/config.ts` | `parseKubriConfig`, `parseStorageConfig` |
| `src/integrations/kubri/payload.ts` | profilo → corpo del webhook (puro) |
| `src/integrations/kubri/client.ts` | `KubriClient`, `createKubriClient`, `FakeKubriClient` |
| `src/integrations/storage.ts` | `CvStorage`, Supabase REST, `FakeCvStorage` |
| `src/integrations/cv/layout.ts`, `render.ts` | contenuto del CV (puro) e PDF |
| `src/store/cv.ts`, `src/store/snapshot.ts` | `CvDocument`; istantanea per i job |
| `src/runtime/jobs/kubri-webhook.ts`, `cv.ts`, `geocoding.ts`, `errors.ts` | i tre gestori |
| `src/runtime/worker.ts`, `src/cli/commands/worker.ts`, `storage.ts` | collegamenti e `storage init` |
| `prisma/schema.prisma`, `prisma/migrations/<ts>_cv_documents/` | `CvDocument` |
| `docs/kubri-integration-setup.md` | variabili, bucket, prova su dev |

---

### Task 1: Il contratto condiviso (`@kubri/contracts`)

**Concetto: un test di contratto.** Chatbot e dashboard sono due programmi che si parlano con un
JSON. Se ciascuno ne ha la propria idea, un campo rinominato rompe la produzione senza che nessun
test se ne accorga. Qui il JSON ha **una sola definizione** (uno schema Zod nel pacchetto
condiviso) e **un solo esempio**. Il chatbot prova che la sua mappatura produce quell'esempio, la
dashboard prova che lo legge: se uno dei due cambia senza l'altro, un test fallisce.

**Files:**
- Create: `packages/contracts/src/candidate-webhook.ts`, `packages/contracts/src/candidate-webhook.test.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

`packages/contracts/src/candidate-webhook.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE,
  CHATBOT_SOURCE,
  candidateWebhookEnvelopeSchema,
  chatbotCandidateDataSchema,
  chatbotCandidateWebhookSchema,
} from "./candidate-webhook";

const example = () => structuredClone(CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE) as {
  key: string;
  externalKey: string;
  data: Record<string, unknown>;
};

describe("candidate webhook contract (D122)", () => {
  it("the example is a valid chatbot payload and a valid envelope", () => {
    expect(chatbotCandidateWebhookSchema.safeParse(example()).success).toBe(true);
    expect(candidateWebhookEnvelopeSchema.safeParse(example()).success).toBe(true);
    expect(CHATBOT_SOURCE).toBe("kubri-chatbot");
  });

  it("the envelope still accepts what Make sends", () => {
    const make = {
      key: "ext_123",
      externalKey: "global",
      data: { first_name: "Mario", source_organization: "APL Milano", anything: [1, 2] },
    };

    expect(candidateWebhookEnvelopeSchema.safeParse(make).success).toBe(true);
  });

  it("the envelope refuses an empty key or external key", () => {
    expect(candidateWebhookEnvelopeSchema.safeParse({ ...example(), key: "" }).success).toBe(false);
    expect(candidateWebhookEnvelopeSchema.safeParse({ ...example(), externalKey: "" }).success).toBe(false);
  });

  it("the chatbot data is strict, and tolerant when loosened for the receiver", () => {
    const withNewKey = { ...example().data, future_field: 1 };

    expect(chatbotCandidateDataSchema.safeParse(withNewKey).success).toBe(false);
    expect(chatbotCandidateDataSchema.loose().safeParse(withNewKey).success).toBe(true);
  });

  it.each([
    ["an ISO birthday", { birthday: "1990-05-12" }],
    ["a lowercase country", { country: "ma" }],
    ["a phone without +", { phone: "393334445566" }],
    ["an unknown channel", { channel: "carrier-pigeon" }],
    ["a non-https CV link", { cv_link_pdf: "http://example.com/cv.pdf" }],
    ["an unknown interview status", { interview_status: "done" }],
    ["a non-boolean consent", { is_kubri_privacy_accepted: "yes" }],
    ["a bad language code", { language: "Arabic" }],
    ["an empty list item", { work_experience: [""] }],
  ])("refuses %s", (_name, change) => {
    const payload = example();
    payload.data = { ...payload.data, ...change };

    expect(chatbotCandidateWebhookSchema.safeParse(payload).success).toBe(false);
  });

  it("needs only the always-present fields", () => {
    const minimal = {
      key: "c:k",
      externalKey: "global",
      data: {
        source_organization: CHATBOT_SOURCE,
        channel: "whatsapp",
        interview_status: "in_progress",
        campaign_version: 1,
        last_updated: "2026-10-24T10:30:00.000Z",
        is_kubri_privacy_accepted: false,
        phone: "+393334445566",
      },
    };

    expect(chatbotCandidateWebhookSchema.safeParse(minimal).success).toBe(true);
  });
});
```

- [ ] **Step 2: Verificare che fallisca**

Run (dalla radice): `pnpm test packages/contracts/src/candidate-webhook.test.ts`
Expected: FAIL, il modulo non esiste.

- [ ] **Step 3: Implementare `packages/contracts/src/candidate-webhook.ts`**

```ts
import { z } from "zod/v4";

/** `source_organization` of every payload the chatbot sends (spec D22). */
export const CHATBOT_SOURCE = "kubri-chatbot";

/**
 * The envelope of `POST /api/webhooks/make/candidate`. It is the same for Make and for the
 * chatbot: `data` stays open so that Make's payloads keep working.
 */
export const candidateWebhookEnvelopeSchema = z.object({
  key: z.string().min(1),
  externalKey: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});
export type CandidateWebhookEnvelope = z.infer<typeof candidateWebhookEnvelopeSchema>;

const text = z.string().trim().min(1);
const textList = z.array(text);

/** Spec §12.1. `.strict` for whoever builds the payload; receivers use `.loose()` (D122). */
export const chatbotCandidateDataSchema = z.strictObject({
  source_organization: z.literal(CHATBOT_SOURCE),
  /** Explicit, never derived from `source_organization` (D22). */
  channel: z.enum(["whatsapp"]),
  interview_status: z.enum(["in_progress", "completed", "stopped"]),
  campaign_version: z.number().int().positive(),
  last_updated: z.iso.datetime(),
  /** Outcome of the optional `kubri_global` consent: whether the candidate is shared (D48). */
  is_kubri_privacy_accepted: z.boolean(),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  interview_language: z.string().regex(/^[a-z]{2}$/).optional(),

  first_name: text.optional(),
  last_name: text.optional(),
  /** dd/mm/yyyy (spec §12.1). */
  birthday: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  address: text.optional(),
  location: text.optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  email: z.email().optional(),

  working_permit: z.boolean().optional(),
  transport: text.optional(),
  driving_license: z.boolean().optional(),

  education_and_training: textList.optional(),
  work_experience: textList.optional(),
  skills_and_competences: textList.optional(),

  language: z.string().regex(/^[a-z]{2}$/).optional(),
  additional_languages: textList.optional(),
  italian_level: text.optional(),

  job_preferences: z
    .strictObject({
      preferred_job: text.optional(),
      part_time_preference: z.boolean().optional(),
      preferred_location: text.optional(),
      constraints: text.optional(),
      has_desired_job_experience: text.optional(),
    })
    .optional(),
  /** Not read by the dashboard today: kept in its `rawPayload`. */
  learning_preferences: z
    .strictObject({ is_interested: z.boolean().optional(), preference: text.optional() })
    .optional(),
  /** The campaign's custom fields, by key. */
  custom: z.record(z.string(), z.unknown()).optional(),

  /** A signed link that expires (D128). */
  cv_link_pdf: z
    .url()
    .refine((value) => URL.canParse(value) && new URL(value).protocol === "https:", {
      error: "must be an https: URL",
    })
    .optional(),
});
export type ChatbotCandidateData = z.infer<typeof chatbotCandidateDataSchema>;

export const chatbotCandidateWebhookSchema = candidateWebhookEnvelopeSchema.extend({
  data: chatbotCandidateDataSchema,
});
export type ChatbotCandidateWebhook = z.infer<typeof chatbotCandidateWebhookSchema>;

/**
 * A complete payload with invented data. The chatbot's mapping test must produce exactly this,
 * and the dashboard's tests read it: the contract test of spec §14 (D122).
 */
export const CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE = {
  key: "7b0f6c2e-1d0a-4a8e-9d57-3f1c2a9b4e10:2c9f5d8a-6b1e-4c37-8a52-9e0d7f3b1a64",
  externalKey: "global",
  data: {
    source_organization: CHATBOT_SOURCE,
    channel: "whatsapp",
    interview_status: "completed",
    campaign_version: 3,
    interview_language: "ar",
    last_updated: "2026-10-24T10:30:00.000Z",
    is_kubri_privacy_accepted: true,
    first_name: "Karim",
    last_name: "Benali",
    birthday: "12/05/1990",
    country: "MA",
    address: "Via Garibaldi 12, Bologna",
    location: "Bologna",
    phone: "+393334445566",
    email: "karim.benali@example.com",
    working_permit: true,
    transport: "bicicletta",
    driving_license: false,
    education_and_training: ["2006 - 2010 Liceo Ibn Rushd (Marocco): Diploma"],
    work_experience: ["2018 - 2020 Bologna: Magazziniere"],
    skills_and_competences: ["uso del muletto", "puntualità"],
    language: "ar",
    additional_languages: ["francese (intermedio)"],
    italian_level: "intermedio",
    job_preferences: {
      preferred_job: "magazziniere",
      part_time_preference: false,
      preferred_location: "Bologna",
      constraints: "non lavoro la domenica",
      has_desired_job_experience: "due anni in magazzino",
    },
    learning_preferences: { is_interested: true, preference: "corso per il muletto" },
    custom: { night_shifts: true },
    cv_link_pdf: "https://example.supabase.co/storage/v1/object/sign/bot-cv/cv/s1/1.pdf?token=abc",
  },
} as const satisfies ChatbotCandidateWebhook;
```

- [ ] **Step 4: Esportare da `packages/contracts/src/index.ts`**

Dopo le altre `export * from`, aggiungere: `export * from "./candidate-webhook";`

- [ ] **Step 5: Verificare che passi**

Run (dalla radice): `pnpm test packages/contracts`
Expected: PASS, compresi i test già presenti del pacchetto.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/candidate-webhook.ts packages/contracts/src/candidate-webhook.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): share the candidate webhook contract between chatbot and dashboard"
```

---

### Task 2: La dashboard legge il contratto, il canale esplicito e il CV

**Concetto: compatibile all'indietro.** Make continua a mandare i suoi payload per un po': le
modifiche non devono rompere nulla. La busta resta la stessa; solo i payload con
`source_organization = kubri-chatbot` vengono controllati nei dettagli. `channel` si legge per
primo (il vecchio trucco di ricavarlo da `source_organization` resta come ripiego per Make). Il
link del CV compare nella scheda CV che c'è già, ma solo se è un `https:` (il payload viene da
fuori: un `javascript:` non deve diventare un link).

**Files (in `apps/dashboard/`):**
- Modify: `src/lib/validations/webhook-candidate.ts`, `src/app/api/webhooks/make/candidate/route.ts`, `src/lib/make/normalize.ts`, `src/lib/candidates/service.ts`
- Create: `src/lib/candidates/cv-link.ts`
- Test: `src/__tests__/lib/candidates/cv-link.test.ts`, `src/__tests__/lib/make/normalize-for-upsert.test.ts`, `src/__tests__/app/api/webhooks/make/candidate.test.ts`, `src/__tests__/lib/validations/webhook-candidate.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`src/__tests__/lib/candidates/cv-link.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cvPdfLinkFromRawPayload } from "@/lib/candidates/cv-link";

const payload = (link: unknown) => ({ key: "k", externalKey: "global", data: { cv_link_pdf: link } });

describe("cvPdfLinkFromRawPayload", () => {
  it("returns an https link", () => {
    expect(cvPdfLinkFromRawPayload(payload("https://x.supabase.co/cv.pdf?token=abc"))).toBe(
      "https://x.supabase.co/cv.pdf?token=abc",
    );
  });

  it.each([
    ["no link", { key: "k", externalKey: "g", data: {} }],
    ["no data", { key: "k" }],
    ["a null payload", null],
    ["a string payload", "oops"],
    ["a non-string link", payload(42)],
    ["a javascript link", payload("javascript:alert(1)")],
    ["an http link", payload("http://x.example/cv.pdf")],
    ["a relative link", payload("/cv.pdf")],
  ])("returns an empty string for %s", (_name, raw) => {
    expect(cvPdfLinkFromRawPayload(raw)).toBe("");
  });
});
```

Aggiungere in `src/__tests__/lib/make/normalize-for-upsert.test.ts` (dopo gli altri `it`, nello
stesso `describe`; `POOL` è già definito nel file):

```ts
import { CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE } from "@kubri/contracts";

  describe("payloads of the chatbot (contract example)", () => {
    const chatbot = () => structuredClone(CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE) as unknown as Parameters<typeof normalizeForUpsert>[0];

    it("maps the shared example to a candidate", () => {
      const result = normalizeForUpsert(chatbot(), POOL);

      expect(result).toMatchObject({
        externalId: CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE.key,
        firstName: "Karim",
        lastName: "Benali",
        birthday: "12/05/1990",
        countryOfOrigin: "MA",
        location: "Bologna",
        phone: "+393334445566",
        email: "karim.benali@example.com",
        workingPermit: true,
        drivingLicense: false,
        meanOfTransport: "bicicletta",
        workExperience: ["2018 - 2020 Bologna: Magazziniere"],
        language: "ar",
        italianLevel: "intermedio",
        desiredJob: "magazziniere",
        partTimePreference: false,
        interviewLanguage: "ar",
        sourceOrganization: "kubri-chatbot",
        channel: "whatsapp",
        sharedWithGlobal: true,
      });
    });

    it("reads the explicit channel, whatever the source organization says", () => {
      const payload = chatbot();
      payload.data["source_organization"] = "kubri-chatbot";
      payload.data["channel"] = "whatsapp";

      expect(normalizeForUpsert(payload, POOL).channel).toBe("whatsapp");
    });

    it("keeps deriving the channel from the source for Make's payloads", () => {
      const make = { key: "k", externalKey: "global", data: { source_organization: "Kubri WhatsApp" } };

      expect(normalizeForUpsert(make, POOL).channel).toBe("whatsapp");
      expect(normalizeForUpsert({ ...make, data: { source_organization: "Kubri Bot" } }, POOL).channel).toBe("telegram");
    });
  });
```

Aggiungere in `src/__tests__/app/api/webhooks/make/candidate.test.ts` (nel `describe` principale;
usano i mock e gli helper già presenti nel file: `makeRequest`, `SECRET`, `POOL`,
`resolvePoolByExternalKey`, `prisma.candidate.upsert`):

```ts
  describe("payloads of the chatbot", () => {
    it("accepts the shared example", async () => {
      vi.mocked(resolvePoolByExternalKey).mockResolvedValue(POOL as never);
      vi.mocked(prisma.candidate.upsert).mockResolvedValue({
        id: "cand-1", skillsAndCompetences: [], workExperience: [], educationAndTraining: [], desiredJob: null, jobConstraints: null,
      } as never);

      const res = await POST(makeRequest(CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE, `Bearer ${SECRET}`));

      expect(res.status).toBe(200);
    });

    it("rejects a chatbot payload that breaks the contract, before touching the database", async () => {
      const broken = structuredClone(CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE) as unknown as { data: Record<string, unknown> };
      broken.data["birthday"] = "1990-05-12";

      const res = await POST(makeRequest(broken, `Bearer ${SECRET}`));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("validation_failed");
      expect(prisma.candidate.upsert).not.toHaveBeenCalled();
    });

    it("tolerates a key the dashboard does not know yet", async () => {
      vi.mocked(resolvePoolByExternalKey).mockResolvedValue(POOL as never);
      vi.mocked(prisma.candidate.upsert).mockResolvedValue({
        id: "cand-1", skillsAndCompetences: [], workExperience: [], educationAndTraining: [], desiredJob: null, jobConstraints: null,
      } as never);
      const newer = structuredClone(CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE) as unknown as { data: Record<string, unknown> };
      newer.data["a_field_from_the_future"] = 1;

      expect((await POST(makeRequest(newer, `Bearer ${SECRET}`))).status).toBe(200);
    });

    it("does not check Make's payloads against the chatbot contract", async () => {
      vi.mocked(resolvePoolByExternalKey).mockResolvedValue(POOL as never);
      vi.mocked(prisma.candidate.upsert).mockResolvedValue({
        id: "cand-1", skillsAndCompetences: [], workExperience: [], educationAndTraining: [], desiredJob: null, jobConstraints: null,
      } as never);

      const res = await POST(
        makeRequest({ key: "k", externalKey: "global", data: { birthday: "1990-05-12" } }, `Bearer ${SECRET}`),
      );

      expect(res.status).toBe(200);
    });
  });
```

con l'import in cima al file: `import { CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE } from "@kubri/contracts";`.

Aggiungere in `src/__tests__/lib/validations/webhook-candidate.test.ts`:

```ts
  it("is the envelope of the shared contract", async () => {
    const { candidateWebhookEnvelopeSchema } = await import("@kubri/contracts");
    const { makeCandidateWebhookSchema } = await import("@/lib/validations/webhook-candidate");

    expect(makeCandidateWebhookSchema).toBe(candidateWebhookEnvelopeSchema);
  });
```

- [ ] **Step 2: Verificare che falliscano**

Run (da `apps/dashboard/`): `pnpm test src/__tests__/lib/candidates/cv-link.test.ts src/__tests__/lib/make/normalize-for-upsert.test.ts src/__tests__/app/api/webhooks/make/candidate.test.ts src/__tests__/lib/validations/webhook-candidate.test.ts`
Expected: FAIL (`cv-link` non esiste; il canale esplicito non è letto; il contratto non è applicato).

- [ ] **Step 3: `src/lib/validations/webhook-candidate.ts`**

Il file completo diventa:

```ts
// The schema is shared with the chatbot (spec D19, D122): change it in @kubri/contracts.
import {
  CHATBOT_SOURCE,
  candidateWebhookEnvelopeSchema,
  chatbotCandidateDataSchema,
  type CandidateWebhookEnvelope,
} from "@kubri/contracts";

export const makeCandidateWebhookSchema = candidateWebhookEnvelopeSchema;
export type MakeCandidateWebhookPayload = CandidateWebhookEnvelope;

export { CHATBOT_SOURCE };

/** The chatbot's data, strictly checked but tolerant of keys added by a newer chatbot. */
export const chatbotDataReceiverSchema = chatbotCandidateDataSchema.loose();
```

- [ ] **Step 4: `src/app/api/webhooks/make/candidate/route.ts`**

Cambiare l'import in
`import { CHATBOT_SOURCE, chatbotDataReceiverSchema, makeCandidateWebhookSchema } from "@/lib/validations/webhook-candidate";`
e, subito dopo il blocco `if (!parsed.success) { … }`, aggiungere:

```ts
  // Payloads of the chatbot are checked against the shared contract; Make's are not (D122).
  if (parsed.data.data["source_organization"] === CHATBOT_SOURCE) {
    const chatbot = chatbotDataReceiverSchema.safeParse(parsed.data.data);
    if (!chatbot.success) {
      console.error(
        "[webhook make/candidate] chatbot payload breaks the contract",
        chatbot.error.flatten(),
      );
      return NextResponse.json(
        { error: "validation_failed", details: chatbot.error.flatten() },
        { status: 400 },
      );
    }
  }
```

- [ ] **Step 5: `src/lib/make/normalize.ts`**

Sostituire la funzione `deriveChannelOrNull` e la riga `channel: deriveChannelOrNull(...)`:

```ts
function deriveChannelOrNull(source: unknown): string | null {
  if (typeof source !== "string") return null;
  const s = source.toLowerCase();
  if (s.includes("whatsapp")) return "whatsapp";
  if (s.length > 0) return "telegram";
  return null;
}

/**
 * The chatbot sends `channel` explicitly (spec D22); Make's payloads only have the source
 * organization, from which the channel is guessed.
 */
function channelOrNull(data: Record<string, unknown>): string | null {
  const explicit = nullableString(data["channel"]);
  return explicit ? explicit.toLowerCase() : deriveChannelOrNull(data["source_organization"]);
}
```

e `channel: channelOrNull(d),`.

- [ ] **Step 6: `src/lib/candidates/cv-link.ts` e `service.ts`**

`src/lib/candidates/cv-link.ts`:

```ts
/**
 * The signed link to the CV the chatbot sends with every update (`cv_link_pdf`, spec §12.1),
 * read from the stored payload. Only `https:` links are returned: the payload comes from
 * outside and a link must never run script.
 */
export function cvPdfLinkFromRawPayload(raw: unknown): string {
  if (typeof raw !== "object" || raw === null || !("data" in raw)) return "";
  const data = raw.data;
  if (typeof data !== "object" || data === null || !("cv_link_pdf" in data)) return "";
  const link = data.cv_link_pdf;
  if (typeof link !== "string" || !URL.canParse(link)) return "";
  const url = new URL(link);
  return url.protocol === "https:" ? url.toString() : "";
}
```

In `src/lib/candidates/service.ts`: `import { cvPdfLinkFromRawPayload } from "./cv-link";` e sostituire
`cvPdfLink: "",` con `cvPdfLink: cvPdfLinkFromRawPayload(c.rawPayload),`.

- [ ] **Step 7: Verificare che passino**

Run (da `apps/dashboard/`): `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: tutti verdi. Nessuna migrazione e nessuna stringa nuova (la scheda CV ha già le sue
etichette in `it.ts` e `en.ts`).

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src
git commit -m "feat(dashboard): validate the chatbot contract, read the explicit channel and the cv link"
```

---

### Task 3: Dipendenza dal contratto, configurazione e code

**Concetto: una coda per gli scarti.** Quando Kubri risponde con un errore definitivo (un 401
perché il segreto è sbagliato) ritentare non serve, ma il job non va nemmeno perso: finisce nella
coda `kubri-webhook-dead`, con il motivo, dove un operatore lo trova. Qui si prepara quella
strada, il nuovo evento `cv.generated` e la configurazione dei due servizi esterni.

**Files:**
- Modify: `package.json`, `src/engine/effects.ts`, `src/store/queue.ts`, `src/runtime/memory-queue.ts`, `src/i18n/system-catalog.ts`, `src/i18n/resolve.ts`, `.env.example`
- Create: `src/integrations/config.ts`
- Test: `tests/unit/integrations/config.test.ts`, `tests/unit/runtime/memory-queue.test.ts`, `tests/unit/i18n/resolve-key.test.ts`, `tests/integration/queue.test.ts`

- [ ] **Step 1: Aggiungere la dipendenza**

Da `apps/chatbot/`:

```bash
pnpm add @kubri/contracts@workspace:* pdfkit && pnpm add -D @types/pdfkit
```

Expected: `package.json` ha `"@kubri/contracts": "workspace:*"` e `pdfkit`; il lockfile alla radice si
aggiorna. `pdfkit` (Task 9) è la sola libreria nuova di terze parti: giustificazione in D127.

- [ ] **Step 2: Scrivere i test che falliscono**

`tests/unit/integrations/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseKubriConfig, parseStorageConfig } from "../../../src/integrations/config";

describe("parseKubriConfig", () => {
  it("needs the base URL and the shared secret", () => {
    expect(parseKubriConfig({ KUBRI_BASE_URL: "https://app.kubri.it/", KUBRI_WEBHOOK_SECRET: "s" })).toEqual({
      baseUrl: "https://app.kubri.it",
      secret: "s",
    });
    expect(() => parseKubriConfig({})).toThrow(/KUBRI_BASE_URL/);
  });

  it("refuses a URL that is not http(s), without echoing the secret", () => {
    expect(() => parseKubriConfig({ KUBRI_BASE_URL: "ftp://x", KUBRI_WEBHOOK_SECRET: "topsecret" })).toThrow(/KUBRI_BASE_URL/);
    expect(() => parseKubriConfig({ KUBRI_BASE_URL: "ftp://x", KUBRI_WEBHOOK_SECRET: "topsecret" })).not.toThrow(/topsecret/);
  });
});

describe("parseStorageConfig", () => {
  it("has defaults for the bucket and the link lifetime", () => {
    expect(parseStorageConfig({ SUPABASE_URL: "https://x.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "k" })).toEqual({
      url: "https://x.supabase.co",
      serviceKey: "k",
      bucket: "bot-cv",
      linkTtlSeconds: 14 * 24 * 3600,
    });
  });

  it("reads every variable", () => {
    expect(
      parseStorageConfig({
        SUPABASE_URL: "https://x.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "k",
        CV_BUCKET: "cv-dev",
        CV_LINK_TTL_DAYS: "7",
      }),
    ).toMatchObject({ bucket: "cv-dev", linkTtlSeconds: 7 * 24 * 3600 });
  });

  it("refuses what would not work, naming the variable only", () => {
    expect(() => parseStorageConfig({ SUPABASE_URL: "https://x.supabase.co" })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => parseStorageConfig({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", CV_BUCKET: "A B" })).toThrow(/CV_BUCKET/);
    expect(() => parseStorageConfig({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", CV_LINK_TTL_DAYS: "0" })).toThrow(/CV_LINK_TTL_DAYS/);
  });
});
```

In `tests/unit/runtime/memory-queue.test.ts` aggiungere:

```ts
  it("records dead letters apart from jobs", async () => {
    const queue = new MemoryJobQueue();

    await queue.deadLetter("kubri-webhook", { sessionId: "s", event: "consents.accepted" }, "unauthorized");

    expect(queue.jobs).toEqual([]);
    expect(queue.deadLetters).toEqual([
      { name: "kubri-webhook", payload: { sessionId: "s", event: "consents.accepted" }, reason: "unauthorized" },
    ]);
  });
```

In `tests/unit/i18n/resolve-key.test.ts` aggiungere:

```ts
describe("resolveKey with parameters", () => {
  it("fills the parameters of a catalog text", async () => {
    const result = await resolver().resolveKey("cv.ready", target("it"), { link: "https://x.example/cv.pdf" });

    expect(result.text).toContain("https://x.example/cv.pdf");
    expect(result.missingParams).toEqual([]);
  });

  it("has a text for a CV that could not be made", async () => {
    expect((await resolver().resolveKey("cv.failed", target("it"))).text).toContain("non sono riuscito");
  });
});
```

In `tests/integration/queue.test.ts` aggiungere nel `describe("workers")`:

```ts
  it("sends a job straight to the dead letter queue, with the reason", async () => {
    await runtime.queue.deadLetter("kubri-webhook", { sessionId: "s", event: "cv.generated" }, "unauthorized");

    expect(await countJobs(db, "kubri-webhook-dead")).toBe(1);
    const [job] = await peekQueue(db, "kubri-webhook-dead");
    expect(job?.data).toEqual({ sessionId: "s", event: "cv.generated", reason: "unauthorized" });
  });

  it("accepts the retry counter of a cv job", async () => {
    const seen: unknown[] = [];
    await runtime.work("cv", (payload) => {
      seen.push(payload);
      return Promise.resolve();
    }, { batchSize: 1, pollingIntervalSeconds: 0.5 });

    await runtime.queue.enqueue("cv", { sessionId: "s", attempt: 2 });

    await expect.poll(() => seen, { timeout: 15_000, interval: 200 }).toEqual([{ sessionId: "s", attempt: 2 }]);
  });
```

- [ ] **Step 3: Verificare che falliscano**

Run: `pnpm test tests/unit/integrations tests/unit/runtime/memory-queue.test.ts tests/unit/i18n/resolve-key.test.ts && pnpm test:integration tests/integration/queue.test.ts`
Expected: FAIL (modulo `integrations/config` assente, `deadLetter` e `cv.ready` mancano).

- [ ] **Step 4: Implementare `src/integrations/config.ts`**

```ts
import { z } from "zod";

const DAY_SECONDS = 24 * 3600;

const present = (source: Readonly<Record<string, string | undefined>>) =>
  Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""));

const messages = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");

/** No trailing slash: paths are appended to it. */
const baseUrl = z
  .url()
  .refine((value) => /^https?:$/.test(new URL(value).protocol), { error: "must be an http(s) URL" })
  .transform((value) => value.replace(/\/+$/, ""));

const KubriEnvSchema = z.object({
  KUBRI_BASE_URL: baseUrl,
  KUBRI_WEBHOOK_SECRET: z.string().min(1),
});

export interface KubriConfig {
  readonly baseUrl: string;
  readonly secret: string;
}

/** Spec §12.1. Errors name the variable and never echo a value. */
export function parseKubriConfig(source: Readonly<Record<string, string | undefined>>): KubriConfig {
  const result = KubriEnvSchema.safeParse(present(source));
  if (!result.success) throw new Error(`Invalid Kubri configuration: ${messages(result.error)}`);
  return { baseUrl: result.data.KUBRI_BASE_URL, secret: result.data.KUBRI_WEBHOOK_SECRET };
}

const StorageEnvSchema = z.object({
  SUPABASE_URL: baseUrl,
  /** Server only (CLAUDE.md, security rule 6): the worker's environment, never the web's. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CV_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "lowercase letters, digits and dashes")
    .default("bot-cv"),
  CV_LINK_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(14),
});

export interface StorageConfig {
  readonly url: string;
  readonly serviceKey: string;
  readonly bucket: string;
  readonly linkTtlSeconds: number;
}

/** Spec §12.2, D128, D129. */
export function parseStorageConfig(source: Readonly<Record<string, string | undefined>>): StorageConfig {
  const result = StorageEnvSchema.safeParse(present(source));
  if (!result.success) throw new Error(`Invalid storage configuration: ${messages(result.error)}`);
  const env = result.data;
  return {
    url: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    bucket: env.CV_BUCKET,
    linkTtlSeconds: env.CV_LINK_TTL_DAYS * DAY_SECONDS,
  };
}
```

- [ ] **Step 5: `src/engine/effects.ts` — il nuovo evento**

Sostituire il tipo `KubriEvent` con:

```ts
/**
 * Events sent to the Kubri platform (spec §12.1). `cv.generated` is not an engine effect:
 * the cv job enqueues it (plan 10).
 */
export type KubriEvent =
  | "consents.accepted"
  | "block.completed"
  | "interview.completed"
  | "profile.updated"
  | "cv.generated";
```

- [ ] **Step 6: `src/store/queue.ts`**

Nell'elenco `KUBRI_EVENTS` aggiungere `"cv.generated"`. Lo schema del job `cv` diventa
`cv: z.strictObject({ sessionId: z.string(), attempt: z.number().int().min(1).optional() }),`.
Nell'interfaccia `JobQueue` aggiungere:

```ts
  /**
   * A job that cannot succeed (a definitive error): straight to the queue's dead letter queue
   * with the reason, so an operator finds it there (D126). It is never retried.
   */
  deadLetter<Q extends QueueName>(name: Q, payload: JobPayloads[Q], reason: string): Promise<void>;
```

e nell'oggetto `queue` di `createQueueRuntime`, dopo `enqueue`:

```ts
    async deadLetter(name, payload, reason) {
      await boss.send(dead(name), { ...payload, reason });
    },
```

- [ ] **Step 7: `src/runtime/memory-queue.ts`**

Aggiungere:

```ts
export interface DeadLetter {
  readonly name: QueueName;
  readonly payload: unknown;
  readonly reason: string;
}
```

nella classe `readonly deadLetters: DeadLetter[] = [];` e

```ts
  deadLetter<Q extends QueueName>(name: Q, payload: JobPayloads[Q], reason: string): Promise<void> {
    this.deadLetters.push({ name, payload, reason });
    return Promise.resolve();
  }
```

- [ ] **Step 8: Catalogo e `resolveKey` con parametri**

In `src/i18n/system-catalog.ts`: aggiungere `"cv.ready"`, `"cv.failed"` a `I18N_TEXT_KEYS` e, in
`SYSTEM_CATALOG`:

```ts
  "cv.ready": {
    params: { link: "text" },
    text: {
      it: "Ecco il tuo CV: {link}\nIl link resta valido per qualche giorno: scaricalo e conservalo.",
    },
  },
  "cv.failed": {
    params: {},
    text: { it: "Mi dispiace, non sono riuscito a preparare il tuo CV. Riprova più tardi." },
  },
```

In `src/i18n/resolve.ts`: nell'interfaccia `TextResolver` la firma di `resolveKey` diventa
`resolveKey(key: I18nTextKey, target: TextTarget, params?: TextParams): Promise<ResolvedText>;`
e nell'implementazione

```ts
  function resolveKey(key: I18nTextKey, target: TextTarget, params: TextParams = {}): Promise<ResolvedText> {
    return resolveSystem(key, params, target);
  }
```

(`TextParams` è già importato da `../engine/text-ref`.)

- [ ] **Step 9: Variabili d'ambiente**

In fondo a `.env.example`:

```bash
# Integrations (plan 10). Kubri's dashboard and the private storage of CVs; the worker needs them,
# the web process does not. SUPABASE_SERVICE_ROLE_KEY is a server secret.
# KUBRI_BASE_URL=https://dashboard-dev.example
# KUBRI_WEBHOOK_SECRET=
# SUPABASE_URL=https://<project>.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=
# CV_BUCKET=bot-cv
# CV_LINK_TTL_DAYS=14
```

- [ ] **Step 10: Verificare che passino**

Run: `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 11: Commit**

```bash
pnpm exec prettier --write src tests .env.example
git add package.json ../../pnpm-lock.yaml .env.example src/integrations/config.ts src/engine/effects.ts src/store/queue.ts src/runtime/memory-queue.ts src/i18n/system-catalog.ts src/i18n/resolve.ts tests/unit/integrations/config.test.ts tests/unit/runtime/memory-queue.test.ts tests/unit/i18n/resolve-key.test.ts tests/integration/queue.test.ts
git commit -m "feat(chatbot): add integration config, dead letters, the cv.generated event and cv texts"
```

---

### Task 4: La mappatura del profilo verso Kubri

**Concetto: una funzione pura, e un esempio d'oro.** Tradurre il profilo del chatbot nelle chiavi
della dashboard è una funzione senza effetti: prende un'istantanea (contatto, campagna, sessione,
profilo) e restituisce il corpo del webhook. Per questo si prova con esempi, senza database. Il
test principale è quello di contratto: dato un profilo completo, il risultato è **esattamente**
l'esempio del pacchetto condiviso. E il risultato passa sempre dallo schema del contratto prima
di uscire: se la mappatura derivasse, il job fallirebbe in modo visibile.

**Files:**
- Create: `src/integrations/kubri/payload.ts`
- Test: `tests/unit/integrations/kubri-payload.test.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
import { CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE } from "@kubri/contracts";
import { describe, expect, it } from "vitest";
import { buildKubriPayload, type KubriSnapshot } from "../../../src/integrations/kubri/payload";

const META = { confidence: 0.95, status: "inferred", source: "extraction" } as const;

const SNAPSHOT: KubriSnapshot = {
  contact: { id: "7b0f6c2e-1d0a-4a8e-9d57-3f1c2a9b4e10", channel: "whatsapp", phoneE164: "+393334445566" },
  campaign: { id: "2c9f5d8a-6b1e-4c37-8a52-9e0d7f3b1a64", externalKey: "global", version: 3 },
  session: { status: "completed", language: "ar" },
  profile: {
    standard: {
      firstName: "Karim",
      lastName: "Benali",
      birthday: "1990-05-12",
      country: "MA",
      address: "Via Garibaldi 12, Bologna",
      location: "Bologna",
      email: "karim.benali@example.com",
      workingPermit: true,
      transport: "bicicletta",
      drivingLicense: false,
      educationAndTraining: ["2006 - 2010 Liceo Ibn Rushd (Marocco): Diploma"],
      workExperience: ["2018 - 2020 Bologna: Magazziniere"],
      skillsAndCompetences: ["uso del muletto", "puntualità"],
      language: "ar",
      additionalLanguages: ["francese (intermedio)"],
      italianLevel: "intermedio",
      "jobPreferences.preferredJob": "magazziniere",
      "jobPreferences.partTime": false,
      "jobPreferences.preferredLocation": "Bologna",
      "jobPreferences.constraints": "non lavoro la domenica",
      "jobPreferences.hasDesiredJobExperience": "due anni in magazzino",
      "learningPreferences.isInterested": true,
      "learningPreferences.preference": "corso per il muletto",
    },
    custom: { night_shifts: true },
    fieldMeta: { firstName: META },
    sharedWithGlobal: true,
    updatedAt: new Date("2026-10-24T10:30:00.000Z"),
  },
};
const LINK = CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE.data.cv_link_pdf;

describe("buildKubriPayload (spec §12.1, D123)", () => {
  it("produces exactly the shared contract example (the contract test, §14)", () => {
    expect(buildKubriPayload(SNAPSHOT, LINK)).toEqual(CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE);
  });

  it("builds the key from the contact and the campaign: two UUIDs, no personal data (D20)", () => {
    expect(buildKubriPayload(SNAPSHOT, null).key).toBe(`${SNAPSHOT.contact.id}:${SNAPSHOT.campaign.id}`);
  });

  it("omits what is missing instead of sending nulls, and the link when there is no CV", () => {
    const sparse: KubriSnapshot = {
      ...SNAPSHOT,
      session: { status: "active", language: null },
      profile: { standard: { firstName: "Karim" }, custom: {}, fieldMeta: {}, sharedWithGlobal: false, updatedAt: new Date("2026-10-24T10:30:00.000Z") },
    };

    const { data } = buildKubriPayload(sparse, null);

    expect(data).toEqual({
      source_organization: "kubri-chatbot",
      channel: "whatsapp",
      interview_status: "in_progress",
      campaign_version: 3,
      last_updated: "2026-10-24T10:30:00.000Z",
      is_kubri_privacy_accepted: false,
      phone: "+393334445566",
      first_name: "Karim",
    });
  });

  it.each([
    ["active", "in_progress"],
    ["needs_attention", "in_progress"],
    ["completed", "completed"],
    ["stopped", "stopped"],
    ["abandoned", "stopped"],
  ] as const)("maps the session status %s to %s", (status, expected) => {
    expect(buildKubriPayload({ ...SNAPSHOT, session: { ...SNAPSHOT.session, status } }, null).data.interview_status).toBe(expected);
  });

  it("turns the ISO birthday into dd/mm/yyyy and never sends coordinates the chatbot does not have (D124)", () => {
    const { data } = buildKubriPayload(SNAPSHOT, null);

    expect(data.birthday).toBe("12/05/1990");
    expect(data).not.toHaveProperty("lat");
    expect(data).not.toHaveProperty("lng");
  });

  it("sends coordinates if the profile ever holds them", () => {
    const withCoordinates: KubriSnapshot = {
      ...SNAPSHOT,
      profile: { ...SNAPSHOT.profile, standard: { ...SNAPSHOT.profile.standard, lat: 44.49, lng: 11.34 } },
    };

    expect(buildKubriPayload(withCoordinates, null).data).toMatchObject({ lat: 44.49, lng: 11.34 });
  });

  it("leaves out empty groups", () => {
    const noGroups: KubriSnapshot = {
      ...SNAPSHOT,
      profile: { ...SNAPSHOT.profile, standard: { firstName: "Karim" }, custom: {} },
    };

    const { data } = buildKubriPayload(noGroups, null);

    expect(data).not.toHaveProperty("job_preferences");
    expect(data).not.toHaveProperty("learning_preferences");
    expect(data).not.toHaveProperty("custom");
  });

  it("refuses to send a payload that breaks the contract", () => {
    const broken: KubriSnapshot = {
      ...SNAPSHOT,
      profile: { ...SNAPSHOT.profile, standard: { ...SNAPSHOT.profile.standard, country: "Marocco" } },
    };

    expect(() => buildKubriPayload(broken, null)).toThrow();
  });
});
```

- [ ] **Step 2: Verificare che fallisca**

Run: `pnpm test tests/unit/integrations/kubri-payload.test.ts`
Expected: FAIL, il modulo non esiste.

- [ ] **Step 3: Implementare `src/integrations/kubri/payload.ts`**

```ts
import {
  CHATBOT_SOURCE,
  chatbotCandidateWebhookSchema,
  type ChatbotCandidateWebhook,
} from "@kubri/contracts";
import type { StoredProfile } from "../../runtime/profile-codec";

export type SessionStatusName = "active" | "completed" | "stopped" | "abandoned" | "needs_attention";

/** Everything the payload is built from, read from the database at send time (D125). */
export interface KubriSnapshot {
  readonly contact: { readonly id: string; readonly channel: "whatsapp"; readonly phoneE164: string };
  readonly campaign: { readonly id: string; readonly externalKey: string; readonly version: number };
  readonly session: { readonly status: SessionStatusName; readonly language: string | null };
  readonly profile: StoredProfile & {
    readonly sharedWithGlobal: boolean;
    readonly updatedAt: Date;
  };
}

type Data = Record<string, unknown>;

const STATUS: Readonly<Record<SessionStatusName, "in_progress" | "completed" | "stopped">> = {
  active: "in_progress",
  needs_attention: "in_progress",
  completed: "completed",
  stopped: "stopped",
  abandoned: "stopped",
};

/** Profile field → key in `data` (spec §12.1). */
const DIRECT: readonly (readonly [string, string])[] = [
  ["firstName", "first_name"],
  ["lastName", "last_name"],
  ["country", "country"],
  ["address", "address"],
  ["location", "location"],
  ["lat", "lat"],
  ["lng", "lng"],
  ["email", "email"],
  ["workingPermit", "working_permit"],
  ["transport", "transport"],
  ["drivingLicense", "driving_license"],
  ["educationAndTraining", "education_and_training"],
  ["workExperience", "work_experience"],
  ["skillsAndCompetences", "skills_and_competences"],
  ["language", "language"],
  ["additionalLanguages", "additional_languages"],
  ["italianLevel", "italian_level"],
];

const JOB_PREFERENCES: readonly (readonly [string, string])[] = [
  ["jobPreferences.preferredJob", "preferred_job"],
  ["jobPreferences.partTime", "part_time_preference"],
  ["jobPreferences.preferredLocation", "preferred_location"],
  ["jobPreferences.constraints", "constraints"],
  ["jobPreferences.hasDesiredJobExperience", "has_desired_job_experience"],
];

const LEARNING_PREFERENCES: readonly (readonly [string, string])[] = [
  ["learningPreferences.isInterested", "is_interested"],
  ["learningPreferences.preference", "preference"],
];

/** Only what is there: the receiver rewrites the record, so an omitted key means "empty". */
function pick(
  source: Readonly<Record<string, unknown>>,
  mapping: readonly (readonly [string, string])[],
): Data {
  const out: Data = {};
  for (const [from, to] of mapping) {
    if (Object.hasOwn(source, from) && source[from] !== undefined && source[from] !== null) {
      out[to] = source[from];
    }
  }
  return out;
}

/** "1990-05-12" → "12/05/1990" (spec §6, §12.1). Anything else passes through for the contract to refuse. */
function toItalianDate(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

const nonEmpty = (value: Data): Data | undefined => (Object.keys(value).length > 0 ? value : undefined);

/**
 * Spec §12.1: the profile in the keys the dashboard reads. The result goes through the shared
 * contract before it leaves (D122): a mapping that drifts fails here, not in production.
 */
export function buildKubriPayload(snapshot: KubriSnapshot, cvLink: string | null): ChatbotCandidateWebhook {
  const { profile, contact, campaign, session } = snapshot;
  const standard = profile.standard;
  const data: Data = {
    source_organization: CHATBOT_SOURCE,
    channel: contact.channel,
    interview_status: STATUS[session.status],
    campaign_version: campaign.version,
    last_updated: profile.updatedAt.toISOString(),
    is_kubri_privacy_accepted: profile.sharedWithGlobal,
    phone: contact.phoneE164,
    ...(session.language ? { interview_language: session.language } : {}),
    ...pick(standard, DIRECT),
    ...(Object.hasOwn(standard, "birthday") ? { birthday: toItalianDate(standard["birthday"]) } : {}),
  };
  const jobPreferences = nonEmpty(pick(standard, JOB_PREFERENCES));
  if (jobPreferences) data["job_preferences"] = jobPreferences;
  const learningPreferences = nonEmpty(pick(standard, LEARNING_PREFERENCES));
  if (learningPreferences) data["learning_preferences"] = learningPreferences;
  const custom = nonEmpty({ ...profile.custom });
  if (custom) data["custom"] = custom;
  if (cvLink) data["cv_link_pdf"] = cvLink;

  return chatbotCandidateWebhookSchema.parse({
    key: `${contact.id}:${campaign.id}`,
    externalKey: campaign.externalKey,
    data,
  });
}
```

- [ ] **Step 4: Verificare che passi**

Run: `pnpm test tests/unit/integrations && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS. Se il confronto con l'esempio fallisce per una chiave, il difetto è nella tabella
`DIRECT` o nei valori dell'istantanea del test: l'esempio del pacchetto è la verità.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write src/integrations tests/unit/integrations
git add src/integrations/kubri/payload.ts tests/unit/integrations/kubri-payload.test.ts
git commit -m "feat(chatbot): map the profile to the Kubri webhook contract"
```

---

### Task 5: `CvDocument` e l'istantanea per i job

**Concetto: leggere tutto in un punto.** Entrambi i job partono da un identificativo di sessione e
hanno bisogno di molti pezzi: sessione, contatto, campagna, profilo, ultimo CV. Una sola funzione
dello store li legge e restituisce un'istantanea; i job non conoscono Prisma. Qui nasce anche
`CvDocument` (rimandato dal piano 08 al primo che lo usa).

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_cv_documents/migration.sql`, `src/store/cv.ts`, `src/store/snapshot.ts`
- Test: `tests/integration/store-snapshot.test.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { insertCvDocument, latestCvDocument } from "../../src/store/cv";
import { applyProfileFields, setSharedWithGlobal } from "../../src/store/profiles";
import { loadSnapshot } from "../../src/store/snapshot";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { seedScenario, startSession, type Scenario } from "./helpers/runtime";

const db = createTestDatabase();
let s: Scenario;
let sessionId = "";

beforeEach(async () => {
  await resetBotSchema(db);
  s = await seedScenario(db);
  sessionId = (await startSession(s)).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("loadSnapshot", () => {
  it("is null for a session that does not exist (it was deleted)", async () => {
    expect(await loadSnapshot(db, "6f1c5f0e-3b8a-4a43-9d6e-5d0b6f7d2a11")).toBeNull();
  });

  it("reads the contact, the campaign, the session and the profile", async () => {
    await applyProfileFields(db, sessionId, "extraction", null, [
      { field: "firstName", value: "Mario", confidence: 0.95, status: "inferred" },
      { field: "custom.night_shifts", value: true, confidence: 0.9, status: "inferred" },
    ]);
    await setSharedWithGlobal(db, sessionId, true);

    const snapshot = await loadSnapshot(db, sessionId);

    expect(snapshot).toMatchObject({
      sessionId,
      contact: { id: s.contactId, channel: "whatsapp", externalId: s.externalId, phoneE164: s.phone },
      campaign: { externalKey: "global", version: 1 },
      session: { status: "active", language: null },
      profile: { standard: { firstName: "Mario" }, custom: { night_shifts: true }, sharedWithGlobal: true },
      cv: null,
    });
    expect(snapshot?.campaign.id).toBe(s.campaign?.campaignId);
    expect(snapshot?.profile.updatedAt).toBeInstanceOf(Date);
  });

  it("reports the newest CV", async () => {
    const profile = await db.candidateProfile.findUniqueOrThrow({ where: { sessionId } });
    await insertCvDocument(db, { profileId: profile.id, template: "default-v1", storageKey: "cv/s/1.pdf" });
    await insertCvDocument(db, { profileId: profile.id, template: "default-v1", storageKey: "cv/s/2.pdf" });

    expect((await loadSnapshot(db, sessionId))?.cv).toMatchObject({ storageKey: "cv/s/2.pdf" });
    expect((await latestCvDocument(db, sessionId))?.storageKey).toBe("cv/s/2.pdf");
  });
});
```

- [ ] **Step 2: Verificare che fallisca**

Run: `pnpm test:integration tests/integration/store-snapshot.test.ts`
Expected: FAIL, i moduli e il modello non esistono.

- [ ] **Step 3: Aggiungere `CvDocument` a `prisma/schema.prisma`**

Nel modello `CandidateProfile` aggiungere, accanto a `changes ProfileChange[]`:
`cvDocuments CvDocument[]`. In fondo al file:

```prisma
enum CvKind {
  generated
  uploaded

  @@schema("bot")
}

/// A CV in the private bucket (spec §12.2). The newest one counts (D129).
model CvDocument {
  id         String           @id @default(uuid()) @db.Uuid
  profileId  String           @db.Uuid
  kind       CvKind           @default(generated)
  template   String
  /// Path in the private bucket: never a link. Links are signed when they are needed.
  storageKey String
  createdAt  DateTime         @default(now())

  profile CandidateProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@index([profileId, createdAt])
  @@schema("bot")
}
```

- [ ] **Step 4: Generare, qualificare e applicare la migrazione**

```bash
pnpm db:migrate --name cv_documents --create-only
```

Sostituire l'intero contenuto di `prisma/migrations/<timestamp>_cv_documents/migration.sql` con:

```sql
-- CreateEnum
CREATE TYPE "bot"."CvKind" AS ENUM ('generated', 'uploaded');

-- CreateTable
CREATE TABLE "bot"."CvDocument" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "kind" "bot"."CvKind" NOT NULL DEFAULT 'generated',
    "template" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CvDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CvDocument_profileId_createdAt_idx" ON "bot"."CvDocument"("profileId", "createdAt");

-- AddForeignKey
ALTER TABLE "bot"."CvDocument" ADD CONSTRAINT "CvDocument_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "bot"."CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

```bash
pnpm db:migrate
pnpm exec prisma generate
pnpm db:migrate --name drift_check --create-only
```

Expected: l'ultimo comando risponde `Already in sync…`; se crea una migrazione, cancellarla e
allineare il SQL (come nei piani 08 e 09).

- [ ] **Step 5: Implementare `src/store/cv.ts`**

```ts
import type { Tx } from "./db";

export interface CvDocumentInput {
  readonly profileId: string;
  readonly template: string;
  readonly storageKey: string;
}

export async function insertCvDocument(tx: Tx, input: CvDocumentInput): Promise<void> {
  await tx.cvDocument.create({ data: { ...input, kind: "generated" } });
}

export interface CvDocumentRecord {
  readonly id: string;
  readonly storageKey: string;
  readonly createdAt: Date;
}

/** The newest CV of a session's profile (D129). */
export function latestCvDocument(tx: Tx, sessionId: string): Promise<CvDocumentRecord | null> {
  return tx.cvDocument.findFirst({
    where: { profile: { sessionId } },
    orderBy: { createdAt: "desc" },
    select: { id: true, storageKey: true, createdAt: true },
  });
}
```

- [ ] **Step 6: Implementare `src/store/snapshot.ts`**

```ts
import { z } from "zod";
import { parseStoredProfile, type StoredProfile } from "../runtime/profile-codec";
import { latestCvDocument, type CvDocumentRecord } from "./cv";
import type { Tx } from "./db";
import type { SessionStatusName } from "./sessions";

/** The campaign's definition has more; the jobs only need its pool key. */
const DefinitionSchema = z.object({ externalKey: z.string().min(1) });

export interface Snapshot {
  readonly sessionId: string;
  readonly contact: {
    readonly id: string;
    readonly channel: "whatsapp";
    readonly externalId: string;
    readonly phoneE164: string;
  };
  readonly campaign: {
    readonly id: string;
    readonly externalKey: string;
    readonly version: number;
    readonly versionId: string;
  };
  readonly session: {
    readonly status: SessionStatusName;
    readonly language: string | null;
    readonly senderNumberId: string;
  };
  readonly profile: StoredProfile & {
    readonly id: string;
    readonly sharedWithGlobal: boolean;
    readonly updatedAt: Date;
  };
  readonly cv: CvDocumentRecord | null;
}

/**
 * Everything the integration jobs need, read at the moment they run (D125). null = the
 * session is gone (the contact was deleted): there is nothing to send.
 */
export async function loadSnapshot(tx: Tx, sessionId: string): Promise<Snapshot | null> {
  const session = await tx.session.findUnique({
    where: { id: sessionId },
    include: {
      contact: true,
      profile: true,
      campaignVersion: { select: { id: true, campaignId: true, version: true, definition: true } },
    },
  });
  if (!session?.profile) return null;
  const definition = DefinitionSchema.parse(session.campaignVersion.definition);
  return {
    sessionId: session.id,
    contact: {
      id: session.contact.id,
      channel: "whatsapp",
      externalId: session.contact.externalId,
      phoneE164: session.contact.phoneE164,
    },
    campaign: {
      id: session.campaignVersion.campaignId,
      externalKey: definition.externalKey,
      version: session.campaignVersion.version,
      versionId: session.campaignVersion.id,
    },
    session: { status: session.status, language: session.language, senderNumberId: session.senderNumberId },
    profile: {
      ...parseStoredProfile(session.profile),
      id: session.profile.id,
      sharedWithGlobal: session.profile.sharedWithGlobal,
      updatedAt: session.profile.updatedAt,
    },
    cv: await latestCvDocument(tx, sessionId),
  };
}
```

- [ ] **Step 7: Verificare che passi**

Run: `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi (compreso `migrations.test.ts`).

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write src tests
git add prisma/schema.prisma prisma/migrations src/store/cv.ts src/store/snapshot.ts tests/integration/store-snapshot.test.ts
git commit -m "feat(chatbot): store CV documents and read a session snapshot for the integration jobs"
```

---

### Task 6: Il client HTTP verso Kubri

**Concetto: chi è colpa di chi.** Dopo una chiamata fallita bisogna sapere se ha senso riprovare.
Un 5xx, un timeout o un 429 sono guasti *dell'altro lato o della rete*: si ritenta. Un 401 (il
segreto è sbagliato), un 400 (il payload non rispetta il contratto) o un 422 (il pool non esiste)
sono errori *nostri*: ritentare con lo stesso payload darebbe lo stesso errore, quindi sono
definitivi. Il client dice quale dei due è, e non stampa mai il segreto né il corpo.

**Files:**
- Create: `src/integrations/kubri/client.ts`
- Test: `tests/unit/integrations/kubri-client.test.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
import { CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE as BODY } from "@kubri/contracts";
import { describe, expect, it } from "vitest";
import { createKubriClient, FakeKubriClient, type FetchLike } from "../../../src/integrations/kubri/client";

interface Call { url: string; init: RequestInit }

function client(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(respond());
  };
  return { calls, client: createKubriClient({ baseUrl: "https://app.kubri.it", secret: "s3cret", fetch }) };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("createKubriClient (spec §12.1)", () => {
  it("posts the payload to the existing endpoint with the bearer secret", async () => {
    const { client: c, calls } = client(() => json({ ok: true, candidateId: "cand-1" }));

    expect(await c.send(BODY as never)).toEqual({ ok: true });

    expect(calls[0]?.url).toBe("https://app.kubri.it/api/webhooks/make/candidate");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer s3cret", "content-type": "application/json" });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(BODY);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [401, { error: "unauthorized" }, "permanent", "unauthorized"],
    [400, { error: "validation_failed" }, "permanent", "validation_failed"],
    [422, { error: "unknown_pool" }, "permanent", "unknown_pool"],
    [404, {}, "permanent", "http_404"],
    [500, { error: "internal_error" }, "transient", "http_500"],
    [502, {}, "transient", "http_502"],
    [429, {}, "transient", "http_429"],
    [408, {}, "transient", "http_408"],
  ])("HTTP %i is %s (%s)", async (status, body, kind, code) => {
    const { client: c } = client(() => json(body, status));

    expect(await c.send(BODY as never)).toEqual({ ok: false, kind, code, status });
  });

  it("treats a timeout and a network failure as transient", async () => {
    const timeout = createKubriClient({ baseUrl: "https://x", secret: "s", fetch: () => Promise.reject(new DOMException("t", "TimeoutError")) });
    const offline = createKubriClient({ baseUrl: "https://x", secret: "s", fetch: () => Promise.reject(new TypeError("fetch failed")) });

    expect(await timeout.send(BODY as never)).toEqual({ ok: false, kind: "transient", code: "timeout" });
    expect(await offline.send(BODY as never)).toEqual({ ok: false, kind: "transient", code: "network" });
  });

  it("never lets the secret or the body into a result", async () => {
    const { client: c } = client(() => json({ error: "unauthorized", echoed: "Bearer s3cret", first_name: "Karim" }, 401));

    const serialized = JSON.stringify(await c.send(BODY as never));

    expect(serialized).not.toContain("s3cret");
    expect(serialized).not.toContain("Karim");
  });
});

describe("FakeKubriClient", () => {
  it("records what it is sent and plays a script first", async () => {
    const fake = new FakeKubriClient([{ ok: false, kind: "transient", code: "http_500", status: 500 }]);

    expect((await fake.send(BODY as never)).ok).toBe(false);
    expect(await fake.send(BODY as never)).toEqual({ ok: true });
    expect(fake.sent).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Verificare che fallisca**

Run: `pnpm test tests/unit/integrations/kubri-client.test.ts`
Expected: FAIL, il modulo non esiste.

- [ ] **Step 3: Implementare `src/integrations/kubri/client.ts`**

```ts
import type { ChatbotCandidateWebhook } from "@kubri/contracts";
import type { KubriConfig } from "../config";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type KubriResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** transient: try again; permanent: the same payload would fail the same way (D126). */
      readonly kind: "transient" | "permanent";
      readonly code: string;
      readonly status?: number;
    };

/** The only module that calls Kubri's dashboard (CLAUDE.md, module boundaries). */
export interface KubriClient {
  send(body: ChatbotCandidateWebhook): Promise<KubriResult>;
}

const ENDPOINT = "/api/webhooks/make/candidate";
const TIMEOUT_MS = 15_000;

/** The dashboard's own codes (`unauthorized`, `validation_failed`, `unknown_pool`). */
const PERMANENT_CODES: Readonly<Record<number, string>> = {
  400: "validation_failed",
  401: "unauthorized",
  422: "unknown_pool",
};

function classify(status: number): KubriResult {
  if (status >= 500 || status === 429 || status === 408) {
    return { ok: false, kind: "transient", code: `http_${status}`, status };
  }
  return { ok: false, kind: "permanent", code: PERMANENT_CODES[status] ?? `http_${status}`, status };
}

export function createKubriClient(
  config: Pick<KubriConfig, "baseUrl" | "secret">,
  options: { readonly fetch?: FetchLike; readonly timeoutMs?: number } = {},
): KubriClient;
export function createKubriClient(
  config: Pick<KubriConfig, "baseUrl" | "secret"> & { readonly fetch?: FetchLike; readonly timeoutMs?: number },
): KubriClient;
export function createKubriClient(
  config: Pick<KubriConfig, "baseUrl" | "secret"> & { readonly fetch?: FetchLike; readonly timeoutMs?: number },
  options: { readonly fetch?: FetchLike; readonly timeoutMs?: number } = {},
): KubriClient {
  const fetchImpl = options.fetch ?? config.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? config.timeoutMs ?? TIMEOUT_MS;
  return {
    async send(body) {
      let response: Response;
      try {
        response = await fetchImpl(`${config.baseUrl}${ENDPOINT}`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.secret}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error: unknown) {
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        return { ok: false, kind: "transient", code: timeout ? "timeout" : "network" };
      }
      // The body is read to release the connection and never looked at: it may echo the payload.
      await response.text().catch(() => "");
      return response.ok ? { ok: true } : classify(response.status);
    },
  };
}

/** For tests: a script of results first (failures are not recorded), then success. */
export class FakeKubriClient implements KubriClient {
  readonly sent: ChatbotCandidateWebhook[] = [];
  private readonly script: KubriResult[];

  constructor(script: readonly KubriResult[] = []) {
    this.script = [...script];
  }

  send(body: ChatbotCandidateWebhook): Promise<KubriResult> {
    const scripted = this.script.shift();
    if (scripted && !scripted.ok) return Promise.resolve(scripted);
    this.sent.push(body);
    return Promise.resolve({ ok: true });
  }
}
```

(Le due firme in overload di `createKubriClient` permettono di chiamarla con `{ baseUrl, secret, fetch }`
in un solo oggetto, come fa il test, o con la configurazione e le opzioni separate, come fa il
collegamento nel Task 11. Se si preferisce una sola forma, tenere la seconda e adeguare il test.)

- [ ] **Step 4: Verificare che passi**

Run: `pnpm test tests/unit/integrations && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write src/integrations tests/unit/integrations
git add src/integrations/kubri/client.ts tests/unit/integrations/kubri-client.test.ts
git commit -m "feat(chatbot): add the Kubri webhook client"
```

---

### Task 7: I gestori `kubri-webhook` e `geocoding`

**Concetto: il job è un'azione che si può ripetere.** Il job non porta i dati: porta
`{ sessionId, event }`. Quando gira, rilegge il profilo e invia **lo stato di adesso**. Così non
importa se i job arrivano in disordine o se un ritentativo parte dopo un altro evento: la
dashboard riceve sempre l'ultima versione, e un invio ripetuto è innocuo (è un upsert). L'unico
pericolo è mandare un record **vuoto** dopo una cancellazione: per questo la regola di salto.

**Files:**
- Create: `src/runtime/jobs/errors.ts`, `src/runtime/jobs/kubri-webhook.ts`, `src/runtime/jobs/geocoding.ts`, `src/integrations/storage.ts` (solo l'interfaccia e il doppione; il client Supabase è nel Task 8)
- Test: `tests/integration/job-kubri-webhook.test.ts`, `tests/unit/runtime/geocoding.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/runtime/geocoding.test.ts`:

```ts
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { handleGeocoding } from "../../../src/runtime/jobs/geocoding";

describe("handleGeocoding (D124)", () => {
  it("closes the job, saying why, without touching anything", async () => {
    const lines: string[] = [];
    const logger = pino({ level: "info" }, { write: (line: string) => lines.push(line) });

    await expect(handleGeocoding({ logger })({ sessionId: "s1" })).resolves.toBeUndefined();

    expect(lines.join("")).toContain("delegated to the platform");
    expect(lines.join("")).toContain("s1");
  });
});
```

`tests/integration/job-kubri-webhook.test.ts`:

```ts
import { CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE } from "@kubri/contracts";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FakeKubriClient } from "../../src/integrations/kubri/client";
import { FakeCvStorage } from "../../src/integrations/storage";
import { TransientJobError } from "../../src/runtime/jobs/errors";
import { handleKubriWebhook, type KubriJobDeps } from "../../src/runtime/jobs/kubri-webhook";
import { MemoryJobQueue } from "../../src/runtime/memory-queue";
import { insertCvDocument } from "../../src/store/cv";
import { applyProfileFields, purgeSessionData } from "../../src/store/profiles";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { seedScenario, silentLogger, startSession, type Scenario } from "./helpers/runtime";

const db = createTestDatabase();
let s: Scenario;
let sessionId = "";
let kubri: FakeKubriClient;
let storage: FakeCvStorage;
let queue: MemoryJobQueue;

const deps = (): KubriJobDeps => ({ db, logger: silentLogger, queue, kubri, storage, linkTtlSeconds: 1209600 });
const job = (event: "consents.accepted" | "interview.completed" | "cv.generated" = "consents.accepted") => ({ sessionId, event });

beforeEach(async () => {
  await resetBotSchema(db);
  s = await seedScenario(db);
  sessionId = (await startSession(s)).id;
  kubri = new FakeKubriClient();
  storage = new FakeCvStorage();
  queue = new MemoryJobQueue();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("handleKubriWebhook (D125, D126)", () => {
  it("creates the candidate at the consent threshold, even with an empty profile (D24)", async () => {
    expect(await handleKubriWebhook(deps(), job())).toBe("sent");

    expect(kubri.sent).toHaveLength(1);
    expect(kubri.sent[0]).toMatchObject({
      key: `${s.contactId}:${s.campaign?.campaignId}`,
      externalKey: "global",
      data: { channel: "whatsapp", interview_status: "in_progress", phone: s.phone, source_organization: "kubri-chatbot" },
    });
  });

  it("sends the current profile, whatever the event that triggered the job", async () => {
    await applyProfileFields(db, sessionId, "extraction", null, [
      { field: "firstName", value: "Karim", confidence: 0.95, status: "inferred" },
      { field: "birthday", value: "1990-05-12", confidence: 0.95, status: "inferred" },
    ]);

    await handleKubriWebhook(deps(), job("interview.completed"));

    expect(kubri.sent[0]?.data).toMatchObject({ first_name: "Karim", birthday: "12/05/1990" });
  });

  it("adds a freshly signed link to the newest CV", async () => {
    const profile = await db.candidateProfile.findUniqueOrThrow({ where: { sessionId } });
    await insertCvDocument(db, { profileId: profile.id, template: "default-v1", storageKey: "cv/s/1.pdf" });

    await handleKubriWebhook(deps(), job("cv.generated"));

    expect(kubri.sent[0]?.data.cv_link_pdf).toBe("https://storage.example/cv/s/1.pdf?ttl=1209600");
  });

  it("sends without a link when the worker has no storage configured", async () => {
    const profile = await db.candidateProfile.findUniqueOrThrow({ where: { sessionId } });
    await insertCvDocument(db, { profileId: profile.id, template: "default-v1", storageKey: "cv/s/1.pdf" });

    await handleKubriWebhook({ ...deps(), storage: null }, job());

    expect(kubri.sent[0]?.data).not.toHaveProperty("cv_link_pdf");
  });

  it("skips a session that no longer exists", async () => {
    await db.contact.delete({ where: { id: s.contactId } });

    expect(await handleKubriWebhook(deps(), job())).toBe("skipped");
    expect(kubri.sent).toEqual([]);
  });

  it("never overwrites a candidate with the empty profile of a deleted session", async () => {
    await applyProfileFields(db, sessionId, "extraction", null, [
      { field: "firstName", value: "Karim", confidence: 0.95, status: "inferred" },
    ]);
    await purgeSessionData(db, sessionId);
    await db.session.update({ where: { id: sessionId }, data: { status: "stopped" } });

    expect(await handleKubriWebhook(deps(), job())).toBe("skipped");
    expect(kubri.sent).toEqual([]);
  });

  it("asks for a retry on a transient failure", async () => {
    kubri = new FakeKubriClient([{ ok: false, kind: "transient", code: "http_503", status: 503 }]);

    await expect(handleKubriWebhook(deps(), job())).rejects.toThrow(TransientJobError);
    expect(queue.deadLetters).toEqual([]);
  });

  it("sends a definitive failure to the dead letter queue, with the reason, and does not retry", async () => {
    kubri = new FakeKubriClient([{ ok: false, kind: "permanent", code: "unauthorized", status: 401 }]);

    expect(await handleKubriWebhook(deps(), job())).toBe("dead");

    expect(queue.deadLetters).toEqual([{ name: "kubri-webhook", payload: job(), reason: "unauthorized" }]);
  });

  it("matches the shared contract example for a complete profile (the contract test, §14)", async () => {
    // Same data as the example, through the real database and the real job.
    const e = CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE.data;
    await applyProfileFields(db, sessionId, "extraction", null, [
      { field: "firstName", value: e.first_name, confidence: 0.95, status: "inferred" },
      { field: "country", value: e.country, confidence: 0.95, status: "inferred" },
    ]);

    await handleKubriWebhook(deps(), job());

    expect(kubri.sent[0]?.data).toMatchObject({ first_name: e.first_name, country: e.country });
  });
});
```

(`FakeCvStorage` firma i link come `https://storage.example/<chiave>?ttl=<secondi>`: vedi lo Step 3.)

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/runtime/geocoding.test.ts && pnpm test:integration tests/integration/job-kubri-webhook.test.ts`
Expected: FAIL, i moduli non esistono.

- [ ] **Step 3: Implementare l'interfaccia dello storage e il doppione**

`src/integrations/storage.ts` (il client Supabase si aggiunge nel Task 8):

```ts
/** A private bucket of CVs (spec §12.2, D129). The only module that talks to Supabase Storage. */
export interface CvStorage {
  /** Stores a PDF under `key`, replacing any object there. */
  upload(key: string, bytes: Uint8Array): Promise<void>;
  /** A link that works for `ttlSeconds` and then stops (CLAUDE.md, privacy rule 5). */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}

/** For tests: remembers what it stores, signs links without a network. */
export class FakeCvStorage implements CvStorage {
  readonly objects = new Map<string, Uint8Array>();
  failNextUpload = false;

  upload(key: string, bytes: Uint8Array): Promise<void> {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      return Promise.reject(new Error("storage unavailable"));
    }
    this.objects.set(key, bytes);
    return Promise.resolve();
  }

  signedUrl(key: string, ttlSeconds: number): Promise<string> {
    return Promise.resolve(`https://storage.example/${key}?ttl=${ttlSeconds}`);
  }
}
```

- [ ] **Step 4: Implementare `src/runtime/jobs/errors.ts`, `geocoding.ts`, `kubri-webhook.ts`**

`errors.ts`:

```ts
/** Thrown by a job handler to make pg-boss try again with its backoff (D126). */
export class TransientJobError extends Error {
  constructor(readonly code: string) {
    super(`transient failure: ${code}`);
    this.name = "TransientJobError";
  }
}
```

`geocoding.ts`:

```ts
import type { Logger } from "pino";

/**
 * D124: the platform geocodes the municipality from the address when it gets no coordinates,
 * so nothing leaves the chatbot. The job exists because the engine enqueues it on every
 * address change; closing it here keeps the queue empty and leaves the reason on record.
 */
export function handleGeocoding(deps: { readonly logger: Logger }) {
  return (payload: { readonly sessionId: string }): Promise<void> => {
    deps.logger.info({ sessionId: payload.sessionId }, "geocoding is delegated to the platform");
    return Promise.resolve();
  };
}
```

`kubri-webhook.ts`:

```ts
import type { Logger } from "pino";
import type { KubriClient } from "../../integrations/kubri/client";
import { buildKubriPayload } from "../../integrations/kubri/payload";
import type { CvStorage } from "../../integrations/storage";
import type { Database } from "../../store/db";
import type { JobPayloads, JobQueue } from "../../store/queue";
import { loadSnapshot, type Snapshot } from "../../store/snapshot";
import { TransientJobError } from "./errors";

export interface KubriJobDeps {
  readonly db: Database;
  readonly logger: Logger;
  readonly queue: JobQueue;
  readonly kubri: KubriClient;
  /** null: no storage on this worker; the payload goes without a CV link. */
  readonly storage: CvStorage | null;
  readonly linkTtlSeconds: number;
}

export type KubriJobResult = "sent" | "skipped" | "dead";

/**
 * D125: a stopped session whose profile was emptied (deletion) must never replace a candidate in
 * the dashboard with a blank record.
 */
function wasDeleted(snapshot: Snapshot): boolean {
  return snapshot.session.status === "stopped" && Object.keys(snapshot.profile.fieldMeta).length === 0;
}

/** Spec §12.1 as a job: read the current profile, map it, send it, classify the outcome. */
export async function handleKubriWebhook(
  deps: KubriJobDeps,
  job: JobPayloads["kubri-webhook"],
): Promise<KubriJobResult> {
  const snapshot = await loadSnapshot(deps.db, job.sessionId);
  if (!snapshot) {
    deps.logger.info({ sessionId: job.sessionId, event: job.event }, "kubri webhook skipped: session gone");
    return "skipped";
  }
  if (wasDeleted(snapshot)) {
    deps.logger.info({ sessionId: job.sessionId, event: job.event }, "kubri webhook skipped: data deleted");
    return "skipped";
  }
  // A failure to sign the link fails the job, so that it is retried: sending without the link
  // would erase the one the dashboard already has.
  const cvLink =
    snapshot.cv && deps.storage
      ? await deps.storage.signedUrl(snapshot.cv.storageKey, deps.linkTtlSeconds)
      : null;
  const result = await deps.kubri.send(buildKubriPayload({ ...snapshot, campaign: snapshot.campaign }, cvLink));
  if (result.ok) {
    deps.logger.info({ sessionId: job.sessionId, event: job.event }, "kubri webhook sent");
    return "sent";
  }
  if (result.kind === "transient") throw new TransientJobError(result.code);
  // Definitive (D126): kept where an operator finds it, with the reason. Ids and codes only.
  deps.logger.error(
    { sessionId: job.sessionId, event: job.event, code: result.code, status: result.status },
    "kubri webhook rejected for good",
  );
  await deps.queue.deadLetter("kubri-webhook", job, result.code);
  return "dead";
}
```

(`buildKubriPayload` prende un `KubriSnapshot`: `Snapshot` è compatibile, perché ha gli stessi
campi con qualcuno in più. Se TypeScript segnala una differenza di forma su `contact`, mappare
esplicitamente `contact: { id, channel, phoneE164 }`.)

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write src tests
git add src/integrations/storage.ts src/runtime/jobs/errors.ts src/runtime/jobs/geocoding.ts src/runtime/jobs/kubri-webhook.ts tests/unit/runtime/geocoding.test.ts tests/integration/job-kubri-webhook.test.ts
git commit -m "feat(chatbot): send the current profile to Kubri from a job, and close geocoding jobs"
```

---

### Task 8: Lo storage privato dei CV (Supabase REST) e `storage init`

**Concetto: un link che scade.** Il CV è un dato personale. Non sta mai in un bucket pubblico e
non si manda mai il suo indirizzo "vero": si manda un indirizzo **firmato**, valido per un tempo
limitato (D128). Chi lo firma deve avere la chiave di servizio di Supabase, per questo il codice
sta in un solo modulo (`src/integrations/storage.ts`), si usa solo nel worker, e lo si prova con
un `fetch` finto: i test non toccano Supabase.

**Files:**
- Modify: `src/integrations/storage.ts`, `package.json` (script `storage` se serve, no)
- Create: `src/cli/commands/storage.ts`
- Modify: `src/cli/program.ts` (registrazione del comando)
- Test: `tests/unit/integrations/storage.test.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
import { describe, expect, it } from "vitest";
import { createSupabaseCvStorage, StorageError } from "../../../src/integrations/storage";
import type { FetchLike } from "../../../src/integrations/kubri/client";

const CONFIG = { url: "https://x.supabase.co", serviceKey: "svc-key", bucket: "bot-cv", linkTtlSeconds: 100 };

function storage(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(respond(url, init));
  };
  return { calls, storage: createSupabaseCvStorage(CONFIG, fetch) };
}

describe("createSupabaseCvStorage (spec §12.2, D129)", () => {
  it("uploads a PDF to the private bucket, replacing an existing object", async () => {
    const { storage: s, calls } = storage(() => new Response("{}", { status: 200 }));

    await s.upload("cv/s1/1.pdf", new Uint8Array([37, 80, 68, 70]));

    expect(calls[0]?.url).toBe("https://x.supabase.co/storage/v1/object/bot-cv/cv/s1/1.pdf");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: "Bearer svc-key",
      apikey: "svc-key",
      "content-type": "application/pdf",
      "x-upsert": "true",
    });
  });

  it("signs a link for the requested time and returns an absolute URL", async () => {
    const { storage: s, calls } = storage(
      () => new Response(JSON.stringify({ signedURL: "/object/sign/bot-cv/cv/s1/1.pdf?token=abc" }), { status: 200 }),
    );

    expect(await s.signedUrl("cv/s1/1.pdf", 3600)).toBe(
      "https://x.supabase.co/storage/v1/object/sign/bot-cv/cv/s1/1.pdf?token=abc",
    );
    expect(calls[0]?.url).toBe("https://x.supabase.co/storage/v1/object/sign/bot-cv/cv/s1/1.pdf");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ expiresIn: 3600 });
  });

  it("fails with the status, never with the key or the object path", async () => {
    const { storage: s } = storage(() => new Response("{}", { status: 403 }));

    const error = await s.upload("cv/s1/1.pdf", new Uint8Array()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).status).toBe(403);
    expect(String(error)).not.toContain("svc-key");
    expect(String(error)).not.toContain("cv/s1");
  });

  it("refuses a response without a signed URL", async () => {
    const { storage: s } = storage(() => new Response("{}", { status: 200 }));

    await expect(s.signedUrl("cv/s1/1.pdf", 60)).rejects.toThrow(StorageError);
  });
});
```

E in coda al file di test, per `ensureBucket`:

```ts
import { ensurePrivateBucket } from "../../../src/integrations/storage";

describe("ensurePrivateBucket", () => {
  it("creates a private bucket", async () => {
    const { calls } = (() => {
      const calls: { url: string; init: RequestInit }[] = [];
      return { calls };
    })();
    const fetch: FetchLike = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(new Response("{}", { status: 200 }));
    };

    expect(await ensurePrivateBucket(CONFIG, fetch)).toBe("created");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ id: "bot-cv", name: "bot-cv", public: false });
  });

  it("is idempotent: an existing bucket is fine", async () => {
    const fetch: FetchLike = () =>
      Promise.resolve(new Response(JSON.stringify({ error: "Duplicate", message: "The resource already exists" }), { status: 400 }));

    expect(await ensurePrivateBucket(CONFIG, fetch)).toBe("exists");
  });

  it("fails on anything else", async () => {
    const fetch: FetchLike = () => Promise.resolve(new Response("{}", { status: 401 }));

    await expect(ensurePrivateBucket(CONFIG, fetch)).rejects.toThrow(StorageError);
  });
});
```

- [ ] **Step 2: Verificare che fallisca**

Run: `pnpm test tests/unit/integrations/storage.test.ts`
Expected: FAIL, `createSupabaseCvStorage` non esiste.

- [ ] **Step 3: Estendere `src/integrations/storage.ts`**

In cima al file aggiungere gli import e, dopo l'interfaccia `CvStorage`, il resto (il `FakeCvStorage`
del Task 7 resta com'è):

```ts
import type { StorageConfig } from "./config";
import type { FetchLike } from "./kubri/client";

/** A storage call that failed. It carries the status only: no key, no path, no body. */
export class StorageError extends Error {
  constructor(
    readonly operation: "upload" | "sign" | "bucket",
    readonly status?: number,
  ) {
    super(`storage ${operation} failed${status === undefined ? "" : ` (HTTP ${status})`}`);
    this.name = "StorageError";
  }
}

type Config = Pick<StorageConfig, "url" | "serviceKey" | "bucket">;

const TIMEOUT_MS = 30_000;

function headers(config: Config, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey, ...extra };
}

/** Encodes each segment of a key, keeping the slashes. */
const encodeKey = (key: string): string => key.split("/").map(encodeURIComponent).join("/");

/** The REST API of Supabase Storage, with the service role key (server only, D129). */
export function createSupabaseCvStorage(config: Config, fetchImpl: FetchLike = fetch): CvStorage {
  const base = `${config.url}/storage/v1`;
  return {
    async upload(key, bytes) {
      let response: Response;
      try {
        response = await fetchImpl(`${base}/object/${config.bucket}/${encodeKey(key)}`, {
          method: "POST",
          headers: headers(config, { "content-type": "application/pdf", "x-upsert": "true" }),
          body: bytes as unknown as BodyInit,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new StorageError("upload");
      }
      await response.text().catch(() => "");
      if (!response.ok) throw new StorageError("upload", response.status);
    },

    async signedUrl(key, ttlSeconds) {
      let response: Response;
      try {
        response = await fetchImpl(`${base}/object/sign/${config.bucket}/${encodeKey(key)}`, {
          method: "POST",
          headers: headers(config, { "content-type": "application/json" }),
          body: JSON.stringify({ expiresIn: ttlSeconds }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new StorageError("sign");
      }
      if (!response.ok) {
        await response.text().catch(() => "");
        throw new StorageError("sign", response.status);
      }
      const body: unknown = await response.json().catch(() => null);
      const signed =
        typeof body === "object" && body !== null && "signedURL" in body ? body.signedURL : null;
      if (typeof signed !== "string" || !signed.startsWith("/")) throw new StorageError("sign", response.status);
      return `${base}${signed}`;
    },
  };
}

/**
 * Creates the private bucket if it is not there (`storage init`). Idempotent: Supabase answers
 * an existing bucket with a 400/409 "already exists".
 */
export async function ensurePrivateBucket(
  config: Config,
  fetchImpl: FetchLike = fetch,
): Promise<"created" | "exists"> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.url}/storage/v1/bucket`, {
      method: "POST",
      headers: headers(config, { "content-type": "application/json" }),
      body: JSON.stringify({ id: config.bucket, name: config.bucket, public: false }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new StorageError("bucket");
  }
  const text = await response.text().catch(() => "");
  if (response.ok) return "created";
  if ((response.status === 400 || response.status === 409) && /already exists|duplicate/i.test(text)) {
    return "exists";
  }
  throw new StorageError("bucket", response.status);
}
```

- [ ] **Step 4: `src/cli/commands/storage.ts`**

```ts
import type { Command } from "commander";
import { parseStorageConfig } from "../../integrations/config";
import { ensurePrivateBucket } from "../../integrations/storage";
import { CliError, type CliDeps } from "../deps";

export function registerStorageCommands(program: Command, deps: CliDeps): void {
  const storage = program.command("storage").description("The private bucket of CVs");

  storage
    .command("init")
    .description("Create the private CV bucket if it does not exist (idempotent)")
    .action(async () => {
      let config;
      try {
        config = parseStorageConfig(process.env);
      } catch (error: unknown) {
        throw new CliError(error instanceof Error ? error.message : String(error));
      }
      const result = await ensurePrivateBucket(config);
      deps.out(result === "created" ? `bucket ${config.bucket} created (private)` : `bucket ${config.bucket} already exists`);
    });
}
```

In `src/cli/program.ts`: `import { registerStorageCommands } from "./commands/storage";` e,
accanto alle altre registrazioni, `registerStorageCommands(program, deps);`.

- [ ] **Step 5: Verificare che passi**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS. Se `body: bytes as unknown as BodyInit` irrita il lint, usare `Buffer.from(bytes)`.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write src tests
git add src/integrations/storage.ts src/cli/commands/storage.ts src/cli/program.ts tests/unit/integrations/storage.test.ts
git commit -m "feat(chatbot): add the private CV storage client and storage init"
```

---

### Task 9: Il CV in PDF (layout puro + pdfkit)

**Concetto: separare il contenuto dal disegno.** Decidere *cosa* c'è nel CV (quali sezioni, in che
ordine, cosa si omette se manca) è logica che si prova con esempi. Disegnare i byte del PDF è
un dettaglio della libreria. Perciò: `buildCvLayout` è una funzione pura (profilo → sezioni di
testo), `renderCv` la disegna con `pdfkit`. Del PDF si prova solo che sia un PDF valido e che non
si rompa con caratteri strani; l'aspetto lo si guarda a occhio, una volta, nel Task 12.

**Files:**
- Create: `src/integrations/cv/layout.ts`, `src/integrations/cv/render.ts`
- Test: `tests/unit/integrations/cv-layout.test.ts`, `tests/unit/integrations/cv-render.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/integrations/cv-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCvLayout, CV_TEMPLATE } from "../../../src/integrations/cv/layout";

const PROFILE = {
  firstName: "Karim",
  lastName: "Benali",
  birthday: "1990-05-12",
  location: "Bologna",
  email: "karim@example.com",
  workExperience: ["2018 - 2020 Bologna: Magazziniere"],
  educationAndTraining: ["Liceo Ibn Rushd: Diploma"],
  skillsAndCompetences: ["uso del muletto"],
  language: "ar",
  additionalLanguages: ["francese (intermedio)"],
  italianLevel: "intermedio",
  workingPermit: true,
  drivingLicense: false,
  transport: "bicicletta",
  "jobPreferences.preferredJob": "magazziniere",
};

describe("buildCvLayout (D127)", () => {
  it("names the template, so a CvDocument says how it was made", () => {
    expect(CV_TEMPLATE).toBe("default-v1");
  });

  it("puts the name first and the contacts under it", () => {
    const layout = buildCvLayout(PROFILE, "+393334445566");

    expect(layout.title).toBe("Karim Benali");
    expect(layout.contacts).toEqual(["Bologna", "+393334445566", "karim@example.com"]);
  });

  it("builds the sections in a fixed order, skipping the empty ones", () => {
    const layout = buildCvLayout(PROFILE, "+393334445566");

    expect(layout.sections.map((s) => s.heading)).toEqual([
      "Profilo",
      "Esperienza lavorativa",
      "Istruzione e formazione",
      "Competenze",
      "Lingue",
      "Informazioni utili",
    ]);
    expect(buildCvLayout({ firstName: "Karim" }, "+39").sections).toEqual([]);
  });

  it("summarises the job aim in the profile and the practical facts as yes/no lines", () => {
    const layout = buildCvLayout(PROFILE, "+39");
    const section = (h: string) => layout.sections.find((s) => s.heading === h)?.lines;

    expect(section("Profilo")).toEqual(["Cerco lavoro come: magazziniere"]);
    expect(section("Lingue")).toEqual(["Italiano: intermedio", "francese (intermedio)"]);
    expect(section("Informazioni utili")).toEqual([
      "Permesso di lavoro: sì",
      "Patente di guida: no",
      "Mezzo di trasporto: bicicletta",
    ]);
  });

  it("falls back to a neutral title when there is no name", () => {
    expect(buildCvLayout({}, "+39").title).toBe("Curriculum vitae");
  });
});
```

`tests/unit/integrations/cv-render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCvLayout } from "../../../src/integrations/cv/layout";
import { renderCv, toWinAnsi } from "../../../src/integrations/cv/render";

describe("toWinAnsi (D127)", () => {
  it("keeps Latin text and accents and replaces what the standard fonts cannot draw", () => {
    expect(toWinAnsi("Perché è già così – € 5")).toBe("Perché è già così – € 5");
    expect(toWinAnsi("كريم")).toBe("????");
    expect(toWinAnsi("a\u0000b")).toBe("ab");
  });
});

describe("renderCv", () => {
  it("produces a PDF", async () => {
    const bytes = await renderCv(
      buildCvLayout({ firstName: "Karim", lastName: "Benali", workExperience: ["2018 - 2020: Magazziniere"] }, "+39333"),
    );

    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("does not break on non-Latin names or on a long document", async () => {
    const long = Array.from({ length: 80 }, (_, i) => `2010 - 2011 Città ${i}: lavoro con molte parole che vanno a capo ${"x".repeat(60)}`);

    const bytes = await renderCv(buildCvLayout({ firstName: "كريم", workExperience: long }, "+39"));

    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/integrations/cv-layout.test.ts tests/unit/integrations/cv-render.test.ts`
Expected: FAIL, i moduli non esistono.

- [ ] **Step 3: `src/integrations/cv/layout.ts`**

```ts
/** Identifies the template in `CvDocument.template` (D127). */
export const CV_TEMPLATE = "default-v1";

export interface CvSection {
  readonly heading: string;
  readonly lines: readonly string[];
}

export interface CvLayout {
  readonly title: string;
  readonly contacts: readonly string[];
  readonly sections: readonly CvSection[];
}

type Standard = Readonly<Record<string, unknown>>;

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap((v) => (str(v) ? [str(v) as string] : [])) : [];

const yesNo = (label: string, value: unknown): string[] =>
  typeof value === "boolean" ? [`${label}: ${value ? "sì" : "no"}`] : [];

const section = (heading: string, lines: readonly string[]): CvSection[] =>
  lines.length > 0 ? [{ heading, lines }] : [];

/**
 * What the CV says and in what order (D127). The text of the template is Italian, whatever the
 * candidate's language: it is read by employers in Italy. Pure: no I/O, no randomness.
 */
export function buildCvLayout(standard: Standard, phoneE164: string): CvLayout {
  const name = [str(standard["firstName"]), str(standard["lastName"])].flatMap((p) => (p ? [p] : [])).join(" ");
  const aim = str(standard["jobPreferences.preferredJob"]);
  const italian = str(standard["italianLevel"]);
  const languages = [...(italian ? [`Italiano: ${italian}`] : []), ...list(standard["additionalLanguages"])];
  const transport = str(standard["transport"]);

  return {
    title: name || "Curriculum vitae",
    contacts: [str(standard["location"]), phoneE164, str(standard["email"])].flatMap((c) => (c ? [c] : [])),
    sections: [
      ...section("Profilo", aim ? [`Cerco lavoro come: ${aim}`] : []),
      ...section("Esperienza lavorativa", list(standard["workExperience"])),
      ...section("Istruzione e formazione", list(standard["educationAndTraining"])),
      ...section("Competenze", list(standard["skillsAndCompetences"])),
      ...section("Lingue", languages),
      ...section("Informazioni utili", [
        ...yesNo("Permesso di lavoro", standard["workingPermit"]),
        ...yesNo("Patente di guida", standard["drivingLicense"]),
        ...(transport ? [`Mezzo di trasporto: ${transport}`] : []),
      ]),
    ],
  };
}
```

(Nel test "skipping the empty ones" il profilo `{ firstName: "Karim" }` non ha sezioni: il
telefono sta in `contacts`, non in una sezione.)

- [ ] **Step 4: `src/integrations/cv/render.ts`**

```ts
import PDFDocument from "pdfkit";
import type { CvLayout } from "./layout";

/**
 * The standard PDF fonts draw WinAnsi (Latin-1 plus a few signs). Anything else would make
 * pdfkit throw or draw garbage, so it becomes "?" (D127: a known limit for non-Latin names).
 */
const EXTRA = new Set(["€", "–", "—", "‘", "’", "“", "”", "•", "…"]);

export function toWinAnsi(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20) continue;
    out += code <= 0xff || EXTRA.has(char) ? char : "?";
  }
  return out;
}

const MARGIN = 56;

/** Draws the layout on A4, one column. The look of the template lives here only. */
export function renderCv(layout: CvLayout): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: toWinAnsi(layout.title) } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(24).text(toWinAnsi(layout.title));
    if (layout.contacts.length > 0) {
      doc.moveDown(0.3).font("Helvetica").fontSize(10).fillColor("#555555").text(toWinAnsi(layout.contacts.join("  ·  ")));
    }
    for (const { heading, lines } of layout.sections) {
      doc.moveDown(1).fillColor("#000000").font("Helvetica-Bold").fontSize(13).text(toWinAnsi(heading.toUpperCase()));
      doc.moveTo(MARGIN, doc.y + 2).lineTo(doc.page.width - MARGIN, doc.y + 2).strokeColor("#cccccc").stroke();
      doc.moveDown(0.5).font("Helvetica").fontSize(11);
      for (const line of lines) doc.text(toWinAnsi(line), { paragraphGap: 3 });
    }
    doc.end();
  });
}
```

Se `pnpm typecheck` si lamenta dell'import di default di `pdfkit` (`export =`), usare
`import PDFDocument = require("pdfkit");` oppure attivare `esModuleInterop` nel `tsconfig.json`
del chatbot: scegliere la prima, che non tocca la configurazione.

- [ ] **Step 5: Verificare che passi**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write src tests
git add src/integrations/cv tests/unit/integrations/cv-layout.test.ts tests/unit/integrations/cv-render.test.ts
git commit -m "feat(chatbot): lay out and render the CV as a PDF"
```

---

### Task 10: Il job `cv`

**Concetto: un lavoro in più passi, riavviabile.** Generare il CV vuol dire: leggere il profilo,
disegnare il PDF, caricarlo, registrarlo, avvisare il candidato e Kubri. Ognuno di questi passi può
fallire. La regola è che **un fallimento prima della registrazione si riprova da capo** (rifare un
PDF è innocuo) e che **dopo 3 tentativi si smette di insistere e si dice al candidato la
verità** (D131), con un flag per l'operatore. Il contatore dei tentativi viaggia nel payload del
job: il job si riaccoda da solo con un'attesa.

**Files:**
- Create: `src/runtime/jobs/cv.ts`
- Test: `tests/integration/job-cv.test.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FakeCvStorage } from "../../src/integrations/storage";
import { createTextResolver } from "../../src/i18n/resolve";
import { FakeTranslator } from "../../src/i18n/fake-translator";
import { handleCv, MAX_CV_ATTEMPTS, type CvJobDeps } from "../../src/runtime/jobs/cv";
import { MemoryJobQueue } from "../../src/runtime/memory-queue";
import { applyProfileFields } from "../../src/store/profiles";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { seedScenario, silentLogger, startSession, type Scenario } from "./helpers/runtime";

const db = createTestDatabase();
let s: Scenario;
let sessionId = "";
let storage: FakeCvStorage;
let queue: MemoryJobQueue;

const NOW = new Date("2026-10-24T10:00:00.000Z");
const deps = (): CvJobDeps => ({
  db,
  logger: silentLogger,
  queue,
  storage,
  linkTtlSeconds: 1209600,
  resolver: createTextResolver({ translator: new FakeTranslator(), cache: { get: () => Promise.resolve(null), put: () => Promise.resolve() } }),
  now: () => NOW,
});

beforeEach(async () => {
  await resetBotSchema(db);
  s = await seedScenario(db);
  sessionId = (await startSession(s)).id;
  await applyProfileFields(db, sessionId, "extraction", null, [
    { field: "firstName", value: "Karim", confidence: 0.95, status: "inferred" },
  ]);
  storage = new FakeCvStorage();
  queue = new MemoryJobQueue();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("handleCv (spec §12.2, D127–D131)", () => {
  it("uploads the PDF, records it, tells the candidate and Kubri", async () => {
    expect(await handleCv(deps(), { sessionId })).toBe("done");

    const [key] = [...storage.objects.keys()];
    expect(key).toMatch(new RegExp(`^cv/${sessionId}/\\d+\\.pdf$`));
    expect(Buffer.from(storage.objects.get(key ?? "") ?? new Uint8Array()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const docs = await db.cvDocument.findMany();
    expect(docs).toMatchObject([{ kind: "generated", template: "default-v1", storageKey: key }]);

    const outbound = await db.message.findMany({ where: { direction: "outbound", sessionId } });
    expect(outbound.at(-1)?.body).toContain(`https://storage.example/${key}?ttl=1209600`);

    expect(queue.jobs.map((j) => j.name)).toEqual(["send-messages", "kubri-webhook"]);
    expect(queue.jobs[1]?.payload).toEqual({ sessionId, event: "cv.generated" });
  });

  it("skips a session that was deleted", async () => {
    await db.contact.delete({ where: { id: s.contactId } });

    expect(await handleCv(deps(), { sessionId })).toBe("skipped");
    expect(storage.objects.size).toBe(0);
  });

  it("retries by itself, later, with the counter in the payload, when the upload fails", async () => {
    storage.failNextUpload = true;

    expect(await handleCv(deps(), { sessionId })).toBe("retry");

    expect(await db.cvDocument.count()).toBe(0);
    expect(queue.jobs).toEqual([
      expect.objectContaining({ name: "cv", payload: { sessionId, attempt: 2 }, options: expect.objectContaining({ startAfterSeconds: 60 }) }),
    ]);
  });

  it("after the last attempt tells the candidate once and flags the session, without needs_attention", async () => {
    storage.failNextUpload = true;

    expect(await handleCv(deps(), { sessionId, attempt: MAX_CV_ATTEMPTS })).toBe("failed");

    const outbound = await db.message.findMany({ where: { direction: "outbound", sessionId } });
    expect(outbound.at(-1)?.body).toContain("non sono riuscito");
    expect(await db.sessionFlag.findMany({ where: { sessionId } })).toMatchObject([{ reason: "cv_failed", needsAttention: false }]);
    expect(queue.jobs.map((j) => j.name)).toEqual(["send-messages"]);
  });
});
```

(`MemoryJobQueue.jobs` registra `{ name, payload, options }`: è il formato del piano 08. Se
`options` manca nel doppione, aggiungerlo lì nello stesso commit.)

- [ ] **Step 2: Verificare che fallisca**

Run: `pnpm test:integration tests/integration/job-cv.test.ts`
Expected: FAIL, il modulo non esiste.

- [ ] **Step 3: Implementare `src/runtime/jobs/cv.ts`**

```ts
import type { Logger } from "pino";
import { CampaignDefinitionSchema } from "../../campaigns/schema/campaign";
import type { TextResolver } from "../../i18n/resolve";
import { buildCvLayout, CV_TEMPLATE } from "../../integrations/cv/layout";
import { renderCv } from "../../integrations/cv/render";
import type { CvStorage } from "../../integrations/storage";
import { insertCvDocument } from "../../store/cv";
import type { Database } from "../../store/db";
import { queueOutbound } from "../../store/messages";
import type { JobPayloads, JobQueue } from "../../store/queue";
import { insertFlag } from "../../store/turns";
import { loadSnapshot, type Snapshot } from "../../store/snapshot";

export const MAX_CV_ATTEMPTS = 3;
const RETRY_DELAY_SECONDS = 60;

export interface CvJobDeps {
  readonly db: Database;
  readonly logger: Logger;
  readonly queue: JobQueue;
  readonly storage: CvStorage;
  readonly linkTtlSeconds: number;
  readonly resolver: TextResolver;
  readonly now: () => Date;
}

export type CvJobResult = "done" | "skipped" | "retry" | "failed";

/** Tells the candidate something: one outbound message and the job that sends it. */
async function tell(
  deps: CvJobDeps,
  snapshot: Snapshot,
  key: "cv.ready" | "cv.failed",
  params: Record<string, string> = {},
): Promise<void> {
  const row = await deps.db.campaignVersion.findUniqueOrThrow({
    where: { id: snapshot.campaign.versionId },
    select: { definition: true },
  });
  const language = snapshot.session.language ?? "it";
  const text = await deps.resolver.resolveKey(
    key,
    { campaign: CampaignDefinitionSchema.parse(row.definition), language },
    params,
  );
  await deps.db.$transaction(async (tx) => {
    await queueOutbound(tx, [
      {
        contactId: snapshot.contact.id,
        senderNumberId: snapshot.session.senderNumberId,
        sessionId: snapshot.sessionId,
        turnId: null,
        body: text.text,
        language,
        stepId: null,
        questionId: null,
      },
    ]);
    await deps.queue.enqueue(
      "send-messages",
      { contactId: snapshot.contact.id, senderNumberId: snapshot.session.senderNumberId },
      {},
      tx,
    );
  });
}

/**
 * Spec §12.2. Everything before the `CvDocument` row is safe to redo; the row is written only
 * after the upload, so a retry never leaves a document without a file.
 */
export async function handleCv(deps: CvJobDeps, job: JobPayloads["cv"]): Promise<CvJobResult> {
  const snapshot = await loadSnapshot(deps.db, job.sessionId);
  if (!snapshot) {
    deps.logger.info({ sessionId: job.sessionId }, "cv skipped: session gone");
    return "skipped";
  }
  const attempt = job.attempt ?? 1;
  try {
    const bytes = await renderCv(buildCvLayout(snapshot.profile.standard, snapshot.contact.phoneE164));
    const storageKey = `cv/${snapshot.sessionId}/${deps.now().getTime()}.pdf`;
    await deps.storage.upload(storageKey, bytes);
    await insertCvDocument(deps.db, { profileId: snapshot.profile.id, template: CV_TEMPLATE, storageKey });
    const link = await deps.storage.signedUrl(storageKey, deps.linkTtlSeconds);
    await tell(deps, snapshot, "cv.ready", { link });
    await deps.queue.enqueue("kubri-webhook", { sessionId: snapshot.sessionId, event: "cv.generated" });
    deps.logger.info({ sessionId: snapshot.sessionId, attempt }, "cv generated");
    return "done";
  } catch (error: unknown) {
    // Ids and the error class only: the message could carry a path or a name.
    deps.logger.warn(
      { sessionId: snapshot.sessionId, attempt, error: error instanceof Error ? error.name : "unknown" },
      "cv generation failed",
    );
    if (attempt < MAX_CV_ATTEMPTS) {
      await deps.queue.enqueue(
        "cv",
        { sessionId: snapshot.sessionId, attempt: attempt + 1 },
        { startAfterSeconds: RETRY_DELAY_SECONDS * attempt },
      );
      return "retry";
    }
    await insertFlag(deps.db, {
      sessionId: snapshot.sessionId,
      turnId: null,
      reason: "cv_failed",
      field: null,
      needsAttention: false,
    });
    await tell(deps, snapshot, "cv.failed");
    return "failed";
  }
}
```

Note per chi implementa:
- Se l'invio del messaggio (`tell`) fallisce dopo la riga `CvDocument`, il tentativo successivo
  crea un secondo documento (innocuo: vale il più recente, D129).
- Gli import `queueOutbound`, `insertFlag` e `Database` vanno puntati ai moduli reali del piano 08
  (`src/store/messages.ts`, `src/store/turns.ts`, `src/store/db.ts`): `pnpm typecheck` lo dice.

- [ ] **Step 4: Verificare che passi**

Run: `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write src tests
git add src/runtime/jobs/cv.ts tests/integration/job-cv.test.ts
git commit -m "feat(chatbot): generate, store and announce the CV from a job"
```

---

### Task 11: Collegare i job nel worker

**Concetto: configurazione che manca = funzione che manca, non crash.** Un worker senza le
variabili di Kubri (per esempio in locale) non deve cadere: deve semplicemente non registrare i
gestori che non può eseguire, e dirlo nel log. Così `worker start` del piano 08 continua a
funzionare da solo, e la prova su dev (Task 12) accende le integrazioni una alla volta.

**Files:**
- Modify: `src/runtime/worker.ts`, `src/cli/commands/worker.ts`
- Test: `tests/integration/worker-integrations.test.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
import { CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE } from "@kubri/contracts";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FakeKubriClient } from "../../src/integrations/kubri/client";
import { FakeCvStorage } from "../../src/integrations/storage";
import { registerIntegrationHandlers, type IntegrationDeps } from "../../src/runtime/worker";
import { MemoryJobQueue } from "../../src/runtime/memory-queue";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { silentLogger } from "./helpers/runtime";

const db = createTestDatabase();

beforeEach(async () => {
  await resetBotSchema(db);
});

afterAll(async () => {
  await db.$disconnect();
});

function recorder() {
  const registered: string[] = [];
  return {
    registered,
    work: (name: string) => {
      registered.push(name);
      return Promise.resolve();
    },
  };
}

const base = (): Omit<IntegrationDeps, "kubri" | "storage"> => ({
  db,
  logger: silentLogger,
  queue: new MemoryJobQueue(),
  linkTtlSeconds: 60,
  resolver: undefined as never,
  now: () => new Date(),
});

describe("registerIntegrationHandlers", () => {
  it("registers geocoding always, kubri-webhook with Kubri, cv with storage", async () => {
    const full = recorder();
    await registerIntegrationHandlers(full.work, { ...base(), kubri: new FakeKubriClient(), storage: new FakeCvStorage() });
    expect(full.registered.sort()).toEqual(["cv", "geocoding", "kubri-webhook"]);

    const none = recorder();
    await registerIntegrationHandlers(none.work, { ...base(), kubri: null, storage: null });
    expect(none.registered).toEqual(["geocoding"]);

    const onlyKubri = recorder();
    await registerIntegrationHandlers(onlyKubri.work, { ...base(), kubri: new FakeKubriClient(), storage: null });
    expect(onlyKubri.registered.sort()).toEqual(["geocoding", "kubri-webhook"]);
  });

  it("the example payload is what the registered Kubri handler would send (smoke)", () => {
    expect(CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE.key).toContain(":");
  });
});
```

- [ ] **Step 2: Verificare che fallisca**

Run: `pnpm test:integration tests/integration/worker-integrations.test.ts`
Expected: FAIL, `registerIntegrationHandlers` non esiste.

- [ ] **Step 3: `src/runtime/worker.ts`**

Aggiungere in cima gli import (`Logger`, `TextResolver`, `KubriClient`, `CvStorage`, `Database`,
`JobQueue`, `QueueName`, `JobPayloads`, `handleCv`, `handleGeocoding`, `handleKubriWebhook`,
`TransientJobError` se serve) e, sotto `startWorker`:

```ts
export interface IntegrationDeps {
  readonly db: Database;
  readonly logger: Logger;
  readonly queue: JobQueue;
  readonly resolver: TextResolver;
  readonly now: () => Date;
  /** null = not configured on this worker: its handler is not registered. */
  readonly kubri: KubriClient | null;
  readonly storage: CvStorage | null;
  readonly linkTtlSeconds: number;
}

type Work = <Q extends QueueName>(
  name: Q,
  handler: (payload: JobPayloads[Q]) => Promise<void>,
) => Promise<void>;

/**
 * Plan 10's handlers. A missing configuration leaves the handler out (and says so) instead of
 * failing: the queue keeps the jobs until a worker that can run them starts.
 */
export async function registerIntegrationHandlers(work: Work, deps: IntegrationDeps): Promise<void> {
  await work("geocoding", handleGeocoding({ logger: deps.logger }));
  if (deps.kubri) {
    const kubriDeps = { ...deps, kubri: deps.kubri };
    await work("kubri-webhook", async (payload) => {
      await handleKubriWebhook(kubriDeps, payload);
    });
  } else {
    deps.logger.warn("kubri-webhook handler not registered: KUBRI_BASE_URL / KUBRI_WEBHOOK_SECRET missing");
  }
  if (deps.storage) {
    const cvDeps = { ...deps, storage: deps.storage };
    await work("cv", async (payload) => {
      await handleCv(cvDeps, payload);
    });
  } else {
    deps.logger.warn("cv handler not registered: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  }
}
```

`startWorker` si estende con un campo opzionale `integrations?: IntegrationDeps` e, in fondo:

```ts
  if (deps.integrations) {
    await registerIntegrationHandlers((name, handler) => deps.queue.work(name, handler, options), deps.integrations);
  }
```

Un errore `TransientJobError` lanciato dal gestore viene gestito da pg-boss come qualunque
eccezione (ritentativo con attesa): non serve altro codice.

- [ ] **Step 4: `src/cli/commands/worker.ts`**

Dopo la creazione di `queue` e prima di `startWorker`, aggiungere (con gli import di
`parseKubriConfig`, `parseStorageConfig`, `createKubriClient`, `createSupabaseCvStorage`):

```ts
        const resolver = createTextResolver({ translator, cache: createDatabaseTranslationCache(db) });
        const kubriConfig = optionalConfig(() => parseKubriConfig(process.env), "KUBRI_", logger);
        const storageConfig = optionalConfig(() => parseStorageConfig(process.env), "SUPABASE_", logger);
```

e passare a `startWorker` il campo:

```ts
          integrations: {
            db, logger, queue: queue.queue, resolver, now: () => new Date(),
            kubri: kubriConfig ? createKubriClient(kubriConfig) : null,
            storage: storageConfig ? createSupabaseCvStorage(storageConfig) : null,
            linkTtlSeconds: storageConfig?.linkTtlSeconds ?? 0,
          },
```

(riusare `resolver` anche in `runtime.resolver`.) In fondo al file:

```ts
/**
 * A configuration is optional only when none of its variables is set at all; a half-filled one
 * is a mistake and stops the worker (the message names the variables, never the values).
 */
function optionalConfig<T>(parse: () => T, prefix: string, logger: { warn: (m: string) => void }): T | null {
  const anySet = Object.keys(process.env).some((k) => k.startsWith(prefix) && process.env[k]);
  if (!anySet) return null;
  try {
    return parse();
  } catch (error: unknown) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
}
```

Per `createKubriClient(kubriConfig)` va bene la firma con un solo oggetto del Task 6.
`SUPABASE_` può essere impostata per altri scopi (per esempio l'URL delle Edge Function): in tal
caso `parseStorageConfig` fallirà con il nome della variabile mancante, che è il comportamento
voluto.

- [ ] **Step 5: Verificare che passi**

Run: `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write src tests
git add src/runtime/worker.ts src/cli/commands/worker.ts tests/integration/worker-integrations.test.ts
git commit -m "feat(chatbot): register the Kubri, CV and geocoding handlers in the worker"
```

---

### Task 12: Prova su dev (guida manuale)

**Concetto: la prova che conta.** I test automatici dimostrano che ogni pezzo fa ciò che promette,
non che Kubri accetti davvero il payload e che il PDF si apra. Questa guida è l'unica prova
con servizi reali. Non è un test: ogni passo ha una cosa da guardare.

**Files:**
- Create: `docs/kubri-integration-setup.md`

- [ ] **Step 1: Scrivere `docs/kubri-integration-setup.md`**

```markdown
# Integrazione con Kubri: configurazione e prova su dev

Prerequisiti: dashboard di dev con le modifiche del piano 10 già distribuite (Task 2), progetto
Supabase di dev, un pool con `externalKey` uguale a quello della campagna (`global`).

## 1. Variabili del worker

| Variabile | Valore |
|---|---|
| `KUBRI_BASE_URL` | indirizzo della dashboard di dev, senza barra finale |
| `KUBRI_WEBHOOK_SECRET` | lo stesso di `MAKE_WEBHOOK_SECRET` della dashboard di dev |
| `SUPABASE_URL` | `https://<progetto>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | chiave di servizio del progetto di dev: solo nell'ambiente del worker |
| `CV_BUCKET`, `CV_LINK_TTL_DAYS` | facoltative (`bot-cv`, 14) |

## 2. Bucket

    pnpm cli storage init

Atteso: `bucket bot-cv created (private)`; rilanciato: `already exists`. In Supabase Studio il
bucket deve risultare **non pubblico**.

## 3. Un'intervista

Avviare il worker con le variabili sopra e completare un'intervista (WhatsApp di test del
piano 09, oppure `inbound send` del piano 08).

    pnpm cli worker start

## 4. Cosa guardare

1. Dopo i consensi: in dashboard compare il candidato (anche con pochi campi), canale WhatsApp.
2. Alla fine: il profilo è completo; lo stato intervista è `completed`.
3. Il candidato riceve un messaggio con il link al CV; il link apre un PDF leggibile.
4. Nella scheda del candidato in dashboard c'è il box CV e il download funziona.
5. In Supabase Studio, tabella `bot."CvDocument"`: una riga con `storageKey` (nessun link).
6. Le code `kubri-webhook-dead` e `cv-dead` sono vuote:
   `select name, count(*) from bot_queue.job where name like '%-dead' group by 1;` (nessuna riga).

## 5. Prove di guasto (facoltative ma consigliate)

- Segreto sbagliato: il job finisce in `kubri-webhook-dead` con motivo `unauthorized`, nel log
  compare un `error`, il worker continua.
- Dashboard spenta: il job viene ritentato (attesa crescente) e al ritorno parte.
- `SUPABASE_SERVICE_ROLE_KEY` sbagliata: tre tentativi di CV, poi il candidato riceve il messaggio
  di scusa e la sessione ha un flag `cv_failed`.
```

- [ ] **Step 2: Eseguire la guida su dev** e annotare nella PR (o nelle note di sessione) cosa è
  stato visto per ogni punto del §4. Se un punto non torna, **non** passare al Task 13.

- [ ] **Step 3: Commit**

```bash
git add docs/kubri-integration-setup.md
git commit -m "docs(chatbot): add the Kubri integration setup and dev verification guide"
```

---

### Task 13: Aggiornare spec, CLAUDE.md, CI e roadmap

**Files:**
- Modify: `docs/superpowers/specs/2026-10-24-chatbot-design.md` (§2: D122–D131; §10.3 `CvDocument`; §12.1 `cv.generated` e `learning_preferences`; §12.3 geocoding delegato)
- Modify: `CLAUDE.md` del chatbot (i moduli `src/integrations/`, le variabili, `storage init`, `docs/kubri-integration-setup.md`)
- Modify: `docs/superpowers/plans/2026-10-24-00-roadmap.md` (riga e scheda 10: "fatto")

- [ ] **Step 1: Spec §2.** Copiare la tabella delle decisioni D122–D131 di questo piano (stesso formato
  delle altre righe: decisione, motivo in una frase).
- [ ] **Step 2: Spec §12.** Nella tabella degli eventi aggiungere `cv.generated`; nella mappatura
  `learning_preferences`; in §12.3 scrivere che il geocoding è della piattaforma (D124) e che un
  geocodificatore proprio è uno sviluppo successivo.
- [ ] **Step 3: `CLAUDE.md` del chatbot.** Aggiungere: `src/integrations/` è il solo posto che chiama
  Kubri e lo storage (regola dei confini: `runtime` li usa solo tramite interfacce); la chiave di
  servizio di Supabase vive solo nell'ambiente del worker; il contratto del webhook si cambia in
  `packages/contracts` **insieme** alla dashboard; il payload di esempio è il test di contratto.
- [ ] **Step 4: Roadmap.** Riga 10: `**fatto** → \`2026-10-24-10-integrations.md\``; nella scheda 10
  aggiungere "*(dettagliato)*", la riga "Decisioni D122–D131" e il Fatto quando invariato.
- [ ] **Step 5: Controlli finali e commit**

Run: `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check` (chatbot), `pnpm test && pnpm exec tsc --noEmit && pnpm lint` (dashboard), `pnpm test` (radice).
Expected: tutti verdi.

```bash
git add docs CLAUDE.md
git commit -m "docs(chatbot): record plan 10 decisions and integration modules"
```

---

## Copertura della spec

| Spec | Dove |
|---|---|
| §12.1 mappatura, `key` (D20), `channel` (D22), soglia dei consensi (D24) | Task 4, 7 |
| §12.1 ritentativi 5xx/timeout, 4xx definitivo, coda degli scarti | Task 3, 6, 7 |
| §12.1 eventi (`consents.accepted`, `block.completed`, `interview.completed`, `profile.updated`, `cv.generated`) | Task 3, 7, 10 |
| D19 contratto condiviso, §14 test di contratto | Task 1, 2, 4 |
| §12.2 CV: PDF, storage privato, link firmato, `CvDocument`, `cv.generated` | Task 5, 8, 9, 10 |
| §12.3 geocoding (provider da scegliere → delegato alla piattaforma) | Task 7 (D124) |
| §13 errori (CV non generato → messaggio e flag) | Task 10 |
| §16.3 segreti (chiave di servizio solo nel worker) | Task 3, 8, 11 |
| Dashboard: `channel` esplicito, link del CV | Task 2 |
| Cancellazione dei dati verso Kubri (§18.8), cancellazione degli oggetti dello storage | piano 11 (qui si salvano le chiavi) |

## Punti aperti

1. **Geocoding.** La spec lasciava la scelta del fornitore. Qui è delegato alla dashboard (ISTAT):
   zero costi e zero dati in uscita, ma copre solo i comuni italiani e solo `location`. Va
   confermato con il titolare, e se serve un fornitore esterno è un piano a parte.
2. **Link del CV in dashboard che scade.** Dopo `CV_LINK_TTL_DAYS` il pulsante non funziona più
   finché non arriva un nuovo invio. Soluzioni: un endpoint della dashboard che chiede un link
   nuovo al chatbot, oppure una scadenza più lunga. Da decidere prima della produzione.
3. **Cancellazione verso Kubri e nello storage.** `delete-contact` (piano 11) deve cancellare gli
   oggetti `bot-cv` del contatto e dire alla dashboard di cancellare il candidato (§18.8): oggi
   la dashboard non ha un endpoint per farlo.
4. **Nomi non latini nel PDF.** I font standard disegnano `?`. Per arabo, cirillico, ecc. serve un
   font incorporato (per esempio Noto) e, per l'arabo, la gestione della scrittura da destra a
   sinistra: sviluppo successivo.
5. **Template per campagna.** Un solo modello italiano (`default-v1`); `CvDocument.template` è
   pronto per averne altri.
6. **Invio del PDF come documento WhatsApp.** Oggi si manda il link; il documento richiede un
   caricamento su Meta e il supporto ai messaggi `document` in uscita (piano 09, esteso).
7. **Ordine di rilascio.** Dashboard prima del chatbot, e `MAKE_WEBHOOK_SECRET` dev/prod coerente
   con `KUBRI_WEBHOOK_SECRET`.
8. **Coda degli scarti.** Oggi si guarda con una query; avvisi e comando `ops dead-letters` sono del
   piano 11.
