# Supabase Auth Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace NextAuth v5 (bcrypt + JWT) with Supabase Auth + Resend SMTP, introducing a proper email-invite flow and reset-password flow, across the Kubri dashboard.

**Architecture:** Supabase Auth owns credentials and sessions via cookie-based `@supabase/ssr`. Prisma's `public.User` remains the domain object (role, organizationId, name) but drops `passwordHash`; its `id` becomes `@db.Uuid` equal to `auth.users.id`. A Postgres trigger keeps `public.User` in sync when `auth.users` rows are inserted. Resend sends all transactional email (invite / recovery) via Supabase SMTP config. RLS stays off — Prisma remains the sole data-access layer.

**Tech Stack:** Next.js 16 (App Router, React 19), TypeScript strict, Prisma 7 + `@prisma/adapter-pg`, `@supabase/supabase-js`, `@supabase/ssr`, Resend (SMTP), Vitest, Zod v4, Tailwind, shadcn/ui.

**Reference spec:** `docs/superpowers/specs/2026-04-22-supabase-auth-migration-design.md`

---

## File Structure

### New files

- `src/lib/supabase/server.ts` — server-side SSR client (anon key) for RSC and server actions
- `src/lib/supabase/client.ts` — browser client (anon key) for interactive auth pages
- `src/lib/supabase/admin.ts` — service-role client, server-only
- `src/lib/supabase/middleware.ts` — cookie refresh helper used by `src/middleware.ts`
- `src/lib/supabase/errors.ts` — maps Supabase error codes to Italian UI strings (+ Vitest tests)
- `src/lib/auth-actions.ts` — server actions for login, logout, forgot-password, lastLoginAt
- `src/app/(auth)/login/forgot/page.tsx` + form client component
- `src/app/auth/callback/route.ts` — GET route that exchanges `code` param for a session
- `src/app/auth/set-password/page.tsx` + form client component
- `src/app/auth/reset-password/page.tsx` + form client component
- `prisma/migrations/<ts>_supabase_auth_schema/migration.sql` — UUID typing + drop passwordHash + organizationId nullable
- `prisma/migrations/<ts>_supabase_auth_trigger/migration.sql` — trigger `on insert auth.users` + FK cascade + `members_with_status` view

### Modified files

- `prisma/schema.prisma` — User.id `@db.Uuid`, drop `passwordHash`, `organizationId` nullable; same UUID typing on Organization
- `src/lib/auth-utils.ts` — same public API, reads session from Supabase
- `src/middleware.ts` — uses `@supabase/ssr` instead of NextAuth
- `src/components/auth/login-form.tsx` — uses browser Supabase client
- `src/components/settings/members-actions.tsx` — remove temporaryPassword field
- `src/components/settings/member-row-actions.tsx` — new client component (extracted), adds Resend-invite button
- `src/app/(dashboard)/dashboard/settings/members/page.tsx` — server actions rewritten, read from `members_with_status`
- `src/components/admin/create-org-dialog.tsx` — remove adminPassword field
- `src/app/(admin)/admin/organizations/page.tsx` — uses invite flow when creating org admin
- `src/lib/validations/organization.ts` — drop `temporaryPassword`, drop `adminPassword`
- `src/lib/i18n/strings.ts` — add new keys (forgot password, set password, resend invite, pending status, error messages)
- `src/components/layout/header.tsx` (or wherever the logout button lives) — logout calls new server action
- `package.json` — add `@supabase/supabase-js`, `@supabase/ssr`; remove `next-auth`, `bcryptjs`
- `.env.example` — new Supabase vars

### Deleted files

- `src/lib/auth.ts`
- `src/lib/auth.config.ts`
- `src/lib/password.ts`
- `src/types/next-auth.d.ts`
- `src/app/api/auth/[...nextauth]/` (the whole directory)
- `src/__tests__/lib/password.test.ts`

---

## Phase 0 — Supabase + Resend manual setup (user action)

### Task 1: Configure Supabase Auth + Resend SMTP (dev only for now)

**This task is executed manually by the user via the Supabase and Resend dashboards. No code is changed.**

- [ ] **Step 1: Create Resend account and verify sending domain**

1. Go to <https://resend.com>, create account (free tier)
2. Domains → Add Domain → enter your domain (e.g. `kubri.it` or subdomain `mail.kubri.it`)
3. Copy the 3 DNS records Resend shows (SPF TXT, DKIM CNAME x2, optional DMARC TXT)
4. Add them to your DNS provider
5. Wait for verification (usually <10 min)
6. Create API Key → `API Keys` → `Create API Key` → name `supabase-kubri-dev` → copy value (shown once)

- [ ] **Step 2: Configure Supabase Auth SMTP on kubri-dev**

1. Open Supabase dashboard → project `kubri-dev` → Authentication → Settings → SMTP Settings
2. Enable "Enable Custom SMTP"
3. Host: `smtp.resend.com`, Port: `465`, Username: `resend`, Password: (paste Resend API key), Sender email: `noreply@<your-domain>`, Sender name: `Kubri`
4. Save

- [ ] **Step 3: Configure URL Configuration**

1. Authentication → URL Configuration
2. Site URL: `http://localhost:3000`
3. Redirect URLs (add): `http://localhost:3000/auth/callback`, `http://localhost:3000/auth/set-password`, `http://localhost:3000/auth/reset-password`
4. Save

- [ ] **Step 4: Set password policy**

1. Authentication → Policies (or Auth → Providers → Email)
2. Minimum password length: 8
3. Require: Lowercase letters, Digits
4. Save

- [ ] **Step 5: Collect dev Supabase keys for next task**

1. Project Settings → API
2. Copy: `Project URL`, `anon public` key, `service_role` key (secret)
3. Paste temporarily in a scratch file — used in Task 2

### Task 2: Update local `.env` with Supabase vars

**Files:**
- Modify: `.env` (local only, not committed)
- Modify: `.env.example`

- [ ] **Step 1: Edit `.env` — remove NextAuth, add Supabase**

Open `.env`. Remove:
```
NEXTAUTH_SECRET=...
NEXTAUTH_URL=...
```
Add (values from Task 1 Step 5):
```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

- [ ] **Step 2: Edit `.env.example` — document the new vars**

Replace NextAuth block with:
```
# Supabase Auth
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

- [ ] **Step 3: Commit `.env.example` only**

```bash
git add .env.example
git commit -m "chore: swap NextAuth env for Supabase in .env.example"
```

---

## Phase 1 — Dependencies and Prisma schema

### Task 3: Swap dependencies

**Files:**
- Modify: `package.json` (via pnpm)

- [ ] **Step 1: Install Supabase packages**

```bash
pnpm add @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Remove NextAuth and bcrypt**

```bash
pnpm remove next-auth bcryptjs
```

- [ ] **Step 3: Verify `pnpm-lock.yaml` and `package.json` are coherent**

```bash
pnpm install
```

Expected: installs complete, no peer-dep warnings beyond those already present for React 19.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add supabase-js + ssr, remove next-auth + bcryptjs"
```

### Task 4: Update Prisma schema (UUID typing + drop passwordHash)

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Replace the `Organization`, `User`, `CandidateNote`, `CandidateTag`, `AuditLog` models with:

