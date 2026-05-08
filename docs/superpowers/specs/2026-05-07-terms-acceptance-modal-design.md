# Terms & Conditions Acceptance Modal — Design

**Date:** 2026-05-07
**Status:** Approved (brainstorming)

## Goal

Mostrare al primo accesso di ciascun utente una modale obbligatoria che richiede l'accettazione esplicita dei Termini e Condizioni. Una volta accettati, la modale non viene più mostrata. L'unica alternativa all'accettazione è il logout. Vale per **tutti** gli utenti autenticati, di qualunque ruolo, su `/dashboard/*` e `/admin/*`.

Il testo dei T&C è fuori scope di questa iterazione: viene caricato un placeholder in una costante dedicata, sostituibile quando il testo definitivo sarà disponibile.

## Persistence

Aggiungere un campo nullable al modello `User`:

```prisma
termsAcceptedAt DateTime?
```

- `null` ⇒ utente non ha mai accettato → modale visibile.
- `DateTime` ⇒ utente ha accettato in quella data → modale nascosta per sempre.

Migrazione: `prisma migrate dev --name add_terms_accepted_at_to_user`.

Il campo è nullable per non invalidare gli utenti già presenti — saranno trattati come "primo accesso" alla loro prossima sessione e dovranno accettare anche loro.

## Gating point

I layout server-rendered di entrambe le aree autenticate fanno il check:

- `src/app/(dashboard)/dashboard/layout.tsx`
- `src/app/(admin)/admin/layout.tsx`

In entrambi, `getCurrentUser()` (in `src/lib/auth-utils.ts`) viene esteso per includere `termsAcceptedAt` nello `select`. Se `termsAcceptedAt === null`, il layout renderizza `<TermsAcceptanceModal />` accanto allo `<DashboardShell>`. Essendo la modale un overlay full-screen non chiudibile, blocca di fatto ogni interazione.

Non si usa redirect a una pagina dedicata: la modale resta nel layout e il contenuto sotto non è interattivo finché non viene accettato.

## UI — `TermsAcceptanceModal` (client component)

File: `src/components/auth/terms-acceptance-modal.tsx`.

Comportamento:

- shadcn `Dialog` con `open` permanentemente `true`. Nessun handler `onOpenChange` chiude la modale: `Esc`, click sull'overlay, e ogni altro tentativo di chiusura sono no-op.
- Niente "X" di chiusura (passare `showCloseButton={false}` al `DialogContent`, che già supporta il flag, vedi `src/components/ui/dialog.tsx`).
- Struttura:
  - Titolo: `Termini e Condizioni`
  - Descrizione breve: `Per accedere alla piattaforma è necessario accettare i Termini e Condizioni.`
  - Body scrollabile (`max-h` + `overflow-y-auto`) con il contenuto da `TERMS_TEXT`.
  - Checkbox shadcn: `Ho letto e accetto i Termini e Condizioni`, default `false`.
  - Footer con due bottoni:
    - **Esci** (variante outline): chiama `signOut()` di Supabase + redirect `/login`.
    - **Conferma** (default): disabilitato finché la checkbox è `false`; al click chiama la server action `acceptTerms()`. Mostra stato `loading` durante la chiamata.

### Testo placeholder

File `src/lib/terms/text.ts`:

```ts
export const TERMS_TEXT = `Testo placeholder dei Termini e Condizioni.\n\n(Da sostituire con il testo legale definitivo prima del rilascio in produzione.)`;
```

Quando il testo definitivo arriva, basta sostituire la costante. Nessun cambio agli altri file.

## Server action — `acceptTerms`

