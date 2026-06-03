# Email Notifications (New Candidates Digest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send each opted-in dashboard user a daily or weekly email digest counting the new candidates that entered the non-global pools of their organization, with a link back to the dashboard; skip the email when there are zero new candidates.

**Architecture:** A single daily Vercel Cron hits `GET /api/cron/notifications` (Bearer `CRON_SECRET`). The handler selects "due" recipients (DAILY always, WEEKLY on a fixed weekday), counts new candidates per user using a `lastNotifiedAt` watermark, and sends a Resend email rendered from a React Email template — updating the watermark only on a successful send. Preferences are per-user columns on `User`, edited from the settings page. See spec: `docs/superpowers/specs/2026-06-03-email-notifications-design.md`.

**Tech Stack:** Next.js 16 App Router, Prisma 7 / Postgres, Resend, React Email, Zod v4, Vitest.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `prisma/schema.prisma` | `NotifyFrequency` enum + 3 columns on `User` |
| `src/lib/notifications/types.ts` | Shared `PoolBreakdown` type |
| `src/lib/notifications/config.ts` | `WEEKLY_SEND_DAY` constant |
| `src/lib/notifications/select-recipients.ts` | `isWeeklyDue`, `getDueRecipients` |
| `src/lib/notifications/new-candidates.ts` | `getNewCandidatesForUser` (watermark, non-global scope) |
| `src/lib/notifications/send-digest.ts` | `sendDigest` (render + Resend + watermark update) |
| `src/lib/email/client.ts` | Resend client + `EMAIL_FROM` |
| `src/emails/candidate-digest.tsx` | React Email template + `PreviewProps` |
| `src/app/api/cron/notifications/route.ts` | Thin orchestrator (auth + loop) |
| `src/lib/validations/notification.ts` | Zod schema for the preference form |
| `src/components/settings/notification-form.tsx` | Client form (toggle + frequency) |
| `src/app/(dashboard)/dashboard/settings/page.tsx` | New Card + server action |
| `src/lib/i18n/strings.ts` | Italian UI strings |
| `vercel.json` | Cron entry |
| `.env.example`, `package.json` | Env vars + `email` preview script |

---

## Task 1: Install dependencies, env vars, preview script

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install runtime + dev deps**

Run:
```bash
pnpm add resend @react-email/components @react-email/render
pnpm add -D react-email
```

- [ ] **Step 2: Add the template preview script to `package.json`**

In the `"scripts"` block add:
```jsonc
"email": "react-email dev --dir src/emails --port 3001"
```

- [ ] **Step 3: Add env vars to `.env.example`**

Append:
```bash
# Email notifications (Resend) — new-candidates digest
# Get an API key at https://resend.com. EMAIL_FROM must use a verified domain in
# production; for local testing use "Kubri <onboarding@resend.dev>" (only sends to
# your own Resend account address until a domain is verified).
RESEND_API_KEY=
EMAIL_FROM="Kubri <onboarding@resend.dev>"

# Public base URL used to build dashboard links inside emails
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 4: Verify install + typecheck baseline**

Run: `pnpm lint`
Expected: passes (no usages yet).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example
git commit -m "chore: add resend + react-email deps and email env vars"
```

---

## Task 2: Prisma schema — notification preference columns

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the enum**

Add near the other enums:
```prisma
enum NotifyFrequency {
  DAILY
  WEEKLY
}
```

- [ ] **Step 2: Add columns to `model User`**

Inside `model User` (after `termsAcceptedAt`):
```prisma
  notifyEnabled   Boolean         @default(false)
  notifyFrequency NotifyFrequency @default(WEEKLY)
  lastNotifiedAt  DateTime?
```

- [ ] **Step 3: Create + apply the migration on dev**

Run: `pnpm prisma migrate dev --name add_user_notification_prefs`
Expected: a new folder under `prisma/migrations/`, client regenerated, no errors.

- [ ] **Step 4: Confirm the generated client has the new fields**