```prisma
model Organization {
  id              String   @id @default(uuid()) @db.Uuid
  name            String
  slug            String   @unique
  makeDatastoreId String
  makeApiToken    String
  createdAt       DateTime @default(now())
  settings        Json?

  users          User[]
  candidateNotes CandidateNote[]
  candidateTags  CandidateTag[]
  auditLogs      AuditLog[]
}

model User {
  id             String    @id @db.Uuid
  email          String    @unique
  name           String
  role           Role      @default(ORG_MEMBER)
  organizationId String?   @db.Uuid
  createdAt      DateTime  @default(now())
  lastLoginAt    DateTime?

  organization   Organization?   @relation(fields: [organizationId], references: [id])
  candidateNotes CandidateNote[]
  auditLogs      AuditLog[]
}

model CandidateNote {
  id             String   @id @default(uuid()) @db.Uuid
  makeRecordId   String
  organizationId String   @db.Uuid
  userId         String   @db.Uuid
  content        String
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id])
  user         User         @relation(fields: [userId], references: [id])

  @@index([makeRecordId, organizationId])
}

model CandidateTag {
  id             String   @id @default(uuid()) @db.Uuid
  makeRecordId   String
  organizationId String   @db.Uuid
  tag            String
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id])

  @@index([makeRecordId, organizationId])
}

model AuditLog {
  id             String   @id @default(uuid()) @db.Uuid
  userId         String   @db.Uuid
  organizationId String   @db.Uuid
  action         String
  resourceType   String
  resourceId     String
  metadata       Json?
  createdAt      DateTime @default(now())

  user         User         @relation(fields: [userId], references: [id])
  organization Organization @relation(fields: [organizationId], references: [id])

  @@index([organizationId, createdAt])
}

model MemberWithStatus {
  id             String    @id @db.Uuid
  email          String
  name           String
  role           Role
  organizationId String?   @db.Uuid
  createdAt      DateTime
  lastLoginAt    DateTime?
  isPending      Boolean

  @@map("members_with_status")
  @@ignore
}
```

Key changes:
- All UUID PK/FK columns gain `@db.Uuid`
- `User.id` drops `@default(uuid())` (provided by Supabase on insert)
- `User.organizationId` becomes optional (bootstrap admin has none initially)
- `User.role` gets a default (`ORG_MEMBER`) — needed so trigger insert works without providing role
- `User.passwordHash` removed
- New `MemberWithStatus` model maps to the view we'll create in Task 6 (`@@ignore` prevents Prisma from trying to manage it)

- [ ] **Step 2: Wipe dev DB and regenerate**

Since we have only fake seed data in dev and we're changing PK types, easiest path is a full reset:

```bash
pnpm dlx prisma migrate reset --force --skip-seed
```

Expected: drops all data, applies existing migration. (We'll delete the old seed in Task 31, for now `--skip-seed`.)

- [ ] **Step 3: Create the schema-change migration**

```bash
pnpm dlx prisma migrate dev --name supabase_auth_schema
```

Expected: new migration folder `prisma/migrations/<ts>_supabase_auth_schema/migration.sql`, Prisma client regenerates.

- [ ] **Step 4: Verify migration contents**

```bash
ls prisma/migrations/ | tail -3
```

Open the new `migration.sql` — should include: `DROP COLUMN "passwordHash"`, `ALTER COLUMN "id" TYPE uuid` (or similar), `ALTER COLUMN "organizationId" DROP NOT NULL`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): drop passwordHash, uuid-typed ids, optional org on user"
```

### Task 5: Create trigger + view + FK cascade (custom SQL migration)

**Files:**
- Create: `prisma/migrations/<ts>_supabase_auth_trigger/migration.sql`

- [ ] **Step 1: Scaffold an empty migration**

```bash
pnpm dlx prisma migrate dev --create-only --name supabase_auth_trigger
```

Expected: empty `migration.sql` file created under `prisma/migrations/<ts>_supabase_auth_trigger/`.

- [ ] **Step 2: Fill the migration SQL**

Replace `migration.sql` contents with:

```sql
-- 1) Add FK from public.User.id → auth.users.id with cascade delete.
--    We don't add a FK constraint directly (auth schema is managed by Supabase),
--    but we do attach a trigger on auth.users to cascade deletes.

-- 2) Insert trigger: when a new auth.users row appears, upsert public.User.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta_name text;
  meta_role text;
  meta_org_id uuid;
BEGIN
  meta_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));
  meta_role := COALESCE(NEW.raw_user_meta_data->>'role', 'ORG_MEMBER');
  meta_org_id := NULLIF(NEW.raw_user_meta_data->>'organization_id', '')::uuid;

  INSERT INTO public."User" (id, email, name, role, "organizationId", "createdAt")
  VALUES (NEW.id, NEW.email, meta_name, meta_role::"Role", meta_org_id, now())
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 3) Delete trigger: when auth.users row is deleted, delete public.User row too.
CREATE OR REPLACE FUNCTION public.handle_delete_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public."User" WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_delete_auth_user();

-- 4) Update trigger: sync email changes from auth.users to public.User.
CREATE OR REPLACE FUNCTION public.handle_update_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public."User" SET email = NEW.email WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_update_auth_user();

-- 5) View exposing pending status (email_confirmed_at IS NULL ⇒ invite not completed).
DROP VIEW IF EXISTS public.members_with_status;
CREATE VIEW public.members_with_status AS
SELECT
  u.id,
  u.email,
  u.name,
  u.role,
  u."organizationId",
  u."createdAt",
  u."lastLoginAt",
  (a.email_confirmed_at IS NULL) AS "isPending"
FROM public."User" u
JOIN auth.users a ON a.id = u.id;

-- Allow the Prisma role to read the view (schemas auth is restricted; SECURITY DEFINER on fn is enough for triggers).
GRANT SELECT ON public.members_with_status TO postgres, service_role;
```

- [ ] **Step 3: Apply the migration**

```bash
pnpm dlx prisma migrate dev
```

Expected: "Applied migration `<ts>_supabase_auth_trigger`". No errors.

- [ ] **Step 4: Smoke-test the trigger in Supabase SQL Editor**

In the Supabase dashboard (kubri-dev) → SQL Editor → run:

```sql
-- simulate an invite
INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
VALUES (gen_random_uuid(), 'trigger-test@example.com',
        '{"name":"Trig Ger","role":"ORG_MEMBER"}'::jsonb,
        'authenticated', 'authenticated');

SELECT id, email, name, role FROM public."User" WHERE email = 'trigger-test@example.com';
-- expected: one row matching

DELETE FROM auth.users WHERE email = 'trigger-test@example.com';
SELECT COUNT(*) FROM public."User" WHERE email = 'trigger-test@example.com';
-- expected: 0
```

If both expectations hold, trigger works. If not, fix the SQL and run `pnpm dlx prisma migrate reset --force --skip-seed` again.

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations
git commit -m "feat(db): trigger to sync auth.users -> public.User + members_with_status view"
```

---

## Phase 2 — Supabase client modules

### Task 6: Server-side SSR client

**Files:**
- Create: `src/lib/supabase/server.ts`

- [ ] **Step 1: Write `src/lib/supabase/server.ts`**

```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll is called from Server Components where cookies cannot be mutated.
            // The middleware refreshes session cookies; safe to ignore here.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/supabase/server.ts
git commit -m "feat(supabase): add server-side SSR client"
```

### Task 7: Browser client

