# Pools — Multi-Dataset Candidate Partitioning

**Status:** Draft, in review
**Author:** Daniele + Claude
**Date:** 2026-04-27
**Phase:** Replaces `makeDatastoreId` tenancy with first-class `Pool` entity

---

## 1. Goal

Sostituire l'attuale concetto di `makeDatastoreId` (campo string su Organization e Candidate) con un'entità di prima classe `Pool`, che diventa l'unità di tenancy per i candidati. Una Organization può avere visibilità su uno o più Pool (M:N); un Candidate appartiene a esattamente un Pool (1:1).

Lo scopo è disaccoppiare la tenancy dal vendor (Make.com) e abilitare casi d'uso di raccolta dati segmentata — ad esempio un cliente che vuole vedere solo candidati di un territorio specifico — senza moltiplicare i datastore Make.

## 2. Out of scope

- ❌ Permessi per-utente-per-pool (Q3): schema-ready ma non implementato
- ❌ Soft delete dei pool (Q6): RESTRICT è sufficiente
- ❌ Auto-creazione di pool da webhook con `externalKey` sconosciuta: rifiutiamo con 422
- ❌ "Sposta candidati da pool A a pool B" UI: YAGNI
- ❌ Tabella `PoolSource` (più sorgenti per pool): un singolo `Pool.externalKey` copre i casi prevedibili
- ❌ Selettore esplicito di pool per stats/export: union dei pool accessibili è la regola unica
- ❌ Switch definitivo del read path da Make.com a Postgres: separato, governato dal flag `USE_PG_CANDIDATES`

## 3. Mental model

```
Organization ──(M:N via OrganizationPool)── Pool ──(1:N)── Candidate
     │
     └── User
```

- **Pool**: bucket logico di candidati. UUID interno + `externalKey` opzionale (chiave usata dal webhook per risolvere il pool di destinazione).
- **OrganizationPool**: pivot M:N che funge da whitelist di visibilità.
- **Candidate.poolId**: FK obbligatoria. Ogni candidato vive in un solo pool.
- **Pool "Global"**: pool sentinella (`isGlobal=true`, unico per vincolo SQL) auto-agganciato a tutte le org alla creazione, rimovibile dall'admin Kubri per casi di isolamento totale.

## 4. Decisioni di design

| # | Tema | Decisione |
|---|------|-----------|
| Q1 | Naming | `Pool` ovunque (DB, API, webhook payload, UI italiana) |
| Q2 | Default sharing | Auto-iscrizione al pool "Global" alla creazione org, rimovibile dall'admin Kubri |
| Q3 | Granularità permessi | Per-org, ma `getAccessiblePoolIds(userId)` come API per essere schema-ready a per-utente futuro senza refactoring |
| Q4 | Identificativi esterni | Singolo campo `Pool.externalKey: string?` con `@@unique` |
| Q5 | Aggregazioni (stats, export) | Union dei pool accessibili. Niente eccezioni. |
| Q6 | Cancellazione pool | `ON DELETE RESTRICT` su candidati e su pivot org |
| Q7 | Admin Kubri | Bypass totale del filtro pool. Filtro UI "per org" come dropdown additivo nella lista candidati |
| Q8 | Migrazione | Big bang in singola release (progetto non in prod, scala piccola) |

## 5. Schema Postgres

```prisma
model Pool {
  id          String   @id @default(uuid()) @db.Uuid
  name        String
  slug        String   @unique
  externalKey String?  @unique
  isGlobal    Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  candidates    Candidate[]
  organizations OrganizationPool[]
}

model OrganizationPool {
  organizationId String       @db.Uuid
  poolId         String       @db.Uuid
  createdAt      DateTime     @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  pool           Pool         @relation(fields: [poolId], references: [id], onDelete: Restrict)

  @@id([organizationId, poolId])
  @@index([poolId])
}

model Organization {
  // ...campi esistenti, RIMOSSO makeDatastoreId
  pools OrganizationPool[]
}

model Candidate {
  // ...campi esistenti, RIMOSSO makeDatastoreId
  poolId String @db.Uuid
  pool   Pool   @relation(fields: [poolId], references: [id], onDelete: Restrict)

  @@unique([poolId, externalId])
  @@index([poolId])
  @@index([poolId, createdAt])
  @@index([poolId, lastName])
}
```

**Vincolo invariante "max un pool global":** partial unique index applicato fuori da Prisma:

```sql
CREATE UNIQUE INDEX pool_only_one_global
ON "Pool" ("isGlobal")
WHERE "isGlobal" = true;
```

