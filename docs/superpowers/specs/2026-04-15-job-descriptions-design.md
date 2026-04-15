# Job Descriptions — Design Doc

**Date:** 2026-04-15
**Status:** Draft for review
**Source PRD:** `/Users/daniele/Downloads/job-description-prd.pdf`

## 1. Overview

Introduce a new `JobDescription` entity (JD) that organizations use to describe open roles. The dashboard then computes a **live match** between the JD and the organization's candidate pool (fetched from Make.com), ranking candidates by a 0–100 score derived from skills, description, and location.

Out of scope (per PRD): migrating the candidate DB to Supabase, vector DB / semantic search infrastructure.

## 2. Data Model (PostgreSQL / Prisma)

```prisma
model JobDescription {
  id             String   @id @default(uuid())
  organizationId String
  createdByUserId String
  name           String
  // Structured location — stored in canonical form after user input is resolved
  // against the Italian administrative hierarchy (see §6).
  locationRaw       String        // what the user typed
  locationMunicipality String?   // canonical comune name, if resolved
  locationProvince     String?   // canonical provincia name
  locationRegion       String?   // canonical regione name
  description    String        @db.Text
  skills         String[]      // Postgres text[] — simple and enough for Phase 1
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  organization   Organization  @relation(fields: [organizationId], references: [id])
  createdBy      User          @relation(fields: [createdByUserId], references: [id])

  @@unique([organizationId, name])
  @@index([organizationId, createdAt])
}
```

**Why `String[]` instead of a separate Skill table?**
Skills on a JD are free-form tags with no cross-entity relations in Phase 1. A Postgres text array keeps queries simple. If we later add skill taxonomies or matching across organizations, we migrate to `JobDescriptionSkill`. YAGNI for now.

**Uniqueness (confirmed 2026-04-15):** `@@unique([organizationId, name])` — JD names are unique within an organization. Enforced at the DB layer and mirrored in the form validation with a friendly error message.

**Why three separate location columns plus `locationRaw`?**
Matching needs the hierarchy resolved at write time (§6). Storing all three lets us query/filter without re-resolving on every match. `locationRaw` preserves the original user input for display and in case the resolver misses.

**Relation updates on existing models:**
```prisma
model Organization {
  // ...existing fields
  jobDescriptions JobDescription[]
}

model User {
  // ...existing fields
  jobDescriptions JobDescription[]
}
```

### Permissions (enforced at query layer, consistent with existing code)

| Role          | List (own org) | View (own org) | Create/Edit/Delete | View all orgs |
|---------------|----------------|----------------|---------------------|----------------|
| `ORG_MEMBER`  | ✓              | ✓              | ✗                   | ✗              |
| `ORG_ADMIN`   | ✓              | ✓              | ✓                   | ✗              |
| `ADMIN_KUBRI` | ✓              | ✓              | (via Kubri admin)   | ✓              |

Every query includes `where: { organizationId: session.user.organizationId }` except the `ADMIN_KUBRI` cross-org view. Role checks live in the server-side page/action layer. This follows the existing Kubri rule (CLAUDE.md §Security).

**Audit logging:** every create/edit/delete writes an `AuditLog` row (`resourceType: "JobDescription"`).

## 3. UI Flows

URL scheme: `/dashboard/jobs/*` (shorter than `job-descriptions`; Italian labels in UI).

Sidebar gets a new entry: **"Offerte di lavoro"** (`Briefcase` icon from lucide-react).

### 3.1 List view — `/dashboard/jobs`

Server Component. Renders a card grid or table of the org's JDs:

| Nome | Località | Competenze | Creata il | Azioni |

- Empty state: "Nessuna offerta di lavoro" + CTA button.
- Primary CTA: **"+ Aggiungi offerta"** (top-right of the list page). Visible only to `ORG_ADMIN`.
- Clicking a row → detail page.
- **Global CTA:** the existing button in `src/components/layout/header.tsx:27-33` stays (confirmed 2026-04-15). It gets uncommented and wired to navigate to `/dashboard/jobs/new`, visible globally for `ORG_ADMIN`. The list-page CTA is redundant when the header button is visible; to avoid duplication, we render the list-page button only in the empty state. Non-admins see neither button.

### 3.2 Create form — `/dashboard/jobs/new`

Server Action. `ORG_ADMIN` only.

Form fields:
- **Nome** (required, text input)
- **Località** (required, autocomplete/combobox backed by the Italian admin dataset — see §6)
- **Descrizione** (required, textarea, ≥ 20 chars)
- **Competenze** (tag input: type a skill, press Enter to add a chip; remove with `x`)

Validation: Zod schema (`src/lib/validations/job-description.ts`). On submit: server action → Prisma insert → `revalidatePath("/dashboard/jobs")` → redirect to detail page.