Run: `pnpm lint`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add per-user notification preference columns"
```

> NOTE for the human before merging the PR: apply to prod with
> `set -a && source .env.prod && set +a && pnpm prisma migrate deploy`
> (additive, non-destructive — no backfill needed).

---

## Task 3: Shared type + config + weekly-due logic

**Files:**
- Create: `src/lib/notifications/types.ts`
- Create: `src/lib/notifications/config.ts`
- Create: `src/lib/notifications/select-recipients.ts`
- Test: `src/__tests__/lib/notifications/select-recipients.test.ts`

- [ ] **Step 1: Create the shared type**

`src/lib/notifications/types.ts`:
```ts
export interface PoolBreakdown {
  poolId: string;
  poolName: string;
  count: number;
}
```

- [ ] **Step 2: Create the config**

`src/lib/notifications/config.ts`:
```ts
// Day-of-week WEEKLY digests are sent on, in UTC. 0 = Sunday … 1 = Monday.
export const WEEKLY_SEND_DAY = 1;
```

- [ ] **Step 3: Write the failing test for `isWeeklyDue`**

`src/__tests__/lib/notifications/select-recipients.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isWeeklyDue } from "@/lib/notifications/select-recipients";

describe("isWeeklyDue", () => {
  it("is due on Monday (WEEKLY_SEND_DAY=1)", () => {
    // 2026-06-01 is a Monday
    expect(isWeeklyDue(new Date("2026-06-01T07:00:00Z"))).toBe(true);
  });

  it("is not due on Tuesday", () => {
    expect(isWeeklyDue(new Date("2026-06-02T07:00:00Z"))).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run src/__tests__/lib/notifications/select-recipients.test.ts`
Expected: FAIL — `isWeeklyDue` is not exported / module not found.

- [ ] **Step 5: Implement `isWeeklyDue`**

`src/lib/notifications/select-recipients.ts`:
```ts
import { WEEKLY_SEND_DAY } from "./config";

export function isWeeklyDue(now: Date): boolean {
  return now.getUTCDay() === WEEKLY_SEND_DAY;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run src/__tests__/lib/notifications/select-recipients.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/notifications/types.ts src/lib/notifications/config.ts src/lib/notifications/select-recipients.ts src/__tests__/lib/notifications/select-recipients.test.ts
git commit -m "feat(notifications): weekly-due logic + shared types/config"
```

---

## Task 4: `getDueRecipients`

**Files:**
- Modify: `src/lib/notifications/select-recipients.ts`
- Test: `src/__tests__/lib/notifications/select-recipients.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing file)**

Add to `src/__tests__/lib/notifications/select-recipients.test.ts`:
```ts
import { vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { user: { findMany: vi.fn() } },
}));

describe("getDueRecipients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps users to recipients with org name", async () => {
    const { prisma } = await import("@/lib/db");
    (prisma.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "u1",
        email: "a@b.c",
        organizationId: "o1",
        lastNotifiedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        organization: { name: "Coop Esempio" },
      },
    ]);
    const { getDueRecipients } = await import("@/lib/notifications/select-recipients");
    const res = await getDueRecipients(new Date("2026-06-01T07:00:00Z"));
    expect(res).toEqual([
      {
        id: "u1",
        email: "a@b.c",
        organizationId: "o1",
        organizationName: "Coop Esempio",
        lastNotifiedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/__tests__/lib/notifications/select-recipients.test.ts`
Expected: FAIL — `getDueRecipients` is not exported.

- [ ] **Step 3: Implement `getDueRecipients`**

Append to `src/lib/notifications/select-recipients.ts`:
```ts
import { prisma } from "@/lib/db";

export interface Recipient {
  id: string;
  email: string;
  organizationId: string;
  organizationName: string;
  lastNotifiedAt: Date | null;
  createdAt: Date;
}

export async function getDueRecipients(now: Date): Promise<Recipient[]> {
  const weeklyDue = isWeeklyDue(now);
  const frequencies: ("DAILY" | "WEEKLY")[] = weeklyDue
    ? ["DAILY", "WEEKLY"]
    : ["DAILY"];

  const users = await prisma.user.findMany({
    where: {
      notifyEnabled: true,
      organizationId: { not: null },
      notifyFrequency: { in: frequencies },
    },
    select: {
      id: true,
      email: true,
      organizationId: true,
      lastNotifiedAt: true,
      createdAt: true,
      organization: { select: { name: true } },
    },
  });

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    organizationId: u.organizationId as string,
    organizationName: u.organization?.name ?? "",
    lastNotifiedAt: u.lastNotifiedAt,
    createdAt: u.createdAt,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/__tests__/lib/notifications/select-recipients.test.ts`
Expected: PASS (both `isWeeklyDue` and `getDueRecipients` describes green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/select-recipients.ts src/__tests__/lib/notifications/select-recipients.test.ts
git commit -m "feat(notifications): select due recipients (DAILY + WEEKLY-on-day)"
```

---

## Task 5: `getNewCandidatesForUser`

**Files:**
- Create: `src/lib/notifications/new-candidates.ts`
- Test: `src/__tests__/lib/notifications/new-candidates.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/lib/notifications/new-candidates.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    candidate: { groupBy: vi.fn() },
    pool: { findMany: vi.fn() },
  },
}));

describe("getNewCandidatesForUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns per-pool breakdown using the watermark", async () => {
    const { prisma } = await import("@/lib/db");
    (prisma.candidate.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { poolId: "p1", _count: { _all: 2 } },
    ]);
    (prisma.pool.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "p1", name: "Magazzino" },
    ]);

    const { getNewCandidatesForUser } = await import(
      "@/lib/notifications/new-candidates"
    );
    const res = await getNewCandidatesForUser({
      organizationId: "o1",
      lastNotifiedAt: new Date("2026-05-01T00:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(res).toEqual([{ poolId: "p1", poolName: "Magazzino", count: 2 }]);
    const where = (prisma.candidate.groupBy as ReturnType<typeof vi.fn>).mock
      .calls[0][0].where;
    expect(where.createdAt.gt).toEqual(new Date("2026-05-01T00:00:00Z"));
    expect(where.pool.isGlobal).toBe(false);
  });

  it("returns empty when there are no new candidates", async () => {
    const { prisma } = await import("@/lib/db");
    (prisma.candidate.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { getNewCandidatesForUser } = await import(
      "@/lib/notifications/new-candidates"
    );
    const res = await getNewCandidatesForUser({
      organizationId: "o1",
      lastNotifiedAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(res).toEqual([]);
    expect(prisma.pool.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/__tests__/lib/notifications/new-candidates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `getNewCandidatesForUser`**

`src/lib/notifications/new-candidates.ts`:
```ts
import { prisma } from "@/lib/db";
import type { PoolBreakdown } from "./types";

interface RecipientWindow {
  organizationId: string;
  lastNotifiedAt: Date | null;
  createdAt: Date;
}

export async function getNewCandidatesForUser(
  user: RecipientWindow,
): Promise<PoolBreakdown[]> {
  const since = user.lastNotifiedAt ?? user.createdAt;

  const groups = await prisma.candidate.groupBy({
    by: ["poolId"],
    where: {
      createdAt: { gt: since },
      pool: {
        isGlobal: false,
        organizations: { some: { organizationId: user.organizationId } },
      },
    },
    _count: { _all: true },
  });

  if (groups.length === 0) return [];

  const pools = await prisma.pool.findMany({
    where: { id: { in: groups.map((g) => g.poolId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(pools.map((p) => [p.id, p.name]));

  return groups.map((g) => ({
    poolId: g.poolId,
    poolName: nameById.get(g.poolId) ?? "—",
    count: g._count._all,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/__tests__/lib/notifications/new-candidates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/new-candidates.ts src/__tests__/lib/notifications/new-candidates.test.ts
git commit -m "feat(notifications): count new candidates per user (watermark, non-global)"
```

---

## Task 6: Email client + React Email template

**Files:**
- Create: `src/lib/email/client.ts`
- Create: `src/emails/candidate-digest.tsx`
- Test: `src/__tests__/emails/candidate-digest.test.ts`

- [ ] **Step 1: Create the Resend client**

`src/lib/email/client.ts`:
```ts
import { Resend } from "resend";

export const resend = new Resend(process.env["RESEND_API_KEY"]);
export const EMAIL_FROM =
  process.env["EMAIL_FROM"] ?? "Kubri <onboarding@resend.dev>";
```

- [ ] **Step 2: Write the failing template render test**

`src/__tests__/emails/candidate-digest.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { CandidateDigestEmail } from "@/emails/candidate-digest";

describe("CandidateDigestEmail", () => {
  it("renders total, per-pool breakdown and dashboard link", async () => {
    const html = await render(
      CandidateDigestEmail({
        orgName: "Coop X",
        total: 3,
        byPool: [
          { poolId: "p1", poolName: "Magazzino", count: 2 },
          { poolId: "p2", poolName: "Sala", count: 1 },
        ],
        dashboardUrl: "https://app.example/dashboard/candidates",
      }),
    );
    expect(html).toContain("Magazzino");
    expect(html).toContain("Sala");
    expect(html).toContain("https://app.example/dashboard/candidates");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run src/__tests__/emails/candidate-digest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the template**

`src/emails/candidate-digest.tsx`:
```tsx
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { PoolBreakdown } from "@/lib/notifications/types";

export interface CandidateDigestEmailProps {
  orgName: string;
  total: number;
  byPool: PoolBreakdown[];
  dashboardUrl: string;
}

export function CandidateDigestEmail({
  orgName,
  total,
  byPool,
  dashboardUrl,
}: CandidateDigestEmailProps) {
  return (
    <Html lang="it">
      <Head />
      <Preview>{`${total} nuovi candidati su Kubri`}</Preview>
      <Body
        style={{
          fontFamily: "Arial, sans-serif",
          backgroundColor: "#f6f6f6",
          padding: "24px",
        }}
      >
        <Container
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "8px",
            padding: "32px",
          }}
        >
          <Heading as="h1" style={{ fontSize: "20px", margin: "0 0 12px" }}>
            Nuovi candidati su Kubri
          </Heading>
          <Text style={{ margin: "0 0 16px" }}>
            {orgName}: sono entrati {total} nuovi candidati in piattaforma.
          </Text>
          <Section>
            {byPool.map((p) => (
              <Text key={p.poolId} style={{ margin: "4px 0" }}>
                • {p.poolName}: {p.count}
              </Text>
            ))}
          </Section>
          <Link
            href={dashboardUrl}
            style={{
              display: "inline-block",
              marginTop: "20px",
              backgroundColor: "#111111",
              color: "#ffffff",
              padding: "10px 16px",
              borderRadius: "6px",
              textDecoration: "none",
            }}
          >
            Vedi i candidati
          </Link>
        </Container>
      </Body>
    </Html>
  );
}

CandidateDigestEmail.PreviewProps = {
  orgName: "Coop Esempio",
  total: 3,
  byPool: [
    { poolId: "p1", poolName: "Magazzino", count: 2 },
    { poolId: "p2", poolName: "Sala", count: 1 },
  ],
  dashboardUrl: "https://dashboard.kubri.it/dashboard/candidates",
} satisfies CandidateDigestEmailProps;

export default CandidateDigestEmail;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/__tests__/emails/candidate-digest.test.ts`
Expected: PASS.

- [ ] **Step 6: Sanity-check the preview server (optional, manual)**

Run: `pnpm email` then open `http://localhost:3001`. Confirm the digest renders with the `PreviewProps` data. Stop the server with Ctrl-C.

- [ ] **Step 7: Commit**

```bash
git add src/lib/email/client.ts src/emails/candidate-digest.tsx src/__tests__/emails/candidate-digest.test.ts
git commit -m "feat(notifications): resend client + candidate digest email template"
```

---

## Task 7: `sendDigest`

**Files:**
- Create: `src/lib/notifications/send-digest.ts`
- Test: `src/__tests__/lib/notifications/send-digest.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/lib/notifications/send-digest.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/email/client", () => ({
  resend: { emails: { send: vi.fn().mockResolvedValue({ data: { id: "x" }, error: null }) } },
  EMAIL_FROM: "Kubri <test@resend.dev>",
}));
vi.mock("@/lib/db", () => ({
  prisma: { user: { update: vi.fn().mockResolvedValue({}) } },
}));

describe("sendDigest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends one email and updates lastNotifiedAt", async () => {
    const { sendDigest } = await import("@/lib/notifications/send-digest");
    const { resend } = await import("@/lib/email/client");
    const { prisma } = await import("@/lib/db");

    await sendDigest({ id: "u1", email: "a@b.c" }, "Coop", [
      { poolId: "p1", poolName: "Magazzino", count: 2 },
    ]);

    expect(resend.emails.send).toHaveBeenCalledOnce();
    const arg = (resend.emails.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.to).toBe("a@b.c");
    expect(arg.from).toBe("Kubri <test@resend.dev>");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { lastNotifiedAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/__tests__/lib/notifications/send-digest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sendDigest`**

`src/lib/notifications/send-digest.ts`:
```ts
import { render } from "@react-email/render";
import { prisma } from "@/lib/db";
import { resend, EMAIL_FROM } from "@/lib/email/client";
import { CandidateDigestEmail } from "@/emails/candidate-digest";
import type { PoolBreakdown } from "./types";

const APP_URL = process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";

export async function sendDigest(
  user: { id: string; email: string },
  orgName: string,
  breakdown: PoolBreakdown[],
): Promise<void> {
  const total = breakdown.reduce((sum, b) => sum + b.count, 0);
  const dashboardUrl = `${APP_URL}/dashboard/candidates`;

  const html = await render(
    CandidateDigestEmail({ orgName, total, byPool: breakdown, dashboardUrl }),
  );

  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: user.email,
    subject: `${total} nuovi candidati su Kubri`,
    html,
  });

  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastNotifiedAt: new Date() },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/__tests__/lib/notifications/send-digest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/send-digest.ts src/__tests__/lib/notifications/send-digest.test.ts
git commit -m "feat(notifications): render + send digest, update watermark on success"
```

---

## Task 8: Cron route handler

**Files:**
- Create: `src/app/api/cron/notifications/route.ts`
- Test: `src/__tests__/app/api/cron/notifications.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/app/api/cron/notifications.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/notifications/select-recipients", () => ({
  getDueRecipients: vi.fn(),
}));
vi.mock("@/lib/notifications/new-candidates", () => ({
  getNewCandidatesForUser: vi.fn(),
}));
vi.mock("@/lib/notifications/send-digest", () => ({ sendDigest: vi.fn() }));

describe("GET /api/cron/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["CRON_SECRET"] = "test-cron";
  });

  it("rejects unauthenticated calls", async () => {
    const { GET } = await import("@/app/api/cron/notifications/route");
    const res = await GET(new Request("http://x/api/cron/notifications"));
    expect(res.status).toBe(401);
  });

  it("sends to users with new candidates and skips empty ones", async () => {
    const { getDueRecipients } = await import("@/lib/notifications/select-recipients");
    const { getNewCandidatesForUser } = await import("@/lib/notifications/new-candidates");
    const { sendDigest } = await import("@/lib/notifications/send-digest");

    (getDueRecipients as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "u1", email: "a@b.c", organizationId: "o1", organizationName: "Coop", lastNotifiedAt: null, createdAt: new Date() },
      { id: "u2", email: "d@e.f", organizationId: "o2", organizationName: "Coop2", lastNotifiedAt: null, createdAt: new Date() },
    ]);
    (getNewCandidatesForUser as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ poolId: "p1", poolName: "Magazzino", count: 2 }])
      .mockResolvedValueOnce([]);

    const { GET } = await import("@/app/api/cron/notifications/route");
    const res = await GET(
      new Request("http://x/api/cron/notifications", {
        headers: { authorization: "Bearer test-cron" },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, skipped: 1, failed: 0 });
    expect(sendDigest).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/__tests__/app/api/cron/notifications.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

`src/app/api/cron/notifications/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getDueRecipients } from "@/lib/notifications/select-recipients";
import { getNewCandidatesForUser } from "@/lib/notifications/new-candidates";
import { sendDigest } from "@/lib/notifications/send-digest";

export async function GET(req: Request): Promise<Response> {
  const expected = process.env["CRON_SECRET"];
  const auth = req.headers.get("authorization");
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const recipients = await getDueRecipients(now);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of recipients) {
    try {
      const breakdown = await getNewCandidatesForUser(user);
      const total = breakdown.reduce((s, b) => s + b.count, 0);
      if (total === 0) {
        skipped++;
        continue;
      }
      await sendDigest(user, user.organizationName, breakdown);
      sent++;
    } catch (e) {
      console.error("[cron] notification digest failed for user", user.id, e);
      failed++;
    }
  }

  return NextResponse.json({ sent, skipped, failed });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/__tests__/app/api/cron/notifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/notifications/route.ts src/__tests__/app/api/cron/notifications.test.ts
git commit -m "feat(notifications): cron route orchestrating the daily/weekly digest"
```

---

## Task 9: Register the Vercel cron

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add the cron entry**

`vercel.json` — add to the `crons` array (alongside the existing embeddings cron):
```json
    {
      "path": "/api/cron/notifications",
      "schedule": "0 7 * * *"
    }
```
Result:
```json
{
  "crons": [
    {
      "path": "/api/cron/regenerate-embeddings",
      "schedule": "0 3 * * *"
    },
    {
      "path": "/api/cron/notifications",
      "schedule": "0 7 * * *"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "chore(cron): schedule daily notifications job at 07:00 UTC"
```

---

## Task 10: Zod validation schema

**Files:**
- Create: `src/lib/validations/notification.ts`
- Test: `src/__tests__/lib/validations/notification.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/lib/validations/notification.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { notificationPrefsSchema } from "@/lib/validations/notification";

describe("notificationPrefsSchema", () => {
  it("accepts valid preferences", () => {
    const r = notificationPrefsSchema.safeParse({
      notifyEnabled: true,
      notifyFrequency: "DAILY",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown frequency", () => {
    const r = notificationPrefsSchema.safeParse({
      notifyEnabled: false,
      notifyFrequency: "MONTHLY",
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/__tests__/lib/validations/notification.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema**

`src/lib/validations/notification.ts`:
```ts
import { z } from "zod/v4";

export const notificationPrefsSchema = z.object({
  notifyEnabled: z.boolean(),
  notifyFrequency: z.enum(["DAILY", "WEEKLY"]),
});

export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/__tests__/lib/validations/notification.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/notification.ts src/__tests__/lib/validations/notification.test.ts
git commit -m "feat(notifications): zod schema for preference form"
```

---

## Task 11: Settings UI — i18n strings + client form

**Files:**
- Modify: `src/lib/i18n/strings.ts`
- Create: `src/components/settings/notification-form.tsx`

- [ ] **Step 1: Add i18n strings**

In `src/lib/i18n/strings.ts`, inside the `settings: { … }` object, add:
```ts
    notifications: "Notifiche email",
    notificationsDescription:
      "Ricevi un riepilogo dei nuovi candidati entrati in piattaforma.",
    notificationsEnable: "Attiva le notifiche email",
    frequency: "Frequenza",
    frequencyDaily: "Giornaliera",
    frequencyWeekly: "Settimanale",
```

- [ ] **Step 2: Create the client form**

`src/components/settings/notification-form.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { strings } from "@/lib/i18n/strings";

interface NotificationFormProps {
  defaultEnabled: boolean;
  defaultFrequency: "DAILY" | "WEEKLY";
  action: (formData: FormData) => Promise<void>;
}

export function NotificationForm({
  defaultEnabled,
  defaultFrequency,
  action,
}: NotificationFormProps) {
  const [_state, formAction, isPending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      await action(formData);
      return { success: true };
    },
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="notifyEnabled"
          defaultChecked={defaultEnabled}
          className="h-4 w-4"
        />
        {strings.settings.notificationsEnable}
      </label>

      <div className="space-y-1">
        <label className="text-sm text-muted-foreground">
          {strings.settings.frequency}
        </label>
        <select
          name="notifyFrequency"
          defaultValue={defaultFrequency}
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="DAILY">{strings.settings.frequencyDaily}</option>
          <option value="WEEKLY">{strings.settings.frequencyWeekly}</option>
        </select>
      </div>

      <Button type="submit" size="sm" disabled={isPending}>
        {strings.common.save}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Verify lint/typecheck**

Run: `pnpm lint`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n/strings.ts src/components/settings/notification-form.tsx
git commit -m "feat(notifications): settings form + i18n strings"
```

---

## Task 12: Settings page — Card + server action

**Files:**
- Modify: `src/app/(dashboard)/dashboard/settings/page.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/app/(dashboard)/dashboard/settings/page.tsx`, add:
```ts
import { NotificationForm } from "@/components/settings/notification-form";
import { notificationPrefsSchema } from "@/lib/validations/notification";
import { NotifyFrequency } from "@/generated/prisma/client";
```

- [ ] **Step 2: Load the current user's preferences**

After the existing `org` lookup in `SettingsPage`, add:
```ts
  const prefs = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { notifyEnabled: true, notifyFrequency: true },
  });
```

- [ ] **Step 3: Add the server action**

Inside `SettingsPage`, alongside `updateOrgName`, add:
```ts
  async function updateNotificationPrefs(formData: FormData) {
    "use server";
    const s = await getCurrentUser();

    const parsed = notificationPrefsSchema.safeParse({
      notifyEnabled: formData.get("notifyEnabled") === "on",
      notifyFrequency: formData.get("notifyFrequency"),
    });
    if (!parsed.success) {
      throw new Error("Dati non validi");
    }

    const current = await prisma.user.findUnique({
      where: { id: s.id },
      select: { notifyEnabled: true },
    });
    const enabling = parsed.data.notifyEnabled && !current?.notifyEnabled;

    await prisma.user.update({
      where: { id: s.id },
      data: {
        notifyEnabled: parsed.data.notifyEnabled,
        notifyFrequency: parsed.data.notifyFrequency as NotifyFrequency,
        ...(enabling ? { lastNotifiedAt: new Date() } : {}),
      },
    });

    revalidatePath("/dashboard/settings");
  }
```

- [ ] **Step 4: Add the Card to the grid**

Inside the `<div className="grid gap-6 md:grid-cols-2">`, after the existing cards, add:
```tsx
        <Card>
          <CardHeader>
            <CardTitle>{strings.settings.notifications}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              {strings.settings.notificationsDescription}
            </p>
            <NotificationForm
              defaultEnabled={prefs.notifyEnabled}
              defaultFrequency={prefs.notifyFrequency}
              action={updateNotificationPrefs}
            />
          </CardContent>
        </Card>
```

- [ ] **Step 5: Verify lint + full test suite**

Run: `pnpm lint && pnpm test`
Expected: lint passes; all tests green.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/dashboard/settings/page.tsx"
git commit -m "feat(notifications): notifications card + preference server action in settings"
```

---

## Final verification

- [ ] **Run the whole suite**

Run: `pnpm lint && pnpm test`
Expected: lint clean, all tests pass.

- [ ] **Manual smoke (optional)**

1. `pnpm email` → confirm the template renders at `localhost:3001`.
2. `pnpm dev`, open `/dashboard/settings`, toggle notifications + pick a frequency, save, reload → values persist.
3. With `CRON_SECRET` and `RESEND_API_KEY` set in `.env.local` (use `EMAIL_FROM="Kubri <onboarding@resend.dev>"` and your own Resend account email as a recipient), trigger:
   `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/notifications`
   Expected JSON: `{ "sent": …, "skipped": …, "failed": 0 }`.

## Pre-merge checklist (human)

- [ ] Apply migration to prod: `set -a && source .env.prod && set +a && pnpm prisma migrate deploy`
- [ ] Verify: `set -a && source .env.prod && set +a && pnpm prisma migrate status`
- [ ] Set `RESEND_API_KEY`, `EMAIL_FROM` (verified domain), `NEXT_PUBLIC_APP_URL` in Vercel (dev + prod)
- [ ] Verify sender domain in Resend
- [ ] Merge → Vercel deploys
