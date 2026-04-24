# Make Candidate Webhook — Design Document

**Status:** Approved, ready for plan
**Author:** Daniele + Claude
**Date:** 2026-04-24
**Phase:** 1 of N (webhook only — no read switch, no backfill)

---

## 1. Goal

Costruire un endpoint HTTP che riceve da Make il payload completo di un candidato a intervista completata, e lo persiste su Postgres tramite upsert. Primo passo verso l'eliminazione dell'architettura ibrida Make/Postgres descritta in `CLAUDE.md`.

## 2. Out of scope (questa fase)

- ❌ Modifiche al consumer (`/dashboard/candidates` continua a leggere da Make come oggi via `src/lib/make/service.ts`)
- ❌ Backfill dei candidati storici già presenti su Make
- ❌ Endpoint manuale di re-sync da UI admin
- ❌ Gestione cancellazioni (Make non può triggerare un webhook on-delete)
- ❌ Editing del Candidate dal dashboard (è read-only, popolato dal webhook)
- ❌ WebhookLog table per observability strutturata

Tutti gli "out of scope" sono raccolti in **§9 Next Steps**.

## 3. Architettura

```
[Telegram/WhatsApp] → [Make scenario] → [Make Data Store]   (resta com'è, "buffer interno")
                            │
                            └─ on interview_complete=true
                                  ↓
                       POST /api/webhooks/make/candidate
                                  ↓
                          [Postgres.Candidate]              (nuova fonte preparata)
                                  ↑
                       (in futuro: dashboard switcha qui)
```

**Decisioni architetturali**

- **Source of truth futura:** Postgres. Make resta come buffer del chatbot pipeline.
- **Trigger:** webhook firato **solo** a `interview_complete = true`. No update intermedi.
- **Multi-tenant:** Candidate è cross-org. L'access control si fa via `Candidate.makeDatastoreId` confrontato con l'`Organization.makeDatastoreId` dell'utente loggato. Più org possono condividere lo stesso datastore (e quindi vedere gli stessi candidati).
- **Identità:** chiave logica `(makeDatastoreId, externalId)`. `externalId` arriva nel campo `key` del payload Make. La PK interna è un UUID nostro, indipendente.
- **Upsert semantics:** A — ultima scrittura vince (`INSERT ON CONFLICT DO UPDATE`). Niente edit dashboard-side, quindi nessun rischio di sovrascrivere modifiche utente.
- **Dashboard switch:** C — il dashboard continua a leggere da Make in questa fase. Lo switch del read sarà un PR separato dopo il backfill.

## 4. Schema Postgres

### 4.1 Nuova tabella `Candidate`

```prisma
model Candidate {
  id              String   @id @default(uuid()) @db.Uuid

  // Identità sorgente
  externalId      String                         // valore di `key` dal payload Make
  makeDatastoreId String                         // datastore di provenienza

  // Anagrafica
  firstName       String?
  lastName        String?
  birthday        String?                        // string: Make manda formati eterogenei
  countryOfOrigin String?
  address         String?
  phone           String?

  // Status legale / lavorativo
  workingPermit   String?
  meanOfTransport String?
  drivingLicense  String?

  // Esperienze e competenze
  educationAndTraining String[]
  workExperience       String[]
  skillsAndCompetences String[]

  // Lingue
  language             String?                   // lingua principale parlata
  additionalLanguages  String[]
  italianLevel         String?

  // Preferenze lavorative (denormalizzate)
  desiredJob               String?
  partTimePreference       Boolean?
  preferredLocation        String?
  jobConstraints           String?
  hasDesiredJobExperience  String?

  // Meta
  interviewLanguage   String?
  sourceOrganization  String?
  channel             String?                    // "telegram" | "whatsapp"

  // Safety net per evoluzione schema senza migration
  rawPayload          Json

  // Timestamps
  sourceUpdatedAt     DateTime?                  // dal campo `last_updated` di Make
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  // Relazioni
  notes CandidateNote[]
  tags  CandidateTag[]

  @@unique([makeDatastoreId, externalId])
  @@index([makeDatastoreId])
  @@index([makeDatastoreId, createdAt])
  @@index([makeDatastoreId, lastName])
}
```