### 3.3 Detail + Match view — `/dashboard/jobs/[id]`

Server Component renders:

**Header**
- JD name, location, createdAt, createdBy name.
- For `ORG_ADMIN`: **Modifica** and **Elimina** buttons.

**JD body**
- Description paragraph.
- Skills rendered as `<Badge>` chips.

**Match results (live)**
- Suspense boundary — matches load in parallel with the JD body.
- Server side: fetch candidates via `getCandidatesForOrg(orgId)` (existing cache layer) → compute match score for each → sort descending → take top N (default 50) → render table.

Table columns: `Candidato | Località preferita | Competenze (top 3) | Score | Azione`.
- Score rendered as "87%" with a colored bar (green ≥ 70, amber 40–69, gray < 40).
- Row click → candidate detail (preserving "came from JD" context for back navigation).

**"Ricalcola"** button (top-right of the match section) — invalidates the Make cache for the org and re-renders.

**Empty state:** "Nessun candidato supera la soglia minima di corrispondenza." Low-match fallback: show top 10 regardless of threshold, marked `Bassa corrispondenza`.

### 3.4 Edit — `/dashboard/jobs/[id]/edit`

Same form as create, pre-filled. Server Action updates the record. `ORG_ADMIN` only.

### 3.5 Delete

Confirmation `Dialog` on detail page. Soft delete would complicate cross-org audit but provide recoverability — **decision: hard delete** for Phase 1 since we're not persisting any downstream match data. Audit log captures the deletion event.

### 3.6 Kubri admin view — `/admin/jobs`

`ADMIN_KUBRI` only. Table of every JD across all orgs with an `Organizzazione` column. No create/edit/delete from here — read-only oversight.

## 4. Match Computation (Live)

Pipeline per request to the JD detail page:

```
1. Load JD from PostgreSQL (includes resolved location tuple + skills[] + description).
2. Call getCandidatesForOrg(orgId) — hits the existing Make.com cache layer
   (60s TTL list cache in src/lib/make/cache.ts).
3. Normalize candidate records (already handled by src/lib/make/normalize.ts).
4. For each candidate, compute:
      skillsScore        ∈ [0, 1]
      descriptionScore   ∈ [0, 1]
      locationScore      ∈ [0, 1]
   final = round(100 * (0.40*skillsScore + 0.30*descriptionScore + 0.30*locationScore))
5. Filter: drop candidates with final < 30 (default threshold). Fallback rule in §3.3.
6. Sort descending by final score. Return top 50.
```

All scoring is pure TypeScript in `src/lib/jobs/matcher/`. No external service. No new DB round trips.

**Performance:** With the Make cache warm, a match over ~500 candidates runs in well under 100 ms (token-set ops are O(n·k) where k is the per-candidate token count, ~30). No parallelism needed.

## 5. Skills + Description Matching — options

The PRD's acid test: JD says "Cleaning Staff" → candidate has experience "cleaning operator" → must connect. Three approaches:

### Option A — Lexical + Italian synonym dictionary *(recommended for v1)*

1. Normalize text: lowercase, strip accents, remove Italian stopwords.
2. Light stemming via `snowball-stemmer` (Italian). `pulizie` / `pulire` / `pulizia` → same stem.
3. Optional bilingual synonym map (~200 entries) for common Italian ↔ English job terms we see in the Make data: `cleaning staff ↔ addetto pulizie`, `warehouse worker ↔ magazziniere`, `waiter ↔ cameriere`.
4. **Skills score** = Jaccard(JD skill tokens, candidate skill tokens ∪ work experience tokens ∪ desired job tokens).
5. **Description score** = weighted token overlap: for each JD description token, 1.0 if it appears in the candidate's combined text, scaled by IDF to downweight filler words.

Pros: zero API cost, deterministic, fast, offline-friendly. Good enough for most cases in the PRD example.
Cons: misses paraphrase unless the synonym dictionary covers it. Doesn't understand context ("experienced manager of cleaners" ≠ "cleaner").

### Option B — Embeddings on the fly

1. Use `text-embedding-3-small` (OpenAI) or an equivalent small model.
2. Embed JD (once per match) + each candidate's combined profile.
3. Cosine similarity → skills+description score.

Pros: handles paraphrase and cross-language semantic closeness natively. Higher ceiling for "feels intelligent".
Cons: external API dependency + key management, per-match cost (~$0.01 per match over 500 candidates, lower if we cache candidate embeddings keyed by record hash with the same TTL as the Make cache), latency (~300–800 ms over the cache miss path), nondeterminism across model revisions.

### Option C — LLM-based scoring

