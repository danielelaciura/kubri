# JD ↔ Candidate semantic matching — Design

Status: draft
Date: 2026-05-13

## Goal

Migliorare il matching tra Job Description e candidati sostituendo l'attuale matcher lessicale rule-based con una **ricerca semantica basata su embeddings** salvati direttamente in Postgres via `pgvector`. La componente location resta invariata e continua a filtrare i candidati a monte.

## Problemi attuali (matcher rule-based)

Il matcher di oggi (`src/lib/jobs/matcher/`) usa tokenizzazione, stemming italiano, stopword e una lista statica di 19 gruppi di sinonimi. Soffre di tre problemi che vogliamo risolvere insieme:

1. **Falsi negativi semantici**: candidati validi che non emergono perché le parole della JD non combaciano col CV (es. JD parla di "addetto sala", candidato scrive "cameriere"; JD parla di "magazzino", candidato scrive "logistica").
2. **Falsi positivi**: candidati con qualche parola in comune che salgono nel ranking anche senza il vero requisito.
3. **Ranking poco discriminante**: i punteggi si appiattiscono nella fascia 30-50, faticando a distinguere i top.

Oltre a questi tre problemi di qualità, il codice attuale ha due bug minori che vengono risolti collateralmente:

- I pesi in [src/lib/jobs/matcher/config.ts](src/lib/jobs/matcher/config.ts) sommano a 1.2 (skills 0.5 + description 0.4 + location 0.3), quindi il punteggio finale può superare 100.
- La formula `0.5 * jdCoverage + 0.5 * candCoverage` in [skills.ts](src/lib/jobs/matcher/skills.ts) e [description.ts](src/lib/jobs/matcher/description.ts) **penalizza i CV ricchi**: a parità di hit, un candidato con esperienza ampia ottiene uno score più basso di uno povero.

## Non-goals (V1)

Esplicitamente fuori scope per questo design:

- Componente LLM narrativa sul dettaglio candidato (spiegazione "wow", skill mancanti, domande per il colloquio). Rinviata a fase successiva.
- Hard filter strutturati su lingua, patenti, permessi di lavoro. Per V1 il modello di embedding cattura abbastanza dal testo.
- Skill matching esplicito tipo "queste skill ci sono, queste mancano". Arriva con la fase LLM.
- Migrazione a modello di embedding più potente (Voyage, OpenAI). Restiamo su `gte-small` locale a Supabase per costo zero ed EU residency.
- Sostituzione del filtro location (Haversine + willingness-to-commute già in produzione, resta invariato).

## Architettura

### Stack

| Strato | Tecnologia | Ruolo |
|---|---|---|
| DB | Supabase Postgres + estensione `pgvector` | Storage embedding e query di similarità |
| Embedding model | `gte-small` (384-dim, multilingue) | Generazione vettori, eseguito in Supabase Edge Functions |
| ORM | Prisma con `Unsupported("vector(384)")` | Schema; query similarity via `$queryRaw` |
| Webhook | `/api/webhooks/make/candidate` (esistente) | Punto di trigger della generazione per i candidati |
| Server actions JD | `src/app/(dashboard)/dashboard/jobs/actions.ts` | Punto di trigger per le JD |

### Flusso

```
[Make scenario] → POST /api/webhooks/make/candidate
                          │
                          ▼
                  Upsert Candidate (Prisma)
                          │
                          ▼
                  Build embeddingText
                          │
                          ▼
              POST Supabase Edge Function /embed
                          │
                          ▼
                  vector(384) ritornato
                          │
                          ▼
                  UPDATE Candidate SET embedding,
                       embeddingText, embeddingUpdatedAt
                          │
                          ▼
                       200 OK
```

Al momento del matching su una JD:

```
[Operatore apre dettaglio JD]
          │
          ▼
  rankCandidates(jd, pool)
          │
          ▼
  1. Filtro location (Haversine, invariato)
          │
          ▼
  2. Query SQL con pgvector cosine similarity
     ORDER BY embedding <=> $jd_embedding LIMIT N
          │
          ▼
  3. Score finale = 0.7 * semantic + 0.3 * location
          │
          ▼
  Lista candidati ordinata
```

## Schema database

### Migration

Una migration Prisma con SQL custom:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Poi su entrambe le tabelle `Candidate` e `JobDescription`:

```sql
ALTER TABLE "Candidate"        ADD COLUMN embedding vector(384);
ALTER TABLE "Candidate"        ADD COLUMN "embeddingText" text;
ALTER TABLE "Candidate"        ADD COLUMN "embeddingUpdatedAt" timestamptz;

ALTER TABLE "JobDescription"   ADD COLUMN embedding vector(384);
ALTER TABLE "JobDescription"   ADD COLUMN "embeddingText" text;
ALTER TABLE "JobDescription"   ADD COLUMN "embeddingUpdatedAt" timestamptz;

CREATE INDEX candidate_embedding_hnsw_idx
  ON "Candidate" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX job_description_embedding_hnsw_idx
  ON "JobDescription" USING hnsw (embedding vector_cosine_ops);
```