**Files:**
- Create: `src/lib/supabase/client.ts`

- [ ] **Step 1: Write `src/lib/supabase/client.ts`**

```typescript
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/supabase/client.ts
git commit -m "feat(supabase): add browser client factory"
```

### Task 8: Admin (service-role) client

**Files:**
- Create: `src/lib/supabase/admin.ts`

- [ ] **Step 1: Write `src/lib/supabase/admin.ts`**

```typescript
import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Server-only client with the Supabase service role key.
 * Use ONLY for admin operations: inviteUserByEmail, deleteUser, updateUserById, listUsers.
 * Never import this file from a "use client" component.
 */
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/supabase/admin.ts
git commit -m "feat(supabase): add service-role admin client (server-only)"
```

### Task 9: Middleware cookie-refresh helper

**Files:**
- Create: `src/lib/supabase/middleware.ts`

- [ ] **Step 1: Write `src/lib/supabase/middleware.ts`**

```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: calling getUser() refreshes the session if needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/supabase/middleware.ts
git commit -m "feat(supabase): add middleware session-refresh helper"
```

### Task 10: Error-mapping module with tests

**Files:**
- Create: `src/lib/supabase/errors.ts`
- Create: `src/__tests__/lib/supabase/errors.test.ts`

- [ ] **Step 1: Write the failing test first**

Create `src/__tests__/lib/supabase/errors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mapSupabaseError } from "@/lib/supabase/errors";

describe("mapSupabaseError", () => {
  it("maps invalid_credentials to Italian message", () => {
    expect(mapSupabaseError({ code: "invalid_credentials" })).toBe(
      "Email o password non validi",
    );
  });

  it("maps email_not_confirmed", () => {
    expect(mapSupabaseError({ code: "email_not_confirmed" })).toBe(
      "Devi completare l'invito via email prima di accedere",
    );
  });

  it("maps over_email_send_rate_limit", () => {
    expect(mapSupabaseError({ code: "over_email_send_rate_limit" })).toBe(
      "Troppi tentativi, riprova tra qualche minuto",
    );
  });

  it("maps same_password", () => {
    expect(mapSupabaseError({ code: "same_password" })).toBe(
      "La nuova password deve essere diversa dalla precedente",
    );
  });

  it("maps weak_password", () => {
    expect(mapSupabaseError({ code: "weak_password" })).toBe(
      "La password non rispetta i requisiti minimi (8 caratteri, lettere e numeri)",
    );
  });

  it("falls back to generic message for unknown code", () => {
    expect(mapSupabaseError({ code: "some_unknown_code" })).toBe(
      "Si è verificato un errore, riprova",
    );
  });

  it("falls back to generic message for null", () => {
    expect(mapSupabaseError(null)).toBe("Si è verificato un errore, riprova");
  });

  it("accepts plain Error objects (no code) and returns generic", () => {
    expect(mapSupabaseError(new Error("boom"))).toBe(
      "Si è verificato un errore, riprova",
    );
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm test src/__tests__/lib/supabase/errors.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/supabase/errors.ts`**

```typescript
const MESSAGES: Record<string, string> = {
  invalid_credentials: "Email o password non validi",
  email_not_confirmed: "Devi completare l'invito via email prima di accedere",
  over_email_send_rate_limit: "Troppi tentativi, riprova tra qualche minuto",
  same_password: "La nuova password deve essere diversa dalla precedente",
  weak_password:
    "La password non rispetta i requisiti minimi (8 caratteri, lettere e numeri)",
  user_already_exists: "Un utente con questa email esiste già",
  email_exists: "Un utente con questa email esiste già",
  otp_expired: "Il link è scaduto, richiedine uno nuovo",
  otp_disabled: "Il link non è più valido, richiedine uno nuovo",
};

const GENERIC = "Si è verificato un errore, riprova";

export function mapSupabaseError(err: unknown): string {
  if (!err || typeof err !== "object") return GENERIC;
  const code = (err as { code?: string }).code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  return GENERIC;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test src/__tests__/lib/supabase/errors.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/errors.ts src/__tests__/lib/supabase/errors.test.ts
git commit -m "feat(supabase): error code → italian message mapper + tests"
```

---

## Phase 3 — auth-utils + middleware rewrite

### Task 11: Rewrite `src/lib/auth-utils.ts`

**Files:**
- Modify: `src/lib/auth-utils.ts`
- Create: `src/__tests__/lib/auth-utils.test.ts`

- [ ] **Step 1: Write tests for `requireRole` logic**

Create `src/__tests__/lib/auth-utils.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { hasMinimumRole } from "@/lib/auth-utils";

describe("hasMinimumRole", () => {
  it("ADMIN_KUBRI passes ORG_ADMIN requirement", () => {
    expect(hasMinimumRole("ADMIN_KUBRI", "ORG_ADMIN")).toBe(true);
  });

  it("ORG_ADMIN passes ORG_MEMBER requirement", () => {
    expect(hasMinimumRole("ORG_ADMIN", "ORG_MEMBER")).toBe(true);
  });

  it("ORG_MEMBER fails ORG_ADMIN requirement", () => {
    expect(hasMinimumRole("ORG_MEMBER", "ORG_ADMIN")).toBe(false);
  });

  it("ORG_MEMBER passes ORG_MEMBER requirement", () => {
    expect(hasMinimumRole("ORG_MEMBER", "ORG_MEMBER")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect failure (export missing)**

```bash
pnpm test src/__tests__/lib/auth-utils.test.ts
```

Expected: FAIL — `hasMinimumRole` not exported.

- [ ] **Step 3: Rewrite `src/lib/auth-utils.ts`**

Replace the full contents with:

```typescript
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import type { Role } from "@/generated/prisma/client";

const ROLE_HIERARCHY: Record<Role, number> = {
  ADMIN_KUBRI: 3,
  ORG_ADMIN: 2,
  ORG_MEMBER: 1,
};

export function hasMinimumRole(userRole: Role, minimumRole: Role): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= ROLE_HIERARCHY[minimumRole];
}

export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    throw new Error("Non autenticato");
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      organizationId: true,
    },
  });

  if (!dbUser) {
    throw new Error("Utente non trovato");
  }

  return dbUser;
}

export async function requireRole(minimumRole: Role) {
  const user = await getCurrentUser();

  if (!hasMinimumRole(user.role, minimumRole)) {
    throw new Error("Permessi insufficienti");
  }

  return user;
}