File: `src/lib/auth/actions.ts` (l'azione non è legata a una route specifica; segue la convenzione `src/lib/<area>/actions.ts` già in uso, es. `src/lib/pools/actions.ts`).

Comportamento:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";

export async function acceptTerms() {
  const user = await getCurrentUser();          // throws se non autenticato
  if (user.termsAcceptedAt) return;              // idempotente
  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { termsAcceptedAt: now },
    }),
    prisma.auditLog.create({
      data: {
        userId: user.id,
        organizationId: user.organizationId,    // può essere null per ADMIN_KUBRI
        action: "terms_accepted",
        resourceType: "User",
        resourceId: user.id,
        metadata: { acceptedAt: now.toISOString() },
      },
    }),
  ]);
  revalidatePath("/", "layout");
}
```

- Nessun input dal client, quindi niente Zod.
- L'idempotenza (`if (user.termsAcceptedAt) return`) protegge da doppi click / race tra tab.
- L'audit log fornisce la traccia legale dell'accettazione (data, ora, utente).

`getCurrentUser` deve includere `termsAcceptedAt` nello `select`.

`AuditLog.organizationId` è già nullable nello schema (`String?`), quindi l'audit log si scrive sempre, anche per `ADMIN_KUBRI` senza organization (`organizationId: null`).

## Edge cases

- **Utente apre due tab simultaneamente, accetta in una**: la seconda tab vede ancora la modale finché non si refresha. Al click su "Conferma" nella seconda tab, l'idempotenza evita doppi update e doppi audit log; `revalidatePath` dovrebbe poi sistemare il render. Accettabile.
- **Server action fallisce (network/DB)**: la modale resta aperta, mostriamo un toast/messaggio inline d'errore vicino al bottone Conferma; l'utente può ritentare.
- **Utente esistente prima del deploy**: `termsAcceptedAt = null` → vedrà la modale al prossimo accesso. È il comportamento voluto.

## Testing

- **Unit/integration** sulla server action `acceptTerms`:
  - Imposta `termsAcceptedAt` su `User`.
  - Crea entry `AuditLog` con `action="terms_accepted"`.
  - È idempotente (chiamata due volte ⇒ un solo update, un solo audit log).
  - Throws se l'utente non è autenticato.
- **Manuale**:
  - Utente nuovo (oppure forzando `termsAcceptedAt = null` via Prisma Studio): la modale appare, checkbox off → Conferma disabilitato.
  - Spunto checkbox → Conferma cliccabile.
  - Click Conferma → modale sparisce, layout torna interattivo, refresh non rimostra.
  - "Esci" → logout + redirect `/login`.
  - `Esc`, click overlay, X (assente): nulla chiude la modale.

Non si introducono test E2E in questa iterazione.

## Out of scope

- **Versioning dei T&C**: un solo `termsAcceptedAt`, niente `termsVersion`. Quando in futuro i T&C cambieranno e si vorrà forzare ri-accettazione, si evolverà verso una tabella `TermsAcceptance(userId, version, acceptedAt)`.
- Pagina dedicata `/terms` per consultare il testo a parte.
- Email di conferma dell'accettazione.
- Internazionalizzazione del testo: tutto in italiano, come il resto della UI.
- Differenziazione di T&C per ruolo o per organization.

## Files

**Created:**
- `src/lib/terms/text.ts`
- `src/components/auth/terms-acceptance-modal.tsx`
- `src/lib/auth/actions.ts`
- `src/__tests__/lib/auth/actions.test.ts`
- `prisma/migrations/<timestamp>_add_terms_accepted_at_to_user/migration.sql`

**Modified:**
- `prisma/schema.prisma` — aggiunto `termsAcceptedAt` su `User`
- `src/lib/auth-utils.ts` — `getCurrentUser` include `termsAcceptedAt`
- `src/app/(dashboard)/dashboard/layout.tsx` — render modale se `termsAcceptedAt === null`
- `src/app/(admin)/admin/layout.tsx` — render modale se `termsAcceptedAt === null`

## Migration & deploy

Standard del progetto (vedi CLAUDE.md):

1. `pnpm prisma migrate dev --name add_terms_accepted_at_to_user`
2. PR review
3. Prima del merge: `set -a && source .env.prod && set +a && pnpm prisma migrate deploy`
4. Merge → Vercel deploya il nuovo codice contro lo schema già aggiornato.

Migrazione non distruttiva (sola aggiunta colonna nullable), zero downtime.