**Note di design**
- Tutti i campi candidato sono **nullable** tranne `rawPayload` — Make può inviare interviste con campi mancanti.
- `rawPayload` è la safety net: campi nuovi non rompono nulla; possono essere promossi a colonne prima-classe in un secondo momento (vedi §6).
- `String[]` (Postgres array) per liste corte come skills — niente tabella accessoria.
- Nessuna FK a Organization (cross-org by design, vedi §3).

### 4.2 Modifiche a `CandidateNote` e `CandidateTag`

```prisma
model CandidateNote {
  id             String   @id @default(uuid()) @db.Uuid
  candidateId    String   @db.Uuid               // NUOVO: FK a Candidate
  organizationId String   @db.Uuid               // resta (multi-tenant)
  userId         String   @db.Uuid
  content        String
  createdAt      DateTime @default(now())

  candidate    Candidate    @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id])
  user         User         @relation(fields: [userId], references: [id])

  @@index([candidateId])
  @@index([organizationId])
}

model CandidateTag {
  id             String   @id @default(uuid()) @db.Uuid
  candidateId    String   @db.Uuid               // NUOVO: FK a Candidate
  organizationId String   @db.Uuid               // resta (multi-tenant)
  tag            String
  createdAt      DateTime @default(now())

  candidate    Candidate    @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id])

  @@unique([candidateId, organizationId, tag])
  @@index([candidateId])
  @@index([organizationId])
}
```

**Cosa cambia rispetto a oggi**
- `makeRecordId` (string) → `candidateId` (UUID FK) per entrambe.
- `onDelete: Cascade` su Candidate → cancellazione manuale future-proof per GDPR.
- `CandidateTag`: aggiunto `@@unique([candidateId, organizationId, tag])` per evitare duplicati.

**Multi-tenant invariato**: `organizationId` resta su Note/Tag. Due org che condividono il datastore vedono lo stesso Candidate ma NON le note/tag reciproche.

### 4.3 Migration SQL

Vedi §7.1 per il file completo.

**Backfill nelle note/tag**:
```sql
ADD COLUMN candidateId UUID;
UPDATE … SET candidateId = (lookup via org.makeDatastoreId + makeRecordId);
DELETE FROM … WHERE candidateId IS NULL;  -- orfane
ALTER … SET NOT NULL;
DROP COLUMN makeRecordId;
ADD CONSTRAINT FK + index;
```

Note/Tag sono **vuote in dev e prod oggi** → backfill no-op nella pratica. Il codice del backfill è comunque corretto per il caso non-vuoto.

## 5. Webhook contract

### 5.1 Endpoint

```
POST /api/webhooks/make/candidate
```

Versionamento futuro: `/v2/candidate` per breaking change.

### 5.2 Headers

| Header | Required | Valore |
|---|---|---|
| `Authorization` | sì | `Bearer <MAKE_WEBHOOK_SECRET>` |
| `Content-Type` | sì | `application/json` |

### 5.3 Body

```json
{
  "key": "abc123def456",
  "makeDatastoreId": "ds_xyz789",
  "data": {
    "first_name": "Mario",
    "last_name": "Rossi",
    "birthday": "1995-03-12",
    "country": "Italia",
    "address": "Via Roma 1, Milano",
    "phone": "+39 333 1234567",
    "working_permit": "permanente",
    "transport": "auto propria",
    "education_and_training": ["..."],
    "work_experience": ["..."],
    "skills_and_competences": ["..."],
    "language": "italiano",
    "additional_languages": ["inglese", "francese"],
    "italian_level": "B2",
    "driving_license": "B",
    "job_preferences": {
      "desired_job": "magazziniere",
      "part_time_preference": true,
      "preferred_location": "Milano nord",
      "constraints": "no turni notturni",
      "has_desired_job_experience": "sì 2 anni"
    },
    "source_organization": "APL Milano",
    "interview_complete": true,
    "last_updated": "2026-04-24T15:32:11Z"
  }
}
```