export async function requireOrganization() {
  const user = await getCurrentUser();

  if (!user.organizationId) {
    throw new Error("Nessuna organizzazione associata");
  }

  return user as typeof user & { organizationId: string };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test src/__tests__/lib/auth-utils.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-utils.ts src/__tests__/lib/auth-utils.test.ts
git commit -m "refactor(auth-utils): read session from Supabase, same public API"
```

### Task 12: Rewrite `src/middleware.ts`

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Replace `src/middleware.ts` with:**

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_PREFIXES = [
  "/login",
  "/auth/callback",
  "/auth/set-password",
  "/auth/reset-password",
];

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (isPublic) {
    if (pathname.startsWith("/login") && user) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return response;
  }

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware.ts
git commit -m "refactor(middleware): replace NextAuth with @supabase/ssr session refresh"
```

---

## Phase 4 — Login + password flows

### Task 13: Rewrite login client component

**Files:**
- Modify: `src/components/auth/login-form.tsx`

- [ ] **Step 1: Replace full file with:**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { mapSupabaseError } from "@/lib/supabase/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Inserisci email e password");
      return;
    }

    setIsLoading(true);

    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(mapSupabaseError(authError));
      setIsLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">Kubri Dashboard</CardTitle>
        <CardDescription>Accedi al tuo account</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium leading-none">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="nome@esempio.it"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium leading-none">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Accesso in corso..." : "Accedi"}
          </Button>
          <p className="text-center text-sm">
            <Link href="/login/forgot" className="text-muted-foreground underline">
              Password dimenticata?
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/auth/login-form.tsx
git commit -m "refactor(login): use Supabase browser client + forgot password link"
```

### Task 14: Forgot-password page

**Files:**
- Create: `src/app/(auth)/login/forgot/page.tsx`
- Create: `src/components/auth/forgot-password-form.tsx`

- [ ] **Step 1: Write the page wrapper**

`src/app/(auth)/login/forgot/page.tsx`:

```tsx
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <ForgotPasswordForm />
    </div>
  );
}
```

- [ ] **Step 2: Write the client form**

`src/components/auth/forgot-password-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    const supabase = createSupabaseBrowserClient();
    // Note: we deliberately ignore the error — feedback is always generic to avoid user enumeration.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    });

    setSubmitted(true);
    setIsLoading(false);
  }

  if (submitted) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Controlla la tua email</CardTitle>
          <CardDescription>
            Se un account esiste per {email}, riceverai un link per reimpostare la password.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Link href="/login" className="text-sm underline">
            Torna al login
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Password dimenticata</CardTitle>
        <CardDescription>
          Ti invieremo un link per reimpostare la password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="email"
            placeholder="nome@esempio.it"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            autoComplete="email"
            required
          />
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Invio in corso..." : "Invia link"}
          </Button>
          <p className="text-center text-sm">
            <Link href="/login" className="text-muted-foreground underline">
              Torna al login
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(auth\)/login/forgot src/components/auth/forgot-password-form.tsx
git commit -m "feat(auth): add forgot-password page"
```

### Task 15: `/auth/callback` route — exchange code for session

**Files:**
- Create: `src/app/auth/callback/route.ts`

- [ ] **Step 1: Write the route handler**

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/auth/set-password";

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=missing_code", request.url),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.code ?? "invalid_code")}`, request.url),
    );
  }

  return NextResponse.redirect(new URL(next, request.url));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/auth/callback/route.ts
git commit -m "feat(auth): add /auth/callback to exchange code for session"
```

### Task 16: `/auth/set-password` page (first login after invite)

**Files:**
- Create: `src/app/auth/set-password/page.tsx`
- Create: `src/components/auth/set-password-form.tsx`

- [ ] **Step 1: Write the page**

`src/app/auth/set-password/page.tsx`:

```tsx
import { SetPasswordForm } from "@/components/auth/set-password-form";

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <SetPasswordForm />
    </div>
  );
}
```

- [ ] **Step 2: Write the client form**

`src/components/auth/set-password-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { mapSupabaseError } from "@/lib/supabase/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const PW_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export function SetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!PW_RE.test(password)) {
      setError("Minimo 8 caratteri, almeno una lettera e un numero");
      return;
    }
    if (password !== confirm) {
      setError("Le password non coincidono");
      return;
    }

    setIsLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.updateUser({ password });

    if (authError) {
      setError(mapSupabaseError(authError));
      setIsLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Imposta la tua password</CardTitle>
        <CardDescription>Scegli una password per accedere a Kubri.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="password"
            placeholder="Password (min. 8, lettere e numeri)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <Input
            type="password"
            placeholder="Conferma password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={isLoading}
            autoComplete="new-password"
            required
            minLength={8}
          />
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Salvataggio..." : "Imposta password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/auth/set-password src/components/auth/set-password-form.tsx
git commit -m "feat(auth): add /auth/set-password page (post-invite flow)"
```

### Task 17: `/auth/reset-password` page

**Files:**
- Create: `src/app/auth/reset-password/page.tsx`
- Create: `src/components/auth/reset-password-form.tsx`

- [ ] **Step 1: Write the page**

`src/app/auth/reset-password/page.tsx`:

```tsx
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <ResetPasswordForm />
    </div>
  );
}
```

- [ ] **Step 2: Write the client form**

`src/components/auth/reset-password-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { mapSupabaseError } from "@/lib/supabase/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const PW_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!PW_RE.test(password)) {
      setError("Minimo 8 caratteri, almeno una lettera e un numero");
      return;
    }
    if (password !== confirm) {
      setError("Le password non coincidono");
      return;
    }

    setIsLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.updateUser({ password });

    if (authError) {
      setError(mapSupabaseError(authError));
      setIsLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Nuova password</CardTitle>
        <CardDescription>Imposta una nuova password per il tuo account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="password"
            placeholder="Nuova password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <Input
            type="password"
            placeholder="Conferma password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={isLoading}
            autoComplete="new-password"
            required
            minLength={8}
          />
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Salvataggio..." : "Salva nuova password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/auth/reset-password src/components/auth/reset-password-form.tsx
git commit -m "feat(auth): add /auth/reset-password page"
```

### Task 18: Logout + lastLoginAt + audit server actions

**Files:**
- Create: `src/lib/auth-actions.ts`
- Create: `src/components/auth/session-tracker.tsx`
- Modify: `src/app/(dashboard)/dashboard/layout.tsx`

- [ ] **Step 1: Write `src/lib/auth-actions.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function logoutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * Called once per session from a mounted client component in the dashboard layout.
 * Updates lastLoginAt and logs a single login_success audit entry.
 */
export async function trackLoginAction() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return;

  const dbUser = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { id: true, organizationId: true, lastLoginAt: true },
  });
  if (!dbUser) return;

  // Throttle: only record if last login is older than 5 minutes (dedupe refresh/nav).
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  if (dbUser.lastLoginAt && dbUser.lastLoginAt > fiveMinAgo) return;

  await prisma.user.update({
    where: { id: dbUser.id },
    data: { lastLoginAt: new Date() },
  });

  if (dbUser.organizationId) {
    await logAudit({
      userId: dbUser.id,
      organizationId: dbUser.organizationId,
      action: "login_success",
      resourceType: "User",
      resourceId: dbUser.id,
    });
  }
}
```

- [ ] **Step 2: Write `src/components/auth/session-tracker.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { trackLoginAction } from "@/lib/auth-actions";

export function SessionTracker() {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void trackLoginAction();
  }, []);

  return null;
}
```

- [ ] **Step 3: Mount `SessionTracker` in the dashboard layout**

Open `src/app/(dashboard)/dashboard/layout.tsx`. Add import near the top:

```tsx
import { SessionTracker } from "@/components/auth/session-tracker";
```

Inside the root layout return JSX, add `<SessionTracker />` as a sibling near the top of the rendered tree (it renders nothing).

- [ ] **Step 4: Update logout button to use the new server action**

Locate the existing logout UI (likely in `src/components/layout/header.tsx` or a sidebar component — search for `signOut`). Replace `signOut` from next-auth with a form calling `logoutAction`:

```tsx
import { logoutAction } from "@/lib/auth-actions";