### Prisma

In `prisma/schema.prisma`, sui modelli `Candidate` e `JobDescription`:

```prisma
embedding             Unsupported("vector(384)")?
embeddingText         String?
embeddingUpdatedAt    DateTime?
```

Prisma non gestirà direttamente le query di similarità: useremo `prisma.$queryRaw` per il ranking. Le query di update dell'embedding usano `$executeRaw` per assegnare il vettore correttamente.

## Composizione `embeddingText`

### Candidato
Concatenazione dei seguenti campi (separati da `\n`, vuoti omessi):

- `skillsAndCompetences` (array → join `, `)
- `workExperience` (array → join `, `)
- `educationAndTraining` (array → join `, `)
- `desiredJob` (string)
- `jobConstraints` (string)

Campi esclusi: `hasDesiredJobExperience` (rumoroso, spesso testo libero non significativo).

### Job Description
Concatenazione di:

- `name`
- `description`
- `skills` (array → join `, `)

## Embedding generation

### Servizio

Una Supabase Edge Function `embed` espone:

```
POST /functions/v1/embed
Body: { "text": "..." }
Response: { "embedding": [0.12, -0.45, ...] }   // 384 numeri
```

Internamente la funzione usa:

```ts
const session = new Supabase.ai.Session('gte-small');
const embedding = await session.run(text, { mean_pool: true, normalize: true });
```

Autenticazione: la function è chiamata server-side da Vercel con il `SUPABASE_SERVICE_ROLE_KEY`.

### Client TypeScript

In `src/lib/embeddings/client.ts`:

```ts
export async function generateEmbedding(text: string): Promise<number[]>
```

Esegue il POST alla Edge Function. Gestisce timeout (3s), errori di rete, risposte malformate. Su errore lancia un'eccezione tipizzata `EmbeddingError` che il chiamante decide come gestire.

### Helper di assemblaggio

In `src/lib/embeddings/text.ts`:

```ts
export function buildCandidateEmbeddingText(c: Candidate): string
export function buildJobDescriptionEmbeddingText(j: JobDescription): string
```

Logica esplicita, testata, deterministica. Le modifiche a questa funzione richiedono backfill (vedi sotto).

## Triggers di generazione

### Candidato — webhook Make

Sincrono dentro `src/app/api/webhooks/make/candidate/route.ts`:

1. Upsert del candidato (come oggi)
2. `text = buildCandidateEmbeddingText(candidate)`
3. `embedding = await generateEmbedding(text)`
4. `UPDATE "Candidate" SET embedding = $1::vector, "embeddingText" = $2, "embeddingUpdatedAt" = now() WHERE id = $3`
5. Risposta 200 a Make

Se `generateEmbedding` fallisce: log dell'errore, candidato salvato comunque, `embedding` resta `null`. Un cron notturno raccoglie i `null` (vedi "Recovery").

### Job Description — server action

Sincrono nelle server action di create/update JD (`src/app/(dashboard)/dashboard/jobs/actions.ts` e `src/app/(dashboard)/dashboard/jobs/[id]/actions.ts`):

1. Validazione + insert/update JD
2. `text = buildJobDescriptionEmbeddingText(jd)`
3. `embedding = await generateEmbedding(text)`
4. Update colonne embedding
5. Redirect

Politica errore: come per il candidato. Se l'embedding fallisce la JD resta salvata senza vettore, il cron la rigenera. In UI mostriamo un piccolo warning "matching non disponibile, riprova tra qualche minuto".

## Matching query

Sostituisce `skillsScore` + `descriptionScore` nel matcher attuale. Resta `locationScore` invariato.

```ts
// in src/lib/jobs/matcher/index.ts
export async function rankCandidates(
  jd: JobDescription,
  poolId: string
): Promise<RankedCandidate[]> {
  if (!jd.embedding) {
    throw new MatchingUnavailableError("JD has no embedding yet");
  }

  const rows = await prisma.$queryRaw<Array<{ id: string; semantic: number }>>`
    SELECT
      id,
      1 - (embedding <=> ${jd.embedding}::vector) AS semantic
    FROM "Candidate"
    WHERE "poolId" = ${poolId}::uuid
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${jd.embedding}::vector
    LIMIT 200;
  `;

  // Carica i candidati completi, applica filtro location, calcola score finale
  // (dettagli implementativi nel plan)
}
```

### Formula finale

```
final = round(100 * (0.7 * semantic + 0.3 * location))
```

I pesi vivono in `src/lib/jobs/matcher/config.ts`. La somma è **esattamente 1** (bug fix vs config attuale a 1.2).

Soglie e fallback (`displayThreshold`, `fallbackTopN`, `maxResults`) restano in config, valori da tarare dopo i primi dati reali.

## Backfill

Script TypeScript one-shot:

```
pnpm tsx scripts/backfill-embeddings.ts [--target=candidates|jobs|all] [--force]
```