- `key`, `makeDatastoreId`, `data` sono **strutturalmente** obbligatori.
- Campi dentro `data` sono tutti opzionali — gestiamo missing in `normalize`.

### 5.4 Status codes

| Status | Quando | Body |
|---|---|---|
| `200` | Upsert riuscito | `{"ok": true, "candidateId": "<uuid>"}` |
| `400` | Payload malformato (Zod fail) | `{"error": "validation_failed", "details": {...}}` |
| `401` | Auth header missing/wrong | `{"error": "unauthorized"}` |
| `500` | Errore DB / inatteso | `{"error": "internal_error"}` |

Risposta sempre entro <5s (Make timeout default).

### 5.5 Idempotenza

Garantita dal vincolo `@@unique([makeDatastoreId, externalId])` + `INSERT ON CONFLICT DO UPDATE`. Make può ritentare lo stesso payload N volte senza side effect.

### 5.6 Authentication

Shared secret `MAKE_WEBHOOK_SECRET` (env var, generato con `openssl rand -hex 32`).

Validation:
```typescript
const auth = req.headers.get("authorization");
if (auth !== `Bearer ${process.env.MAKE_WEBHOOK_SECRET}`) {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
```

Upgrade futuro a HMAC signature se servirà più robustezza.

## 6. Validazione, normalizzazione, manutenibilità

### 6.1 Strategia "tollerante in input, stretta in output"

```typescript
// src/lib/validations/webhook-candidate.ts
import { z } from "zod/v4";

export const makeCandidateWebhookSchema = z.object({
  key: z.string().min(1),
  makeDatastoreId: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export type MakeCandidateWebhookPayload = z.infer<typeof makeCandidateWebhookSchema>;
```

Solo 3 campi structurally required. Tutto dentro `data` viene normalizzato best-effort dal `normalize` esistente.

### 6.2 Riuso normalize

`src/lib/make/normalize.ts` oggi trasforma `MakeDataStoreRecord → Candidate (TypeScript type)`. Lo estendiamo:
- Output: input per `prisma.candidate.upsert` (mapping diretto, dei nuovi campi `italianLevel` etc.)
- Aggiunte: campo `italianLevel` (da `data.italian_level`), gestione `data.country` → `countryOfOrigin`
- Stesso file usato sia dal webhook (nuovo) sia da `service.ts` (read da Make, finché esiste)

### 6.3 Aggiungere un campo nuovo lato Make

Senza modifiche: il campo finisce in `rawPayload.data.<nome>` → recuperabile via `SELECT raw_payload->'data'->>'nome'`.

Per renderlo prima-classe (filtrabile, indicizzabile):
1. `prisma migrate dev --name add_candidate_<nome>`
2. 2 righe in `normalize.ts`
3. Backfill opzionale: `UPDATE "Candidate" SET nome = raw_payload->'data'->>'nome'`

Costo totale: ~5 minuti.

### 6.4 Breaking change

Se Make cambia struttura del payload:
- Nuovo endpoint `/api/webhooks/make/v2/candidate`
- Vecchio endpoint resta operativo durante la migrazione scenari
- Rimuoviamo il vecchio quando tutti gli scenario sono migrati

### 6.5 Pseudo-codice handler

```typescript
// src/app/api/webhooks/make/candidate/route.ts
export async function POST(req: NextRequest) {
  // 1. Auth
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.MAKE_WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Parse + structural validation
  const json = await req.json().catch(() => null);
  const parsed = makeCandidateWebhookSchema.safeParse(json);
  if (!parsed.success) {
    console.error("[webhook] validation failed", parsed.error.flatten());
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 3. Normalize → upsert input
  const upsertInput = normalizeForUpsert(parsed.data);

  // 4. Upsert
  try {
    const candidate = await prisma.candidate.upsert({
      where: {
        makeDatastoreId_externalId: {
          makeDatastoreId: parsed.data.makeDatastoreId,
          externalId: parsed.data.key,
        },
      },
      create: upsertInput,
      update: upsertInput,
      select: { id: true },
    });
    return NextResponse.json({ ok: true, candidateId: candidate.id });
  } catch (e) {
    console.error("[webhook] upsert failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
```