// ...
<form action={logoutAction}>
  <button type="submit" className="...existing classes...">
    {strings.common.logout}
  </button>
</form>
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-actions.ts src/components/auth/session-tracker.tsx src/app/\(dashboard\)/dashboard/layout.tsx src/components/layout
git commit -m "feat(auth): logout action, lastLoginAt tracker, login_success audit"
```

---

## Phase 5 — Member management rewrite

### Task 19: Update validation schemas

**Files:**
- Modify: `src/lib/validations/organization.ts`

- [ ] **Step 1: Replace the `inviteMemberSchema` and `createOrgSchema`**

```typescript
import { z } from "zod/v4";

export const createOrgSchema = z.object({
  name: z.string().min(1, "Nome obbligatorio"),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Solo lettere minuscole, numeri e trattini"),
  makeDatastoreId: z.string().min(1, "Data Store ID obbligatorio"),
  makeApiToken: z.string().min(1, "API Token obbligatorio"),
  adminEmail: z.email("Email non valida"),
  adminName: z.string().min(1, "Nome obbligatorio"),
  // adminPassword removed — Supabase invite flow handles password
});

export const inviteMemberSchema = z.object({
  email: z.email("Email non valida"),
  name: z.string().min(1, "Nome obbligatorio"),
  role: z.enum(["ORG_ADMIN", "ORG_MEMBER"]),
  // temporaryPassword removed
});

export const updateOrgSettingsSchema = z.object({
  name: z.string().min(1).optional(),
});

export const changeRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["ORG_ADMIN", "ORG_MEMBER"]),
});

export const removeMemberSchema = z.object({
  userId: z.string().min(1),
});

