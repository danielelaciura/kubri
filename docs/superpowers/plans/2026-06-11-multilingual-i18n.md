# Multilingual platform (IT/EN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Kubri Dashboard fully bilingual (Italian default + English), with a per-user language preference and the entire UI translated.

**Architecture:** Hand-rolled dictionary system — no new dependency. Two typed dictionaries (`it.ts`, `en.ts`) with compile-time key parity (`satisfies Dictionary`). The DB field `User.language` is the single source of truth; Server Components resolve it via a React-`cache()`-wrapped `getServerLocale()`, Client Components via an `<I18nProvider>` + `useT()` hook. A language switcher on the profile page writes the preference via a Server Action.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict), Prisma/Postgres, Vitest, React 19 Server/Client Components.

**Reference spec:** `docs/superpowers/specs/2026-06-11-multilingual-i18n-design.md`

---

## File Structure

New files:
- `src/lib/i18n/dictionaries/it.ts` — Italian dictionary (moved from `strings.ts`, enriched during extraction)
- `src/lib/i18n/dictionaries/en.ts` — English dictionary (same shape, `satisfies Dictionary`)
- `src/lib/i18n/types.ts` — `Locale`, `Dictionary` types
- `src/lib/i18n/index.ts` — `getDictionary`, `LOCALES`, `DEFAULT_LOCALE`, `isLocale`
- `src/lib/i18n/locale.ts` — `getServerLocale()` (cache()-wrapped DB read)
- `src/lib/i18n/provider.tsx` — `<I18nProvider>` + `useT()` (client)
- `src/lib/validations/language.ts` — Zod schema for `setLanguage`
- `src/lib/i18n/actions.ts` — `setLanguage` Server Action
- `src/components/settings/language-form.tsx` — switcher UI
- `src/lib/i18n/__tests__/index.test.ts`, `locale.test.ts`, `__tests__/actions.test.ts`

Modified:
- `prisma/schema.prisma` — add `User.language`
- `src/lib/i18n/strings.ts` — becomes a temporary re-export shim, deleted in the final task
- `src/components/layout/dashboard-shell.tsx` — mount `<I18nProvider>`
- `src/app/(dashboard)/dashboard/layout.tsx`, `src/app/(admin)/admin/layout.tsx` — resolve + pass `locale`
- All 31 files currently importing `strings` + the ~8 files with inline Italian (migrated per-domain in Phase 2)
- `CLAUDE.md` — new i18n convention section

---

## Phase 0 — Infrastructure

### Task 1: Split dictionaries + types + index

**Files:**
- Create: `src/lib/i18n/dictionaries/it.ts`
- Create: `src/lib/i18n/dictionaries/en.ts`
- Create: `src/lib/i18n/types.ts`
- Create: `src/lib/i18n/index.ts`
- Modify: `src/lib/i18n/strings.ts` (→ shim)
- Test: `src/lib/i18n/__tests__/index.test.ts`

- [ ] **Step 1: Create `it.ts` by moving the current dictionary**

Copy the entire object literal from `src/lib/i18n/strings.ts` into `src/lib/i18n/dictionaries/it.ts`, renaming the export:

```ts
// src/lib/i18n/dictionaries/it.ts
export const it = {
  nav: {
    candidates: "Candidati",
    lists: "Liste",
    // ... (verbatim copy of the current `strings` object body)
  },
  // ... all existing groups unchanged
} as const;
```

(Keep the `as const`. Do not change any value.)

- [ ] **Step 2: Create `types.ts`**

```ts
// src/lib/i18n/types.ts
import type { it } from "./dictionaries/it";

export type Locale = "it" | "en";

// `it` is the canonical shape every dictionary must match.
export type Dictionary = typeof it;
```

- [ ] **Step 3: Create `en.ts` as the English translation of the current keys**

Translate every existing key. Type it with `satisfies Dictionary` so missing/extra keys fail compilation:

```ts
// src/lib/i18n/dictionaries/en.ts
import type { Dictionary } from "../types";

export const en = {
  nav: {
    candidates: "Candidates",
    lists: "Lists",
    jobs: "Candidate analysis",
    users: "Users",
    settings: "Settings",
    stats: "Statistics",
    qrCodes: "QR codes",
    admin: "Administration",
    organizations: "Organizations",
    pools: "Pools",
    adminJobs: "Analysis (admin)",
  },
  common: {
    logout: "Log out",
    profile: "Profile",
    loading: "Loading...",
    error: "Error",
    notFound: "Page not found",
    goBack: "Go back",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    add: "Add",
    search: "Search",
    filter: "Filter",
    reset: "Reset",
    export: "Export",
    refresh: "Refresh",
    confirm: "Confirm",
    name: "Name",
    email: "Email",
    role: "Role",
    actions: "Actions",
    createdAt: "Created at",
  },
  pages: {
    candidates: "Candidates",
    lists: "Lists",
    candidateDetail: "Candidate detail",
    jobs: "Candidate analysis",
    jobNew: "New analysis",
    jobEdit: "Edit analysis",
    settings: "Settings",
    members: "Members",
    stats: "Statistics",
    admin: "Administration panel",
    organizations: "Organizations",
  },
  roles: {
    ADMIN_KUBRI: "Kubri administrator",
    ORG_ADMIN: "Administrator",
    ORG_MEMBER: "Operator",
  },
  settings: {
    orgName: "Organization name",
    orgSlug: "Slug",
    makeConnection: "Make.com connection",
    connectionOk: "Connected",
    connectionError: "Connection error",
    editName: "Edit name",
    readOnly: "Read only",
    notifications: "Email notifications",
    notificationsDescription:
      "Receive a summary of new candidates added to the platform.",
    notificationsEnable: "Enable email notifications",
    frequency: "Frequency",
    frequencyDaily: "Daily",
    frequencyWeekly: "Weekly",
  },
  members: {
    title: "Members",
    invite: "Invite member",
    inviteDescription: "Add a new member to your organization.",
    remove: "Remove",
    removeConfirm: "Are you sure you want to remove this member?",
    changeRole: "Change role",
    joinedAt: "Joined at",
    cannotRemoveSelf: "You cannot remove yourself",
    memberInvited: "Member invited successfully",
    memberRemoved: "Member removed successfully",
    roleChanged: "Role changed successfully",
    emailExists: "A user with this email already exists",
    status: "Status",
    active: "Active",
    pending: "Pending",
    resendInvite: "Resend invite",
  },
  organizations: {
    title: "Organizations",
    newOrg: "New organization",
    createOrg: "Create organization",
    createDescription: "Create a new organization with an initial administrator.",
    memberCount: "Members",
    slug: "Slug",
    datastoreId: "Data Store ID",
    apiToken: "API Token",
    adminEmail: "Administrator email",
    adminName: "Administrator name",
    adminPassword: "Administrator password",
    orgCreated: "Organization created successfully",
    orgUpdated: "Organization updated successfully",
    details: "Organization details",
  },
  jobs: {
    listEmpty: "No analysis",
    listEmptyHint: "Create your first analysis to start receiving candidate matches.",
    addButton: "+ Create analysis",
    fieldName: "Name",
    fieldLocation: "Location",
    fieldDescription: "Description",
    fieldSkills: "Skills",
    skillPlaceholder: "Add a skill and press Enter",
    createButton: "Create analysis",
    updateButton: "Save changes",
    deleteButton: "Delete",
    deleteConfirmTitle: "Delete the analysis?",
    deleteConfirmBody: "This action cannot be undone.",
    matchHeading: "Recommended candidates",
    matchEmpty: "No candidate passes the minimum match threshold.",
    matchFallback: "No high-match candidates. Showing the top results anyway.",
    refreshMatches: "Recalculate",
    score: "Score",
    lowMatchTag: "Low match",
    notFound: "Analysis not found",
    uniqueNameError: "An analysis with this name already exists.",
    matchSummaryHeading: "AI assessment",
    matchedSkillsHeading: "Recognized skills",
    missingSkillsHeading: "Missing skills",
    redFlagsHeading: "Points of attention",
    viewCandidateAction: "Open profile",
    preferredLocationLabel: "Preference",
  },
} satisfies Dictionary;
```

- [ ] **Step 4: Create `index.ts`**

```ts
// src/lib/i18n/index.ts
import { it } from "./dictionaries/it";
import { en } from "./dictionaries/en";
import type { Dictionary, Locale } from "./types";

export type { Dictionary, Locale };

export const LOCALES = ["it", "en"] as const;
export const DEFAULT_LOCALE: Locale = "it";

const DICTIONARIES: Record<Locale, Dictionary> = { it, en };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
```

- [ ] **Step 5: Turn `strings.ts` into a temporary shim**

Replace the whole file so existing imports keep working until they are migrated:

```ts
// src/lib/i18n/strings.ts
// TEMPORARY SHIM — re-exports the Italian dictionary so existing
// `import { strings } from "@/lib/i18n/strings"` call sites keep compiling
// while they are migrated to getDictionary()/useT(). Deleted in the final task.
import { it } from "./dictionaries/it";

export const strings = it;
```

- [ ] **Step 6: Write tests for `index.ts`**