## 7. Migration & deploy

### 7.1 SQL migration completa

```sql
-- 1. Create Candidate table
CREATE TABLE "Candidate" (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "externalId"             TEXT NOT NULL,
  "makeDatastoreId"        TEXT NOT NULL,
  "firstName"              TEXT,
  "lastName"               TEXT,
  birthday                 TEXT,
  "countryOfOrigin"        TEXT,
  address                  TEXT,
  phone                    TEXT,
  "workingPermit"          TEXT,
  "meanOfTransport"        TEXT,
  "drivingLicense"         TEXT,
  "educationAndTraining"   TEXT[] NOT NULL DEFAULT '{}',
  "workExperience"         TEXT[] NOT NULL DEFAULT '{}',
  "skillsAndCompetences"   TEXT[] NOT NULL DEFAULT '{}',
  language                 TEXT,
  "additionalLanguages"    TEXT[] NOT NULL DEFAULT '{}',
  "italianLevel"           TEXT,
  "desiredJob"             TEXT,
  "partTimePreference"     BOOLEAN,
  "preferredLocation"      TEXT,
  "jobConstraints"         TEXT,
  "hasDesiredJobExperience" TEXT,
  "interviewLanguage"      TEXT,
  "sourceOrganization"     TEXT,
  channel                  TEXT,
  "rawPayload"             JSONB NOT NULL,
  "sourceUpdatedAt"        TIMESTAMPTZ,
  "createdAt"              TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"              TIMESTAMPTZ NOT NULL,
  CONSTRAINT "Candidate_makeDatastoreId_externalId_key" UNIQUE ("makeDatastoreId", "externalId")
);

CREATE INDEX "Candidate_makeDatastoreId_idx" ON "Candidate"("makeDatastoreId");
CREATE INDEX "Candidate_makeDatastoreId_createdAt_idx" ON "Candidate"("makeDatastoreId", "createdAt");
CREATE INDEX "Candidate_makeDatastoreId_lastName_idx" ON "Candidate"("makeDatastoreId", "lastName");

-- 2. CandidateNote: add candidateId FK, drop makeRecordId
ALTER TABLE "CandidateNote" ADD COLUMN "candidateId" UUID;
UPDATE "CandidateNote" cn
SET "candidateId" = c.id
FROM "Candidate" c, "Organization" o
WHERE o.id = cn."organizationId"
  AND c."makeDatastoreId" = o."makeDatastoreId"
  AND c."externalId" = cn."makeRecordId";
DELETE FROM "CandidateNote" WHERE "candidateId" IS NULL;
ALTER TABLE "CandidateNote" ALTER COLUMN "candidateId" SET NOT NULL;
ALTER TABLE "CandidateNote" DROP COLUMN "makeRecordId";
ALTER TABLE "CandidateNote" ADD CONSTRAINT "CandidateNote_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "Candidate"(id) ON DELETE CASCADE;
CREATE INDEX "CandidateNote_candidateId_idx" ON "CandidateNote"("candidateId");

-- 3. CandidateTag: add candidateId FK + unique constraint
ALTER TABLE "CandidateTag" ADD COLUMN "candidateId" UUID;
UPDATE "CandidateTag" ct
SET "candidateId" = c.id
FROM "Candidate" c, "Organization" o
WHERE o.id = ct."organizationId"
  AND c."makeDatastoreId" = o."makeDatastoreId"
  AND c."externalId" = ct."makeRecordId";
DELETE FROM "CandidateTag" WHERE "candidateId" IS NULL;
ALTER TABLE "CandidateTag" ALTER COLUMN "candidateId" SET NOT NULL;
ALTER TABLE "CandidateTag" DROP COLUMN "makeRecordId";
ALTER TABLE "CandidateTag" ADD CONSTRAINT "CandidateTag_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "Candidate"(id) ON DELETE CASCADE;
CREATE INDEX "CandidateTag_candidateId_idx" ON "CandidateTag"("candidateId");
ALTER TABLE "CandidateTag" ADD CONSTRAINT "CandidateTag_candidateId_organizationId_tag_key"
  UNIQUE ("candidateId", "organizationId", tag);
```

