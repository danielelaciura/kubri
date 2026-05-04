# Location Proximity Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a proximity-based location filter to the candidates page (place picker + radius slider) and a `searchRadiusKm` field on Job Descriptions, all backed by the local `ITALY_ADMIN` table extended with lat/lng coordinates.

**Architecture:** Static dataset only — extend `ITALY_ADMIN` rows with coordinates regenerated from a public JSON source (Italian comuni). Proximity filtering for candidates happens application-side via haversine distance over the cached candidate list. JDs persist a default radius integer column; centers are resolved at runtime from the existing `locationMunicipality/Province/Region` strings. No external geocoding API.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma, Zod, shadcn/ui (new `Slider`), Vitest.

**Reference spec:** `docs/superpowers/specs/2026-05-01-location-proximity-filter-design.md`

---

## File Structure

**Create:**
- `src/lib/geo/constants.ts` — radius constants
- `src/lib/geo/proximity.ts` — haversine, place→coords resolver, filterByRadius
- `src/components/shared/location-combobox.tsx` — moved from `components/jobs/`
- `src/components/ui/slider.tsx` — shadcn slider wrapper
- `src/__tests__/lib/geo/proximity.test.ts`
- `src/__tests__/lib/geo/italy-admin.test.ts`
- `prisma/migrations/<timestamp>_add_jd_search_radius/migration.sql`

**Modify:**
- `scripts/build-italy-admin.ts` — fetch lat/lng + emit them
- `src/lib/geo/italy-admin.ts` — regenerated with `latitude`/`longitude` fields
- `src/lib/geo/resolve.ts` — `Indices` consumers may keep working unchanged
- `prisma/schema.prisma` — add `searchRadiusKm`
- `src/lib/validations/job-description.ts` — add `searchRadiusKm`
- `src/lib/jobs/service.ts` — pass `searchRadiusKm` through
- `src/app/(dashboard)/dashboard/jobs/actions.ts` — read field from FormData
- `src/app/(dashboard)/dashboard/jobs/[id]/actions.ts` — read field from FormData
- `src/components/jobs/job-form.tsx` — slider + new prop, replace import path
- `src/app/(dashboard)/dashboard/jobs/[id]/edit/page.tsx` — pass `searchRadiusKm` initial
- `src/app/(dashboard)/dashboard/jobs/[id]/page.tsx` — show "· N km"
- `src/types/index.ts` — extend `CandidateFilters`
- `src/lib/validations/candidate-filters.ts` — add `nearPlace` + `radiusKm`
- `src/lib/candidates/filter.ts` — apply proximity in `filterCandidates`
- `src/components/candidates/candidate-filters.tsx` — new "Vicino a..." block
- `src/app/(dashboard)/dashboard/candidates/page.tsx` — pass new params (no logic change beyond schema)
- `src/__tests__/lib/jobs/service.test.ts`
- `src/__tests__/lib/validations/job-description.test.ts`
- `src/__tests__/lib/candidates/filter.test.ts`
- `package.json` — `@radix-ui/react-slider` dep

---

## Task 1: Install shadcn `Slider` primitive

**Files:**
- Modify: `package.json`
- Create: `src/components/ui/slider.tsx`

- [ ] **Step 1: Add radix slider dependency**

```bash
pnpm add @radix-ui/react-slider
```

- [ ] **Step 2: Create the shadcn-style Slider wrapper**

Create `src/components/ui/slider.tsx`:

```tsx
"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
```

- [ ] **Step 3: Verify build still passes**

Run: `pnpm tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/components/ui/slider.tsx
git commit -m "feat(ui): add shadcn Slider primitive"
```

---

## Task 2: Update `build-italy-admin.ts` to emit coordinates

We join two public datasets:

- **`matteocontrini/comuni-json`** — provides clean canonical names (`nome`, `regione.nome`, `provincia.nome`, `sigla`) keyed on a 6-digit ISTAT code (`codice`, e.g. `"028001"` for Abano Terme = province `028` + comune `001`). No coordinates.
- **`avalla/coordinate-comuni-italiani`** — provides `lat`/`lng` keyed on `codice_prov_istat` + `codice_comu_istat` (3+3 digits, concatenated = the same 6-digit ISTAT code).

The build script fetches both, joins them, and emits `italy-admin.ts` with the existing fields plus `latitude` and `longitude`.

**Files:**
- Modify: `scripts/build-italy-admin.ts`

- [ ] **Step 1: Rewrite the build script**

Replace the entire contents of `scripts/build-italy-admin.ts` with:

```ts
/**
 * One-shot builder: joins matteocontrini/comuni-json (canonical names) with
 * avalla/coordinate-comuni-italiani (lat/lng) on the 6-digit ISTAT code,
 * and emits src/lib/geo/italy-admin.ts.
 *
 * Run: pnpm tsx scripts/build-italy-admin.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const NAMES_URL =
  "https://raw.githubusercontent.com/matteocontrini/comuni-json/master/comuni.json";
const COORDS_URL =
  "https://raw.githubusercontent.com/avalla/coordinate-comuni-italiani/master/comuni.json";

interface NameRow {
  nome: string;
  codice: string; // 6 digits, e.g. "028001"
  sigla: string;
  regione: { nome: string };
  provincia: { nome: string };
}

interface CoordRow {
  codice_prov_istat: string; // 3 digits
  codice_comu_istat: string; // 3 digits
  lat: number;
  lng: number;
}

interface Row {
  municipality: string;
  province: string;
  provinceCode: string;
  region: string;
  latitude: number;
  longitude: number;
}

function pad3(s: string): string {
  return s.padStart(3, "0");
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed for ${url}: ${res.status}`);
  return (await res.json()) as T;
}