```ts
// src/lib/i18n/__tests__/index.test.ts
import { describe, it as test, expect } from "vitest";
import { getDictionary, isLocale, DEFAULT_LOCALE, LOCALES } from "../index";
import { it } from "../dictionaries/it";
import { en } from "../dictionaries/en";

describe("i18n index", () => {
  test("getDictionary returns the matching dictionary", () => {
    expect(getDictionary("it")).toBe(it);
    expect(getDictionary("en")).toBe(en);
  });

  test("getDictionary falls back to default for unknown locale", () => {
    // @ts-expect-error testing runtime fallback
    expect(getDictionary("fr")).toBe(getDictionary(DEFAULT_LOCALE));
  });

  test("isLocale validates supported locales", () => {
    expect(isLocale("it")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  test("it and en have identical key sets (deep)", () => {
    const keysOf = (obj: object): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === "object"
          ? Object.keys(v).map((sub) => `${k}.${sub}`)
          : [k],
      );
    expect(keysOf(en).sort()).toEqual(keysOf(it).sort());
  });

  test("LOCALES contains it and en", () => {
    expect([...LOCALES]).toEqual(["it", "en"]);
  });
});
```

- [ ] **Step 7: Run tests**

Run: `pnpm test src/lib/i18n/__tests__/index.test.ts`
Expected: PASS (5 tests). If the key-parity test fails, fix the mismatched key in `en.ts`.

- [ ] **Step 8: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors (the `satisfies Dictionary` on `en` confirms parity).

- [ ] **Step 9: Commit**

```bash
git add src/lib/i18n/
git commit -m "feat(i18n): split dictionaries into it/en with typed parity"
```

---

### Task 2: Add `User.language` column

**Files:**
- Modify: `prisma/schema.prisma` (User model)
- Create: `prisma/migrations/<timestamp>_add_user_language/migration.sql` (generated)

- [ ] **Step 1: Add the field to the `User` model**

In `prisma/schema.prisma`, inside `model User`, add after `role`:

```prisma
  language        String          @default("it")
```

- [ ] **Step 2: Generate + apply the migration on dev**

Run: `pnpm prisma migrate dev --name add_user_language`
Expected: migration created and applied; Prisma client regenerated.

- [ ] **Step 3: Strip pgvector index drift from the migration**

Open the generated `migration.sql`. If it contains any `DROP INDEX ...` lines for the HNSW pgvector indexes (a known Prisma drift — see memory `prisma_pgvector_migration_drift`), delete those lines so prod does not lose semantic-search performance. The migration should contain only the `ALTER TABLE "User" ADD COLUMN "language"...` statement.

- [ ] **Step 4: Verify the field exists**

Run: `pnpm prisma migrate status`
Expected: database schema up to date, no pending migrations.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(i18n): add User.language column (default it)"
```

---

### Task 3: `getServerLocale()` resolver

**Files:**
- Create: `src/lib/i18n/locale.ts`
- Test: `src/lib/i18n/__tests__/locale.test.ts`

- [ ] **Step 1: Write the resolver**

```ts
// src/lib/i18n/locale.ts
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { DEFAULT_LOCALE, isLocale } from "./index";
import type { Locale } from "./types";

/**
 * Resolves the current user's UI locale from `User.language`.
 * Wrapped in React cache() so it runs at most once per request even when
 * called by the layout, the page and nested Server Components.
 * Falls back to DEFAULT_LOCALE when unauthenticated (login/error pages).
 */
export const getServerLocale = cache(async (): Promise<Locale> => {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) return DEFAULT_LOCALE;

    const dbUser = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { language: true },
    });
    return isLocale(dbUser?.language) ? dbUser.language : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
});
```

- [ ] **Step 2: Write tests (mock supabase + prisma)**

```ts
// src/lib/i18n/__tests__/locale.test.ts
import { describe, it as test, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const findUnique = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique } } }));

// react cache() is identity-ish in test; import after mocks
import { getServerLocale } from "../locale";

beforeEach(() => {
  getUser.mockReset();
  findUnique.mockReset();
});

describe("getServerLocale", () => {
  test("returns the user's language when valid", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    findUnique.mockResolvedValue({ language: "en" });
    expect(await getServerLocale()).toBe("en");
  });

  test("falls back to it when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getServerLocale()).toBe("it");
  });

  test("falls back to it when language invalid", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    findUnique.mockResolvedValue({ language: "xx" });
    expect(await getServerLocale()).toBe("it");
  });
});
```

Note: `react`'s `cache()` memoizes per-request; across separate `await` calls in
one test process it may return the first result. If a later test sees a stale
value, wrap each assertion in its own `describe`/dynamic import, or accept that
the first authenticated call defines the cached value. Keep the three cases as
separate test files if memoization interferes — but in practice Vitest runs each
`test` with a fresh module registry only across files, so if flakiness appears,
split into `locale.en.test.ts` / `locale.unauth.test.ts`.

- [ ] **Step 3: Run tests**

Run: `pnpm test src/lib/i18n/__tests__/locale.test.ts`
Expected: PASS. If cache memoization causes cross-test bleed, split the cases into separate test files as noted.

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n/locale.ts src/lib/i18n/__tests__/locale.test.ts
git commit -m "feat(i18n): add cache()-wrapped getServerLocale resolver"
```

