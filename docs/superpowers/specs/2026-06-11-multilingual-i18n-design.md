# Multilingual platform (IT/EN) — Design

**Date:** 2026-06-11
**Status:** Approved (design)
**Scope:** Make the Kubri Dashboard fully bilingual (Italian + English). Italian
stays the default. No other languages are planned.

## Goal

The dashboard today renders Italian only. UI text is partly centralized in a
single `src/lib/i18n/strings.ts` object (consumed by 31 files) and partly
hardcoded inline in the JSX of ~39 `.tsx` files. We want a per-user language
preference (IT/EN), an English translation of the **entire** UI (full
extraction — no Italian "islands" left), and a documented project convention so
every future text goes through the i18n system.

## Decisions (locked during brainstorming)

1. **Language source:** per-user preference persisted in the DB (`User.language`).
2. **Technical approach:** hand-rolled, extend the existing key/object system —
   **no** new dependency (no `next-intl`). TypeScript type-parity between the
   dictionaries is the safety net for missing translations.
3. **Coverage:** full extraction — all hardcoded UI text moves into the
   dictionary system and is translated to EN. Toast/error messages and Zod error
   text are in scope (they are user-visible).
4. **Locale plumbing:** cookie `kubri_locale` mirrors `User.language`. The cookie
   is the synchronous read source for both Server and Client Components; the DB
   field is the persistent source of truth.
5. **Switcher location:** the language selector lives **only** on the user
   Profile page (`/dashboard/profile`). Not in the header menu.

## Architecture

### Dictionaries

Replace the single `strings.ts` with:

```
src/lib/i18n/
├── dictionaries/
│   ├── it.ts        ← current object, renamed + enriched with extracted keys
│   └── en.ts        ← same structure, English values
├── types.ts         ← Dictionary, Locale types
├── locale.ts        ← getServerLocale(), cookie helpers
├── index.ts         ← getDictionary(locale), LOCALES, DEFAULT_LOCALE, isLocale()
└── provider.tsx     ← <I18nProvider> + useT() (client)
```

- `it.ts` exports the dictionary object (the current `strings`, enriched).
- `types.ts`: `export type Locale = 'it' | 'en'`; `export type Dictionary = typeof import('./dictionaries/it').it`.
- `en.ts`: typed with `satisfies Dictionary` so the compiler flags any missing
  or extra key. `it` is the canonical shape; `en` must match it exactly.
- `index.ts`:
  - `LOCALES: readonly Locale[] = ['it', 'en']`
  - `DEFAULT_LOCALE: Locale = 'it'`
  - `getDictionary(locale: Locale): Dictionary`
  - `isLocale(value: unknown): value is Locale`

The dictionary keys keep the existing domain grouping (`nav`, `common`, `pages`,
`roles`, `settings`, `members`, `organizations`, `jobs`, …) and gain new groups
as needed during extraction (`lists`, `stats`, `pools`, `candidates`, `errors`,
`profile`, …).

### Locale resolution

`src/lib/i18n/locale.ts`:

- `getServerLocale(): Locale` — reads the `kubri_locale` cookie via `cookies()`;
  validates with `isLocale()`; falls back to `DEFAULT_LOCALE`. Used by every
  Server Component.
- Cookie spec: name `kubri_locale`, `SameSite=Lax`, `path=/`, max-age ~1 year,
  **not** httpOnly (must be readable client-side). No sensitive data — it only
  holds `it`/`en`.

The DB field is the persistent truth; the cookie is the fast read path. They are
synchronized in exactly two places:

1. **On login** — after auth resolves the user, write `kubri_locale` ←
   `User.language`. (Hook into the existing post-login / session-bootstrap path;
   if the cookie is already correct, this is a no-op.)
2. **On change** — the `setLanguage` Server Action writes both DB and cookie.

### Accessing strings

- **Server Components** (the majority — dashboard pages, admin routes,
  `error.tsx`, `not-found.tsx`):
  ```ts
  const t = getDictionary(getServerLocale());
  // t.nav.candidates  (replaces strings.nav.candidates)
  ```