export const resendInviteSchema = z.object({
  userId: z.string().min(1),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/validations/organization.ts
git commit -m "refactor(validations): remove password fields, add resendInvite schema"
```

### Task 20: Remove password field from invite dialog

**Files:**
- Modify: `src/components/settings/members-actions.tsx`

- [ ] **Step 1: Delete the password form field**

In `src/components/settings/members-actions.tsx`, remove the `<div className="space-y-2">` block that contains `id="invite-password"` / `name="temporaryPassword"` (roughly lines 95–107 in current file).

Keep name, email, role fields. The dialog now shows: name, email, role, then cancel/submit buttons.

- [ ] **Step 2: Commit**

```bash
git add src/components/settings/members-actions.tsx
git commit -m "refactor(members): remove temporary password field from invite dialog"
```

### Task 21: Rewrite members page server actions + use view

**Files:**
- Modify: `src/app/(dashboard)/dashboard/settings/members/page.tsx`
- Create: `src/components/settings/member-row-actions.tsx`

- [ ] **Step 1: Extract MemberRowActions into its own file as a client component**

Create `src/components/settings/member-row-actions.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import type { Role } from "@/generated/prisma/client";
import { strings } from "@/lib/i18n/strings";

interface Props {
  memberId: string;
  memberRole: Role;
  isPending: boolean;
  removeAction: (formData: FormData) => Promise<void>;
  changeRoleAction: (formData: FormData) => Promise<void>;
  resendInviteAction: (formData: FormData) => Promise<void>;
}

export function MemberRowActions({
  memberId,
  memberRole,
  isPending,
  removeAction,
  changeRoleAction,
  resendInviteAction,
}: Props) {
  const [transitionPending, startTransition] = useTransition();
  const newRole = memberRole === ("ORG_ADMIN" as Role) ? "ORG_MEMBER" : "ORG_ADMIN";
  const newRoleLabel =
    memberRole === ("ORG_ADMIN" as Role)
      ? strings.roles.ORG_MEMBER
      : strings.roles.ORG_ADMIN;

  return (
    <div className="flex items-center justify-end gap-1">
      {isPending && (
        <form action={resendInviteAction}>
          <input type="hidden" name="userId" value={memberId} />
          <button
            type="submit"
            disabled={transitionPending}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {strings.members.resendInvite}
          </button>
        </form>
      )}
      {memberRole !== ("ADMIN_KUBRI" as Role) && (
        <form
          action={(fd) => startTransition(() => changeRoleAction(fd))}
        >
          <input type="hidden" name="userId" value={memberId} />
          <input type="hidden" name="role" value={newRole} />
          <button
            type="submit"
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {newRoleLabel}
          </button>
        </form>
      )}
      <form action={removeAction}>
        <input type="hidden" name="userId" value={memberId} />
        <button
          type="submit"
          className="rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
        >
          {strings.members.remove}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Replace `src/app/(dashboard)/dashboard/settings/members/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import {
  inviteMemberSchema,
  removeMemberSchema,
  changeRoleSchema,
  resendInviteSchema,
} from "@/lib/validations/organization";
import { strings } from "@/lib/i18n/strings";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MembersActions } from "@/components/settings/members-actions";
import { MemberRowActions } from "@/components/settings/member-row-actions";
import { headers } from "next/headers";

async function originFromHeaders(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export default async function MembersPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { id: true, role: true, organizationId: true },
  });
  if (!currentUser?.organizationId) redirect("/login");

  const isAdmin =
    currentUser.role === Role.ADMIN_KUBRI || currentUser.role === Role.ORG_ADMIN;

  const members = await prisma.memberWithStatus.findMany({
    where: { organizationId: currentUser.organizationId },
    orderBy: { createdAt: "asc" },
  });

  async function inviteMember(formData: FormData) {
    "use server";
    const sbRead = await createSupabaseServerClient();
    const {
      data: { user: aUser },
    } = await sbRead.auth.getUser();
    if (!aUser) throw new Error("Non autenticato");

    const me = await prisma.user.findUnique({
      where: { id: aUser.id },
      select: { id: true, role: true, organizationId: true },
    });
    if (!me?.organizationId) throw new Error("Non autenticato");
    if (me.role !== Role.ADMIN_KUBRI && me.role !== Role.ORG_ADMIN) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = inviteMemberSchema.safeParse({
      email: formData.get("email"),
      name: formData.get("name"),
      role: formData.get("role"),
    });
    if (!parsed.success) throw new Error("Dati non validi");

    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) throw new Error(strings.members.emailExists);

    const admin = createSupabaseAdminClient();
    const origin = await originFromHeaders();
    const { error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
      data: {
        name: parsed.data.name,
        role: parsed.data.role,
        organization_id: me.organizationId,
      },
      redirectTo: `${origin}/auth/callback?next=/auth/set-password`,
    });
    if (error) throw new Error(error.message);

    await logAudit({
      userId: me.id,
      organizationId: me.organizationId,
      action: "invite_member",
      resourceType: "User",
      resourceId: parsed.data.email,
      metadata: { email: parsed.data.email, role: parsed.data.role },
    });

    revalidatePath("/dashboard/settings/members");
  }

  async function resendInvite(formData: FormData) {
    "use server";
    const sbRead = await createSupabaseServerClient();
    const {
      data: { user: aUser },
    } = await sbRead.auth.getUser();
    if (!aUser) throw new Error("Non autenticato");

    const me = await prisma.user.findUnique({
      where: { id: aUser.id },
      select: { id: true, role: true, organizationId: true },
    });
    if (!me?.organizationId) throw new Error("Non autenticato");
    if (me.role !== Role.ADMIN_KUBRI && me.role !== Role.ORG_ADMIN) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = resendInviteSchema.safeParse({ userId: formData.get("userId") });
    if (!parsed.success) throw new Error("Dati non validi");

    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organizationId: me.organizationId },
    });
    if (!target) throw new Error("Utente non trovato");

    const admin = createSupabaseAdminClient();
    const origin = await originFromHeaders();
    const { error } = await admin.auth.admin.inviteUserByEmail(target.email, {
      data: {
        name: target.name,
        role: target.role,
        organization_id: me.organizationId,
      },
      redirectTo: `${origin}/auth/callback?next=/auth/set-password`,
    });
    if (error) throw new Error(error.message);

    await logAudit({
      userId: me.id,
      organizationId: me.organizationId,
      action: "resend_invite",
      resourceType: "User",
      resourceId: target.id,
      metadata: { email: target.email },
    });

    revalidatePath("/dashboard/settings/members");
  }

  async function removeMember(formData: FormData) {
    "use server";
    const sbRead = await createSupabaseServerClient();
    const {
      data: { user: aUser },
    } = await sbRead.auth.getUser();
    if (!aUser) throw new Error("Non autenticato");

    const me = await prisma.user.findUnique({
      where: { id: aUser.id },
      select: { id: true, role: true, organizationId: true },
    });
    if (!me?.organizationId) throw new Error("Non autenticato");
    if (me.role !== Role.ADMIN_KUBRI && me.role !== Role.ORG_ADMIN) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = removeMemberSchema.safeParse({ userId: formData.get("userId") });
    if (!parsed.success) throw new Error("Dati non validi");
    if (parsed.data.userId === me.id) {
      throw new Error(strings.members.cannotRemoveSelf);
    }

    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organizationId: me.organizationId },
      select: { id: true, email: true },
    });
    if (!target) throw new Error("Utente non trovato");

    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.deleteUser(target.id);
    if (error) throw new Error(error.message);

    await logAudit({
      userId: me.id,
      organizationId: me.organizationId,
      action: "remove_member",
      resourceType: "User",
      resourceId: target.id,
      metadata: { email: target.email },
    });

    revalidatePath("/dashboard/settings/members");
  }

  async function changeRole(formData: FormData) {
    "use server";
    const sbRead = await createSupabaseServerClient();
    const {
      data: { user: aUser },
    } = await sbRead.auth.getUser();
    if (!aUser) throw new Error("Non autenticato");

    const me = await prisma.user.findUnique({
      where: { id: aUser.id },
      select: { id: true, role: true, organizationId: true },
    });
    if (!me?.organizationId) throw new Error("Non autenticato");
    if (me.role !== Role.ADMIN_KUBRI && me.role !== Role.ORG_ADMIN) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = changeRoleSchema.safeParse({
      userId: formData.get("userId"),
      role: formData.get("role"),
    });
    if (!parsed.success) throw new Error("Dati non validi");

    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organizationId: me.organizationId },
      select: { id: true, email: true, role: true, name: true },
    });
    if (!target) throw new Error("Utente non trovato");

    await prisma.user.update({
      where: { id: target.id },
      data: { role: parsed.data.role as Role },
    });

    const admin = createSupabaseAdminClient();
    await admin.auth.admin.updateUserById(target.id, {
      user_metadata: {
        name: target.name,
        role: parsed.data.role,
        organization_id: me.organizationId,
      },
    });

    await logAudit({
      userId: me.id,
      organizationId: me.organizationId,
      action: "change_role",
      resourceType: "User",
      resourceId: target.id,
      metadata: { email: target.email, oldRole: target.role, newRole: parsed.data.role },
    });

    revalidatePath("/dashboard/settings/members");
  }

  const roleLabel = (role: Role): string => strings.roles[role] ?? role;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl tracking-tight">{strings.members.title}</h1>
          <p className="mt-1 text-muted-foreground">
            Gestisci i membri della tua organizzazione.
          </p>
        </div>
        {isAdmin && (
          <MembersActions
            inviteAction={inviteMember}
            removeAction={removeMember}
            changeRoleAction={changeRole}
            members={members.map((m) => ({
              id: m.id,
              name: m.name,
              email: m.email,
              role: m.role,
            }))}
            currentUserId={currentUser.id}
          />
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{strings.common.name}</TableHead>
            <TableHead>{strings.common.email}</TableHead>
            <TableHead>{strings.common.role}</TableHead>
            <TableHead>{strings.members.joinedAt}</TableHead>
            <TableHead>{strings.members.status}</TableHead>
            {isAdmin && (
              <TableHead className="text-right">{strings.common.actions}</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.id}>
              <TableCell className="font-medium">{member.name}</TableCell>
              <TableCell>{member.email}</TableCell>
              <TableCell>
                <Badge variant="secondary">{roleLabel(member.role)}</Badge>
              </TableCell>
              <TableCell>
                {member.createdAt.toLocaleDateString("it-IT")}
              </TableCell>
              <TableCell>
                {member.isPending ? (
                  <Badge variant="outline">{strings.members.pending}</Badge>
                ) : (
                  <Badge>{strings.members.active}</Badge>
                )}
              </TableCell>
              {isAdmin && (
                <TableCell className="text-right">
                  {member.id !== currentUser.id && (
                    <MemberRowActions
                      memberId={member.id}
                      memberRole={member.role}
                      isPending={member.isPending}
                      removeAction={removeMember}
                      changeRoleAction={changeRole}
                      resendInviteAction={resendInvite}
                    />
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 3: Add new i18n keys**

Open `src/lib/i18n/strings.ts`, under `members:` object add (before the closing `}`):

```typescript
  status: "Stato",
  active: "Attivo",
  pending: "In attesa",
  resendInvite: "Reinvia invito",
```

Remove the `password: "Password temporanea",` key (no longer used).

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/settings/members/page.tsx src/components/settings/member-row-actions.tsx src/lib/i18n/strings.ts
git commit -m "feat(members): Supabase invite flow + pending status + resend invite"
```

---

## Phase 6 — Admin organization creation

### Task 22: Update admin create-org flow to use invite

**Files:**
- Modify: `src/components/admin/create-org-dialog.tsx`
- Modify: `src/app/(admin)/admin/organizations/page.tsx`

- [ ] **Step 1: Remove admin password field from the dialog**

Open `src/components/admin/create-org-dialog.tsx`. Locate and delete the form field for `adminPassword` (likely an `<Input name="adminPassword" ...>` block). Keep name, slug, makeDatastoreId, makeApiToken, adminEmail, adminName.

- [ ] **Step 2: Rewrite the server action in `src/app/(admin)/admin/organizations/page.tsx`**

Find the `createOrganization` server action. Replace its body with the pattern below (keep the outer wrapper / name / permission checks, replace only the "create admin user" portion):

```typescript
// Inside createOrganization action, after validating input and creating the Organization row:

const organization = await prisma.organization.create({
  data: {
    name: parsed.data.name,
    slug: parsed.data.slug,
    makeDatastoreId: parsed.data.makeDatastoreId,
    makeApiToken: encryptedToken, // existing logic
  },
});

const admin = createSupabaseAdminClient();
const origin = await originFromHeaders(); // same helper as members page; inline or extract to src/lib/origin.ts

const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
  parsed.data.adminEmail,
  {
    data: {
      name: parsed.data.adminName,
      role: "ORG_ADMIN",
      organization_id: organization.id,
    },
    redirectTo: `${origin}/auth/callback?next=/auth/set-password`,
  },
);
if (inviteError) {
  // Roll back org creation
  await prisma.organization.delete({ where: { id: organization.id } });
  throw new Error(inviteError.message);
}

await logAudit({
  userId: currentAdmin.id,
  organizationId: organization.id,
  action: "create_organization",
  resourceType: "Organization",
  resourceId: organization.id,
  metadata: { adminEmail: parsed.data.adminEmail },
});
```

Add imports at the top of the file:

```typescript
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { headers } from "next/headers";
```

And the helper (copy-paste, to be extracted later if desired):

```typescript
async function originFromHeaders(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}
```

Remove any remaining usage of `hashPassword` and the `adminPassword` field.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/create-org-dialog.tsx src/app/\(admin\)/admin/organizations
git commit -m "feat(admin): org creation uses Supabase invite instead of inline password"
```

### Task 23: Extract origin helper (DRY)

**Files:**
- Create: `src/lib/origin.ts`
- Modify: `src/app/(dashboard)/dashboard/settings/members/page.tsx`
- Modify: `src/app/(admin)/admin/organizations/page.tsx`

- [ ] **Step 1: Write `src/lib/origin.ts`**

```typescript
import { headers } from "next/headers";

export async function getAppOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}
```

- [ ] **Step 2: Replace inline helper in both pages**

In `members/page.tsx` and `admin/organizations/page.tsx`: remove the local `originFromHeaders` function and its `import { headers }`; replace with `import { getAppOrigin } from "@/lib/origin";` and calls with `await getAppOrigin()`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/origin.ts src/app/\(dashboard\)/dashboard/settings/members/page.tsx src/app/\(admin\)/admin/organizations/page.tsx
git commit -m "refactor: extract getAppOrigin helper"
```

---

## Phase 7 — Cleanup NextAuth

### Task 24: Delete NextAuth files

**Files:**
- Delete: `src/lib/auth.ts`
- Delete: `src/lib/auth.config.ts`
- Delete: `src/lib/password.ts`
- Delete: `src/types/next-auth.d.ts`
- Delete: `src/app/api/auth/[...nextauth]/` (whole dir)
- Delete: `src/__tests__/lib/password.test.ts`

- [ ] **Step 1: Verify nothing still imports these files**

```bash
pnpm dlx grep -RE "from ['\"]@/lib/auth['\"]|from ['\"]@/lib/auth\.config['\"]|from ['\"]@/lib/password['\"]|from ['\"]next-auth['\"]" src/ || echo "CLEAN"
```

Expected: `CLEAN` or no results.

If results appear, fix each import first (they should have been updated in earlier tasks; if any remain, switch to `@/lib/auth-utils` or `@/lib/supabase/*` as appropriate).

- [ ] **Step 2: Delete the files**

```bash
rm src/lib/auth.ts src/lib/auth.config.ts src/lib/password.ts src/types/next-auth.d.ts
rm -rf src/app/api/auth/\[...nextauth\]
rm src/__tests__/lib/password.test.ts
```

- [ ] **Step 3: Check the `api/auth` folder — delete if empty**

```bash
[ -z "$(ls -A src/app/api/auth 2>/dev/null)" ] && rmdir src/app/api/auth && echo "removed empty dir"
```

- [ ] **Step 4: Typecheck + lint + tests**

```bash
pnpm dlx tsc --noEmit
pnpm lint
pnpm test
```

Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove NextAuth and bcrypt code + tests"
```

### Task 25: Update seed script (or drop it)

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Inspect current seed**

```bash
cat prisma/seed.ts
```

- [ ] **Step 2: Rewrite (minimal) or delete**

If the seed creates Organization + User with `passwordHash` (very likely), rewrite to seed only the Organization rows (optional) — skip user seeding entirely (in the new world, users come from Supabase invites). Suggested minimal seed:

```typescript
import { PrismaClient } from "@/generated/prisma/client";

const prisma = new PrismaClient();

async function main() {
  // No user seeding: users are created via Supabase Auth invite flow.
  // Optionally seed a single placeholder organization here for local dev:
  console.log("Seed skipped: use Supabase Auth invite flow to bootstrap users.");
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 3: Remove `bcryptjs` imports and any `hashPassword` usage**

Verify none remain.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "chore(seed): drop user seeding, bootstrap via Supabase invite"
```

---

## Phase 8 — Supabase email templates (manual)

### Task 26: Customize email templates in Italian

**This task is executed manually by the user in the Supabase dashboard.**

- [ ] **Step 1: Open Supabase dashboard → kubri-dev → Authentication → Email Templates**

- [ ] **Step 2: "Invite user" template — replace with:**

**Subject:**
```
Sei stato invitato su Kubri
```

**Body (HTML):**
```html
<h2>Benvenuto su Kubri</h2>
<p>Sei stato invitato a unirti all'organizzazione sul dashboard Kubri.</p>
<p>Clicca sul pulsante qui sotto per impostare la tua password e accedere:</p>
<p><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;border-radius:6px;text-decoration:none;">Imposta password</a></p>
<p>Il link è valido per 24 ore. Se non ti aspettavi questa email, ignorala.</p>
<p>— Il team Kubri</p>
```

- [ ] **Step 3: "Reset Password" template — replace with:**

**Subject:**
```
Reimposta la password Kubri
```

**Body (HTML):**
```html
<h2>Reimposta la tua password</h2>
<p>Hai richiesto di reimpostare la password per il tuo account Kubri.</p>
<p><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;border-radius:6px;text-decoration:none;">Imposta nuova password</a></p>
<p>Il link è valido per un'ora. Se non hai richiesto tu questo cambio, puoi ignorare l'email.</p>
<p>— Il team Kubri</p>
```

- [ ] **Step 4: Save**

---

## Phase 9 — Dev validation (manual 12-point checklist)

### Task 27: Run full dev smoke test

**Prerequisites:** dev server running (`pnpm dev`), kubri-dev DB empty (0 rows in `public."User"`, 0 orgs, 0 auth.users). If not empty, run `pnpm dlx prisma migrate reset --force --skip-seed` + delete users from `auth.users` via Supabase dashboard.

- [ ] **Step 1: Bootstrap first ADMIN_KUBRI via Supabase dashboard**

Supabase → kubri-dev → Authentication → Users → Invite User → enter your real email → User Metadata: `{"name": "Daniele", "role": "ADMIN_KUBRI"}` → Invite.

Expected: email arrives from Resend (sender `noreply@<your-domain>`). Click link → atterri su `/auth/callback` → redirect a `/auth/set-password` → imposti password → atterri su `/dashboard`.

- [ ] **Step 2: Verify `public.User` row**

In Supabase SQL Editor:

```sql
SELECT id, email, name, role, "organizationId" FROM public."User";
```

Expected: one row, your id, role `ADMIN_KUBRI`, `organizationId` null.

- [ ] **Step 3: Logout + re-login**

Click logout → redirect a `/login`. Login con email+password. Entri.

Verifica in SQL: `SELECT "lastLoginAt" FROM public."User" WHERE email = '<tua email>'` → valore recente.

- [ ] **Step 4: Reset password flow**

Logout. `/login` → "Password dimenticata?" → email. Arriva, click, atterri su `/auth/reset-password`, cambi password, redirect a `/dashboard`. Relogin con la nuova password OK.

- [ ] **Step 5: Create an Organization from `/admin/organizations`**

Come ADMIN_KUBRI senza org, vai su `/admin/organizations`. Crea org di test. L'admin email è un tuo alias (tipo `tuonome+test@gmail.com`). Verifica: org creata, email di invito arrivata al secondo indirizzo.

- [ ] **Step 6: Accept the invite in a private browser window**

Browser privato → click link → imposti password → entri → vedi dashboard come `ORG_ADMIN`.

- [ ] **Step 7: Invite a third user (ORG_MEMBER) from members page**

Come `ORG_ADMIN`, `/dashboard/settings/members` → Invita membro → nome, email (altro alias), role `ORG_MEMBER`. Verifica: email arriva.

- [ ] **Step 8: Verify pending state**

Non completare il terzo invito. Nella tabella membri vedi la terza riga con badge "In attesa" + pulsante "Reinvia invito".

- [ ] **Step 9: Resend invite**

Click "Reinvia invito" → arriva nuova email → il vecchio link è invalidato (tenta clic, atterri su `/login?error=otp_expired` o simile) → il nuovo funziona.

- [ ] **Step 10: Change role**

Sul secondo utente, click sul pulsante cambio ruolo → ruolo aggiornato sia in `public."User".role` sia in `auth.users.raw_user_meta_data.role` (verifica entrambi in SQL).

- [ ] **Step 11: Remove member**

Rimuovi il terzo utente. Verifica:
```sql
SELECT COUNT(*) FROM public."User" WHERE email = '<terza email>';
SELECT COUNT(*) FROM auth.users WHERE email = '<terza email>';
```
Entrambi 0.

- [ ] **Step 12: Permission check**

Loggati come `ORG_MEMBER` (crea un quarto utente solo per questo test se serve). Tenta di andare su `/dashboard/settings/members` e invitare → bloccato lato server.

- [ ] **Step 13: Route protection**

Sloggato → `/dashboard` → redirect `/login`. Loggato → `/login` → redirect `/dashboard`.

- [ ] **Step 14: Audit log sanity check**

```sql
SELECT action, "createdAt", metadata FROM public."AuditLog" ORDER BY "createdAt" DESC LIMIT 30;
```

Verifica presenti: `login_success`, `invite_member`, `resend_invite`, `remove_member`, `change_role`, `create_organization`.

- [ ] **Step 15: Expired token UX**

Simula un link scaduto (puoi invalidarlo chiamando di nuovo invite per lo stesso utente o aspettando, o in SQL `UPDATE auth.users SET confirmation_sent_at = now() - interval '25 hours' WHERE email = '...'`). Clicca il vecchio link → atterri su `/login?error=...` con messaggio coerente.

**If anything fails, fix and re-run the failing step. Only proceed to merge when all 15 pass.**

- [ ] **Step 16: Typecheck + lint + tests once more**

```bash
pnpm dlx tsc --noEmit
pnpm lint
pnpm test
pnpm build
```

Expected: all green.

- [ ] **Step 17: Merge branch**

```bash
git checkout main
git merge --ff-only feat/supabase-auth
git branch -d feat/supabase-auth
```

(If `--ff-only` fails because main advanced, rebase: `git rebase main` on the feature branch first.)

---

## Phase 10 — Production cutover (manual, separate day)

### Task 28: Production rollout sequence

**⚠️ Execute only after dev validation (Task 27) has fully passed and you've decided to cut over.**

- [ ] **Step 1: Configure Resend + Supabase Auth on `kubri-prod`**

Repeat Task 1 steps but for the kubri-prod Supabase project and production Site URL (e.g. `https://app.kubri.it`). Redirect URLs: `https://app.kubri.it/auth/callback`, `.../auth/set-password`, `.../auth/reset-password`.

Customize email templates (Task 26) in prod too.

- [ ] **Step 2: Set Vercel prod env vars**

Vercel → Project → Settings → Environment Variables (Production scope):
- Add `NEXT_PUBLIC_SUPABASE_URL` (prod project URL)
- Add `NEXT_PUBLIC_SUPABASE_ANON_KEY` (prod anon key)
- Add `SUPABASE_SERVICE_ROLE_KEY` (prod service role key)
- Remove `NEXTAUTH_SECRET`, `NEXTAUTH_URL`

- [ ] **Step 3: Apply Prisma migrations to prod**

Via the dedicated GitHub Action (per prior deploy brainstorming). If that isn't ready yet, run manually from your laptop:

```bash
DATABASE_URL="<prod session pooler conn string>" pnpm dlx prisma migrate deploy
```

Expected: both `supabase_auth_schema` and `supabase_auth_trigger` apply cleanly.

- [ ] **Step 4: Clean prod seed data**

Supabase prod → SQL Editor:

```sql
BEGIN;
TRUNCATE public."AuditLog" CASCADE;
DELETE FROM public."User";
DELETE FROM public."Organization";
COMMIT;
```

- [ ] **Step 5: Deploy Vercel**

```bash
git push origin main
```

Vercel auto-deploys. Check deploy log for errors.

- [ ] **Step 6: Bootstrap prod first admin**

Supabase prod → Authentication → Users → Invite User → your real email → metadata `{"name":"Daniele","role":"ADMIN_KUBRI"}` → Invite.

Email arriva dal dominio prod. Completi l'invito, setti password, atterri su `/dashboard`.

- [ ] **Step 7: Create first prod Organization**

Come `ADMIN_KUBRI` su prod → `/admin/organizations` → crea la prima org. Invita un alias come `ORG_ADMIN`. Verifica email.

- [ ] **Step 8: Prod smoke test**

Ripeti almeno: login, logout, invite, accept invite, reset password. Confermato OK? Cutover concluso.

### Rollback plan

If something breaks in prod:

1. `git revert -m 1 <merge-sha>` → push → Vercel redeploys previous code
2. Restore schema: migration rollback. Since we dropped `passwordHash` and changed UUID types, a roll-forward fix is usually faster than rollback. Given prod has 0 real users, the safe option is always to reset and re-cutover.
3. Restore env vars (re-add `NEXTAUTH_SECRET` if rolling all the way back).

---

## Self-review results (filled during writing)

- Spec coverage: ✅ tutti i flussi dello spec (login, invite, resend, reset, logout, remove, change-role) sono coperti da task. Modello dati con trigger/view: Task 5. Error mapping: Task 10. RLS off: non serve task (assenza = default). Email templates IT: Task 26. 12-point checklist: Task 27 (esteso a 15 step + build).
- Placeholder scan: nessun TBD/TODO/generic error handling. Codice completo in ogni step.
- Type consistency: `Role`, `MemberWithStatus`, `getAppOrigin`, `hasMinimumRole`, `mapSupabaseError`, `createSupabaseServerClient`, `createSupabaseBrowserClient`, `createSupabaseAdminClient`, `updateSession`, `logoutAction`, `trackLoginAction` — tutti nomi coerenti tra task di definizione e task di uso.
- Open detail del design "admin senza org": coperto da Task 21 (members page redirect `/login` se `!organizationId`) + Task 22 (admin crea org anche senza org propria — la pagina `/admin/organizations` richiede solo `ADMIN_KUBRI`, non `organizationId`). Nota: verificare in Task 27 Step 5 che la pagina funzioni davvero con `organizationId=null`.