### 7.2 Env vars

```
MAKE_WEBHOOK_SECRET=<openssl rand -hex 32>
```

Da settare in: `.env.local` (dev), Vercel Production scope (prod).

Aggiungere a `.env.example`.

### 7.3 Deploy steps

Workflow standard documentato in `CLAUDE.md`:

1. Branch `feat/make-candidate-webhook`
2. Implement (vedi piano)
3. Test in locale: cloudflared tunnel + scenario Make di test
4. PR + review
5. **Prima del merge**: `prisma migrate deploy` su prod
6. Aggiungi `MAKE_WEBHOOK_SECRET` su Vercel Production
7. Merge → Vercel auto-deploys
8. Aggiorna scenario Make in produzione: aggiungi modulo HTTP che chiama l'endpoint a `interview_complete = true`
9. Verifica i primi candidati arrivano: `SELECT * FROM "Candidate" ORDER BY "createdAt" DESC LIMIT 10`

Il dashboard continua a leggere da Make per tutta la durata di questo PR. Nessun cambiamento user-visible.

## 8. Test plan

### 8.1 Unit tests

- `src/__tests__/lib/make/normalize.test.ts`: estendere copertura per i nuovi mapping (`italianLevel`, fallback su campi sconosciuti, payload completo, payload parziale)
- `src/__tests__/lib/validations/webhook-candidate.test.ts`: nuovi test su Zod schema

### 8.2 Integration test (route handler)

`src/__tests__/app/api/webhooks/make/candidate.test.ts`:
- 200 happy path (insert)
- 200 happy path (update — secondo POST con stesso `key`)
- 401 senza header
- 401 con secret sbagliato
- 400 con payload malformato (manca `key`, manca `makeDatastoreId`)
- 400 con `data` mancante
- 500 simulato (mock Prisma error)

### 8.3 Manual end-to-end

1. `pnpm dev` + `cloudflared tunnel --url http://localhost:3000`
2. Setup scenario Make di test → modulo HTTP verso URL del tunnel
3. Triggera intervista completata
4. Verifica:
   - Risposta 200
   - Record in `SELECT * FROM "Candidate"`
   - Re-triggera lo stesso → record aggiornato (no duplicato)

## 9. Next steps post-launch

Da appuntare in TODO/issue tracker (fuori scope di questa fase):

1. **Backfill iniziale**: script `pnpm tsx scripts/backfill-candidates.ts <makeDatastoreId>` + endpoint admin "Sincronizza candidati da Make"
2. **Switch read del dashboard**: sostituire `getCandidatesForOrg` (read da Make) con query Prisma su `Candidate`
3. **Rimuovere `src/lib/make/cache.ts` + `client.ts` + `service.ts`** quando il read è migrato
4. **WebhookLog table** se servirà audit/observability strutturato
5. **Endpoint manuale "Re-sync from Make"** in admin UI
6. **Hard delete GDPR**: UI per ADMIN_KUBRI per cancellare un Candidate (cascade su Note/Tag già configurato)
7. **Upgrade auth a HMAC signature** (se mai servirà più robustezza del Bearer token)

## 10. Open questions / risks

- **Risk**: scenario Make non aggiornato → webhook mai chiamato in prod. **Mitigation**: smoke test post-deploy con record di test reale.
- **Risk**: payload diverso da quello atteso in prod (campi rinominati, struttura nested differente). **Mitigation**: `rawPayload` cattura tutto + log dettagliato in caso di Zod fail. Ispezione e correzione in normalize senza schema migration.
- **Risk**: timeout Vercel (60s su Hobby) — non rilevante con upsert singolo (~50ms).
- **Open**: scenario di test su Make già esistente o va creato? (Vedere prima del deploy)