---

### Task 4: Client `<I18nProvider>` + `useT()`

**Files:**
- Create: `src/lib/i18n/provider.tsx`

- [ ] **Step 1: Write the provider + hook**

```tsx
// src/lib/i18n/provider.tsx
"use client";

import { createContext, useContext } from "react";
import { getDictionary } from "./index";
import type { Dictionary, Locale } from "./types";

const I18nContext = createContext<Dictionary | null>(null);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const dictionary = getDictionary(locale);
  return <I18nContext.Provider value={dictionary}>{children}</I18nContext.Provider>;
}

export function useT(): Dictionary {
  const dictionary = useContext(I18nContext);
  if (!dictionary) {
    throw new Error("useT must be used within <I18nProvider>");
  }
  return dictionary;
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n/provider.tsx
git commit -m "feat(i18n): add I18nProvider and useT hook for client components"
```

---

### Task 5: Wire the provider into the shell + both layouts

**Files:**
- Modify: `src/components/layout/dashboard-shell.tsx`
- Modify: `src/app/(dashboard)/dashboard/layout.tsx`
- Modify: `src/app/(admin)/admin/layout.tsx`

- [ ] **Step 1: Add a `locale` prop to `DashboardShell` and wrap children with the provider**

In `src/components/layout/dashboard-shell.tsx`, add the import and prop, and wrap the inner content:

```tsx
import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/types";
```

Add `locale: Locale;` to `DashboardShellProps`, accept it in the params, and wrap the existing `<SidebarProvider>...</SidebarProvider>` return value:

```tsx
  return (
    <I18nProvider locale={locale}>
      <SidebarProvider>
        {/* ...existing shell unchanged... */}
      </SidebarProvider>
    </I18nProvider>
  );
```

- [ ] **Step 2: Resolve + pass `locale` in the dashboard layout**

In `src/app/(dashboard)/dashboard/layout.tsx` add:

```tsx
import { getServerLocale } from "@/lib/i18n/locale";
```

Before the `return`, add `const locale = await getServerLocale();` and pass `locale={locale}` to `<DashboardShell ...>`.

- [ ] **Step 3: Resolve + pass `locale` in the admin layout**

Same change in `src/app/(admin)/admin/layout.tsx`: import `getServerLocale`, add `const locale = await getServerLocale();`, pass `locale={locale}` to `<DashboardShell ...>`.

- [ ] **Step 4: Type-check + build**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/dashboard-shell.tsx "src/app/(dashboard)/dashboard/layout.tsx" "src/app/(admin)/admin/layout.tsx"
git commit -m "feat(i18n): provide active dictionary to client components via shell"
```

---

## Phase 1 — Language switcher

### Task 6: `setLanguage` Server Action + Zod

**Files:**
- Create: `src/lib/validations/language.ts`
- Create: `src/lib/i18n/actions.ts`
- Test: `src/lib/i18n/__tests__/actions.test.ts`

- [ ] **Step 1: Zod schema**

```ts
// src/lib/validations/language.ts
import { z } from "zod";

export const languageSchema = z.object({
  language: z.enum(["it", "en"]),
});
```

- [ ] **Step 2: Server Action**

```ts
// src/lib/i18n/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { languageSchema } from "@/lib/validations/language";

