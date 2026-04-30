# Test DB Isolation — Spec

**Status:** Open, needs implementation
**Author:** Claude (post-mortem) + Daniele
**Date:** 2026-04-30
**Severity:** High — actively skipped tests + risk of recurrence

---

## 1. Problem

I test DB-backed introdotti durante il lavoro sui Pool (`src/lib/pools/__tests__/{access,actions,resolve}.test.ts`) usano nel `beforeEach`:

```typescript
await prisma.user.deleteMany({});
await prisma.organization.deleteMany({});
await prisma.candidate.deleteMany({});
// ecc.
```

Sono pensati per girare contro un DB di test isolato. Ma `vitest.setup.ts` carica `.env.local` (che punta al **dev DB reale** Supabase). Quando uno sviluppatore lancia `pnpm test`, i test cancellano dati reali.

**Incidente concreto (30 aprile 2026):** un'esecuzione di `pnpm test` sul worktree `feat/pools` ha cancellato:
- Tutti gli `User` in `public.User` (incluso l'admin Kubri reale)
- Tutte le `Organization`
- Pool / OrganizationPool / Candidate / AuditLog

Solo `auth.users` (Supabase) è sopravvissuto perché vive in un altro schema. Recovery manuale: ricreazione minimale di Org "Kubri" + User admin + Global pool + re-seed dei 30 candidati. **Nessun backup Supabase disponibile** (free tier).

Mitigazione immediata: i 3 file di test sono `describe.skip`-ati (commit `6b8f2fd`). Tutti i 160 test che girano oggi sono safe — nessuno tocca DB reale.

## 2. Goal

Permettere ai DB-backed test di girare in modo isolato e ripetibile, **senza la possibilità di toccare il DB di sviluppo o di produzione**, in modo da poter ri-attivare i 3 file skip-pati e aggiungerne altri in futuro senza paura.

## 3. Non-goals

- ❌ Setup di un DB di staging condiviso (overkill per la scala attuale)
- ❌ Migrazione a un test runner diverso (vitest va bene)
- ❌ Riscrittura dei test esistenti — devono rimanere quelli, solo isolati

## 4. Opzioni

### A. PGLite in-memory (raccomandato)

`@electric-sql/pglite` è un Postgres che gira in-process, in-memory. È già nel `node_modules` (dipendenza transitiva). Setup: una pagina di codice nel `vitest.setup.ts` che crea un'istanza pglite, applica il Prisma schema (via `prisma db push` o equivalente programmatico), e injecta un Prisma client connesso a pglite invece che a Supabase.

**Pro:**
- Zero rischio: nessuna connessione a DB reali, mai
- Veloce (~10s startup, <1ms per query)
- Ogni file di test parte da DB vuoto pulito
- Niente nuove credenziali, niente env vars aggiuntive

**Contro:**
- pglite supporta la maggior parte di Postgres ma non tutto (es. partial unique index dovrebbero funzionare, ma da verificare)
- Setup iniziale ~30-60 min (creare il setup file, far funzionare prisma.schema → pglite, validare che i nostri test passano)

### B. TEST_DATABASE_URL separato

Un secondo DB Supabase (o Postgres locale via Docker) con il suo proprio schema, dedicato ai test. `vitest.setup.ts` carica un `.env.test` invece di `.env.local`.

**Pro:**
- Comportamento Postgres identico al dev
- Pattern standard, ben documentato
- Permette test che durano oltre il singolo run (es. ispezione manuale dello stato post-test)

**Contro:**
- Richiede spinning up di un secondo DB (Supabase free? Docker? Neon free?)
- Setup di credenziali, migrazioni da ri-applicare
- Costo se Supabase/Neon
- Rischio identico al primo se `.env.test` per errore punta al dev

### C. Transactional rollback

Ogni test gira in una `prisma.$transaction` che si rolla back alla fine. Niente `deleteMany`. Niente cleanup.

**Pro:**
- Zero stato condiviso tra test
- Nessuna setup di nuovo DB

**Contro:**
- Prisma 7 transaction support per nested calls è limitato
- Ogni test deve essere riscritto per fluire dentro la callback `$transaction`
- Non isola da casi in cui il codice testato apre una sua propria connessione (es. raw queries)
- Più complesso da debuggare quando un test fallisce

### Raccomandazione: A (PGLite)

A copre il 100% del caso d'uso, è già nel grafo di dipendenze, e produce zero rischio operativo. B introduce un secondo DB da mantenere per benefici marginali. C è fragile e richiede riscrittura.

## 5. Done criteria

- [ ] `vitest.setup.ts` (o un nuovo `vitest.db-setup.ts` referenziato da config) avvia pglite e applica lo schema Prisma all'inizio del run
- [ ] Il `prisma` client esportato da `@/lib/db` viene mockato/sostituito durante i test per puntare a pglite
- [ ] I 3 file `describe.skip` (`access.test.ts`, `actions.test.ts`, `resolve.test.ts`) tornano a `describe(...)` e passano
- [ ] Si verifica esplicitamente che il `vitest.setup.ts` **non legge `.env.local`** per le sue connessioni DB
- [ ] Aggiunta una test che fallisce intenzionalmente se `process.env.DATABASE_URL` punta a un host non-localhost durante test (guardia)
- [ ] README o `CLAUDE.md` aggiornato con: "i test DB-backed girano contro pglite in-memory, non contro Supabase"

## 6. Estimate

~30-60 min se pglite supporta tutto quello che usiamo. ~2-3 h se ci sono incompatibilità (es. partial unique index, certi tipi UUID, qualche estensione Postgres).

## 7. Lessons learned (per non ripeterlo)

1. **Mai puntare un test che fa `deleteMany({})` a `.env.local`.** Se il test ha cleanup distruttivo, il DB sotto deve essere usa-e-getta.
2. **Setup file dei test devono rifiutare di girare se DATABASE_URL non è una sandbox.** Una guardia hard-coded che fa `throw new Error` se l'host include `supabase.co` o `neon.tech` avrebbe bloccato l'incidente.
3. **Backup**: dev Supabase su free tier non ha backup. Vale la pena il Pro plan ($25/mo) almeno per dev se la prod un giorno ci girerà sopra. Oppure un `pg_dump` cron settimanale su S3/locale.
4. **Audit log**: il nostro audit log esiste ma non era stato applicato a dev op tipo "creazione user via trigger". Tracciare creazione/eliminazione di User nelle audit log avrebbe reso più facile un restore puntuale.

## 8. Related

- Worktree: `.worktrees/pools` (branch `feat/pools`)
- Mitigation commit: `6b8f2fd test(pools): skip DB-backed tests pending isolated test DB`
- Test files affected: `src/lib/pools/__tests__/{access,actions,resolve}.test.ts`
- Schema reference: `vitest.config.ts` `setupFiles: ["./vitest.setup.ts"]`, `vitest.setup.ts` loads `.env.local` via `dotenv`
