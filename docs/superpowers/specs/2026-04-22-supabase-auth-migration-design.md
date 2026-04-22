# Supabase Auth Migration — Design

**Date:** 2026-04-22
**Status:** Approved
**Author:** Daniele (Kubri)

## Contesto

Kubri Dashboard usa oggi NextAuth v5 con Credentials provider (email + password bcrypt) e JWT sessions. Il flusso di "invito" nella pagina membri crea un utente immediatamente con una password temporanea che l'admin deve comunicare fuori banda — non c'è reale email di invito.

Vogliamo sostituire questo sistema con **Supabase Auth**, che fornisce nativamente:

- login email + password
- flusso di invito via email (l'invitato sceglie la propria password)
- reset password via email
- gestione sessioni con cookie HttpOnly (via `@supabase/ssr`)

Le email transazionali vengono inviate da **Resend** via SMTP, configurato nel pannello Supabase.

Il prodotto è pre-launch: prod contiene solo 3 utenti seed fake (`admin@kubri.it`, `manager@kubri.it`, `operator@kubri.it`) e 2 Organization seed. Nessun dato reale da migrare.

## Obiettivi

1. Sostituire NextAuth con Supabase Auth come unico sistema di autenticazione.
2. Implementare un flusso di invito via email "un solo step" (admin invita → invitato riceve email → clicca → imposta password → entra).
3. Implementare reset password via email.
4. Rimuovere bcrypt e la colonna `passwordHash` da `public.User`.
5. Mantenere invariate le funzionalità di dominio (ruoli, multi-tenancy, audit log, organizzazioni, candidati).

## Non-obiettivi

- Non attiviamo Row Level Security su `public.*` — Prisma resta il data access layer, non esponiamo Postgres al browser.
- Non migriamo utenti reali (non ce ne sono).
- Non implementiamo 2FA, OAuth (Google/GitHub), SSO, magic link. Solo email+password.
- Non ci occupiamo in questo spec del deploy end-to-end (altro brainstorming separato, sospeso).

## Architettura

### Stack cambia così

| Area | Prima | Dopo |
|---|---|---|
| Auth provider | NextAuth v5 Credentials | Supabase Auth |
| Hash password | bcrypt (nostro) | gestito da Supabase |
| Sessioni | JWT NextAuth | Cookie HttpOnly via `@supabase/ssr` |
| Email transazionali | Nessuna | Resend via SMTP Supabase |
| `public.User.passwordHash` | esiste | rimosso |
| `public.User.id` | `cuid` | `uuid` = `auth.users.id` |

### Nuovi moduli

- `src/lib/supabase/server.ts` — client server-side (anon key) per server components
- `src/lib/supabase/admin.ts` — client server-side con service role key, solo per operazioni admin (invite, delete, updateUserById). **Mai importato in client component.**
- `src/lib/supabase/client.ts` — client browser-side (anon key) per pagine auth interattive
- `src/lib/supabase/middleware.ts` — helper per refresh dei cookie di sessione
- `src/lib/supabase/errors.ts` — mapping errori Supabase → messaggi UI italiani
- `src/middleware.ts` — riscritto con `@supabase/ssr`
- `src/lib/auth-utils.ts` — stessa API (`getCurrentUser`, `requireRole`, `requireOrganization`) ma implementazione nuova che legge la sessione da Supabase

### Moduli rimossi

- `src/lib/auth.ts`, `src/lib/auth.config.ts`
- `src/types/next-auth.d.ts`
- `src/lib/password.ts`
- `src/app/api/auth/[...nextauth]/` (se esiste)

### Pagine nuove / modificate

- `/login` — modificata: submit chiama `supabase.auth.signInWithPassword()` invece di NextAuth signIn
- `/login/forgot` — nuova: form "password dimenticata"
- `/auth/callback` — nuova: scambia il token ricevuto via email per una sessione attiva, poi redirect in base a `type` (invite → `/auth/set-password`, recovery → `/auth/reset-password`)
- `/auth/set-password` — nuova: form per impostare la password al primo login dopo invito
- `/auth/reset-password` — nuova: form per impostare nuova password dopo recovery

### Variabili d'ambiente

**Nuove:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

**Rimosse:**
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`

## Modello dati

### Schema Prisma — modello `User`

```prisma
model User {
  id             String        @id @db.Uuid          // = auth.users.id
  email          String        @unique
  name           String
  role           Role          @default(ORG_MEMBER)
  organizationId String?       @db.Uuid
  organization   Organization? @relation(...)
  createdAt      DateTime      @default(now())
  lastLoginAt    DateTime?

  // relazioni CandidateNote / AuditLog invariate
}
```

Modifiche rispetto ad oggi:
- Campo `passwordHash` **rimosso**
- Tipo `id` cambia da default a `@db.Uuid` per allinearlo a `auth.users.id`
- `Organization.id` e tutte le FK verso Organization diventano `@db.Uuid` per coerenza

### Sincronizzazione `auth.users` → `public.User`

Realizzata con un **trigger Postgres** `on insert on auth.users`. Il trigger:

1. Legge `NEW.id`, `NEW.email`, `NEW.raw_user_meta_data`
2. Estrae `name`, `role`, `organization_id` dai metadati
3. Inserisce una riga in `public.User` con lo stesso id

Il trigger è creato in una migration SQL custom (Prisma `migrate dev --create-only` + edit manuale).

**Cascade su delete:** `public.User.id` ha FK verso `auth.users.id` con `ON DELETE CASCADE`, così chiamare `supabaseAdmin.auth.admin.deleteUser(id)` pulisce automaticamente entrambe le tabelle.

### View `members_with_status`

Per distinguere utenti "attivi" (invito completato) da "pending" (invito inviato, non ancora accettato), si crea una Postgres view:

```sql
CREATE VIEW public.members_with_status AS
SELECT
  u.id, u.email, u.name, u.role, u.organization_id,
  u.created_at, u.last_login_at,
  (a.email_confirmed_at IS NULL) AS is_pending
FROM public."User" u
JOIN auth.users a ON a.id = u.id;
```

Prisma la legge come una tabella via `@@map` + `@ignore` sulle righe. La pagina membri la usa invece della query su `User` diretta.

## Flussi end-to-end

### 1. Login

1. Utente su `/login`, form email + password
2. `supabase.auth.signInWithPassword({ email, password })` (lato client)
3. Supabase ritorna sessione nei cookie
4. Redirect a `/dashboard`
5. Una piccola server action (chiamata dal layout dashboard) aggiorna `lastLoginAt` e logga `AuditLog` action `login_success`

### 2. Invito membro

1. Admin su `/dashboard/settings/members` clicca "Invita membro"
2. Dialog chiede: email, nome, ruolo (**no più password temporanea**)
3. Server action `inviteMember`:
   - verifica ruolo admin (`ADMIN_KUBRI` o `ORG_ADMIN`)
   - valida input con Zod
   - controlla che email non esista in `auth.users` (via `supabaseAdmin.auth.admin.listUsers` filtrato)
   - chiama `supabaseAdmin.auth.admin.inviteUserByEmail(email, { data: { name, role, organization_id }, redirectTo: ORIGIN + "/auth/callback" })`
   - logga `AuditLog` action `invite_member`
   - `revalidatePath`
4. Il trigger DB crea la riga in `public.User` (pending, `lastLoginAt` null)
5. Resend invia email con link Supabase
6. Destinatario clicca → `/auth/callback?code=...&type=invite` → scambio → redirect a `/auth/set-password`
7. Form "nuova password + conferma" → `supabase.auth.updateUser({ password })`
8. Redirect a `/dashboard`. Logga `AuditLog` action `invite_accepted`.

### 3. Reinvio invito

Per utenti con `is_pending = true`, pulsante "Reinvia invito" nella tabella membri:

1. Server action `resendInvite(userId)`
2. Verifica permessi, recupera email
3. Chiama `supabaseAdmin.auth.admin.inviteUserByEmail(email, { data: {...stessi dati...} })` — Supabase rigenera il link, il vecchio è invalidato
4. Logga `AuditLog` action `resend_invite`

### 4. Reset password

1. Su `/login`, link "Password dimenticata?" → pagina `/login/forgot`
2. Utente inserisce email → `supabase.auth.resetPasswordForEmail(email, { redirectTo: ORIGIN + "/auth/callback" })`
3. UI mostra feedback generico "Se l'email esiste, riceverai un link" (no user enumeration)
4. Logga `AuditLog` action `password_reset_requested`
5. Email → click → `/auth/callback?code=...&type=recovery` → `/auth/reset-password`
6. Form → `supabase.auth.updateUser({ password })` → redirect `/dashboard`
7. Logga `AuditLog` action `password_changed`

### 5. Logout

1. Click su "Logout" in header
2. Server action → `supabase.auth.signOut()` → cookie cancellati
3. Redirect `/login`

### 6. Rimozione membro

1. Admin clicca "Rimuovi" su un membro
2. Server action:
   - verifica permessi, blocca auto-rimozione
   - chiama `supabaseAdmin.auth.admin.deleteUser(userId)` → cascade cancella anche `public.User`
   - logga `AuditLog` action `remove_member`

### 7. Cambio ruolo

1. Admin cambia ruolo
2. Server action aggiorna:
   - `public.User.role` via Prisma (fonte di verità)
   - `auth.users.raw_user_meta_data.role` via `supabaseAdmin.auth.admin.updateUserById()` (coerenza)
3. Logga `AuditLog` action `change_role`

La verifica dei permessi a runtime legge **sempre** da `public.User.role`.

## Sicurezza

### Isolamento chiavi

- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: esposta al browser, soggetta a RLS
- `SUPABASE_SERVICE_ROLE_KEY`: solo server-side, in `src/lib/supabase/admin.ts`, bypassa RLS. Mai importata da codice client.

### RLS

Disattivata su `public.*`. Prisma resta il data access layer, tutte le query vengono dal backend Next.js con la connection string di servizio. Il client browser non parla mai direttamente al DB.

**Nota per il futuro:** se in futuro esponessimo dati al browser via `supabase-js`, RLS diventa obbligatoria.

### Multi-tenancy (invariata)

Ogni query Prisma su `CandidateNote`, `CandidateTag`, `AuditLog`, e `User` (in contesto "membri") **deve** filtrare per `organizationId` dell'utente loggato.

### Sicurezza dei flussi auth

- **No user enumeration** su reset: feedback sempre generico
- **Token scaduti**: Supabase default 24h per invito, 1h per recovery. Pagina `/auth/callback` mostra errore con CTA "Richiedi nuovo invito/reset" se il token è invalido o scaduto.
- **Password policy**: min 8 caratteri, almeno una lettera e un numero. Configurata in Supabase (Auth → Policies) + validazione identica client-side
- **Rate limiting**: built-in di Supabase, non aggiungiamo il nostro
- **Cookie**: HttpOnly + Secure + SameSite=Lax (gestiti da `@supabase/ssr`)

### Audit log

Eventi auth loggati:
- `invite_member`, `resend_invite`, `remove_member`, `change_role` (esistenti)
- `login_success`, `invite_accepted`, `password_reset_requested`, `password_changed` (nuovi)

### Error handling

File `src/lib/supabase/errors.ts` con mapping errore → messaggio italiano. Esempi:

| Codice Supabase | Messaggio UI |
|---|---|
| `invalid_credentials` | "Email o password non validi" |
| `email_not_confirmed` | "Devi completare l'invito via email prima di accedere" |
| `over_email_send_rate_limit` | "Troppi tentativi, riprova tra qualche minuto" |
| `same_password` | "La nuova password deve essere diversa dalla precedente" |
| default | "Si è verificato un errore, riprova" |

### Route protection

Middleware protegge tutto tranne:
- `/login`, `/login/forgot`
- `/auth/callback`, `/auth/set-password`, `/auth/reset-password`
- asset statici Next.js

Utente loggato che va su `/login` → redirect `/dashboard`.

## Testing e rollout

### Checklist di validazione in dev (pre-merge)

Eseguita su `kubri-dev` con DB pulito (0 utenti, 0 organizzazioni).

1. **Bootstrap primo admin**: dal pannello Supabase (Auth → Users → Invite), invito manuale a email reale con metadata `role=ADMIN_KUBRI`. Email arriva da Resend. Click → set password → atterro su `/dashboard`.
2. **Login / logout**: logout, rientro con email+password. `lastLoginAt` aggiornato.
3. **Reset password**: "Password dimenticata?" → email → nuova password → login OK.
4. **Invito membro**: come admin, invito un secondo utente (ruolo `ORG_ADMIN`). Email arriva. Browser privato → completo invito → entro con ruolo corretto.
5. **Stato pending**: invito terzo utente, non completo. Tabella membri mostra "pending" + pulsante "Reinvia".
6. **Reinvio invito**: click → nuova email → vecchio link scaduto → nuovo funziona.
7. **Change role**: cambio ruolo, verifico aggiornato in `public.User` e `auth.users.raw_user_meta_data`.
8. **Remove member**: rimuovo membro, verifico cancellato da entrambe le tabelle (cascade).
9. **Permessi**: login come `ORG_MEMBER`, tento invito → 403.
10. **Audit log**: riga in `AuditLog` per ogni azione sopra.
11. **Route protection**: sloggato `/dashboard` → `/login`; loggato `/login` → `/dashboard`.
12. **Token scaduto**: aspetto scadenza (o manipolo `expires_at` a mano) → `/auth/callback` mostra errore con CTA chiara.

Tutti e 12 i punti devono passare prima del merge in `main`.

### Rollout in produzione (cutover)

Sequenza one-shot, ~30 minuti:

1. **Pre-deploy su Supabase prod**: attivare Auth, collegare Resend SMTP (stesso dominio verificato di dev), caricare template email in italiano, configurare password policy.
2. **Env Vercel prod**: aggiungere `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Rimuovere `NEXTAUTH_SECRET`, `NEXTAUTH_URL`.
3. **Migrazioni Prisma prod**: via GitHub Action dedicata — applica migrations (drop `passwordHash`, id → uuid, trigger, view).
4. **Cleanup dati seed prod** (SQL manuale nel Supabase SQL Editor):
   ```sql
   TRUNCATE public."AuditLog" CASCADE;
   DELETE FROM public."User";
   DELETE FROM public."Organization";
   ```
5. **Deploy Vercel**: merge `feat/supabase-auth` → `main` → deploy automatico.
6. **Bootstrap admin prod**: Supabase Dashboard prod → Auth → Invite User → email reale con metadata `role=ADMIN_KUBRI`, `organization_id=null`.
7. **Prima Organization**: login, creo la prima organizzazione da `/admin/organizations`. (Vedi "dettaglio aperto" sotto.)
8. **Smoke test**: invito un alias come `ORG_ADMIN`, verifico email da dominio prod, completo flusso.

### Rollback

Se il cutover fallisce:
1. `git revert` del merge → re-deploy automatico
2. Migration di rollback (o `prisma migrate resolve`) per ripristinare `passwordHash`
3. Dati sono fake → in caso di problemi gravi, re-clone dev → prod e ricominciamo

### Cleanup codice (nel branch `feat/supabase-auth`)

**Rimuovere:**
- `src/lib/auth.ts`, `src/lib/auth.config.ts`, `src/types/next-auth.d.ts`
- `src/lib/password.ts`
- `src/app/api/auth/[...nextauth]/` se esiste

**Disinstallare:**
- `next-auth`
- `bcrypt`, `@types/bcrypt`

**Installare:**
- `@supabase/supabase-js`
- `@supabase/ssr`

## Dettagli aperti (da risolvere in fase di plan)

1. **Admin senza organizzazione**: al bootstrap, l'utente `ADMIN_KUBRI` non ha `organizationId`. La pagina `/admin/organizations` deve funzionare in questo stato. Verificare e, se necessario, aggiungere un task al plan.
2. **`lastLoginAt`**: decidere se aggiornarlo via server action chiamata da un client component montato nel layout dashboard (tracking per-sessione) o via trigger DB. Default proposto: server action.
3. **Template email Supabase**: contenuto italiano dei 3 template (invite, recovery, confirmation). Da scrivere nel plan.
4. **Dominio Resend**: identificare il dominio da usare per l'invio (placeholder `noreply@<dominio>`). Verifica DNS in fase di plan.

## Impatto sul brainstorming deploy (sospeso)

Questa migrazione invalida alcune decisioni del brainstorming deploy:
- `NEXTAUTH_SECRET` non serve più
- Il bootstrap del primo admin in prod cambia (Supabase Dashboard invece di SQL diretto)
- La sezione "generazione secret" si semplifica

Quando riprendiamo deploy, aggiorneremo di conseguenza.