- **Client Components** (13 today): an `<I18nProvider locale dictionary>` is
  mounted in the dashboard layout **and** the admin layout. It provides the
  active dictionary via React context; `useT(): Dictionary` returns it.
  Client files switch from `import { strings }` to `const t = useT()`.
- Root-level `error.tsx` / `not-found.tsx` are Server Components by default and
  read the cookie directly, so they work even outside any provider.

The full active dictionary is passed to the client provider. It is small (a few
KB), so shipping it is fine.

### Language switcher (UI)

- A `LanguageForm` client component on `/dashboard/profile`, rendered next to the
  existing notification preferences card. Two options (Italiano / English),
  current value preselected.
- Server Action `setLanguage(locale: Locale)`:
  1. Validate `locale` with Zod (`isLocale`).
  2. Resolve the logged-in user; update `User.language` (scoped to that user).
  3. Set the `kubri_locale` cookie.
  4. `revalidatePath('/')` (or a broad revalidation) so all Server Components
     re-render with the new dictionary.
  5. Optional: write an `AuditLog` entry, consistent with other user actions.

### Database

New field on `User`:

```prisma
language String @default("it")  // 'it' | 'en'
```

Migration follows the CLAUDE.md dev→prod workflow (`prisma migrate dev` in dev;
`prisma migrate deploy` against prod **before** merge). Existing rows default to
`it`. Watch for the known pgvector HNSW `DROP INDEX` drift in the generated
migration — strip those lines (see memory `prisma_pgvector_migration_drift`).

## Text extraction (the bulk of the work)

Systematic, file-by-file across the ~39 `.tsx` files with inline Italian plus the
31 already using `strings`:

- Every Italian string in JSX → a new dictionary key, grouped by domain.
- Translate each new key in `en.ts`.
- Server Action toasts / thrown error messages and Zod error maps are in scope.
- Role labels currently hardcoded in some pages (e.g. the `ROLE_LABEL` map in
  the profile page) move into the `roles` dictionary group.

To keep review tractable, the implementation plan sequences this in phases:

1. **Infrastructure** — dictionaries split, types, `locale.ts`, `index.ts`,
   `provider.tsx`, `User.language` migration, cookie sync on login. Migrate all
   existing `strings.*` call sites to the new accessors (no behavior change yet,
   IT still renders).
2. **Switcher** — `setLanguage` action + `LanguageForm` on the profile page.
   End-to-end IT↔EN switching becomes testable even before full extraction (the
   already-centralized strings flip language).
3. **Extraction by domain** — one reviewable block per area (candidates, jobs,
   lists, settings/members, organizations/pools, admin, stats, shared/layout,
   errors). Each block: extract inline IT → keys, add EN translations.

## Project convention (CLAUDE.md)

Add a new **Internationalization (i18n)** section to `CLAUDE.md` stating, as a
project rule:

> Every user-visible string (text, label, placeholder, toast, error message)
> MUST go through the dictionary system (`src/lib/i18n/dictionaries/it.ts` +
> `en.ts`) — never hardcoded in JSX or server actions. Server Components read
> strings via `getDictionary(getServerLocale())`; Client Components via
> `useT()`. Both dictionaries must stay key-for-key identical (enforced by the
> `satisfies Dictionary` type check). Italian is the default locale.

Also update the existing "Styling and UI" bullet that vaguely references putting
UI strings "in separate files" to point at this concrete system.

## Testing / verification

- **Type-check** (`tsc` / `pnpm build`): `satisfies Dictionary` guarantees `en`
  and `it` have identical key sets — a missing translation fails the build.
- **Manual:** on the profile page switch IT→EN → the whole UI changes; reload →
  persists (cookie); log out and back in → persists (DB→cookie sync). Switch
  back to IT.
- **Final grep:** no residual accented/Italian text in `.tsx` outside the
  dictionaries.

## Out of scope

- Locale-prefixed routing (`/it`, `/en`). URLs stay locale-agnostic.
- Pluralization / ICU message formatting (not needed for IT/EN dashboard copy).
- Localizing candidate *data* (profiles come from the chatbot) — only the
  dashboard chrome is translated.
- Date/number locale formatting beyond what already exists (can be a follow-up).
- Any third language.