export async function setLanguage(formData: FormData): Promise<void> {
  const user = await getCurrentUser();

  const parsed = languageSchema.safeParse({
    language: formData.get("language"),
  });
  if (!parsed.success) {
    throw new Error("Lingua non valida");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { language: parsed.data.language },
  });

  revalidatePath("/");
}
```

- [ ] **Step 3: Test the action**

```ts
// src/lib/i18n/__tests__/actions.test.ts
import { describe, it as test, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
const update = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth-utils", () => ({ getCurrentUser }));
vi.mock("@/lib/db", () => ({ prisma: { user: { update } } }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { setLanguage } from "../actions";

function fd(language: unknown): FormData {
  const f = new FormData();
  if (language !== undefined) f.set("language", language as string);
  return f;
}

beforeEach(() => {
  getCurrentUser.mockReset();
  update.mockReset();
  revalidatePath.mockReset();
  getCurrentUser.mockResolvedValue({ id: "u1" });
});

describe("setLanguage", () => {
  test("updates the user's language and revalidates", async () => {
    await setLanguage(fd("en"));
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { language: "en" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  test("rejects an invalid language", async () => {
    await expect(setLanguage(fd("xx"))).rejects.toThrow("Lingua non valida");
    expect(update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm test src/lib/i18n/__tests__/actions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/language.ts src/lib/i18n/actions.ts src/lib/i18n/__tests__/actions.test.ts
git commit -m "feat(i18n): add setLanguage server action"
```

---

### Task 7: Language switcher on the profile page

**Files:**
- Create: `src/components/settings/language-form.tsx`
- Modify: `src/app/(dashboard)/dashboard/profile/page.tsx`
- Add keys: `src/lib/i18n/dictionaries/it.ts` + `en.ts` (new `profile` group)

- [ ] **Step 1: Add a `profile` group to both dictionaries**

In `it.ts` add a new top-level group:

```ts
  profile: {
    language: "Lingua",
    languageDescription: "Scegli la lingua dell'interfaccia.",
    italian: "Italiano",
    english: "Inglese",
    accountData: "Dati account",
    accountIntro: "I tuoi dati personali e l'organizzazione di appartenenza.",
    fieldName: "Nome",
    fieldEmail: "Email",
    fieldRole: "Ruolo",
    fieldOrganization: "Organizzazione",
    fieldCreatedAt: "Account creato il",
    fieldLastLogin: "Ultimo accesso",
  },
```

In `en.ts` add the matching group:

```ts
  profile: {
    language: "Language",
    languageDescription: "Choose the interface language.",
    italian: "Italian",
    english: "English",
    accountData: "Account data",
    accountIntro: "Your personal data and the organization you belong to.",
    fieldName: "Name",
    fieldEmail: "Email",
    fieldRole: "Role",
    fieldOrganization: "Organization",
    fieldCreatedAt: "Account created on",
    fieldLastLogin: "Last login",
  },
```

- [ ] **Step 2: Build the `LanguageForm` client component**

Mirror the `NotificationForm` pattern (controlled select + `useActionState`):

```tsx
// src/components/settings/language-form.tsx
"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/types";

interface LanguageFormProps {
  defaultLanguage: Locale;
  action: (formData: FormData) => Promise<void>;
}

export function LanguageForm({ defaultLanguage, action }: LanguageFormProps) {
  const t = useT();
  const [language, setLanguage] = useState<Locale>(defaultLanguage);

  const [_state, formAction, isPending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      await action(formData);
      return { success: true };
    },
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">{t.profile.language}</label>
        <select
          name="language"
          value={language}
          onChange={(e) => setLanguage(e.target.value as Locale)}
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="it">{t.profile.italian}</option>
          <option value="en">{t.profile.english}</option>
        </select>
      </div>
      <Button type="submit" size="sm" disabled={isPending}>
        {t.common.save}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Render it on the profile page**

In `src/app/(dashboard)/dashboard/profile/page.tsx`:
- import `getServerLocale`, `getDictionary`, `setLanguage`, `LanguageForm`;
- add `language: true` to the `prisma.user.findUnique` select;
- after the notifications `<Card>`, add a new card:

```tsx
      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>{t.profile.language}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            {t.profile.languageDescription}
          </p>
          <LanguageForm
            defaultLanguage={locale}
            action={setLanguage}
          />
        </CardContent>
      </Card>
```

where `const locale = await getServerLocale();` and `const t = getDictionary(locale);` are resolved at the top of the component. (This page's full migration off `strings` happens in Task 12; for now you may keep `strings` for the other labels and use `t` only for the new card — or migrate the whole page now.)

- [ ] **Step 4: Type-check + manual smoke**

Run: `pnpm exec tsc --noEmit && pnpm test src/lib/i18n`
Expected: no type errors, i18n tests pass.

Manual: `pnpm dev`, open `/dashboard/profile`, switch to English, save. The sidebar/header (already centralized strings) should render in English after the revalidate. Reload → still English. Switch back to Italian.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/language-form.tsx "src/app/(dashboard)/dashboard/profile/page.tsx" src/lib/i18n/dictionaries/
git commit -m "feat(i18n): language switcher on the profile page"
```

---

## Phase 2 — Full text extraction (per domain)

**General procedure for every extraction task below.** For each listed file:

1. Read the file. Find every user-visible Italian string (JSX text, `placeholder`, `title`, `aria-label`, button labels, toast/`throw new Error(...)` messages, hardcoded role/label maps).
2. For each string, add a key under the appropriate dictionary group in **both** `it.ts` (the original Italian) and `en.ts` (the English translation). Reuse existing keys (e.g. `common.save`, `common.cancel`) instead of duplicating.
3. Replace the literal in the file with the accessor:
   - **Server Component:** at the top, `const t = getDictionary(await getServerLocale());` then use `t.group.key`. Replace any `import { strings } ...` with `import { getServerLocale } from "@/lib/i18n/locale"; import { getDictionary } from "@/lib/i18n";`.
   - **Client Component:** `const t = useT();` then `t.group.key`. Replace `import { strings } ...` with `import { useT } from "@/lib/i18n/provider";`. (If the component already received text via props, prefer keeping it prop-driven and translating at the parent.)
4. **Verification per file:** `pnpm exec tsc --noEmit` passes, and `grep -nE "à|è|é|ì|ò|ù" <file>` returns nothing except inside comments. The i18n key-parity test (Task 1, Step 6) still passes because `en` must `satisfy Dictionary`.

**Worked example** (real, from `notification-form.tsx` — already centralized, shown to fix the accessor pattern):

```tsx
// before
import { strings } from "@/lib/i18n/strings";
// ...
{strings.settings.notificationsEnable}

// after
import { useT } from "@/lib/i18n/provider";
// ...inside component:
const t = useT();
// ...
{t.settings.notificationsEnable}
```

Each task ends with a commit: `git commit -m "refactor(i18n): localize <domain>"`.

---

### Task 8: Shared layout & error chrome

**Files (migrate `strings`→accessor; extract any inline):**
- `src/components/layout/app-sidebar.tsx` (client → `useT`)
- `src/components/layout/header.tsx` (client → `useT`)
- `src/app/error.tsx` (client → `useT` is unavailable here since error.tsx is outside the provider; instead read via a server boundary is not possible — `error.tsx` is a Client Component. Keep its strings by passing through a small inline `it/en` lookup is overkill. Decision: `error.tsx` and `not-found.tsx` stay on the **default locale** dictionary via `getDictionary(DEFAULT_LOCALE)` imported directly, since they render outside the authenticated provider and often outside a known user. Document this in the file with a comment.)
- `src/app/not-found.tsx` (server → `getDictionary(DEFAULT_LOCALE)`)

- [ ] **Step 1:** Migrate `app-sidebar.tsx` and `header.tsx` to `useT()` (both are Client Components under the provider).
- [ ] **Step 2:** For `error.tsx` (Client) and `not-found.tsx`, replace `strings` with `getDictionary(DEFAULT_LOCALE)` and add a comment explaining these render outside the user-scoped provider so they use the default locale.
- [ ] **Step 3:** Extract any inline Italian in these files into the `nav`/`common`/`pages` groups (both dictionaries).
- [ ] **Step 4:** Verify: `pnpm exec tsc --noEmit`; grep each file clean.
- [ ] **Step 5:** Commit `refactor(i18n): localize layout and error chrome`.

---

### Task 9: Candidates domain

**Files:**
- `src/app/(dashboard)/dashboard/candidates/page.tsx` (server)
- `src/app/(dashboard)/dashboard/candidates/[id]/page.tsx` (server, inline IT)
- `src/components/candidates/candidate-filters.tsx` (client)
- `src/components/candidates/candidate-profile.tsx` (inline IT)

- [ ] **Step 1:** Add a `candidates` group (and extend `common`) in both dictionaries for every string found in these files (filter labels, empty states, profile field labels, etc.).
- [ ] **Step 2:** Migrate each file per the general procedure (server files → `getDictionary(await getServerLocale())`; `candidate-filters` client → `useT`). For `candidate-profile.tsx`, if it is a Client Component use `useT`; if Server, use the server accessor.
- [ ] **Step 3:** Verify: `pnpm exec tsc --noEmit`; grep each file clean.
- [ ] **Step 4:** Commit `refactor(i18n): localize candidates domain`.

---

### Task 10: Jobs domain

**Files:**
- `src/app/(dashboard)/dashboard/jobs/page.tsx`, `jobs/new/page.tsx`, `jobs/[id]/page.tsx`, `jobs/[id]/edit/page.tsx` (server)
- `src/components/jobs/job-form.tsx`, `skills-input.tsx`, `match-table.tsx`, `delete-job-button.tsx` (client)

- [ ] **Step 1:** Extend the existing `jobs` group in both dictionaries for any inline strings not already keyed.
- [ ] **Step 2:** Migrate each file (server pages → server accessor; client components → `useT`).
- [ ] **Step 3:** Verify: `pnpm exec tsc --noEmit`; grep each file clean.
- [ ] **Step 4:** Commit `refactor(i18n): localize jobs domain`.

---

### Task 11: Lists domain

**Files:**
- `src/app/(dashboard)/dashboard/lists/page.tsx` (server)
- `src/components/lists/lists-manager.tsx` (client)
- `src/components/lists/add-to-list-menu.tsx` (client, inline IT)

- [ ] **Step 1:** Add a `lists` group in both dictionaries for all strings in these files.
- [ ] **Step 2:** Migrate each file (server page → server accessor; client components → `useT`).
- [ ] **Step 3:** Verify: `pnpm exec tsc --noEmit`; grep each file clean.
- [ ] **Step 4:** Commit `refactor(i18n): localize lists domain`.

---

### Task 12: Settings, members & profile domain

**Files:**
- `src/app/(dashboard)/dashboard/settings/page.tsx` (server)
- `src/app/(dashboard)/dashboard/users/page.tsx` (server)
- `src/app/(dashboard)/dashboard/profile/page.tsx` (server — finish full migration; move the `ROLE_LABEL` map to `t.roles`, localize the account-data card labels using the `profile` group)
- `src/components/settings/notification-form.tsx`, `org-name-form.tsx`, `members-actions.tsx`, `member-row-actions.tsx`, `delete-member-button.tsx` (client)
- `src/components/admin/invite-org-member-dialog.tsx` (client)

- [ ] **Step 1:** Extend `settings`/`members`/`roles`/`profile` groups in both dictionaries for any remaining strings (including inline IT in `delete-member-button.tsx`).
- [ ] **Step 2:** Migrate each file; replace the profile page's `ROLE_LABEL` map and date `toLocaleDateString("it-IT", …)` with locale-aware formatting (`user.createdAt.toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", …)`).
- [ ] **Step 3:** Verify: `pnpm exec tsc --noEmit`; grep each file clean.
- [ ] **Step 4:** Commit `refactor(i18n): localize settings, members and profile`.

---

### Task 13: Admin (organizations, pools) domain

**Files:**
- `src/app/(admin)/admin/page.tsx`, `admin/jobs/page.tsx` (server)
- `src/app/(admin)/admin/organizations/page.tsx`, `organizations/[id]/page.tsx` (server)
- `src/app/(admin)/admin/pools/new/page.tsx`, `pools/[id]/page.tsx` (server)

- [ ] **Step 1:** Extend `organizations`/`pages`/`admin` groups (add a `pools` group if needed) in both dictionaries.
- [ ] **Step 2:** Migrate each server page via the server accessor.
- [ ] **Step 3:** Verify: `pnpm exec tsc --noEmit`; grep each file clean.
- [ ] **Step 4:** Commit `refactor(i18n): localize admin organizations and pools`.

---

### Task 14: Stats + auth flows

**Files:**
- `src/app/(dashboard)/dashboard/stats/page.tsx` (server)
- `src/components/auth/accept-invite-form.tsx` (client, inline IT — NOT under the dashboard provider)
- `src/components/auth/terms-acceptance-modal.tsx` (client, inline IT — rendered in dashboard layout, IS under the provider)

- [ ] **Step 1:** Add a `stats` group and an `auth` group in both dictionaries.
- [ ] **Step 2:** Migrate `stats/page.tsx` (server accessor) and `terms-acceptance-modal.tsx` (`useT` — it is rendered inside the dashboard layout, within the provider). For `accept-invite-form.tsx`, which lives on the unauthenticated invite page outside the provider, use `getDictionary(DEFAULT_LOCALE)` directly (invitee has no saved preference yet) — add a comment explaining the default-locale choice.
- [ ] **Step 3:** Verify: `pnpm exec tsc --noEmit`; grep each file clean.
- [ ] **Step 4:** Commit `refactor(i18n): localize stats and auth flows`.

---

### Task 15: Localized outputs (PDF export + email digest)

**Files:**
- `src/components/export/candidate-pdf.tsx`
- `src/emails/candidate-digest.tsx`
- Their call sites (the route/server action that renders the PDF; the cron/notification sender that renders the email)

These render **outside** the React provider tree, so the dictionary must be passed explicitly.

- [ ] **Step 1:** Add `pdf` and `email` groups in both dictionaries for the strings in these files.
- [ ] **Step 2:** Give each component a `dictionary: Dictionary` (or `locale: Locale`) prop and replace inline Italian with `dictionary.pdf.*` / `dictionary.email.*`.
- [ ] **Step 3:** At the call sites, resolve the locale:
  - PDF: use `getDictionary(await getServerLocale())` (operator-triggered, request-scoped).
  - Email digest: the cron iterates users; pass `getDictionary(isLocale(user.language) ? user.language : DEFAULT_LOCALE)` per recipient so each operator gets their own language.
- [ ] **Step 4:** Verify: `pnpm exec tsc --noEmit`; existing `candidate-digest.test.ts` still passes (`pnpm test src/__tests__/emails/candidate-digest.test.ts`) — update its expectations if it asserts Italian copy.
- [ ] **Step 5:** Commit `refactor(i18n): localize PDF export and email digest`.

---

## Phase 3 — Convention + cleanup

### Task 16: Remove the `strings.ts` shim

**Files:**
- Delete: `src/lib/i18n/strings.ts`

- [ ] **Step 1:** Confirm no references remain.

Run: `grep -rn "i18n/strings" src`
Expected: no output. If any remain, migrate them (they were missed in Phase 2).

- [ ] **Step 2:** Delete the shim.

Run: `git rm src/lib/i18n/strings.ts`

- [ ] **Step 3:** Type-check + full test suite.

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors, all tests pass.

- [ ] **Step 4:** Commit.

```bash
git commit -m "refactor(i18n): remove temporary strings.ts shim"
```

---

### Task 17: Document the i18n convention in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** Add a new top-level section (after "Code Conventions" → "Styling and UI") titled **"Internationalization (i18n)"**:

```markdown
### Internationalization (i18n)

The dashboard is bilingual (Italian default + English). Every user-visible string
— text, label, placeholder, button, toast, thrown error message, PDF/email copy —
MUST go through the dictionary system. Never hardcode user-facing text in JSX or
server actions.

- Dictionaries live in `src/lib/i18n/dictionaries/it.ts` and `en.ts`. They must
  stay key-for-key identical; `en` is typed `satisfies Dictionary` so a missing
  translation fails the build. Add every new key to BOTH files.
- **Server Components:** `const t = getDictionary(await getServerLocale());` then
  `t.group.key`.
- **Client Components:** `const t = useT();` (must be under `<I18nProvider>`, which
  the dashboard/admin shell provides).
- **Outside the provider** (error.tsx, not-found.tsx, unauthenticated pages,
  PDF/email renderers): pass the dictionary explicitly or use
  `getDictionary(DEFAULT_LOCALE)`; for per-user outputs (email digest) resolve from
  that user's `User.language`.
- The active locale is the per-user `User.language` field (default `it`), changed
  from the profile page via the `setLanguage` server action.
```

- [ ] **Step 2:** Update the existing "Styling and UI" bullet that reads *"The UI is in Italian. UI text strings go in separate files to prepare for future i18n"* to:

```markdown
- The UI is bilingual (IT default / EN). All UI strings go through the dictionary
  system — see the Internationalization (i18n) section.
```

- [ ] **Step 3:** Commit.

```bash
git add CLAUDE.md
git commit -m "docs(i18n): document the dictionary convention for new strings"
```

---

### Task 18: Final verification

- [ ] **Step 1: No residual Italian outside dictionaries.**

Run: `grep -rlE "à|è|é|ì|ò|ù" src --include="*.tsx" | grep -v "lib/i18n/dictionaries"`
Expected: no output (any hit is a missed string — extract it). Inspect remaining `.ts` server actions for hardcoded Italian error messages too: `grep -rn "throw new Error(\"[^\"]*[àèéìòù]" src`.

- [ ] **Step 2: Full build + tests.**

Run: `pnpm build && pnpm test`
Expected: build succeeds, all tests pass.

- [ ] **Step 3: Manual end-to-end.**

`pnpm dev`: log in, switch language to English on `/dashboard/profile`, navigate candidates / jobs / lists / settings / admin → all English. Reload and re-login → persists. Switch back to Italian → all Italian.

- [ ] **Step 4: Apply migration to prod before merge** (per CLAUDE.md workflow).

Run: `set -a && source .env.prod && set +a && pnpm prisma migrate deploy`
Then: `set -a && source .env.prod && set +a && pnpm prisma migrate status`
Expected: `add_user_language` applied, no pending migrations.

- [ ] **Step 5: Commit any final fixes** and open the PR targeting `main`.

---

## Self-Review notes

- **Spec coverage:** dictionaries split (T1), `User.language` + migration (T2), `getServerLocale` cache() (T3), provider/`useT` (T4–5), switcher on profile only (T6–7), full extraction across all listed files (T8–15), CLAUDE.md convention (T17), type-parity + manual + grep verification (T1 test, T18). PDF/email (out-of-chrome outputs) covered by T15.
- **Cookie removed:** plan reflects the approved DB-cached resolution (no cookie), consistent with the updated spec.
- **error.tsx / unauthenticated pages:** explicitly resolved to `getDictionary(DEFAULT_LOCALE)` since they render outside the user-scoped provider.