Cardinalità delle FK:
- `OrganizationPool → Organization`: `Cascade` (eliminata l'org, vanno via i pivot)
- `OrganizationPool → Pool`: `Restrict` (il pool con org agganciate non si cancella)
- `Candidate → Pool`: `Restrict` (il pool con candidati non si cancella)

## 6. Read path (dashboard)

### 6.1 API cardine: `getAccessiblePoolIds(userId)`

Centralizza la regola "quali pool può vedere questo utente". Implementata in `src/lib/auth/pool-access.ts`.

```typescript
async function getAccessiblePoolIds(userId: string): Promise<string[]> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { organization: { include: { pools: true } } }
  });

  if (user.role === 'admin_kubri') {
    const all = await db.pool.findMany({ select: { id: true } });
    return all.map(p => p.id);
  }

  return user.organization.pools.map(op => op.poolId);
}
```

Variante che ritorna pool completi (serve al Make-read mode per l'`externalKey`):

```typescript
async function getAccessiblePools(userId: string): Promise<Pool[]>
```

### 6.2 Modalità PG-read (flag `USE_PG_CANDIDATES=true`)

```typescript
async function listCandidatesFromPg(userId: string, filters: CandidateFilters) {
  const poolIds = await getAccessiblePoolIds(userId);
  return db.candidate.findMany({
    where: { poolId: { in: poolIds }, ...filters },
    // ...
  });
}
```

### 6.3 Modalità Make-read (flag `USE_PG_CANDIDATES=false`)

`src/lib/make/service.ts` viene aggiornato. Oggi recupera l'`Organization.makeDatastoreId` dell'utente e fa una sola chiamata API. Diventa:

```typescript
async function listCandidatesFromMake(userId: string) {
  const pools = await getAccessiblePools(userId);
  const externalKeys = pools
    .map(p => p.externalKey)
    .filter((k): k is string => Boolean(k));

  // Una chiamata Make API per externalKey, union dei risultati.
  const resultsPerKey = await Promise.all(
    externalKeys.map(key => makeClient.listRecords(key))
  );
  return resultsPerKey.flat();
}
```

Cache key esistente `make:{org_id}:{datastore_id}:...` viene riadattata a `make:{externalKey}:...`: la cache non è più legata all'org perché lo stesso `externalKey` può essere visto da più org (caso comune del pool "Global").

### 6.4 Stats, export, dettaglio candidato

- **Stats e export**: stesso filtro union via `getAccessiblePoolIds`.
- **Dettaglio candidato** (GET `/dashboard/candidates/[id]`): se il `poolId` del candidato non è in `getAccessiblePoolIds`, ritorna 404 (non 403, per non leakkare l'esistenza).
- **Note/Tag**: invariati. Restano filtrati per `organizationId` (le note sono private dell'org anche quando il pool è condiviso).

### 6.5 Filtro "per org" lato admin Kubri

Nuovo dropdown UI nella lista candidati admin: `?orgId=...`. Se presente E `user.role === 'admin_kubri'`, restringe la query ai pool di quella org. Implementato come filtro additivo, non come "impersonazione".

## 7. Write path (webhook Make → Candidate)

### 7.1 Cambio payload

Il webhook attuale riceve `makeDatastoreId`. Diventa `externalKey`. Lato Make: rinominare il campo nello scenario. Il valore della chiave NON cambia (è lo stesso `makeDatastoreId` di prima, solo rinominato). Aggiornamento Zod:

```typescript
const webhookSchema = z.object({
  externalKey: z.string().min(1),  // era: makeDatastoreId
  externalId: z.string().min(1),
  // ...resto invariato
});
```

### 7.2 Resolver `externalKey → poolId`

Nuovo modulo `src/lib/pools/resolve.ts`:

```typescript
export class UnknownPoolError extends Error {}

export async function resolvePoolByExternalKey(key: string): Promise<Pool> {
  const pool = await db.pool.findUnique({ where: { externalKey: key } });
  if (!pool) throw new UnknownPoolError(key);
  return pool;
}
```

### 7.3 Comportamento del webhook

- `externalKey` assente nel payload → **422** (Zod validation fail)
- `externalKey` non matcha alcun pool → **422 Unknown pool: {key}**, payload loggato (no auto-create per evitare creazione arbitraria di pool)
- `externalKey` matcha → upsert con la nuova chiave logica:

```typescript
await db.candidate.upsert({
  where: { poolId_externalId: { poolId: pool.id, externalId } },
  create: { poolId: pool.id, externalId, ...fields },
  update: { ...fields },
});
```

L'idempotenza è preservata: stesso `(poolId, externalId)` due volte = update.

## 8. UI di gestione (admin Kubri)

I Pool sono gestiti esclusivamente dal ruolo `admin_kubri`. Org admin/member non vedono né gestiscono pool — è uno strumento di tenancy interna.

### 8.1 Pagine

- **`/admin/pools`**: lista con name, slug, externalKey, n. candidati, n. org agganciate, badge "global" se applicabile. Bottone "Nuovo pool".
- **`/admin/pools/new`**: form nome / slug (auto-generato editabile) / externalKey opzionale. `isGlobal` non editabile via UI.
- **`/admin/pools/[id]`**: dettaglio. Edit di name / slug / externalKey. Lista organizations agganciate con add/remove. Conteggio candidati read-only con link a `/admin/candidates?poolId=...`. Bottone "Elimina pool" (disabilitato + tooltip se ha candidati o org agganciate).

### 8.2 Aggancio org ↔ pool

Esiste in due punti, equivalenti, entrambi scrivono su `OrganizationPool`:

- Da `/admin/pools/[id]` → "Aggancia organization" (multi-select)
- Da `/admin/organizations/[id]` → sezione "Pool accessibili" (multi-select)

Il pool "Global" appare di default come agganciato per nuove org (Q2) e si può rimuovere.

### 8.3 Lista candidati admin Kubri

Filtri additivi: dropdown "Pool" e dropdown "Org". Default: tutti i candidati visibili.

## 9. Migrazione (big bang)

Singola migrazione Prisma + script di backfill, nello stesso PR del codice nuovo.

### 9.1 Step SQL (in ordine, in transazione dove possibile)

```sql
-- 1. Crea tabelle nuove (vuote)
-- (gestito da prisma migrate)

-- 2. Crea il pool "Global"
INSERT INTO "Pool" (id, name, slug, "isGlobal", "externalKey")
VALUES (gen_random_uuid(), 'Global', 'global', true, NULL);

-- 3. Crea un Pool per ogni makeDatastoreId distinto già presente
INSERT INTO "Pool" (id, name, slug, "externalKey")
SELECT gen_random_uuid(),
       'Pool ' || md,
       md,
       md
FROM (SELECT DISTINCT "makeDatastoreId" AS md FROM "Organization") src;
-- Note: name e slug temporanei, l'admin Kubri li rinomina dopo dalla UI.

-- 4. Popola OrganizationPool: pool dedicato + global
INSERT INTO "OrganizationPool" ("organizationId", "poolId")
SELECT o.id, p.id
FROM "Organization" o
JOIN "Pool" p ON p."externalKey" = o."makeDatastoreId";

INSERT INTO "OrganizationPool" ("organizationId", "poolId")
SELECT o.id, (SELECT id FROM "Pool" WHERE "isGlobal" = true)
FROM "Organization" o
ON CONFLICT DO NOTHING;

-- 5. Aggiungi Candidate.poolId nullable temporaneamente
ALTER TABLE "Candidate" ADD COLUMN "poolId" UUID;

-- 6. Backfill Candidate.poolId
UPDATE "Candidate" c
SET "poolId" = p.id
FROM "Pool" p
WHERE p."externalKey" = c."makeDatastoreId";

-- 7. Verifica integrità (gate, fallisce la migrazione se restano NULL)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Candidate" WHERE "poolId" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incompleto: ci sono candidati senza poolId';
  END IF;
END $$;

-- 8. NOT NULL + FK + nuovi indici + nuovo unique
ALTER TABLE "Candidate" ALTER COLUMN "poolId" SET NOT NULL;
ALTER TABLE "Candidate"
  ADD CONSTRAINT "Candidate_poolId_fkey"
  FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT;
CREATE INDEX "Candidate_poolId_idx" ON "Candidate"("poolId");
CREATE INDEX "Candidate_poolId_createdAt_idx" ON "Candidate"("poolId", "createdAt");
CREATE INDEX "Candidate_poolId_lastName_idx" ON "Candidate"("poolId", "lastName");
CREATE UNIQUE INDEX "Candidate_poolId_externalId_key" ON "Candidate"("poolId", "externalId");

-- 9. Drop vecchie strutture su Candidate
DROP INDEX "Candidate_makeDatastoreId_externalId_key";
DROP INDEX "Candidate_makeDatastoreId_idx";
DROP INDEX "Candidate_makeDatastoreId_createdAt_idx";
DROP INDEX "Candidate_makeDatastoreId_lastName_idx";
ALTER TABLE "Candidate" DROP COLUMN "makeDatastoreId";

-- 10. Drop Organization.makeDatastoreId
ALTER TABLE "Organization" DROP COLUMN "makeDatastoreId";

-- 11. Partial unique index su Pool.isGlobal
CREATE UNIQUE INDEX pool_only_one_global
ON "Pool" ("isGlobal")
WHERE "isGlobal" = true;
```

### 9.2 Procedura operativa (per CLAUDE.md dev→prod workflow)

1. Apply in dev: `pnpm prisma migrate dev --name pools_and_partitioning`
2. Eseguire test (vedi §11)
3. Backup prod prima del deploy: `pg_dump "$DIRECT_URL" > /tmp/kubri-prod-pre-pools-$(date +%Y%m%d-%H%M%S).sql`
4. Apply in prod: `set -a && source .env.prod && set +a && pnpm prisma migrate deploy`
5. Verifica: `pnpm prisma migrate status`
6. Aggiornare lo scenario Make per inviare `externalKey` al posto di `makeDatastoreId` (valore identico)
7. Merge PR → Vercel deploya il codice nuovo
8. Window di rischio: ~10–30s di errori (vecchio codice ancora in esecuzione contro nuovo schema)

### 9.3 Coordinamento Make scenario

Lo scenario Make va aggiornato per rinominare il campo nel payload del webhook (`makeDatastoreId` → `externalKey`). Il valore della chiave NON cambia. Da fare nella stessa finestra di deploy.

### 9.4 Rollback

Se il deploy va male: restore da `pg_dump` + `prisma migrate resolve --rolled-back`. I candidati nuovi arrivati durante il window vengono rifiutati lato Make (422) → Make ha retry, quindi non si perdono dati.

## 10. Coordinamento con USE_PG_CANDIDATES

Le due migrazioni sono **ortogonali**. Pool è un livello di tenancy sopra entrambi i read path:

- **Make-read mode**: `getAccessiblePools(userId)` → `externalKey[]` → N chiamate Make API → union
- **PG-read mode**: `getAccessiblePoolIds(userId)` → filtro `Candidate.poolId IN (...)`

**Ordine di rilascio:**

1. **Release Pool** (questa feature). Prod resta con `USE_PG_CANDIDATES=false`: dashboard legge ancora da Make, ma con tenancy via Pool. Webhook scrive `poolId` su Candidate PG.
2. **Release "PG cutover"** (separata, futura). Flip del flag. Logica Pool già presente, niente di nuovo.

## 11. Testing strategy

### 11.1 Unit

- `getAccessiblePoolIds` per ruoli `admin_kubri`, `org_admin`, `org_member` con varie configurazioni di pivot
- `resolvePoolByExternalKey` happy path + `UnknownPoolError`
- Validazione `Pool` schema (slug formato `kebab-case`, externalKey non vuota se presente)

### 11.2 Integration

- POST webhook con `externalKey` valida → upsert su PG con `poolId` corretto
- POST webhook con `externalKey` sconosciuta → 422
- POST webhook con `externalKey` mancante → 422 (Zod)
- POST webhook duplicato (stesso `externalKey + externalId`) → 200 update, no duplicati
- Lista candidati org_member con due pool → vede union, non vede candidati di pool non agganciati
- Lista candidati admin_kubri → vede tutti
- Tentativo cancellazione pool con candidati → errore RESTRICT
- Tentativo cancellazione pool con org agganciate (zero candidati) → errore RESTRICT

### 11.3 Migrazione

- Test su copia di staging: verifica che il count candidati prima e dopo sia identico, che ogni candidato abbia `poolId` non-null, che ogni org abbia almeno il pool global agganciato.
- Test del partial unique index global: tentare di creare un secondo pool con `isGlobal=true` → fallisce.

### 11.4 E2E (manual smoke)

- Creazione pool dedicato dalla UI admin
- Aggancio pool a un'org tramite entrambe le viste (`/admin/pools/[id]` e `/admin/organizations/[id]`)
- Login come org_member dell'org → verifica che vede solo i candidati dei pool agganciati
- Webhook end-to-end con il nuovo `externalKey` → candidato appare nella dashboard dell'org giusta

## 12. Open questions per la fase di plan

- Naming UI completo italiano: "Pool" si traduce così com'è? (Ipotesi: sì, è internazionale).
- Slug del pool: auto-generato da `name` con strategia di disambiguazione (es. suffisso numerico) o richiesto esplicitamente all'utente?
- Limit hard al numero di pool per org: serve? (Ipotesi: no, soft limit con warning UI a >10).
- Audit log: ogni create/update/delete pool e ogni modifica di `OrganizationPool` va loggata? (Ipotesi: sì, coerente con altre operazioni admin).