Comportamento:

- Cicla candidati / JD con `embedding IS NULL` (o tutti se `--force`)
- Per ogni record: costruisce `embeddingText`, chiama `generateEmbedding`, fa update
- Batch di 50 record con commit progressivi
- Idempotente, re-runnabile in caso di interruzione
- Log su stdout: `[123/2000] candidate xyz ok`

Con i volumi attuali (poche decine di candidati esistenti, qualche JD): runtime ~1 minuto.

Da rilanciare manualmente se in futuro:
- cambia il modello di embedding (es. passaggio a `gte-base` o a un provider esterno)
- cambia la composizione di `buildCandidateEmbeddingText` / `buildJobDescriptionEmbeddingText`

## Recovery: cron rigenerazione `null`

Un Vercel Cron giornaliero (`/api/cron/regenerate-embeddings`) cicla i record con `embedding IS NULL` e prova a rigenerarli. Protetto da `CRON_SECRET`. Limita a 500 record per run per evitare timeout.

Questo copre i casi in cui la generazione sincrona fallisce (Edge Function temporaneamente giù, errore di rete, etc.).

## Rimozione del rule-based

I seguenti file vengono **eliminati**:

- `src/lib/jobs/matcher/tokens.ts`
- `src/lib/jobs/matcher/synonyms.ts`
- `src/lib/jobs/matcher/skills.ts`
- `src/lib/jobs/matcher/description.ts`

E i relativi test:

- `src/__tests__/lib/jobs/matcher/tokens.test.ts`
- `src/__tests__/lib/jobs/matcher/synonyms.test.ts`
- `src/__tests__/lib/jobs/matcher/skills.test.ts`
- `src/__tests__/lib/jobs/matcher/description.test.ts`

Sopravvivono:

- `src/lib/jobs/matcher/location.ts` (filtro a monte)
- `src/lib/jobs/matcher/config.ts` (riscritto con i nuovi pesi)
- `src/lib/jobs/matcher/index.ts` (riscritto: integra embedding query + location)

La dipendenza `snowball-stemmers` può essere rimossa dal `package.json`.

## Sicurezza e GDPR

- Embedding generation **non lascia mai l'infra Supabase** (Edge Function self-hosted EU). I dati candidato non vengono inviati a provider esterni.
- L'embedding è derivato dal testo del candidato: in caso di richiesta di cancellazione (diritto all'oblio), `DELETE` sul candidato → l'embedding sparisce con la riga.
- Service role key per chiamare la Edge Function vive solo in env Vercel server-side, non esposta al client.

## Variabili d'ambiente nuove

```
SUPABASE_EDGE_FUNCTION_URL=https://<project>.supabase.co/functions/v1
SUPABASE_SERVICE_ROLE_KEY=<già presente per le query admin>
EMBEDDING_TIMEOUT_MS=3000
```

## Costi e performance previsti

| Voce | Stima |
|---|---|
| Embedding (Supabase free tier) | 0 € / mese |
| Embedding (Supabase Pro tier) | incluso nel piano attuale |
| Latenza extra webhook Make | +300–800 ms |
| Latenza query matching su 200 candidati | 30–100 ms |
| Spazio storage embedding | ~1.5 KB per record (20k candidati → ~30 MB) |
| Nuove dipendenze npm | 0 (`@supabase/supabase-js` già presente) |

Sentinella per migrare ad async con coda: se i volumi superano 200-300 candidati/min in burst.

## Testing

### Test unitari
- `buildCandidateEmbeddingText`: copre vari pattern di campi presenti/assenti, ordini, escape
- `buildJobDescriptionEmbeddingText`: idem
- Formula final score con casi limite (semantic 0/1, location 0/1)

### Test di integrazione
- Webhook Make end-to-end con embedding stub (Edge Function mockata)
- Server action JD con embedding stub
- Query `rankCandidates` con dataset seedato di 10-20 candidati con embedding noti, verifica ordinamento

### Test manuale post-deploy
1. Eseguire backfill in dev
2. Creare 3 JD reali con descrizioni diverse
3. Verificare che i top candidati siano semanticamente sensati
4. Modificare un candidato (via webhook simulato) e verificare che l'embedding si rigeneri

## Open questions

- Soglia `displayThreshold` per il nuovo punteggio: il vecchio 30 va ricalibrato dopo i primi dati reali. Per la prima settimana di test la abbassiamo a 25.
- Pesi 0.7 / 0.3 sono un punto di partenza. Da rivedere dopo feedback degli operatori.

## Step di follow-up (non in V1)

1. Aggiungere LLM narrativo (Haiku) sul dettaglio candidato per spiegazione + skill mancanti + domande colloquio.
2. Hard filter strutturati (lingue obbligatorie, patenti) come pre-filtro SQL prima della query pgvector.
3. Valutare migrazione a `gte-base` o `multilingual-e5-large` se la qualità di `gte-small` non basta.
4. Re-rank LLM sui top-20 in casi specifici (es. JD molto complessa).