Send each (JD, candidate) pair to an LLM asking for a 0–100 score + one-line reason.

Pros: highest perceived intelligence; can explain the match.
Cons: ~500 LLM calls per match view = cost + latency catastrophe without heavy caching/batching. Not fit for "live" without persistence.

### Recommendation

**Start with Option A.** Ship, measure user satisfaction on 5–10 real JDs, then decide whether Option B earns its keep. Option C is a future feature ("Why does this candidate match?" explanation on hover, computed lazily per candidate the user opens).

Wire it so the scoring engine is swappable: `scoreTextual(jd, candidate) -> number` lives behind an interface. A/B between strategies is one import change.

## 6. Location Matching — Italian Hierarchy

### Data source

ISTAT publishes the canonical list of Italian comuni with their province and region (`Elenco dei comuni italiani` CSV, ~8,000 rows, updated ~yearly). We bundle a static JSON/TS file at `src/lib/geo/italy-admin.ts`:

```ts
export const ITALY_LOCATIONS: {
  municipality: string;
  province: string;     // e.g. "Milano"
  provinceCode: string; // "MI"
  region: string;       // "Lombardia"
}[]
```

Plus a normalized lookup index keyed by `normalize(name)` (lowercase + strip accents + collapse whitespace). Size: ~600 KB JSON, negligible for a Next.js bundle (server-only import).

### Resolver

```ts
resolveLocation(input: string): {
  municipality?: string;
  province?: string;
  region?: string;
  confidence: "exact" | "partial" | "none";
}
```

Resolution order:
1. Exact match on `municipality` → fill {municipality, province, region}, confidence `exact`.
2. Exact match on `province` → {province, region}, `exact`.
3. Exact match on `region` → {region}, `exact`.
4. Fuzzy (Levenshtein ≤ 2) → `partial`.
5. No match → `none`, store `locationRaw` only.

Called when the user saves the JD form, so the canonical tuple is persisted.

### Matching a candidate

The candidate's relevant fields (from `src/types/index.ts`):
- `address` (free text, where the candidate lives)
- `jobPreferences.preferredLocation` (free text, where they want to work)

Candidate's preferences are resolved with the same resolver, on the fly, per match call. (They're free-text on Make.com; we don't get to persist back.)

### Score

| Candidate level resolved against JD level | Score |
|-------------------------------------------|-------|
| Same municipality                         | 1.00  |
| Same province                             | 0.80  |
| Same region                               | 0.60  |
| Different region                          | 0.00  |
| Either side unresolved                    | 0.50  |

Rationale:
- Asymmetry: a candidate who said "Lombardia" is a valid match for a JD in "Milano" → 0.60 (same region). A candidate in "Milano" is fully a match for a JD in "Lombardia" → also 0.60. Both are scored at the coarsest overlap level.
- Unresolved → 0.50 (neutral) rather than 0.00 (penalizing missing data too aggressively hides viable candidates). We expose this explicitly in the match breakdown UI.

### Candidate's home vs. preference

Default: use `jobPreferences.preferredLocation` if present, else fall back to `address`. Rationale: preferences trump current address.

## 7. Scoring formula

```
finalScore = round(100 * (
  0.40 * skillsScore
+ 0.30 * descriptionScore
+ 0.30 * locationScore
))
```

- **Weights** chosen to reflect product intent: skills are the primary discriminator, location and description tied for secondary. These become configurable constants in `src/lib/jobs/matcher/config.ts` — easy to tune after early user feedback.
- **Threshold for display:** 30 (configurable). Below it, candidates don't appear unless the fallback rule in §3.3 kicks in.
- **Each sub-score's derivation** is captured so the detail page can show a breakdown on row-hover: "Skills 72% · Description 55% · Location 100%". Helps users understand why someone ranked high.

## 8. Files & modules

New code lives under clear boundaries:

```
src/
  app/(dashboard)/dashboard/jobs/
    page.tsx                          # list
    new/page.tsx                      # create form
    [id]/page.tsx                     # detail + match
    [id]/edit/page.tsx                # edit form
    [id]/actions.ts                   # server actions (update, delete)
  app/(admin)/admin/jobs/
    page.tsx                          # cross-org list
  components/jobs/
    job-form.tsx                      # shared create/edit client component
    job-list.tsx
    job-match-table.tsx               # client component for sortable score table
    skills-input.tsx                  # tag/chip input
    location-combobox.tsx             # autocomplete against ITALY_LOCATIONS
  lib/jobs/
    service.ts                        # CRUD + list, always filters by orgId
    matcher/
      index.ts                        # computeMatch(jd, candidate) -> { final, breakdown }
      skills.ts                       # skillsScore
      description.ts                  # descriptionScore
      location.ts                     # locationScore
      tokens.ts                       # normalize/stem/tokenize
      synonyms.ts                     # Italian ↔ English synonym dictionary
      config.ts                       # weights, thresholds
  lib/geo/
    italy-admin.ts                    # static dataset
    resolve.ts                        # resolveLocation
  lib/validations/
    job-description.ts                # Zod schemas
```