async function main() {
  const [names, coords] = await Promise.all([
    fetchJson<NameRow[]>(NAMES_URL),
    fetchJson<CoordRow[]>(COORDS_URL),
  ]);
  if (!Array.isArray(names) || names.length < 7000) {
    throw new Error(`Too few name rows: ${names.length}`);
  }
  if (!Array.isArray(coords) || coords.length < 7000) {
    throw new Error(`Too few coord rows: ${coords.length}`);
  }

  // Index coords by 6-digit ISTAT code: codice_prov_istat (padded to 3) +
  // codice_comu_istat (padded to 3).
  const coordIndex = new Map<string, { lat: number; lng: number }>();
  for (const c of coords) {
    const key = pad3(c.codice_prov_istat) + pad3(c.codice_comu_istat);
    coordIndex.set(key, { lat: c.lat, lng: c.lng });
  }

  const rows: Row[] = [];
  const missing: string[] = [];
  for (const n of names) {
    const c = coordIndex.get(n.codice);
    if (!c) {
      missing.push(`${n.nome} (${n.codice})`);
      continue;
    }
    rows.push({
      municipality: n.nome,
      province: n.provincia.nome,
      provinceCode: n.sigla,
      region: n.regione.nome,
      latitude: c.lat,
      longitude: c.lng,
    });
  }

  // Acceptable miss rate: <1% (avalla can lag on recent comune mergers).
  if (missing.length > names.length * 0.01) {
    throw new Error(
      `Too many comuni missing coords (${missing.length}/${names.length}). Sample: ${missing.slice(0, 10).join(", ")}`,
    );
  }
  if (missing.length > 0) {
    console.warn(`Skipped ${missing.length} comuni without coords: ${missing.slice(0, 5).join(", ")}...`);
  }

  // Sanity check: every emitted row has finite coords in valid range.
  for (const r of rows) {
    if (
      !Number.isFinite(r.latitude) ||
      !Number.isFinite(r.longitude) ||
      r.latitude < -90 ||
      r.latitude > 90 ||
      r.longitude < -180 ||
      r.longitude > 180
    ) {
      throw new Error(`Invalid coords for ${r.municipality}: ${r.latitude},${r.longitude}`);
    }
  }

  const file = `// AUTO-GENERATED by scripts/build-italy-admin.ts — do not edit manually.
export interface ItalyAdminRow {
  municipality: string;
  province: string;
  provinceCode: string;
  region: string;
  latitude: number;
  longitude: number;
}

export const ITALY_ADMIN: readonly ItalyAdminRow[] = ${JSON.stringify(rows, null, 2)} as const;
`;
  const out = resolve(process.cwd(), "src/lib/geo/italy-admin.ts");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, file, "utf8");
  console.log(`Wrote ${rows.length} rows to ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Regenerate the dataset**

Run: `pnpm tsx scripts/build-italy-admin.ts`
Expected: `Wrote ~7900 rows to .../italy-admin.ts`

- [ ] **Step 3: Spot-check the regenerated file**

Run: `head -25 src/lib/geo/italy-admin.ts`
Expected: each row has `latitude` and `longitude` numeric fields. The exported `ItalyAdminRow` interface includes them.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-italy-admin.ts src/lib/geo/italy-admin.ts
git commit -m "feat(geo): add lat/lng to ITALY_ADMIN dataset"
```

---

## Task 3: Add `geo/constants.ts`

**Files:**
- Create: `src/lib/geo/constants.ts`

- [ ] **Step 1: Write the constants module**

```ts
export const DEFAULT_SEARCH_RADIUS_KM = 25;
export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 200;
export const RADIUS_STEP_KM = 5;
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/geo/constants.ts
git commit -m "feat(geo): add radius constants"
```

---

## Task 4: Sanity test for `ITALY_ADMIN`

**Files:**
- Create: `src/__tests__/lib/geo/italy-admin.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { ITALY_ADMIN } from "@/lib/geo/italy-admin";

describe("ITALY_ADMIN dataset", () => {
  it("contains a sensible number of municipalities", () => {
    expect(ITALY_ADMIN.length).toBeGreaterThan(7000);
  });

  it("every row has valid coordinates", () => {
    for (const row of ITALY_ADMIN) {
      expect(Number.isFinite(row.latitude)).toBe(true);
      expect(Number.isFinite(row.longitude)).toBe(true);
      expect(row.latitude).toBeGreaterThanOrEqual(35);
      expect(row.latitude).toBeLessThanOrEqual(48);
      expect(row.longitude).toBeGreaterThanOrEqual(6);
      expect(row.longitude).toBeLessThanOrEqual(19);
    }
  });

  it("has no duplicate (municipality, province) pairs", () => {
    const seen = new Set<string>();
    for (const row of ITALY_ADMIN) {
      const key = `${row.municipality}|${row.province}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("includes well-known municipalities", () => {
    const milano = ITALY_ADMIN.find((r) => r.municipality === "Milano");
    expect(milano).toBeDefined();
    expect(milano!.region).toBe("Lombardia");
    expect(milano!.latitude).toBeCloseTo(45.46, 1);
    expect(milano!.longitude).toBeCloseTo(9.19, 1);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test src/__tests__/lib/geo/italy-admin.test.ts`
Expected: PASS (all four tests).

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/lib/geo/italy-admin.test.ts
git commit -m "test(geo): sanity-check ITALY_ADMIN dataset"
```

---

## Task 5: Implement `proximity.ts` — haversine + filter

**Files:**
- Create: `src/lib/geo/proximity.ts`
- Create: `src/__tests__/lib/geo/proximity.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/lib/geo/proximity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  haversineKm,
  filterByRadius,
  resolvePlaceCoords,
} from "@/lib/geo/proximity";

const MILANO = { latitude: 45.4642, longitude: 9.19 };
const ROMA = { latitude: 41.9028, longitude: 12.4964 };

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm(MILANO, MILANO)).toBeCloseTo(0, 5);
  });

  it("computes Milano to Roma ≈ 477 km", () => {
    expect(haversineKm(MILANO, ROMA)).toBeGreaterThan(470);
    expect(haversineKm(MILANO, ROMA)).toBeLessThan(485);
  });

  it("is symmetric", () => {
    expect(haversineKm(MILANO, ROMA)).toBeCloseTo(haversineKm(ROMA, MILANO), 5);
  });
});

describe("filterByRadius", () => {
  const items = [
    { id: "a", latitude: 45.4642, longitude: 9.19 }, // Milano
    { id: "b", latitude: 45.07, longitude: 7.69 }, // Torino
    { id: "c", latitude: 41.9, longitude: 12.5 }, // Roma
    { id: "d", latitude: null, longitude: null },
  ];

  it("includes only items within the radius", () => {
    const r = filterByRadius(items, MILANO, 30);
    expect(r.map((i) => i.id)).toEqual(["a"]);
  });

  it("includes Torino at 150 km", () => {
    const r = filterByRadius(items, MILANO, 150);
    expect(r.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("excludes items with null coordinates", () => {
    const r = filterByRadius(items, MILANO, 10000);
    expect(r.map((i) => i.id)).not.toContain("d");
  });
});

describe("resolvePlaceCoords", () => {
  it("resolves a known municipality", () => {
    const r = resolvePlaceCoords("Milano");
    expect(r).not.toBeNull();
    expect(r!.latitude).toBeCloseTo(45.46, 1);
  });

  it("is case- and diacritics-insensitive", () => {
    expect(resolvePlaceCoords("milano")).not.toBeNull();
    expect(resolvePlaceCoords("MILANO")).not.toBeNull();
  });

  it("resolves a known province", () => {
    const r = resolvePlaceCoords("Torino");
    expect(r).not.toBeNull();
  });

  it("resolves a known region", () => {
    const r = resolvePlaceCoords("Lombardia");
    expect(r).not.toBeNull();
  });

  it("returns null for unknown places", () => {
    expect(resolvePlaceCoords("Nowhereville")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(resolvePlaceCoords("")).toBeNull();
    expect(resolvePlaceCoords("   ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm test src/__tests__/lib/geo/proximity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `proximity.ts`**

Create `src/lib/geo/proximity.ts`:

```ts
import { ITALY_ADMIN, type ItalyAdminRow } from "./italy-admin";
import { normalizePlace } from "./resolve";

export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface PlaceIndex {
  byMunicipality: Map<string, ItalyAdminRow>;
  byProvince: Map<string, LatLng>;
  byRegion: Map<string, LatLng>;
}

function meanLatLng(rows: ItalyAdminRow[]): LatLng {
  let lat = 0;
  let lon = 0;
  for (const r of rows) {
    lat += r.latitude;
    lon += r.longitude;
  }
  return { latitude: lat / rows.length, longitude: lon / rows.length };
}

let _index: PlaceIndex | null = null;
function index(): PlaceIndex {
  if (_index) return _index;
  const byMunicipality = new Map<string, ItalyAdminRow>();
  const byProvinceRows = new Map<string, ItalyAdminRow[]>();
  const byRegionRows = new Map<string, ItalyAdminRow[]>();
  for (const row of ITALY_ADMIN) {
    byMunicipality.set(normalizePlace(row.municipality), row);
    const pKey = normalizePlace(row.province);
    const rKey = normalizePlace(row.region);
    if (!byProvinceRows.has(pKey)) byProvinceRows.set(pKey, []);
    if (!byRegionRows.has(rKey)) byRegionRows.set(rKey, []);
    byProvinceRows.get(pKey)!.push(row);
    byRegionRows.get(rKey)!.push(row);
  }
  const byProvince = new Map<string, LatLng>();
  for (const [k, rows] of byProvinceRows) byProvince.set(k, meanLatLng(rows));
  const byRegion = new Map<string, LatLng>();
  for (const [k, rows] of byRegionRows) byRegion.set(k, meanLatLng(rows));
  _index = { byMunicipality, byProvince, byRegion };
  return _index;
}

export function resolvePlaceCoords(label: string): LatLng | null {
  const key = normalizePlace(label);
  if (!key) return null;
  const idx = index();
  const m = idx.byMunicipality.get(key);
  if (m) return { latitude: m.latitude, longitude: m.longitude };
  const p = idx.byProvince.get(key);
  if (p) return p;
  const r = idx.byRegion.get(key);
  if (r) return r;
  return null;
}

export function filterByRadius<
  T extends { latitude: number | null; longitude: number | null },
>(items: T[], center: LatLng, radiusKm: number): T[] {
  return items.filter((item) => {
    if (item.latitude == null || item.longitude == null) return false;
    return (
      haversineKm(
        { latitude: item.latitude, longitude: item.longitude },
        center,
      ) <= radiusKm
    );
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test src/__tests__/lib/geo/proximity.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo/proximity.ts src/__tests__/lib/geo/proximity.test.ts
git commit -m "feat(geo): add haversine, filterByRadius, resolvePlaceCoords"
```

---

## Task 6: Move `LocationCombobox` to `components/shared/`

**Files:**
- Create: `src/components/shared/location-combobox.tsx`
- Modify: `src/components/jobs/job-form.tsx`
- Delete: `src/components/jobs/location-combobox.tsx`

- [ ] **Step 1: Create the shared file (copy of the existing one)**

Copy the full contents of `src/components/jobs/location-combobox.tsx` into `src/components/shared/location-combobox.tsx`. The contents are unchanged — only the path changes. (Use Read on the original then Write to the new path.)

- [ ] **Step 2: Update the import in `job-form.tsx`**

In `src/components/jobs/job-form.tsx`, change:
```ts
import { LocationCombobox } from "./location-combobox";
```
to:
```ts
import { LocationCombobox } from "@/components/shared/location-combobox";
```

- [ ] **Step 3: Delete the old file**

```bash
git rm src/components/jobs/location-combobox.tsx
```

- [ ] **Step 4: Verify build/tests**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: no errors, tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/location-combobox.tsx src/components/jobs/job-form.tsx
git commit -m "refactor(ui): move LocationCombobox to components/shared"
```

---

## Task 7: Prisma migration — add `searchRadiusKm` to `JobDescription`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_add_jd_search_radius/migration.sql` (generated)

- [ ] **Step 1: Update the schema**

In `prisma/schema.prisma`, inside `model JobDescription`, add (right after `skills`):

```prisma
  searchRadiusKm       Int      @default(25)
```

- [ ] **Step 2: Create + apply the migration in dev**

Run: `pnpm prisma migrate dev --name add_jd_search_radius`
Expected: migration created and applied; Prisma client regenerated.

- [ ] **Step 3: Verify the new column**

Run: `pnpm prisma migrate status`
Expected: "Database schema is up to date".

- [ ] **Step 4: Commit (do NOT apply to prod yet — that happens pre-merge)**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add JobDescription.searchRadiusKm"
```

---

## Task 8: Validation — add `searchRadiusKm` to JD schema

**Files:**
- Modify: `src/lib/validations/job-description.ts`
- Modify: `src/__tests__/lib/validations/job-description.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `src/__tests__/lib/validations/job-description.test.ts` (inside the existing `describe`):

```ts
  it("defaults searchRadiusKm to 25 when omitted", () => {
    const r = jobDescriptionInputSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.searchRadiusKm).toBe(25);
  });

  it("accepts a custom searchRadiusKm in range", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, searchRadiusKm: 50 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.searchRadiusKm).toBe(50);
  });

  it("coerces searchRadiusKm from string", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, searchRadiusKm: "75" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.searchRadiusKm).toBe(75);
  });

  it("rejects searchRadiusKm below MIN_RADIUS_KM", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, searchRadiusKm: 0 });
    expect(r.success).toBe(false);
  });

  it("rejects searchRadiusKm above MAX_RADIUS_KM", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, searchRadiusKm: 201 });
    expect(r.success).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test src/__tests__/lib/validations/job-description.test.ts`
Expected: FAIL — `searchRadiusKm` not in schema.

- [ ] **Step 3: Update the schema**

Replace `src/lib/validations/job-description.ts` with:

```ts
import { z } from "zod/v4";
import {
  DEFAULT_SEARCH_RADIUS_KM,
  MIN_RADIUS_KM,
  MAX_RADIUS_KM,
} from "@/lib/geo/constants";

export const jobDescriptionInputSchema = z.object({
  name: z.string().trim().min(1, "Il nome è obbligatorio").max(120, "Massimo 120 caratteri"),
  locationRaw: z.string().trim().min(1, "La località è obbligatoria").max(120),
  description: z
    .string()
    .trim()
    .min(20, "La descrizione deve contenere almeno 20 caratteri")
    .max(5000),
  skills: z
    .array(z.string())
    .max(30, "Massimo 30 competenze")
    .transform((arr) => arr.map((s) => s.trim()).filter(Boolean)),
  searchRadiusKm: z.coerce
    .number()
    .int()
    .min(MIN_RADIUS_KM, `Il raggio minimo è ${MIN_RADIUS_KM} km`)
    .max(MAX_RADIUS_KM, `Il raggio massimo è ${MAX_RADIUS_KM} km`)
    .default(DEFAULT_SEARCH_RADIUS_KM),
});

export type JobDescriptionInput = z.infer<typeof jobDescriptionInputSchema>;
```

- [ ] **Step 4: Run tests**

Run: `pnpm test src/__tests__/lib/validations/job-description.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/job-description.ts src/__tests__/lib/validations/job-description.test.ts
git commit -m "feat(jd): validate searchRadiusKm input"
```

---

## Task 9: Wire `searchRadiusKm` through service + actions

**Files:**
- Modify: `src/lib/jobs/service.ts`
- Modify: `src/app/(dashboard)/dashboard/jobs/actions.ts`
- Modify: `src/app/(dashboard)/dashboard/jobs/[id]/actions.ts`
- Modify: `src/__tests__/lib/jobs/service.test.ts`

- [ ] **Step 1: Update service test to assert the new field**

In `src/__tests__/lib/jobs/service.test.ts`:

Update `baseInput` to include the new field:
```ts
const baseInput = {
  name: "Addetto pulizie",
  locationRaw: "Milano",
  description: "Cerchiamo personale per pulizie di uffici.",
  skills: ["pulizie"],
  searchRadiusKm: 25,
};
```

Update the `createJobDescription` "resolves location and forwards to Prisma…" assertion to also expect `searchRadiusKm: 25`.

Add a new test:
```ts
  it("forwards a custom searchRadiusKm", async () => {
    mockPrisma.jobDescription.create.mockResolvedValue({ id: "jd-1" });
    await createJobDescription({
      input: { ...baseInput, searchRadiusKm: 75 },
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(mockPrisma.jobDescription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ searchRadiusKm: 75 }),
      }),
    );
  });
```

In the `updateJobDescription` test, also assert `searchRadiusKm: 25` in the `data` object.

- [ ] **Step 2: Update `service.ts` to pass through the field**

In `src/lib/jobs/service.ts`:

`createJobDescription` — extend the `data` block:
```ts
data: {
  organizationId,
  createdByUserId: userId,
  name: input.name,
  description: input.description,
  skills: input.skills,
  searchRadiusKm: input.searchRadiusKm,
  ...resolveAndSpread(input.locationRaw),
},
```

`updateJobDescription` — extend the `data` block:
```ts
data: {
  name: input.name,
  description: input.description,
  skills: input.skills,
  searchRadiusKm: input.searchRadiusKm,
  ...resolveAndSpread(input.locationRaw),
},
```

- [ ] **Step 3: Update `jobs/actions.ts` (create)**

In the `parseInput`-equivalent block of `createJobAction`, change the `safeParse` call to include the field:
```ts
const parsed = jobDescriptionInputSchema.safeParse({
  name: formData.get("name"),
  locationRaw: formData.get("locationRaw"),
  description: formData.get("description"),
  skills,
  searchRadiusKm: formData.get("searchRadiusKm"),
});
```

- [ ] **Step 4: Update `jobs/[id]/actions.ts` (edit)**

In `parseInput()`, do the same:
```ts
return jobDescriptionInputSchema.safeParse({
  name: formData.get("name"),
  locationRaw: formData.get("locationRaw"),
  description: formData.get("description"),
  skills,
  searchRadiusKm: formData.get("searchRadiusKm"),
});
```

- [ ] **Step 5: Run service tests**

Run: `pnpm test src/__tests__/lib/jobs/service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jobs/service.ts src/app/\(dashboard\)/dashboard/jobs/actions.ts src/app/\(dashboard\)/dashboard/jobs/\[id\]/actions.ts src/__tests__/lib/jobs/service.test.ts
git commit -m "feat(jd): persist searchRadiusKm via service + actions"
```

---

## Task 10: JD form — add radius slider

**Files:**
- Modify: `src/components/jobs/job-form.tsx`
- Modify: `src/app/(dashboard)/dashboard/jobs/[id]/edit/page.tsx`
- Modify: `src/lib/i18n/strings.ts` (if it exists — see step below)

- [ ] **Step 1: Check for a strings file entry**

Run: `grep -n "fieldLocation" src/lib/i18n/strings.ts`
Expected: a `jobs.fieldLocation` key exists. If there is a similar pattern for other field labels, add a new key:

In `src/lib/i18n/strings.ts`, inside the `jobs` block, add:
```ts
fieldSearchRadius: "Raggio di ricerca default",
```
If the file uses a different pattern, add a comparable entry. If no strings file exists for jobs, hard-code "Raggio di ricerca default" inline in the form (simpler).

- [ ] **Step 2: Update `JobForm` props + component**

Replace `src/components/jobs/job-form.tsx` with:

```tsx
"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { strings } from "@/lib/i18n/strings";
import { SkillsInput } from "./skills-input";
import { LocationCombobox } from "@/components/shared/location-combobox";
import {
  DEFAULT_SEARCH_RADIUS_KM,
  MIN_RADIUS_KM,
  MAX_RADIUS_KM,
  RADIUS_STEP_KM,
} from "@/lib/geo/constants";

type FormState = { ok: true } | { ok: false; error: string } | null;

interface JobFormProps {
  mode: "create" | "edit";
  initial?: {
    name: string;
    locationRaw: string;
    description: string;
    skills: string[];
    searchRadiusKm: number;
  };
  action: (formData: FormData) => Promise<FormState>;
}

export function JobForm({ mode, initial, action }: JobFormProps) {
  const [skills, setSkills] = useState<string[]>(initial?.skills ?? []);
  const [radius, setRadius] = useState<number>(
    initial?.searchRadiusKm ?? DEFAULT_SEARCH_RADIUS_KM,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    form.set("skills", JSON.stringify(skills));
    form.set("searchRadiusKm", String(radius));
    startTransition(async () => {
      const result = await action(form);
      if (result && result.ok === false) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-2xl">
      <div className="space-y-2">
        <Label htmlFor="name">{strings.jobs.fieldName}</Label>
        <Input
          id="name"
          name="name"
          defaultValue={initial?.name}
          required
          maxLength={120}
          className="bg-white"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="locationRaw">{strings.jobs.fieldLocation}</Label>
        <LocationCombobox
          name="locationRaw"
          defaultValue={initial?.locationRaw ?? ""}
          placeholder="es. Milano, Lombardia"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="searchRadiusKm">Raggio di ricerca default</Label>
          <span className="text-sm text-muted-foreground">{radius} km</span>
        </div>
        <Slider
          id="searchRadiusKm"
          min={MIN_RADIUS_KM}
          max={MAX_RADIUS_KM}
          step={RADIUS_STEP_KM}
          value={[radius]}
          onValueChange={(v) => setRadius(v[0] ?? DEFAULT_SEARCH_RADIUS_KM)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">{strings.jobs.fieldDescription}</Label>
        <Textarea
          id="description"
          name="description"
          defaultValue={initial?.description}
          rows={8}
          minLength={20}
          maxLength={5000}
          className="bg-white"
          required
        />
      </div>

      <div className="space-y-2">
        <Label>{strings.jobs.fieldSkills}</Label>
        <SkillsInput value={skills} onChange={setSkills} />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {mode === "create" ? strings.jobs.createButton : strings.jobs.updateButton}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {strings.common.cancel}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Update edit page to pass `searchRadiusKm` initial**

In `src/app/(dashboard)/dashboard/jobs/[id]/edit/page.tsx`, change the `initial` object to:

```ts
initial={{
  name: jd.name,
  locationRaw: jd.locationRaw,
  description: jd.description,
  skills: jd.skills,
  searchRadiusKm: jd.searchRadiusKm,
}}
```

- [ ] **Step 4: Run typecheck + tests**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/jobs/job-form.tsx src/app/\(dashboard\)/dashboard/jobs/\[id\]/edit/page.tsx
git commit -m "feat(jd): radius slider in job form"
```

---

## Task 11: JD detail page — show "· N km"

**Files:**
- Modify: `src/app/(dashboard)/dashboard/jobs/[id]/page.tsx`

- [ ] **Step 1: Update the location header**

Locate the `<span>` that renders `{jd.locationRaw}` and the conditional `· {jd.locationRegion}`. Append the radius:

```tsx
<span className="font-medium mt-md">
  {jd.locationRaw}
  {jd.locationRegion && jd.locationRaw !== jd.locationRegion && (
    <> · {jd.locationRegion}</>
  )}
  <> · {jd.searchRadiusKm} km</>
</span>
```

- [ ] **Step 2: Verify**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/jobs/\[id\]/page.tsx
git commit -m "feat(jd): show default search radius on detail page"
```

---

## Task 12: Candidate filters — types + validation

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/validations/candidate-filters.ts`

- [ ] **Step 1: Extend `CandidateFilters` type**

In `src/types/index.ts`, update:

```ts
export interface CandidateFilters {
  search?: string;
  languages?: string[];
  countryOfOrigin?: string;
  city?: string;
  dateFrom?: Date;
  dateTo?: Date;
  nearPlace?: string;
  radiusKm?: number;
}
```

- [ ] **Step 2: Extend the Zod schema + mapper**

Replace `src/lib/validations/candidate-filters.ts` with:

```ts
import { z } from "zod/v4";
import type { CandidateFilters, SortConfig } from "@/types";
import {
  DEFAULT_SEARCH_RADIUS_KM,
  MIN_RADIUS_KM,
  MAX_RADIUS_KM,
} from "@/lib/geo/constants";

export const candidateFiltersSchema = z.object({
  search: z.string().optional(),
  languages: z.string().optional(),
  countryOfOrigin: z.string().optional(),
  city: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  nearPlace: z.string().optional(),
  radiusKm: z.coerce.number().int().min(MIN_RADIUS_KM).max(MAX_RADIUS_KM).optional(),
  sortField: z.enum(["firstName", "lastName", "createdAt"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().min(1).optional().default(1),
  pageSize: z.coerce.number().min(10).max(100).optional().default(25),
});

export type ParsedFilterParams = z.infer<typeof candidateFiltersSchema>;

export function toFiltersAndSort(params: ParsedFilterParams): {
  filters: CandidateFilters;
  sort: SortConfig;
  page: number;
  pageSize: number;
} {
  const filters: CandidateFilters = {};

  if (params.search) filters.search = params.search;
  if (params.languages) {
    filters.languages = params.languages.split(",").filter(Boolean);
  }
  if (params.countryOfOrigin) filters.countryOfOrigin = params.countryOfOrigin;
  if (params.city) filters.city = params.city;
  if (params.dateFrom) filters.dateFrom = new Date(params.dateFrom);
  if (params.dateTo) filters.dateTo = new Date(params.dateTo);
  if (params.nearPlace && params.nearPlace.trim()) {
    filters.nearPlace = params.nearPlace.trim();
    filters.radiusKm = params.radiusKm ?? DEFAULT_SEARCH_RADIUS_KM;
  }

  const sort: SortConfig = {
    field: params.sortField ?? "createdAt",
    direction: params.sortDir ?? "desc",
  };

  return { filters, sort, page: params.page, pageSize: params.pageSize };
}
```

- [ ] **Step 3: Verify**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/lib/validations/candidate-filters.ts
git commit -m "feat(candidates): add nearPlace + radiusKm to filter schema"
```

---

## Task 13: Candidate `filterCandidates` — apply proximity

**Files:**
- Modify: `src/lib/candidates/filter.ts`
- Modify: `src/__tests__/lib/candidates/filter.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/lib/candidates/filter.test.ts` (inside the existing `describe("filterCandidates", …)` or a new `describe`):

```ts
import { filterCandidates } from "@/lib/candidates/filter";

describe("filterCandidates — proximity", () => {
  // Minimal Candidate-shaped objects: only fields the proximity branch reads.
  // Cast to Candidate; other branches (search/city) have no input here so
  // they're inert.
  const base = {
    firstName: "x",
    lastName: "x",
    countryOfOrigin: "",
    address: "",
    skillsAndCompetences: [],
    workExperience: [],
    languages: { language: "", additionalLanguages: "" },
  } as unknown;

  const milano = { ...(base as object), latitude: 45.4642, longitude: 9.19 };
  const torino = { ...(base as object), latitude: 45.07, longitude: 7.69 };
  const roma = { ...(base as object), latitude: 41.9, longitude: 12.5 };
  const noCoords = { ...(base as object), latitude: null, longitude: null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any = [milano, torino, roma, noCoords];

  it("filters within radius around a known place", () => {
    const r = filterCandidates(items, { nearPlace: "Milano", radiusKm: 30 });
    expect(r).toHaveLength(1);
    expect(r[0]).toBe(milano);
  });

  it("includes Torino when radius is 150 km from Milano", () => {
    const r = filterCandidates(items, { nearPlace: "Milano", radiusKm: 150 });
    expect(r).toHaveLength(2);
  });

  it("excludes candidates with null coords when proximity active", () => {
    const r = filterCandidates(items, { nearPlace: "Milano", radiusKm: 10000 });
    expect(r).not.toContain(noCoords);
  });

  it("is a no-op when nearPlace cannot be resolved", () => {
    const r = filterCandidates(items, { nearPlace: "Nowhereville", radiusKm: 50 });
    // Falls through: returns all items unchanged (other filters not active).
    expect(r).toHaveLength(items.length);
  });
});
```

Note: `Candidate` does not currently expose `latitude`/`longitude` in the types. The proximity branch will read these via the `lat`/`lng` fields produced by `normalize.ts`. We extend the `Candidate` type next.

- [ ] **Step 2: Add `latitude`/`longitude` to the `Candidate` type**

In `src/types/index.ts`, add to `Candidate`:
```ts
  latitude: number | null;
  longitude: number | null;
```

- [ ] **Step 3: Surface lat/lng in `normalize.ts`**

Open `src/lib/make/normalize.ts`. The lines at ~132-133 already compute `latitude` / `longitude`. Verify that the returned `Candidate` object includes `latitude` and `longitude` keys; if they're computed but not in the returned object, add them. Run a quick grep:

Run: `grep -n "latitude\|longitude" src/lib/make/normalize.ts`
Expected: both fields are present in the returned object.

If they are NOT in the returned object literal, add them to the return mapping.

- [ ] **Step 4: Update `filterCandidates`**

Replace `src/lib/candidates/filter.ts` `filterCandidates` function with one that includes the proximity branch. Locate the existing function and add this branch as the FIRST inside the `.filter` callback (before language/country/city/etc), so we exit early when it fails:

```ts
import type { Candidate, CandidateFilters, SortConfig, PaginatedResult } from "@/types";
import { resolvePlaceCoords, haversineKm } from "@/lib/geo/proximity";

export function filterCandidates(
  candidates: Candidate[],
  filters: CandidateFilters,
): Candidate[] {
  const center = filters.nearPlace ? resolvePlaceCoords(filters.nearPlace) : null;
  const radius = filters.radiusKm;

  return candidates.filter((c) => {
    if (center && radius != null) {
      if (c.latitude == null || c.longitude == null) return false;
      const d = haversineKm(
        { latitude: c.latitude, longitude: c.longitude },
        center,
      );
      if (d > radius) return false;
    }

    // ... keep all existing branches (languages, countryOfOrigin, city,
    // dateFrom, dateTo, search) unchanged below this line.
```

Keep the rest of the function body intact. Do not touch `sortCandidates` or `paginateCandidates`.

- [ ] **Step 5: Run filter tests**

Run: `pnpm test src/__tests__/lib/candidates/filter.test.ts`
Expected: PASS.

- [ ] **Step 6: Run all tests**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/lib/make/normalize.ts src/lib/candidates/filter.ts src/__tests__/lib/candidates/filter.test.ts
git commit -m "feat(candidates): apply proximity filter in filterCandidates"
```

---

## Task 14: Candidate filter UI — `nearPlace` + radius slider

**Files:**
- Modify: `src/components/candidates/candidate-filters.tsx`

- [ ] **Step 1: Replace the component**

Replace `src/components/candidates/candidate-filters.tsx` with:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { LocationCombobox } from "@/components/shared/location-combobox";
import { Search, Filter, X } from "lucide-react";
import { strings } from "@/lib/i18n/strings";
import {
  DEFAULT_SEARCH_RADIUS_KM,
  MIN_RADIUS_KM,
  MAX_RADIUS_KM,
  RADIUS_STEP_KM,
} from "@/lib/geo/constants";

interface CandidateFiltersProps {
  initialFilters: {
    search?: string;
    languages?: string;
    countryOfOrigin?: string;
    city?: string;
    dateFrom?: string;
    dateTo?: string;
    nearPlace?: string;
    radiusKm?: string;
  };
}

export function CandidateFilters({ initialFilters }: CandidateFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(initialFilters.search ?? "");
  const [languages, setLanguages] = useState(initialFilters.languages ?? "");
  const [countryOfOrigin, setCountryOfOrigin] = useState(initialFilters.countryOfOrigin ?? "");
  const [city, setCity] = useState(initialFilters.city ?? "");
  const [dateFrom, setDateFrom] = useState(initialFilters.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(initialFilters.dateTo ?? "");
  const [nearPlace, setNearPlace] = useState(initialFilters.nearPlace ?? "");
  const [radiusKm, setRadiusKm] = useState<number>(
    initialFilters.radiusKm ? Number(initialFilters.radiusKm) : DEFAULT_SEARCH_RADIUS_KM,
  );
  const [showFilters, setShowFilters] = useState(false);

  const applyFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");

    const setOrDelete = (key: string, value: string) => {
      if (value) params.set(key, value);
      else params.delete(key);
    };

    setOrDelete("search", search.trim());
    setOrDelete("languages", languages.trim());
    setOrDelete("countryOfOrigin", countryOfOrigin.trim());
    setOrDelete("city", city.trim());
    setOrDelete("dateFrom", dateFrom);
    setOrDelete("dateTo", dateTo);
    setOrDelete("nearPlace", nearPlace.trim());
    if (nearPlace.trim()) params.set("radiusKm", String(radiusKm));
    else params.delete("radiusKm");

    router.push(`/dashboard/candidates?${params.toString()}`);
  }, [
    router,
    searchParams,
    search,
    languages,
    countryOfOrigin,
    city,
    dateFrom,
    dateTo,
    nearPlace,
    radiusKm,
  ]);

  const resetFilters = useCallback(() => {
    setSearch("");
    setLanguages("");
    setCountryOfOrigin("");
    setCity("");
    setDateFrom("");
    setDateTo("");
    setNearPlace("");
    setRadiusKm(DEFAULT_SEARCH_RADIUS_KM);
    router.push("/dashboard/candidates");
  }, [router]);

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={`${strings.common.search} per nome, competenze, esperienze...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            className="pl-10 bg-white border-1 border-kubri-800"
          />
        </div>
        <Button variant="outline" onClick={() => setShowFilters(!showFilters)} className="gap-2">
          <Filter className="h-5 w-5" />
          {strings.common.filter}
        </Button>
        <Button onClick={applyFilters}>{strings.common.search}</Button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <Card className="p-4 shadow-sm border-border/60">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium">Lingue</label>
              <Input
                placeholder="es. Arabo, Francese"
                value={languages}
                onChange={(e) => setLanguages(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Paese di origine</label>
              <Input
                placeholder="es. Marocco"
                value={countryOfOrigin}
                onChange={(e) => setCountryOfOrigin(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Città</label>
              <Input
                placeholder="es. Torino"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>

            <div className="md:col-span-2 lg:col-span-3">
              <label className="mb-2 block text-sm font-medium">Vicino a...</label>
              <LocationCombobox
                name="nearPlace"
                defaultValue={nearPlace}
                placeholder="es. Milano, Lombardia"
              />
              {nearPlace.trim() && (
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Raggio</span>
                    <span className="text-sm text-muted-foreground">{radiusKm} km</span>
                  </div>
                  <Slider
                    min={MIN_RADIUS_KM}
                    max={MAX_RADIUS_KM}
                    step={RADIUS_STEP_KM}
                    value={[radiusKm]}
                    onValueChange={(v) => setRadiusKm(v[0] ?? DEFAULT_SEARCH_RADIUS_KM)}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button onClick={applyFilters}>Applica</Button>
            <Button variant="outline" onClick={resetFilters} className="gap-1">
              <X className="h-5 w-5" />
              {strings.common.reset}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
```

Note: `LocationCombobox` is uncontrolled — the input mirrors `defaultValue` on mount. To keep `nearPlace` state in sync we need a controlled variant. The simplest path: wrap a hidden field that the combobox writes to, and read it back via `onChange` on the input. To avoid that complexity, swap in a small controlled change here: replace the `LocationCombobox` invocation above with a local controlled `<Input>` if the combobox doesn't support a `value`/`onChange` pair.

- [ ] **Step 2: Add controlled support to `LocationCombobox`**

In `src/components/shared/location-combobox.tsx`, extend props with optional controlled `value`/`onChange`:

```tsx
interface LocationComboboxProps {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
}
```

In the body, derive the actual value from the prop when provided:

```tsx
const isControlled = value !== undefined;
const [internal, setInternal] = useState(defaultValue);
const current = isControlled ? value : internal;

const setCurrent = (v: string) => {
  if (!isControlled) setInternal(v);
  onChange?.(v);
};
```

Replace `value`/`setValue` references in the JSX with `current`/`setCurrent`.

- [ ] **Step 3: Use controlled mode in `candidate-filters.tsx`**

Update the `<LocationCombobox>` call to:

```tsx
<LocationCombobox
  name="nearPlace"
  value={nearPlace}
  onChange={setNearPlace}
  placeholder="es. Milano, Lombardia"
/>
```

- [ ] **Step 4: Verify**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: clean.

- [ ] **Step 5: Manual smoke check**

Run: `pnpm dev`, open `/dashboard/candidates`, expand filters, type "Milano" in "Vicino a..." → slider appears. Adjust slider, click Applica → URL contains `nearPlace=Milano&radiusKm=...`. Confirm the candidate list updates.

- [ ] **Step 6: Commit**

```bash
git add src/components/shared/location-combobox.tsx src/components/candidates/candidate-filters.tsx
git commit -m "feat(candidates): proximity filter UI (place + radius slider)"
```

---

## Task 15: Candidates page — pass new params through `initialFilters`

**Files:**
- Modify: `src/app/(dashboard)/dashboard/candidates/page.tsx`

- [ ] **Step 1: Inspect the current call**

The `<CandidateFilters initialFilters={flatParams} />` call already forwards all query params. Verify in `flatParams` mapping that string values for `nearPlace` and `radiusKm` are passed through. No code change should be needed — `flatParams` is built generically from `searchParams`. Confirm by reading the page; if `initialFilters` has a typed shape that excludes the new keys, add `nearPlace` and `radiusKm` to its inferred type via the component's prop type (already done in Task 14).

- [ ] **Step 2: Verify**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: clean.

- [ ] **Step 3: No commit if no changes; otherwise:**

```bash
git add src/app/\(dashboard\)/dashboard/candidates/page.tsx
git commit -m "feat(candidates): forward proximity filter params to UI"
```

---

## Task 16: End-to-end smoke + lint

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke (dev server)**

- Create a JD, set radius to 50, save. Reload, edit page, slider shows 50.
- JD detail page shows "· 50 km".
- On candidates page, filter "Vicino a Milano" + radius 30 → only Milano-area candidates returned. Switch to radius 200 → many more.
- Reset filters → list returns to unfiltered.

---

## Task 17: Apply migration to prod and merge

Per CLAUDE.md migration workflow:

- [ ] **Step 1: Apply migration to prod**

```bash
set -a && source .env.prod && set +a && pnpm prisma migrate deploy
```
Expected: migration `add_jd_search_radius` applied.

- [ ] **Step 2: Verify status**

```bash
set -a && source .env.prod && set +a && pnpm prisma migrate status
```
Expected: "Database schema is up to date".

- [ ] **Step 3: Merge PR**

After PR review, merge to `main`. Vercel auto-deploys the new code against the already-migrated DB.