Prisma:
- `prisma/schema.prisma` — new model, relations.
- `prisma/migrations/<timestamp>_add_job_descriptions/` — migration.

Tests (unit, Vitest):
- `__tests__/lib/jobs/matcher/skills.test.ts`
- `__tests__/lib/jobs/matcher/description.test.ts`
- `__tests__/lib/jobs/matcher/location.test.ts`
- `__tests__/lib/jobs/matcher/index.test.ts` — end-to-end on the PRD's "Cleaning Staff" example.
- `__tests__/lib/geo/resolve.test.ts`

## 9. Resolved decisions & remaining recommendations

**Decisions locked in on 2026-04-15 (user review):**

- **A — JD name unique per organization:** confirmed. Enforced via `@@unique([organizationId, name])` + form-level validation (§2).
- **B — Free-form skill tags (no shared taxonomy):** confirmed.
- **C — Single location per JD:** confirmed for Phase 1. Multi-location ("Milano OR Torino") is a known future requirement — out of scope now, noted in §10.
- **D — Start with lexical matching (Option A); embeddings are a follow-up:** confirmed.
- **E — Match weights 40 / 30 / 30 (skills / description / location):** confirmed as starting defaults.
- **F — Threshold 30% + fallback to top 10:** confirmed.
- **G — Hard delete + audit log (no soft delete):** confirmed.
- **H — Bundle ISTAT admin dataset as a server-only static file:** confirmed.
- **I — `ADMIN_KUBRI` view is read-only:** confirmed. Note: `ADMIN_KUBRI` will become org-agnostic in the future; current schema keeps the role attached to an organization, which is acceptable for now.
- **J — Keep the header button:** confirmed. `src/components/layout/header.tsx:27-33` gets uncommented, wired, and role-gated (§3.1).



### 9.1 Should we migrate the candidate DB from Make.com to Supabase?

**Recommendation: no, not for this feature.** The live match works fine over the existing Make.com cache layer. Candidates counts per org are small enough (hundreds to low thousands) that live computation is trivial. The PRD lists this migration as a non-goal for a reason — doing it now couples two large pieces of work and blocks shipping.

**When to reconsider:** if per-org candidate counts cross ~10k, if we need server-side filtering/search that Make.com can't do efficiently, or if Make.com rate limits bite us.

### 9.2 Should we persist/cache match results?

**Recommendation: no.** Two reasons:
- The input data (candidates) already has a 60s cache. Matching is CPU-cheap. Caching match output adds invalidation complexity without saving much.
- Persisting match scores would mean either recomputing them on every candidate update (we don't own those updates) or letting them go stale (contradicting the PRD's "live" requirement).

**One narrow caching case** worth considering: if we go with Option B (embeddings), candidate embeddings must be cached per record hash — otherwise we'd pay ~$0.01 per JD page load. That's embedding caching, not match caching. Different thing.

### 9.3 Known risks / unknowns

- **Candidate location field quality** — `jobPreferences.preferredLocation` is free text filled by the chatbot. Some real values may be non-Italian, misspelled, or ambiguous ("Nord Italia", "vicino Milano"). The resolver returns `none` gracefully (score = 0.50 neutral), but we should review a sample of real values before finalizing the scoring curve.
- **Skill dictionary coverage** — if the real candidate skills in Make.com are in Italian and the JDs often in English (or vice versa), a light synonym dictionary might need 100–300 entries to feel intelligent. Plan accounts for this but the work is real.
- **Pagination of candidates from Make.com** — the current `getCandidatesForOrg` fetches everything. At scale we'd want streamed matching. Not a Phase 1 concern.

## 10. Out of scope for this spec

- **Multi-location JDs** ("Milano OR Torino"). Known future requirement; will require a location join table or JSON array column.
- Persisting "applied" / "shortlisted" state against a JD (i.e., candidate pipelines). Future feature.
- JD-to-JD duplication detection or a template library.
- Explaining the match with LLM-generated narrative ("Why does this candidate fit?").
- External publishing of JDs (posting to job boards, public pages).
- WhatsApp Business integration as a source channel (Phase 2 per CLAUDE.md).
- Detaching `ADMIN_KUBRI` from any specific organization. Known future change; role stays org-bound for now.

---

**Status:** design approved 2026-04-15 (A–J resolved in §9). Next step: step-by-step implementation plan via the `writing-plans` skill.
