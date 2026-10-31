# Landing Candidate Geocoding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every candidate created from the public landing gets a precise address and coordinates: prefilled from the CV through Google Geocoding, confirmed or changed by the candidate through a required "Dove abiti?" autocomplete field, resolved server-side, with an ISTAT comune fallback when Google is unavailable.

**Architecture:** A minimal Google client (`src/lib/geo/google.ts`, plain `fetch`) and an ISTAT counterpart (`src/lib/geo/istat-places.ts`) share two types (`PlaceSuggestion`, `ResolvedPlace`). `src/lib/landing/place.ts` picks the provider (Google first, ISTAT on error or without a key). The landing flow adds a place prefill to the extraction result, a rate-limited `searchLandingPlaces`, and server-side resolution of the chosen place id at confirm, which passes explicit coordinates to `confirmImport`. The UI adds an accessible combobox (`PlaceField`) to the contact form.

**Tech Stack:** Next.js 16 server actions, TypeScript strict, Zod v4, Vitest + Testing Library, Upstash (rate limits + cache store), Google Geocoding API + Places API (New).

**Spec:** `docs/superpowers/specs/2026-10-31-landing-candidate-geocoding-design.md`

## Conventions for every task

- Work from `apps/dashboard` unless a path starts with `docs/` or `.env.example` (repo root).
- Run tests with the DB guard disabled (no local DB in worktrees):
  `DATABASE_URL= DIRECT_URL= pnpm exec vitest run <paths>`
- Typecheck: `pnpm exec tsc --noEmit -p .` — the only accepted pre-existing errors are in `candidate-pdf.tsx` and `CompetenceReportPdf.tsx`.
- Lint touched files: `pnpm exec eslint <paths>`.
- Commit with explicit paths (never `git add -A`), conventional commit messages, ending with the `Co-Authored-By` line.
- Never log addresses, search text or place labels.
- Google requests always use `languageCode`/`language` = `"it"` (stored addresses are read by Italian operators). This replaces the spec's "page locale" wording; Task 11 updates the spec.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/geo/place-types.ts` | new | `PlaceSuggestion`, `PlaceSource`, `ResolvedPlace` |
| `src/lib/geo/proximity.ts` | modify | export `stripPostcodeAndProvince` |
| `src/lib/geo/istat-places.ts` | new | ISTAT search / resolve / text match / nearest comune |
| `src/lib/geo/google.ts` | new | Geocoding, Autocomplete (New), Place Details (New) |
| `src/lib/landing/place.ts` | new | provider choice, prefill cache, search, resolve |
| `src/lib/candidates/dashboard-create.ts` | modify | optional explicit `coords` |
| `src/lib/candidate-imports/service.ts` | modify | `confirmImport` passes `coords` through |
| `src/lib/landing/contact.ts` | modify | `placeId` in schema, `LandingPrefill`, merge place into fields |
| `src/lib/landing/flow.ts` | modify | prefill, `searchLandingPlaces`, resolve at confirm, limits, `PLACE_INVALID` |
| `src/app/(public)/candidati/[slug]/actions.ts` | modify | `searchLandingPlacesAction`, new prefill type |
| `src/lib/i18n/dictionaries/{it,en}.ts` | modify | place strings |
| `src/components/landing/place-field.tsx` | new | combobox |
| `src/components/landing/contact-form.tsx` | modify | place field + validation |
| `src/components/landing/landing-flow.tsx` | modify | `placeInvalid` error, reset key |
| `.env.example`, `docs/setup/candidate-landing-setup.md`, `CLAUDE.md`, spec | modify | config + docs |

---

### Task 1: Place types and ISTAT places

**Files:**
- Create: `src/lib/geo/place-types.ts`
- Create: `src/lib/geo/istat-places.ts`
- Modify: `src/lib/geo/proximity.ts` (export `stripPostcodeAndProvince`)
- Test: `src/__tests__/lib/geo/istat-places.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/lib/geo/istat-places.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isIstatPlaceId,
  istatPlaceForText,
  nearestIstatLabel,
  resolveIstatPlace,
  searchIstatPlaces,
} from "@/lib/geo/istat-places";

describe("searchIstatPlaces", () => {
  it("puts the exact match first, then prefixes, shortest first", () => {
    const r = searchIstatPlaces("milano");
    expect(r[0]).toEqual({ placeId: "istat:MI:milano", label: "Milano (MI)" });
    expect(r.length).toBeLessThanOrEqual(5);
    expect(r.every((s) => isIstatPlaceId(s.placeId))).toBe(true);
  });

  it("ignores case and accents", () => {
    expect(searchIstatPlaces("CANTU")[0]?.label).toBe("Cantù (CO)");
  });

  it("returns nothing for queries under 2 chars or no match", () => {
    expect(searchIstatPlaces("m")).toEqual([]);
    expect(searchIstatPlaces("zzzzqq")).toEqual([]);
  });
});

describe("resolveIstatPlace", () => {
  it("round-trips a search id to the comune centroid", () => {
    const r = resolveIstatPlace("istat:MI:milano");
    expect(r).toMatchObject({
      placeId: "istat:MI:milano", source: "istat", address: "Milano (MI)", location: "Milano (MI)",
    });
    expect(r!.latitude).toBeCloseTo(45.46, 0);
    expect(r!.longitude).toBeCloseTo(9.19, 0);
  });

  it("returns null for an unknown id", () => {
    expect(resolveIstatPlace("istat:XX:nowhere")).toBeNull();
    expect(resolveIstatPlace("ChIJ123")).toBeNull();
  });
});

describe("istatPlaceForText", () => {
  it("matches the comune in the last comma-separated token", () => {
    expect(istatPlaceForText("Via Garibaldi 14, 20121 Milano (MI)")).toEqual({
      placeId: "istat:MI:milano", label: "Milano (MI)",
    });
    expect(istatPlaceForText("Torino")).toEqual({ placeId: "istat:TO:torino", label: "Torino (TO)" });
  });

  it("returns null when no comune matches", () => {
    expect(istatPlaceForText("Casablanca, Marocco")).toBeNull();
    expect(istatPlaceForText("  ")).toBeNull();
  });
});

describe("nearestIstatLabel", () => {
  it("returns the closest comune label", () => {
    expect(nearestIstatLabel(45.4642, 9.19)).toBe("Milano (MI)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/lib/geo/istat-places.test.ts`
Expected: FAIL — cannot resolve `@/lib/geo/istat-places`.

- [ ] **Step 3: Implement**

`src/lib/geo/place-types.ts`:

```ts
/** One autocomplete option: an opaque place id and the text shown to the user. */
export interface PlaceSuggestion {
  placeId: string;
  label: string;
}

export type PlaceSource = "google" | "istat";

/** A place resolved server-side, ready to be written on a Candidate. */
export interface ResolvedPlace {
  placeId: string;
  source: PlaceSource;
  /** Full address (Google formatted address, or "Comune (PROV)" for ISTAT). */
  address: string;
  /** "Comune (PROV)". */
  location: string;
  latitude: number;
  longitude: number;
}
```

In `src/lib/geo/proximity.ts` change `function stripPostcodeAndProvince` to `export function stripPostcodeAndProvince` (body unchanged).

`src/lib/geo/istat-places.ts`:

```ts
import { ITALY_ADMIN, type ItalyAdminRow } from "./italy-admin";
import { normalizePlace } from "./resolve";
import { haversineKm, stripPostcodeAndProvince } from "./proximity";
import type { PlaceSuggestion, ResolvedPlace } from "./place-types";

const PREFIX = "istat:";

interface IndexedRow {
  row: ItalyAdminRow;
  key: string;
  id: string;
}

let _rows: IndexedRow[] | null = null;
function rows(): IndexedRow[] {
  if (_rows) return _rows;
  _rows = ITALY_ADMIN.map((row) => {
    const key = normalizePlace(row.municipality);
    return { row, key, id: `${PREFIX}${row.provinceCode}:${key}` };
  });
  return _rows;
}

export function isIstatPlaceId(id: string): boolean {
  return id.startsWith(PREFIX);
}

function label(row: ItalyAdminRow): string {
  return `${row.municipality} (${row.provinceCode})`;
}

function suggestion(r: IndexedRow): PlaceSuggestion {
  return { placeId: r.id, label: label(r.row) };
}

/** Comuni whose name equals or starts with the query (exact first, then shortest). */
export function searchIstatPlaces(query: string, limit = 5): PlaceSuggestion[] {
  const q = normalizePlace(query);
  if (q.length < 2) return [];
  const exact: IndexedRow[] = [];
  const prefix: IndexedRow[] = [];
  for (const r of rows()) {
    if (r.key === q) exact.push(r);
    else if (r.key.startsWith(q)) prefix.push(r);
  }
  prefix.sort(
    (a, b) => a.key.length - b.key.length || a.row.municipality.localeCompare(b.row.municipality, "it"),
  );
  return [...exact, ...prefix].slice(0, limit).map(suggestion);
}

/** The comune centroid for an `istat:` id, or null. */
export function resolveIstatPlace(id: string): ResolvedPlace | null {
  if (!isIstatPlaceId(id)) return null;
  const hit = rows().find((r) => r.id === id);
  if (!hit) return null;
  const text = label(hit.row);
  return {
    placeId: hit.id,
    source: "istat",
    address: text,
    location: text,
    latitude: hit.row.latitude,
    longitude: hit.row.longitude,
  };
}

/** Free text such as "Via X 1, 20121 Milano (MI)" → the comune in its last token. */
export function istatPlaceForText(text: string): PlaceSuggestion | null {
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;
  const key = normalizePlace(stripPostcodeAndProvince(last));
  const hit = rows().find((r) => r.key === key);
  return hit ? suggestion(hit) : null;
}

/** "Comune (PROV)" of the comune whose centroid is closest to the point. */
export function nearestIstatLabel(latitude: number, longitude: number): string {
  let best = rows()[0]!;
  let bestKm = Number.POSITIVE_INFINITY;
  for (const r of rows()) {
    const km = haversineKm({ latitude, longitude }, { latitude: r.row.latitude, longitude: r.row.longitude });
    if (km < bestKm) {
      best = r;
      bestKm = km;
    }
  }
  return label(best.row);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/lib/geo`
Expected: PASS (new file plus the existing geo suites). If "Cantù (CO)" is not the first prefix result for "CANTU", check the dataset spelling with `grep -n '"Cant' src/lib/geo/italy-admin.ts` and adjust only the test's expected label.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo/place-types.ts src/lib/geo/istat-places.ts src/lib/geo/proximity.ts src/__tests__/lib/geo/istat-places.test.ts
git commit -m "feat(geo): ISTAT comune search and resolution for place pickers"
```

---

### Task 2: Google Maps client

**Files:**
- Create: `src/lib/geo/google.ts`
- Test: `src/__tests__/lib/geo/google.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/lib/geo/google.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  autocompletePlaces,
  geocodeAddress,
  getPlaceDetails,
  googleMapsConfigured,
  GoogleMapsUnavailableError,
  GooglePlaceNotFoundError,
} from "@/lib/geo/google";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const GEOCODE_HIT = {
  status: "OK",
  results: [
    {
      place_id: "ChIJgeo",
      formatted_address: "Via Roma, 12, 20121 Milano MI, Italia",
      types: ["street_address"],
      geometry: { location: { lat: 45.47, lng: 9.19 } },
      address_components: [
        { long_name: "Milano", short_name: "Milano", types: ["locality", "political"] },
        { long_name: "Città Metropolitana di Milano", short_name: "MI", types: ["administrative_area_level_2"] },
      ],
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "k");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe("googleMapsConfigured", () => {
  it("reflects the env key", () => {
    expect(googleMapsConfigured()).toBe(true);
    vi.stubEnv("GOOGLE_MAPS_API_KEY", " ");
    expect(googleMapsConfigured()).toBe(false);
  });
});

describe("geocodeAddress", () => {
  it("returns a precise result restricted to Italy, in Italian", async () => {
    fetchMock.mockResolvedValueOnce(json(GEOCODE_HIT));
    await expect(geocodeAddress("Via Roma 12 Milano")).resolves.toEqual({
      placeId: "ChIJgeo",
      formattedAddress: "Via Roma, 12, 20121 Milano MI, Italia",
      latitude: 45.47,
      longitude: 9.19,
      municipality: "Milano",
      provinceCode: "MI",
    });
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("components")).toBe("country:IT");
    expect(url.searchParams.get("language")).toBe("it");
    expect(url.searchParams.get("key")).toBe("k");
  });

  it("returns null for ZERO_RESULTS or a too generic result", async () => {
    fetchMock.mockResolvedValueOnce(json({ status: "ZERO_RESULTS", results: [] }));
    await expect(geocodeAddress("xx")).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(json({
      status: "OK",
      results: [{ ...GEOCODE_HIT.results[0], types: ["country", "political"] }],
    }));
    await expect(geocodeAddress("Italia")).resolves.toBeNull();
  });

  it("throws GoogleMapsUnavailableError on missing key, HTTP or API errors and network failures", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    await expect(geocodeAddress("x")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "k");
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(geocodeAddress("x")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
    fetchMock.mockResolvedValueOnce(json({ status: "REQUEST_DENIED" }));
    await expect(geocodeAddress("x")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
    fetchMock.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
    await expect(geocodeAddress("x")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
  });
});

describe("autocompletePlaces", () => {
  it("posts the query with Italy restriction and session token, maps up to 5 suggestions", async () => {
    fetchMock.mockResolvedValueOnce(json({
      suggestions: [
        { placePrediction: { placeId: "p1", text: { text: "Via Roma, Milano, MI, Italia" } } },
        { queryPrediction: { text: { text: "ignored" } } },
        { placePrediction: { placeId: "p2", text: { text: "Roma, RM, Italia" } } },
      ],
    }));
    await expect(autocompletePlaces("via roma", "tok")).resolves.toEqual([
      { placeId: "p1", label: "Via Roma, Milano, MI, Italia" },
      { placeId: "p2", label: "Roma, RM, Italia" },
    ]);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(JSON.parse(init.body as string)).toEqual({
      input: "via roma", includedRegionCodes: ["it"], regionCode: "it", languageCode: "it", sessionToken: "tok",
    });
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("k");
  });

  it("throws GoogleMapsUnavailableError on HTTP errors", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 403));
    await expect(autocompletePlaces("via roma")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
  });
});

describe("getPlaceDetails", () => {
  const DETAILS = {
    id: "p1",
    formattedAddress: "Via Roma, 12, 20121 Milano MI, Italia",
    location: { latitude: 45.47, longitude: 9.19 },
    addressComponents: [
      { longText: "Milano", shortText: "Milano", types: ["locality", "political"] },
      { longText: "Città Metropolitana di Milano", shortText: "MI", types: ["administrative_area_level_2"] },
    ],
  };

  it("fetches the fields we need with the session token", async () => {
    fetchMock.mockResolvedValueOnce(json(DETAILS));
    await expect(getPlaceDetails("p1", "tok")).resolves.toEqual({
      placeId: "p1",
      formattedAddress: "Via Roma, 12, 20121 Milano MI, Italia",
      latitude: 45.47,
      longitude: 9.19,
      municipality: "Milano",
      provinceCode: "MI",
    });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const u = new URL(url);
    expect(u.pathname).toBe("/v1/places/p1");
    expect(u.searchParams.get("sessionToken")).toBe("tok");
    expect(u.searchParams.get("languageCode")).toBe("it");
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(
      "id,formattedAddress,location,addressComponents",
    );
  });

  it("falls back to administrative_area_level_3 and drops a non-2-letter province", async () => {
    fetchMock.mockResolvedValueOnce(json({
      ...DETAILS,
      addressComponents: [
        { longText: "Sesto San Giovanni", shortText: "Sesto S.G.", types: ["administrative_area_level_3"] },
        { longText: "Milano", shortText: "Metropolitan City of Milan", types: ["administrative_area_level_2"] },
      ],
    }));
    await expect(getPlaceDetails("p1")).resolves.toMatchObject({
      municipality: "Sesto San Giovanni", provinceCode: null,
    });
  });

  it("rejects malformed ids without calling Google, and maps 400/404 to not found", async () => {
    await expect(getPlaceDetails("../x")).rejects.toBeInstanceOf(GooglePlaceNotFoundError);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json({}, 404));
    await expect(getPlaceDetails("p1")).rejects.toBeInstanceOf(GooglePlaceNotFoundError);
    fetchMock.mockResolvedValueOnce(json({}, 400));
    await expect(getPlaceDetails("p1")).rejects.toBeInstanceOf(GooglePlaceNotFoundError);
  });

  it("throws unavailable on 5xx and not found on an incomplete body", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 503));
    await expect(getPlaceDetails("p1")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
    fetchMock.mockResolvedValueOnce(json({ id: "p1" }));
    await expect(getPlaceDetails("p1")).rejects.toBeInstanceOf(GooglePlaceNotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/lib/geo/google.test.ts`
Expected: FAIL — cannot resolve `@/lib/geo/google`.

- [ ] **Step 3: Implement**

`src/lib/geo/google.ts`:

```ts
import type { PlaceSuggestion } from "./place-types";

/**
 * Minimal Google Maps Platform client (Geocoding API + Places API (New)).
 * Server only: the key never reaches the browser. Never log the query text
 * or the returned address: they are candidate personal data.
 */

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const PLACES_URL = "https://places.googleapis.com/v1";
const TIMEOUT_MS = 3000;
/** Stored addresses are read by Italian operators. */
const LANGUAGE = "it";
const MAX_SUGGESTIONS = 5;
/** Geocoding results precise enough to stand for "where the candidate lives". */
const PRECISE_TYPES = new Set([
  "street_address", "premise", "subpremise", "route", "locality",
  "postal_code", "administrative_area_level_3", "sublocality",
]);
/** Google place ids are URL-safe base64-like strings. */
const PLACE_ID_RE = /^[A-Za-z0-9_-]{1,300}$/;

export class GoogleMapsUnavailableError extends Error {
  constructor(reason: string, cause?: unknown) {
    super(`google maps unavailable: ${reason}`, { cause });
    this.name = "GoogleMapsUnavailableError";
  }
}

export class GooglePlaceNotFoundError extends Error {
  constructor() {
    super("google place not found");
    this.name = "GooglePlaceNotFoundError";
  }
}

export interface GooglePlace {
  placeId: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  municipality: string | null;
  /** Two-letter province code ("MI"), or null when Google gives something else. */
  provinceCode: string | null;
}

interface Component {
  long: string;
  short: string;
  types: string[];
}

export function googleMapsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) throw new GoogleMapsUnavailableError("missing key");
  return key;
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new GoogleMapsUnavailableError("network", e);
  }
}

function adminFrom(components: Component[]): Pick<GooglePlace, "municipality" | "provinceCode"> {
  const find = (type: string) => components.find((c) => c.types.includes(type));
  const comune = find("locality") ?? find("administrative_area_level_3");
  const province = find("administrative_area_level_2")?.short ?? "";
  return {
    municipality: comune?.long ?? null,
    provinceCode: /^[A-Z]{2}$/.test(province) ? province : null,
  };
}

interface GeocodeResult {
  place_id: string;
  formatted_address: string;
  types: string[];
  geometry: { location: { lat: number; lng: number } };
  address_components: { long_name: string; short_name: string; types: string[] }[];
}

/** Best precise match in Italy, or null (no result / too generic). */
export async function geocodeAddress(text: string): Promise<GooglePlace | null> {
  const params = new URLSearchParams({
    address: text, components: "country:IT", region: "it", language: LANGUAGE, key: apiKey(),
  });
  const res = await call(`${GEOCODE_URL}?${params.toString()}`);
  if (!res.ok) throw new GoogleMapsUnavailableError(`geocode HTTP ${res.status}`);
  const body = (await res.json()) as { status?: string; results?: GeocodeResult[] };
  if (body.status === "ZERO_RESULTS") return null;
  if (body.status !== "OK") throw new GoogleMapsUnavailableError(`geocode status ${body.status ?? "?"}`);
  const hit = body.results?.find((r) => r.types.some((t) => PRECISE_TYPES.has(t)));
  if (!hit) return null;
  return {
    placeId: hit.place_id,
    formattedAddress: hit.formatted_address,
    latitude: hit.geometry.location.lat,
    longitude: hit.geometry.location.lng,
    ...adminFrom(hit.address_components.map((c) => ({ long: c.long_name, short: c.short_name, types: c.types }))),
  };
}

/** Places Autocomplete (New), restricted to Italy. */
export async function autocompletePlaces(input: string, sessionToken?: string): Promise<PlaceSuggestion[]> {
  const res = await call(`${PLACES_URL}/places:autocomplete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
    },
    body: JSON.stringify({
      input,
      includedRegionCodes: ["it"],
      regionCode: "it",
      languageCode: LANGUAGE,
      ...(sessionToken ? { sessionToken } : {}),
    }),
  });
  if (!res.ok) throw new GoogleMapsUnavailableError(`autocomplete HTTP ${res.status}`);
  const body = (await res.json()) as {
    suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string } } }[];
  };
  return (body.suggestions ?? [])
    .flatMap((s) => {
      const p = s.placePrediction;
      return p?.placeId && p.text?.text ? [{ placeId: p.placeId, label: p.text.text }] : [];
    })
    .slice(0, MAX_SUGGESTIONS);
}

/** Place Details (New). Closes the autocomplete session when a token is given. */
export async function getPlaceDetails(placeId: string, sessionToken?: string): Promise<GooglePlace> {
  if (!PLACE_ID_RE.test(placeId)) throw new GooglePlaceNotFoundError();
  const params = new URLSearchParams({ languageCode: LANGUAGE });
  if (sessionToken) params.set("sessionToken", sessionToken);
  const res = await call(`${PLACES_URL}/places/${placeId}?${params.toString()}`, {
    headers: {
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "id,formattedAddress,location,addressComponents",
    },
  });
  if (res.status === 400 || res.status === 404) throw new GooglePlaceNotFoundError();
  if (!res.ok) throw new GoogleMapsUnavailableError(`details HTTP ${res.status}`);
  const body = (await res.json()) as {
    id?: string;
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    addressComponents?: { longText: string; shortText: string; types: string[] }[];
  };
  const lat = body.location?.latitude;
  const lng = body.location?.longitude;
  if (!body.id || !body.formattedAddress || typeof lat !== "number" || typeof lng !== "number") {
    throw new GooglePlaceNotFoundError();
  }
  return {
    placeId: body.id,
    formattedAddress: body.formattedAddress,
    latitude: lat,
    longitude: lng,
    ...adminFrom((body.addressComponents ?? []).map((c) => ({ long: c.longText, short: c.shortText, types: c.types }))),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/lib/geo/google.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo/google.ts src/__tests__/lib/geo/google.test.ts
git commit -m "feat(geo): minimal Google Geocoding and Places client"
```

---

### Task 3: Explicit coordinates in candidate creation

**Files:**
- Modify: `src/lib/candidates/dashboard-create.ts` (`buildDashboardCandidateInput`)
- Modify: `src/lib/candidate-imports/service.ts` (`ConfirmImportInput`, the `buildDashboardCandidateInput` call inside `confirmImport`)
- Test: `src/__tests__/lib/candidates/dashboard-create.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside `describe("buildDashboardCandidateInput", …)` in `src/__tests__/lib/candidates/dashboard-create.test.ts`:

```ts
  it("uses explicit coordinates instead of offline geocoding", () => {
    const row = buildDashboardCandidateInput({
      pool: POOL,
      fields: FIELDS,
      channel: "landing_cv",
      rawPayload: {},
      coords: { latitude: 45.1, longitude: 9.2 },
    });
    expect(row.latitude).toBe(45.1);
    expect(row.longitude).toBe(9.2);
    expect(geocode).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/lib/candidates/dashboard-create.test.ts`
Expected: FAIL — TypeScript/vitest reports `coords` unknown or `geocode` called.

- [ ] **Step 3: Implement**

In `src/lib/candidates/dashboard-create.ts`, add the import and parameter:

```ts
import { geocodeFromAddress, type LatLng } from "@/lib/geo/proximity";
```

```ts
export function buildDashboardCandidateInput(args: {
  pool: PoolRef;
  fields: CandidateFields;
  channel: CandidateCreateChannel;
  rawPayload: Prisma.InputJsonValue;
  consentToShare?: boolean;
  /** Already resolved coordinates (public landing); skips offline geocoding. */
  coords?: LatLng;
}): Prisma.CandidateUncheckedCreateInput {
  const { pool, fields } = args;
  const coords = args.coords ?? geocodeFromAddress(fields.location) ?? geocodeFromAddress(fields.address);
```

(the rest of the function is unchanged).

In `src/lib/candidate-imports/service.ts`, add to `ConfirmImportInput` (after `rawPayloadExtra`):

```ts
  /** Resolved coordinates for a new candidate (public landing place picker). */
  coords?: { latitude: number; longitude: number };
```

and pass it in the `buildDashboardCandidateInput({ … })` call inside `confirmImport`:

```ts
      buildDashboardCandidateInput({
        pool: imp.pool,
        fields: input.fields,
        channel,
        consentToShare: input.consentToShare,
        coords: input.coords,
        rawPayload: {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/lib/candidates/dashboard-create.test.ts` then `pnpm exec tsc --noEmit -p . 2>&1 | grep -v "candidate-pdf\|CompetenceReportPdf" | grep error`
Expected: PASS; no new tsc errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/candidates/dashboard-create.ts src/lib/candidate-imports/service.ts src/__tests__/lib/candidates/dashboard-create.test.ts
git commit -m "feat(candidates): accept resolved coordinates when creating from an import"
```

---

### Task 4: Landing place service

**Files:**
- Create: `src/lib/landing/place.ts`
- Test: `src/__tests__/lib/landing/place.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/lib/landing/place.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/geo/google", async () => {
  const actual = await vi.importActual<typeof import("@/lib/geo/google")>("@/lib/geo/google");
  return {
    ...actual,
    googleMapsConfigured: vi.fn(),
    geocodeAddress: vi.fn(),
    autocompletePlaces: vi.fn(),
    getPlaceDetails: vi.fn(),
  };
});

import {
  autocompletePlaces,
  geocodeAddress,
  getPlaceDetails,
  googleMapsConfigured,
  GoogleMapsUnavailableError,
  GooglePlaceNotFoundError,
} from "@/lib/geo/google";
import { _resetCacheStoreForTests } from "@/lib/cache/store";
import { normalizeQuery, prefillPlace, resolvePlace, searchPlaces } from "@/lib/landing/place";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const GOOGLE_PLACE = {
  placeId: "ChIJ1", formattedAddress: "Via Roma, 12, 20121 Milano MI, Italia",
  latitude: 45.47, longitude: 9.19, municipality: "Milano", provinceCode: "MI",
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetCacheStoreForTests();
  m(googleMapsConfigured).mockReturnValue(true);
});

describe("normalizeQuery", () => {
  it("collapses whitespace and caps the length", () => {
    expect(normalizeQuery("  via   roma ")).toBe("via roma");
    expect(normalizeQuery("x".repeat(150))).toHaveLength(100);
  });
});

describe("prefillPlace", () => {
  it("geocodes the draft address once per import (cached)", async () => {
    m(geocodeAddress).mockResolvedValue(GOOGLE_PLACE);
    const draft = { address: "Via Roma 12, Milano", location: "Milano (MI)" };
    const expected = { placeId: "ChIJ1", label: "Via Roma, 12, 20121 Milano MI, Italia" };
    await expect(prefillPlace("imp-1", draft)).resolves.toEqual(expected);
    await expect(prefillPlace("imp-1", draft)).resolves.toEqual(expected);
    expect(m(geocodeAddress)).toHaveBeenCalledTimes(1);
    expect(m(geocodeAddress)).toHaveBeenCalledWith("Via Roma 12, Milano");
  });

  it("uses the location when there is no address, and null when there is neither", async () => {
    m(geocodeAddress).mockResolvedValue(null);
    await expect(prefillPlace("imp-2", { address: null, location: "Milano (MI)" })).resolves.toBeNull();
    expect(m(geocodeAddress)).toHaveBeenCalledWith("Milano (MI)");
    await expect(prefillPlace("imp-3", { address: " ", location: null })).resolves.toBeNull();
    expect(m(geocodeAddress)).toHaveBeenCalledTimes(1);
  });

  it("falls back to the ISTAT comune when Google is unavailable or not configured", async () => {
    m(geocodeAddress).mockRejectedValue(new GoogleMapsUnavailableError("down"));
    await expect(prefillPlace("imp-4", { address: "Via X 1, Torino", location: null }))
      .resolves.toEqual({ placeId: "istat:TO:torino", label: "Torino (TO)" });
    m(googleMapsConfigured).mockReturnValue(false);
    await expect(prefillPlace("imp-5", { address: null, location: "Milano (MI)" }))
      .resolves.toEqual({ placeId: "istat:MI:milano", label: "Milano (MI)" });
  });

  it("never throws", async () => {
    m(geocodeAddress).mockRejectedValue(new Error("boom"));
    await expect(prefillPlace("imp-6", { address: "Via X", location: null })).resolves.toBeNull();
  });
});

describe("searchPlaces", () => {
  it("returns nothing under 3 chars without calling Google", async () => {
    await expect(searchPlaces("ro")).resolves.toEqual([]);
    expect(m(autocompletePlaces)).not.toHaveBeenCalled();
  });

  it("uses Google autocomplete with the session token", async () => {
    m(autocompletePlaces).mockResolvedValue([{ placeId: "p1", label: "Roma, RM, Italia" }]);
    await expect(searchPlaces("roma", "tok")).resolves.toEqual([{ placeId: "p1", label: "Roma, RM, Italia" }]);
    expect(m(autocompletePlaces)).toHaveBeenCalledWith("roma", "tok");
  });

  it("falls back to ISTAT comuni when Google is unavailable or not configured", async () => {
    m(autocompletePlaces).mockRejectedValue(new GoogleMapsUnavailableError("down"));
    expect((await searchPlaces("milano"))[0]).toEqual({ placeId: "istat:MI:milano", label: "Milano (MI)" });
    m(googleMapsConfigured).mockReturnValue(false);
    expect((await searchPlaces("torino"))[0]).toEqual({ placeId: "istat:TO:torino", label: "Torino (TO)" });
  });
});

describe("resolvePlace", () => {
  it("resolves a Google id through Place Details", async () => {
    m(getPlaceDetails).mockResolvedValue(GOOGLE_PLACE);
    await expect(resolvePlace("ChIJ1", "tok")).resolves.toEqual({
      placeId: "ChIJ1", source: "google", address: "Via Roma, 12, 20121 Milano MI, Italia",
      location: "Milano (MI)", latitude: 45.47, longitude: 9.19,
    });
    expect(m(getPlaceDetails)).toHaveBeenCalledWith("ChIJ1", "tok");
  });

  it("builds the location from the nearest comune when components are incomplete", async () => {
    m(getPlaceDetails).mockResolvedValue({ ...GOOGLE_PLACE, provinceCode: null });
    await expect(resolvePlace("ChIJ1")).resolves.toMatchObject({ location: "Milano (MI)" });
  });

  it("resolves an ISTAT id without Google", async () => {
    await expect(resolvePlace("istat:MI:milano")).resolves.toMatchObject({ source: "istat", location: "Milano (MI)" });
    expect(m(getPlaceDetails)).not.toHaveBeenCalled();
  });

  it("returns null for unknown ids, Google errors, or Google ids without a key", async () => {
    m(getPlaceDetails).mockRejectedValueOnce(new GooglePlaceNotFoundError());
    await expect(resolvePlace("ChIJbad")).resolves.toBeNull();
    m(getPlaceDetails).mockRejectedValueOnce(new GoogleMapsUnavailableError("down"));
    await expect(resolvePlace("ChIJ1")).resolves.toBeNull();
    await expect(resolvePlace("istat:XX:nowhere")).resolves.toBeNull();
    m(googleMapsConfigured).mockReturnValue(false);
    await expect(resolvePlace("ChIJ1")).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/lib/landing/place.test.ts`
Expected: FAIL — cannot resolve `@/lib/landing/place`.

- [ ] **Step 3: Implement**

`src/lib/landing/place.ts`:

```ts
import { getCacheStore } from "@/lib/cache/store";
import {
  autocompletePlaces,
  geocodeAddress,
  getPlaceDetails,
  googleMapsConfigured,
  GoogleMapsUnavailableError,
  GooglePlaceNotFoundError,
  type GooglePlace,
} from "@/lib/geo/google";
import {
  isIstatPlaceId,
  istatPlaceForText,
  nearestIstatLabel,
  resolveIstatPlace,
  searchIstatPlaces,
} from "@/lib/geo/istat-places";
import type { PlaceSuggestion, ResolvedPlace } from "@/lib/geo/place-types";

/** Shorter queries return nothing (and never reach Google). */
export const MIN_PLACE_QUERY = 3;
const MAX_QUERY = 100;
/** Same lifetime as the import cookie. */
const PREFILL_TTL_MS = 30 * 60 * 1000;

/** Logs the failure class only: queries and addresses are personal data. */
function warn(op: string, e: unknown): void {
  console.warn(`[landing] place ${op} fell back`, { name: e instanceof Error ? e.name : "unknown" });
}

export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
}

function toResolved(p: GooglePlace): ResolvedPlace {
  const location =
    p.municipality && p.provinceCode
      ? `${p.municipality} (${p.provinceCode})`
      : nearestIstatLabel(p.latitude, p.longitude);
  return {
    placeId: p.placeId,
    source: "google",
    address: p.formattedAddress,
    location,
    latitude: p.latitude,
    longitude: p.longitude,
  };
}

async function geocodeForPrefill(text: string): Promise<PlaceSuggestion | null> {
  if (googleMapsConfigured()) {
    try {
      const p = await geocodeAddress(text);
      return p ? { placeId: p.placeId, label: p.formattedAddress } : null;
    } catch (e) {
      if (!(e instanceof GoogleMapsUnavailableError)) throw e;
      warn("prefill", e);
    }
  }
  return istatPlaceForText(text);
}

/**
 * The "Dove abiti?" prefill from the CV draft, cached per import so polling,
 * a second tab or a reload don't geocode again. Never throws: geocoding must
 * not fail the extraction.
 */
export async function prefillPlace(
  importId: string,
  draft: { address: string | null; location: string | null },
): Promise<PlaceSuggestion | null> {
  try {
    const text = draft.address?.trim() || draft.location?.trim();
    if (!text) return null;
    const cache = getCacheStore();
    const key = `landing:prefill:${importId}`;
    const hit = await cache.get<{ place: PlaceSuggestion | null }>(key);
    if (hit) return hit.place;
    const place = await geocodeForPrefill(text);
    await cache.set(key, { place }, PREFILL_TTL_MS);
    return place;
  } catch (e) {
    warn("prefill", e);
    return null;
  }
}

/** Autocomplete suggestions: Google when available, ISTAT comuni otherwise. */
export async function searchPlaces(query: string, sessionToken?: string): Promise<PlaceSuggestion[]> {
  const q = normalizeQuery(query);
  if (q.length < MIN_PLACE_QUERY) return [];
  if (googleMapsConfigured()) {
    try {
      return await autocompletePlaces(q, sessionToken);
    } catch (e) {
      if (!(e instanceof GoogleMapsUnavailableError)) throw e;
      warn("search", e);
    }
  }
  return searchIstatPlaces(q);
}

/**
 * Server-side resolution of a chosen place id. Null when the id is unknown or
 * Google cannot answer: the candidate picks again (the search then falls back
 * to ISTAT if Google is down).
 */
export async function resolvePlace(placeId: string, sessionToken?: string): Promise<ResolvedPlace | null> {
  if (isIstatPlaceId(placeId)) return resolveIstatPlace(placeId);
  if (!googleMapsConfigured()) return null;
  try {
    return toResolved(await getPlaceDetails(placeId, sessionToken));
  } catch (e) {
    if (e instanceof GooglePlaceNotFoundError) return null;
    if (e instanceof GoogleMapsUnavailableError) {
      warn("resolve", e);
      return null;
    }
    throw e;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/lib/landing/place.test.ts`
Expected: PASS. (The cache store uses the in-memory LRU in tests because `UPSTASH_*` are unset; `_resetCacheStoreForTests` gives each test a fresh store. If the test env has Upstash vars, add `vi.stubEnv("UPSTASH_REDIS_REST_URL", "")` in `beforeEach`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/place.ts src/__tests__/lib/landing/place.test.ts
git commit -m "feat(landing): place prefill, search and resolution with ISTAT fallback"
```

---

### Task 5: Contact schema and draft merge

**Files:**
- Modify: `src/lib/landing/contact.ts`
- Test: `src/__tests__/lib/landing/contact.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/lib/landing/contact.test.ts`:

1. Add `placeId: "istat:MI:milano"` to the `CONTACT` constant at the top.
2. Add the import `placeQueryFromDraft` to the existing import line.
3. Append:

```ts
describe("landingContactSchema place", () => {
  it("requires a place id and accepts an optional UUID session token", () => {
    expect(landingContactSchema.safeParse({ ...CONTACT, placeId: "" }).success).toBe(false);
    expect(landingContactSchema.safeParse({ ...CONTACT, placeId: "x".repeat(301) }).success).toBe(false);
    expect(landingContactSchema.safeParse({ ...CONTACT, placeSessionToken: "nope" }).success).toBe(false);
    expect(
      landingContactSchema.safeParse({ ...CONTACT, placeSessionToken: "6f1c1b6e-3a51-4b8f-9d3e-0c4c1c1e2a10" }).success,
    ).toBe(true);
  });
});

describe("mergeContactIntoDraft with a place", () => {
  it("overrides the draft address and location with the resolved place", () => {
    const draft = {
      isCv: true, uncertain: [],
      fields: { ...emptyCandidateDraftFields(), address: "Old 1, Roma", location: "Roma (RM)" },
    };
    const place = {
      placeId: "ChIJ1", source: "google" as const, address: "Via Roma, 12, 20121 Milano MI, Italia",
      location: "Milano (MI)", latitude: 45.47, longitude: 9.19,
    };
    const fields = mergeContactIntoDraft(draft, landingContactSchema.parse(CONTACT), place);
    expect(fields.address).toBe("Via Roma, 12, 20121 Milano MI, Italia");
    expect(fields.location).toBe("Milano (MI)");
  });
});

describe("placeQueryFromDraft", () => {
  it("returns the draft address and location", () => {
    const draft = {
      isCv: true, uncertain: [],
      fields: { ...emptyCandidateDraftFields(), address: "Via X 1, Torino", location: null },
    };
    expect(placeQueryFromDraft(draft)).toEqual({ address: "Via X 1, Torino", location: null });
    expect(placeQueryFromDraft(null)).toEqual({ address: null, location: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/lib/landing/contact.test.ts`
Expected: FAIL — `placeQueryFromDraft` missing; schema accepts an empty place id.

- [ ] **Step 3: Implement**

In `src/lib/landing/contact.ts`:

Add the import:

```ts
import type { PlaceSuggestion, ResolvedPlace } from "@/lib/geo/place-types";
```

Extend the schema (after `shareWithGlobal`):

```ts
  shareWithGlobal: z.boolean(),
  /** Chosen "Dove abiti?" place; resolved server-side at confirm. */
  placeId: z.string().trim().min(1).max(300),
  /** Google autocomplete session to close with Place Details (billing). */
  placeSessionToken: z.uuid().optional(),
});
```

After `ContactPrefill`, add:

```ts
/** What the extraction returns to the landing: contact prefill + place prefill. */
export interface LandingPrefill extends ContactPrefill {
  place: PlaceSuggestion | null;
}
```

After `contactFromDraft`, add:

```ts
/** The draft's address text, used to prefill the place field. */
export function placeQueryFromDraft(draft: unknown): { address: string | null; location: string | null } {
  const f = draftFields(draft);
  return { address: f.address, location: f.location };
}
```

Change `mergeContactIntoDraft` to accept the resolved place:

```ts
export function mergeContactIntoDraft(
  draft: unknown,
  contact: LandingContact,
  place?: ResolvedPlace,
): CandidateFields {
  const merged: Record<string, unknown> = {
    ...draftFields(draft),
    firstName: contact.firstName,
    lastName: contact.lastName,
    phone: contact.phone,
    email: contact.email,
    // Limits from the candidate fields schema (address 300, location 200).
    ...(place ? { address: place.address.slice(0, 300), location: place.location.slice(0, 200) } : {}),
  };
```

(the rest of the function is unchanged). Update its doc comment's first line to: "Full candidate fields: the LLM draft, with the contact fields (and the resolved place, when given) replaced by what the candidate confirmed."

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/lib/landing/contact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/contact.ts src/__tests__/lib/landing/contact.test.ts
git commit -m "feat(landing): place id in the contact schema and merged into fields"
```

---

### Task 6: Landing flow — prefill, search, resolution at confirm

**Files:**
- Modify: `src/lib/landing/flow.ts`
- Test: `src/__tests__/lib/landing/flow.test.ts`

- [ ] **Step 1: Update and add failing tests**

In `src/__tests__/lib/landing/flow.test.ts`:

1. Add a mock next to the others (top of the file):

```ts
vi.mock("@/lib/landing/place", async () => {
  const actual = await vi.importActual<typeof import("@/lib/landing/place")>("@/lib/landing/place");
  return { ...actual, prefillPlace: vi.fn(), searchPlaces: vi.fn(), resolvePlace: vi.fn() };
});
```

2. Import them and `searchLandingPlaces`:

```ts
import { prefillPlace, resolvePlace, searchPlaces } from "@/lib/landing/place";
```

and add `searchLandingPlaces` to the existing `@/lib/landing/flow` import list.

3. Add constants after `DRAFT`:

```ts
const PLACE = {
  placeId: "ChIJ1", source: "google" as const, address: "Via Roma, 12, 20121 Milano MI, Italia",
  location: "Milano (MI)", latitude: 45.47, longitude: 9.19,
};
const PREFILL_PLACE = { placeId: "ChIJ1", label: "Via Roma, 12, 20121 Milano MI, Italia" };
```

4. In `describe("runLandingExtraction")`'s `beforeEach` add `m(prefillPlace).mockResolvedValue(PREFILL_PLACE);` and change the first test's expectation to:

```ts
    expect(r).toEqual({
      ok: true,
      data: { firstName: "Ahmed", lastName: "Benali", phone: "333 1234567", email: "", place: PREFILL_PLACE },
    });
    expect(m(prefillPlace)).toHaveBeenCalledWith(IMPORT_ID, { address: null, location: null });
```

5. Add a new describe block before `describe("confirmLandingImport")`:

```ts
describe("searchLandingPlaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m(consumeRateLimits).mockResolvedValue(true);
    m(getPublicImport).mockResolvedValue({ id: IMPORT_ID, status: "READY", errorCode: null, draft: DRAFT });
    m(searchPlaces).mockResolvedValue([PREFILL_PLACE]);
  });
  const TOKEN = "6f1c1b6e-3a51-4b8f-9d3e-0c4c1c1e2a10";

  it("searches for a READY import under the per-import and per-IP limits", async () => {
    await expect(searchLandingPlaces(LANDING, IMPORT_ID, { query: " via  roma ", sessionToken: TOKEN }, CTX))
      .resolves.toEqual({ ok: true, data: [PREFILL_PLACE] });
    const rules = m(consumeRateLimits).mock.calls[0]![0] as { key: string; limit: number }[];
    expect(rules.map((r) => r.key)).toEqual([
      `landing:import:${IMPORT_ID}:places:d`, `landing:ip:${CTX.ipHash}:places:h`,
    ]);
    expect(rules.map((r) => r.limit)).toEqual([40, 120]);
    expect(m(searchPlaces)).toHaveBeenCalledWith("via roma", TOKEN);
  });

  it("returns an empty list for short queries without touching the DB or limits", async () => {
    await expect(searchLandingPlaces(LANDING, IMPORT_ID, { query: "ro" }, CTX)).resolves.toEqual({ ok: true, data: [] });
    expect(m(getPublicImport)).not.toHaveBeenCalled();
    expect(m(consumeRateLimits)).not.toHaveBeenCalled();
  });

  it("refuses imports that are not READY, invalid input, and over-limit searches", async () => {
    m(getPublicImport).mockResolvedValueOnce({ id: IMPORT_ID, status: "COMPLETED", errorCode: null, draft: DRAFT });
    await expect(searchLandingPlaces(LANDING, IMPORT_ID, { query: "via roma" }, CTX))
      .resolves.toEqual({ ok: false, error: "SESSION_EXPIRED" });
    await expect(searchLandingPlaces(LANDING, IMPORT_ID, { query: 42 }, CTX))
      .resolves.toEqual({ ok: false, error: "VALIDATION" });
    m(consumeRateLimits).mockResolvedValueOnce(false);
    await expect(searchLandingPlaces(LANDING, IMPORT_ID, { query: "via roma" }, CTX))
      .resolves.toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(m(searchPlaces)).not.toHaveBeenCalled();
  });

  it("maps an unavailable limiter to UNAVAILABLE", async () => {
    m(consumeRateLimits).mockRejectedValueOnce(new RateLimitUnavailableError());
    await expect(searchLandingPlaces(LANDING, IMPORT_ID, { query: "via roma" }, CTX))
      .resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
  });
});
```

6. In `describe("confirmLandingImport")`:
   - Add `placeId: "ChIJ1", placeSessionToken: "6f1c1b6e-3a51-4b8f-9d3e-0c4c1c1e2a10"` to its `CONTACT`.
   - In its `beforeEach` add `m(consumeRateLimits).mockResolvedValue(true);` and `m(resolvePlace).mockResolvedValue(PLACE);`.
   - In the first test, change the expected `rawPayloadExtra` to also contain `place: { placeId: "ChIJ1", source: "google", resolvedAt: "2026-10-29T10:00:00.000Z" }`, add `coords: { latitude: 45.47, longitude: 9.19 }` to the `toMatchObject`, change the fields expectation to `expect(args.fields).toMatchObject({ firstName: "Ahmed", phone: "+39 333 1234567", address: PLACE.address, location: "Milano (MI)" });`, and add `place: { placeId: "ChIJ1", source: "google", resolvedAt: "2026-10-29T10:00:00.000Z" }` to the expected audit `metadata`. Also assert `expect(m(resolvePlace)).toHaveBeenCalledWith("ChIJ1", "6f1c1b6e-3a51-4b8f-9d3e-0c4c1c1e2a10");`.
   - Append:

```ts
  it("returns PLACE_INVALID without confirming when the place cannot be resolved", async () => {
    m(resolvePlace).mockResolvedValueOnce(null);
    await expect(confirmLandingImport(LANDING, IMPORT_ID, CONTACT, CTX))
      .resolves.toEqual({ ok: false, error: "PLACE_INVALID" });
    expect(m(confirmImport)).not.toHaveBeenCalled();
  });

  it("limits place resolutions per import", async () => {
    m(consumeRateLimits).mockResolvedValueOnce(false);
    await expect(confirmLandingImport(LANDING, IMPORT_ID, CONTACT, CTX))
      .resolves.toEqual({ ok: false, error: "RATE_LIMITED" });
    const rules = m(consumeRateLimits).mock.calls[0]![0] as { key: string; limit: number }[];
    expect(rules).toEqual([{ key: `landing:import:${IMPORT_ID}:place-resolve:d`, limit: 10, windowSec: 86400 }]);
    expect(m(resolvePlace)).not.toHaveBeenCalled();
  });

  it("rejects a contact without a place id", async () => {
    await expect(confirmLandingImport(LANDING, IMPORT_ID, { ...CONTACT, placeId: "" }, CTX))
      .resolves.toEqual({ ok: false, error: "VALIDATION" });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/lib/landing/flow.test.ts`
Expected: FAIL — `searchLandingPlaces` not exported; prefill without `place`; no `PLACE_INVALID`.

- [ ] **Step 3: Implement**

In `src/lib/landing/flow.ts`:

Imports — replace the `./contact` import and add the place ones:

```ts
import {
  contactFromDraft,
  landingContactSchema,
  mergeContactIntoDraft,
  placeQueryFromDraft,
  type LandingPrefill,
} from "./contact";
import { MIN_PLACE_QUERY, normalizeQuery, prefillPlace, resolvePlace, searchPlaces } from "./place";
import type { PlaceSuggestion } from "@/lib/geo/place-types";
```

`getLimits()` — add:

```ts
    /** "Dove abiti?" autocomplete: per import and per IP. */
    placeSearchPerImportDay: intFromEnv("LANDING_LIMIT_PLACE_SEARCH_IMPORT", 40),
    placeSearchPerIpHour: intFromEnv("LANDING_LIMIT_PLACE_SEARCH_IP_HOUR", 120),
    /** Place Details calls at confirm (each confirm attempt). */
    placeResolvePerImportDay: intFromEnv("LANDING_LIMIT_PLACE_RESOLVE_IMPORT", 10),
```

`LandingErrorCode` — add after `"NOT_FOUND"`:

```ts
  | "NOT_FOUND"
  /** The chosen place id could not be resolved: pick the address again. */
  | "PLACE_INVALID";
```

Prefill helper (before `runLandingExtraction`):

```ts
async function prefillFor(importId: string, draft: unknown): Promise<LandingPrefill> {
  return { ...contactFromDraft(draft), place: await prefillPlace(importId, placeQueryFromDraft(draft)) };
}
```

Change `runLandingExtraction` and `extractUnderBudget` return types from `LandingResult<ContactPrefill>` to `LandingResult<LandingPrefill>`, and replace the two READY returns:

```ts
  if (imp.status === "READY") return { ok: true, data: await prefillFor(imp.id, imp.draft) };
```

```ts
  if (after?.status === "READY") return { ok: true, data: await prefillFor(after.id, after.draft) };
```

Search (after `extractUnderBudget`):

```ts
const placeSearchSchema = z.object({
  query: z.string().max(200),
  sessionToken: z.uuid().optional(),
});

/**
 * "Dove abiti?" autocomplete. Only for a READY import bound to this browser,
 * so the Google key can't be used without an upload that passed Turnstile.
 */
export async function searchLandingPlaces(
  landing: ActiveLanding,
  importId: string,
  input: unknown,
  ctx: RequestContext,
): Promise<LandingResult<PlaceSuggestion[]>> {
  const parsed = placeSearchSchema.safeParse(input);
  if (!parsed.success) return fail("VALIDATION");
  const query = normalizeQuery(parsed.data.query);
  if (query.length < MIN_PLACE_QUERY) return { ok: true, data: [] };
  try {
    const imp = await getPublicImport(importId, landing.pool.id);
    if (!imp || imp.status !== "READY") return fail("SESSION_EXPIRED");
    const LIMITS = getLimits();
    const allowed = await consumeRateLimits([
      { key: `landing:import:${imp.id}:places:d`, limit: LIMITS.placeSearchPerImportDay, windowSec: DAY },
      { key: `landing:ip:${ctx.ipHash}:places:h`, limit: LIMITS.placeSearchPerIpHour, windowSec: HOUR },
    ]);
    if (!allowed) return fail("RATE_LIMITED");
    return { ok: true, data: await searchPlaces(query, parsed.data.sessionToken) };
  } catch (e) {
    return toLandingError(e, "place search");
  }
}
```

Confirm — inside `confirmLandingImport`, right after `if (imp.status !== "READY") return fail("NOT_FOUND");`:

```ts
    const allowed = await consumeRateLimits([
      { key: `landing:import:${imp.id}:place-resolve:d`, limit: getLimits().placeResolvePerImportDay, windowSec: DAY },
    ]);
    if (!allowed) return fail("RATE_LIMITED");
    // Resolved here from the id only: the browser never supplies coordinates.
    const place = await resolvePlace(contact.placeId, contact.placeSessionToken);
    if (!place) return fail("PLACE_INVALID");
    const placeRecord = { placeId: place.placeId, source: place.source, resolvedAt: now.toISOString() };
```

and change the `confirmImport({ … })` arguments:

```ts
        fields: mergeContactIntoDraft(imp.draft, contact, place),
        coords: { latitude: place.latitude, longitude: place.longitude },
        channel: "landing_cv",
        consentToShare: shareWithGlobal,
        attachToExistingByPhone: true,
        rawPayloadExtra: { landingPageId: landing.id, consent, place: placeRecord },
```

```ts
          metadata: { ipHash: ctx.ipHash, consent, place: placeRecord },
```

Remove the now-unused `ContactPrefill` type import if tsc/eslint flag it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/lib/landing` then the tsc command from Conventions.
Expected: PASS; tsc errors only in `actions.ts`/components that still use `ContactPrefill` for the extraction result (fixed in Tasks 7 and 10) — note them, don't fix here.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/flow.ts src/__tests__/lib/landing/flow.test.ts
git commit -m "feat(landing): place prefill, rate-limited search and server-side resolution at confirm"
```

---

### Task 7: Server actions

**Files:**
- Modify: `src/app/(public)/candidati/[slug]/actions.ts`

- [ ] **Step 1: Implement**

Replace the `ContactPrefill` import with:

```ts
import type { LandingPrefill } from "@/lib/landing/contact";
import type { PlaceSuggestion } from "@/lib/geo/place-types";
```

Add `searchLandingPlaces` to the `@/lib/landing/flow` import list.

Change `runLandingExtractionAction`'s return type to `Promise<LandingResult<LandingPrefill>>`.

Add after `runLandingExtractionAction`:

```ts
export async function searchLandingPlacesAction(
  slug: string,
  input: unknown,
): Promise<LandingResult<PlaceSuggestion[]>> {
  const landing = await landingFor(slug);
  if (isFail(landing)) return landing;
  const importId = await boundImportId(landing);
  if (!importId) return { ok: false, error: "SESSION_EXPIRED" };
  const ctx = await requestContext();
  if (!ctx) return { ok: false, error: "UNAVAILABLE" };
  return searchLandingPlaces(landing, importId, input, ctx);
}
```

- [ ] **Step 2: Verify**

Run: `pnpm exec eslint "src/app/(public)/candidati/[slug]/actions.ts"`
Expected: clean. (tsc still reports the components; fixed in Task 10.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(public)/candidati/[slug]/actions.ts"
git commit -m "feat(landing): place search server action"
```

---

### Task 8: Dictionary strings

**Files:**
- Modify: `src/lib/i18n/dictionaries/it.ts`, `src/lib/i18n/dictionaries/en.ts`

- [ ] **Step 1: Implement**

In the `landing` group of `it.ts`, after `email: "Email (facoltativa)",` add:

```ts
    placeLabel: "Dove abiti?",
    placeHint: "Puoi indicare anche solo la città.",
    placePlaceholder: "Via, numero civico, città",
    placeRequired: "Scegli un indirizzo dalla lista",
    placeNoResults: "Nessun risultato. Prova a scrivere solo la città.",
```

and in `landing.errors`, after `verifyFailed`:

```ts
      placeInvalid: "Non riusciamo a trovare questo indirizzo. Sceglilo di nuovo dalla lista.",
```

In `en.ts`, same positions:

```ts
    placeLabel: "Where do you live?",
    placeHint: "Your city alone is enough.",
    placePlaceholder: "Street, number, city",
    placeRequired: "Choose an address from the list",
    placeNoResults: "No results. Try typing just the city.",
```

```ts
      placeInvalid: "We can't find this address. Please choose it again from the list.",
```

- [ ] **Step 2: Verify parity**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/lib/i18n/__tests__/index.test.ts`
Expected: PASS (deep-parity test).

- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n/dictionaries/it.ts src/lib/i18n/dictionaries/en.ts
git commit -m "feat(i18n): landing place field strings"
```

---

### Task 9: PlaceField combobox

**Files:**
- Create: `src/components/landing/place-field.tsx`
- Test: `src/__tests__/components/landing/place-field.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/__tests__/components/landing/place-field.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { getDictionary } from "@/lib/i18n";
import { searchLandingPlacesAction } from "@/app/(public)/candidati/[slug]/actions";
import { PlaceField, type PlaceSelection } from "@/components/landing/place-field";

vi.mock("@/app/(public)/candidati/[slug]/actions", () => ({ searchLandingPlacesAction: vi.fn() }));

const t = getDictionary("it").landing;
const OPTIONS = [
  { placeId: "p1", label: "Via Roma, Milano, MI, Italia" },
  { placeId: "p2", label: "Via Roma, Torino, TO, Italia" },
];

function setup(value: PlaceSelection | null = null) {
  const onChange = vi.fn();
  render(
    <I18nProvider locale="it">
      <PlaceField slug="coop-sole" value={value} onChange={onChange} describedBy="hint" />
    </I18nProvider>,
  );
  return { onChange, input: screen.getByRole("combobox") };
}

async function typeAndWait(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(searchLandingPlacesAction).mockResolvedValue({ ok: true, data: OPTIONS });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("PlaceField", () => {
  it("shows the prefilled label", () => {
    const { input } = setup({ placeId: "p1", label: "Via Roma, Milano, MI, Italia" });
    expect(input).toHaveValue("Via Roma, Milano, MI, Italia");
  });

  it("searches after the debounce with a session token and selects with the mouse", async () => {
    const { input, onChange } = setup();
    await typeAndWait(input, "via roma");
    expect(searchLandingPlacesAction).toHaveBeenCalledTimes(1);
    const [slug, arg] = vi.mocked(searchLandingPlacesAction).mock.calls[0]!;
    expect(slug).toBe("coop-sole");
    expect(arg).toMatchObject({ query: "via roma" });
    expect((arg as { sessionToken: string }).sessionToken).toMatch(/^[0-9a-f-]{36}$/);
    fireEvent.mouseDown(screen.getByRole("option", { name: OPTIONS[1]!.label }));
    expect(onChange).toHaveBeenLastCalledWith({ ...OPTIONS[1], sessionToken: (arg as { sessionToken: string }).sessionToken });
    expect(input).toHaveValue(OPTIONS[1]!.label);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports keyboard selection", async () => {
    const { input, onChange } = setup();
    await typeAndWait(input, "via roma");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", "landing-place-option-1");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ placeId: "p2" }));
  });

  it("does not search under 3 characters and clears a selection when the text changes", async () => {
    const { input, onChange } = setup({ placeId: "p1", label: "Milano" });
    await typeAndWait(input, "mi");
    expect(searchLandingPlacesAction).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows a no-results hint and an error message", async () => {
    vi.mocked(searchLandingPlacesAction).mockResolvedValueOnce({ ok: true, data: [] });
    const { input } = setup();
    await typeAndWait(input, "zzzz");
    expect(screen.getByText(t.placeNoResults)).toBeInTheDocument();
    vi.mocked(searchLandingPlacesAction).mockResolvedValueOnce({ ok: false, error: "RATE_LIMITED" });
    await typeAndWait(input, "zzzzz");
    expect(screen.getByText(t.errors.busy)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/components/landing/place-field.test.tsx`
Expected: FAIL — cannot resolve `@/components/landing/place-field`.

- [ ] **Step 3: Implement**

`src/components/landing/place-field.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/provider";
import type { PlaceSuggestion } from "@/lib/geo/place-types";
import { searchLandingPlacesAction } from "@/app/(public)/candidati/[slug]/actions";

const DEBOUNCE_MS = 300;
/** Mirrors MIN_PLACE_QUERY on the server (shorter queries return nothing). */
const MIN_QUERY = 3;
const LISTBOX_ID = "landing-place-listbox";
const optionId = (i: number) => `landing-place-option-${i}`;

/** A chosen place, with the autocomplete session it closes (Google billing). */
export interface PlaceSelection extends PlaceSuggestion {
  sessionToken?: string;
}

type Status = "idle" | "empty" | "error";

/**
 * "Dove abiti?" combobox. Suggestions come from the server (Google, or ISTAT
 * comuni as a fallback); only a suggestion can be selected, never free text.
 */
export function PlaceField({
  slug,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  slug: string;
  value: PlaceSelection | null;
  onChange: (value: PlaceSelection | null) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useT().landing;
  const [text, setText] = useState(value?.label ?? "");
  const [options, setOptions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const session = useRef<string | null>(null);
  const sessionToken = () => (session.current ??= crypto.randomUUID());

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function search(query: string) {
    const mine = ++seq.current;
    searchLandingPlacesAction(slug, { query, sessionToken: sessionToken() })
      .then((r) => {
        if (mine !== seq.current) return;
        const found = r.ok ? r.data : [];
        setOptions(found);
        setActive(-1);
        setStatus(!r.ok ? "error" : found.length ? "idle" : "empty");
        setOpen(true);
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setOptions([]);
        setStatus("error");
        setOpen(true);
      });
  }

  function onInput(next: string) {
    setText(next);
    if (value) onChange(null);
    if (timer.current) clearTimeout(timer.current);
    const query = next.replace(/\s+/g, " ").trim();
    if (query.length < MIN_QUERY) {
      seq.current++;
      setOptions([]);
      setOpen(false);
      setStatus("idle");
      return;
    }
    timer.current = setTimeout(() => search(query), DEBOUNCE_MS);
  }

  function select(option: PlaceSuggestion) {
    onChange({ ...option, sessionToken: session.current ?? undefined });
    // A selection closes the Google session: the next search starts a new one.
    session.current = null;
    setText(option.label);
    setOptions([]);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || options.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      select(options[active]!);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Input
        id="landing-placeId" role="combobox" autoComplete="off" maxLength={100}
        aria-expanded={open} aria-controls={LISTBOX_ID} aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid ? true : undefined} aria-describedby={describedBy}
        placeholder={t.placePlaceholder} value={text}
        onChange={(e) => onInput(e.target.value)} onKeyDown={onKeyDown} onBlur={() => setOpen(false)}
      />
      {open && (
        <ul id={LISTBOX_ID} role="listbox" className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
          {options.map((o, i) => (
            <li
              key={o.placeId} id={optionId(i)} role="option" aria-selected={i === active}
              className={cn("cursor-pointer rounded-sm px-2 py-1.5 text-sm", i === active && "bg-muted")}
              // mousedown + preventDefault: select before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                select(o);
              }}
            >
              {o.label}
            </li>
          ))}
          {status === "empty" && <li className="px-2 py-1.5 text-sm text-muted-foreground">{t.placeNoResults}</li>}
          {status === "error" && <li className="px-2 py-1.5 text-sm text-muted-foreground">{t.errors.busy}</li>}
        </ul>
      )}
    </div>
  );
}
```

Note on the test's "selects with the mouse" expectation: the session token passed to `onChange` is the one used by the search (`session.current` before it is reset), which is what the test compares.

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/components/landing/place-field.test.tsx` and `pnpm exec eslint src/components/landing/place-field.tsx`
Expected: PASS; lint clean. If `react-hooks` lint flags the cleanup effect, keep the effect (it only clears a timer on unmount, no state change).

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/place-field.tsx src/__tests__/components/landing/place-field.test.tsx
git commit -m "feat(landing): accessible place autocomplete field"
```

---

### Task 10: Contact form and landing flow integration

**Files:**
- Modify: `src/components/landing/contact-form.tsx`
- Modify: `src/components/landing/landing-flow.tsx`
- Test: `src/__tests__/components/landing/contact-form.test.tsx`, `src/__tests__/components/landing/landing-flow.test.tsx`

- [ ] **Step 1: Update and add failing tests**

`src/__tests__/components/landing/contact-form.test.tsx`:

1. Mock the actions module (PlaceField imports it) at the top:

```tsx
vi.mock("@/app/(public)/candidati/[slug]/actions", () => ({ searchLandingPlacesAction: vi.fn() }));
```

2. Change `PREFILL` to include a place:

```tsx
const PLACE = { placeId: "istat:MI:milano", label: "Milano (MI)" };
const PREFILL = { firstName: "Ahmed", lastName: "", phone: "333 1234567", email: "", place: PLACE };
```

3. Change `setup` to accept the prefill and pass the new props:

```tsx
function setup(showShare = true, busy = false, prefill = PREFILL) {
  const onSubmit = vi.fn();
  render(
    <I18nProvider locale="it">
      <ContactForm
        slug="coop-sole" orgName="Coop Sole" prefill={prefill} privacyPolicyUrl="https://x.it/p"
        showShare={showShare} busy={busy} placeResetKey={0} onSubmit={onSubmit}
      />
    </I18nProvider>,
  );
  return onSubmit;
}
```

4. In "submits the confirmed contact", change the expectation to:

```tsx
    expect(onSubmit).toHaveBeenCalledWith({
      firstName: "Ahmed", lastName: "Benali", phone: "333 1234567", email: "",
      privacyAccepted: true, shareWithGlobal: false, placeId: "istat:MI:milano", placeSessionToken: undefined,
    });
```

5. Append:

```tsx
  it("shows the place prefill", () => {
    setup();
    expect(screen.getByRole("combobox", { name: "Dove abiti?" })).toHaveValue("Milano (MI)");
  });

  it("blocks submit without a place", () => {
    const onSubmit = setup(true, false, { ...PREFILL, lastName: "Benali", place: null });
    fireEvent.click(screen.getByLabelText(/Ho letto l'informativa/));
    fireEvent.click(screen.getByRole("button", { name: "Invia candidatura" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Scegli un indirizzo dalla lista")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveFocus();
  });
```

`src/__tests__/components/landing/landing-flow.test.tsx`:

1. Add `searchLandingPlacesAction: vi.fn(),` to the actions mock object.
2. Change `PREFILL` to `{ firstName: "Ahmed", lastName: "", phone: "333 1234567", email: "", place: { placeId: "istat:MI:milano", label: "Milano (MI)" } }`.
3. Append:

```tsx
  it("shows the place error and clears the selection on PLACE_INVALID", async () => {
    vi.mocked(confirmLandingImportAction).mockResolvedValue({ ok: false, error: "PLACE_INVALID" });
    const { container } = setup();
    chooseFile(container);
    const lastName = await screen.findByLabelText(t.lastName);
    fireEvent.change(lastName, { target: { value: "Benali" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: t.submit }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t.errors.placeInvalid);
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.getByLabelText(t.lastName)).toHaveValue("Benali");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/components/landing`
Expected: FAIL — no combobox, unknown props.

- [ ] **Step 3: Implement `contact-form.tsx`**

Replace the imports and types at the top:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n/provider";
import { landingContactSchema, type ContactPrefill, type LandingPrefill } from "@/lib/landing/contact";
import { PlaceField, type PlaceSelection } from "./place-field";

export interface ContactSubmission extends ContactPrefill {
  privacyAccepted: boolean;
  shareWithGlobal: boolean;
  placeId: string;
  placeSessionToken: string | undefined;
}

type FieldKey = keyof ContactPrefill | "placeId" | "privacyAccepted";
const FIELD_ORDER: FieldKey[] = ["firstName", "lastName", "phone", "email", "placeId", "privacyAccepted"];
```

Props and state:

```tsx
export function ContactForm({
  slug,
  orgName,
  prefill,
  privacyPolicyUrl,
  showShare,
  busy,
  placeResetKey,
  onSubmit,
}: {
  slug: string;
  orgName: string;
  prefill: LandingPrefill;
  privacyPolicyUrl: string;
  showShare: boolean;
  busy: boolean;
  /** Bumped by the parent when the server rejects the chosen place. */
  placeResetKey: number;
  onSubmit: (values: ContactSubmission) => void;
}) {
  const t = useT().landing;
  const [values, setValues] = useState<ContactPrefill>({
    firstName: prefill.firstName,
    lastName: prefill.lastName,
    phone: prefill.phone,
    email: prefill.email,
  });
  const [place, setPlace] = useState<PlaceSelection | null>(prefill.place);
  // Reset the selection when the parent asks (adjusting state during render).
  const [seenResetKey, setSeenResetKey] = useState(placeResetKey);
  if (seenResetKey !== placeResetKey) {
    setSeenResetKey(placeResetKey);
    setPlace(null);
  }
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
```

(keep `shareWithGlobal`, `errors`, `org` as they are).

In `validate()`, build the parse input and add the place message:

```tsx
    const parsed = landingContactSchema.safeParse({
      ...values, privacyAccepted, shareWithGlobal,
      placeId: place?.placeId ?? "", placeSessionToken: place?.sessionToken,
    });
```

```tsx
        else if (key === "privacyAccepted") e.privacyAccepted = t.privacyRequired;
        else if (key === "placeId" || key === "placeSessionToken") e.placeId = t.placeRequired;
        else e[key] = t.fieldRequired;
```

(`issue.path[0]` is typed as `FieldKey`; widen the cast to `FieldKey | "placeSessionToken" | undefined`.)

Submit:

```tsx
        if (validate()) {
          onSubmit({
            ...values, privacyAccepted, shareWithGlobal,
            placeId: place!.placeId, placeSessionToken: place!.sessionToken,
          });
        }
```

Field, after `{field("email", …)}`:

```tsx
      <div className="space-y-1.5">
        <Label htmlFor="landing-placeId">{t.placeLabel}</Label>
        <PlaceField
          key={placeResetKey} slug={slug} value={place} onChange={setPlace} invalid={Boolean(errors.placeId)}
          describedBy={errors.placeId ? "landing-placeId-hint landing-placeId-error" : "landing-placeId-hint"}
        />
        <p id="landing-placeId-hint" className="text-xs text-muted-foreground">{t.placeHint}</p>
        {errors.placeId && <p id="landing-placeId-error" role="alert" className="text-sm text-destructive">{errors.placeId}</p>}
      </div>
```

- [ ] **Step 4: Implement `landing-flow.tsx`**

- Import `LandingPrefill` instead of `ContactPrefill`: `import type { LandingPrefill } from "@/lib/landing/contact";` and change the step type to `{ kind: "contact"; prefill: LandingPrefill }`.
- `type ErrorKey = … | "verifyFailed" | "placeInvalid";`
- In `errorKey`, before `default`: `case "PLACE_INVALID": return "placeInvalid";`
- State: `const [placeResetKey, setPlaceResetKey] = useState(0);`
- In `confirm()`, in the failure branch:

```tsx
      } else {
        if (r.error === "PLACE_INVALID") setPlaceResetKey((k) => k + 1);
        showError(r.error, null, { retryExtraction: false });
      }
```

- Pass the new props to `ContactForm`: `slug={props.slug}` and `placeResetKey={placeResetKey}`.

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run src/__tests__/components/landing src/__tests__/lib/landing src/__tests__/lib/geo src/lib/i18n/__tests__/index.test.ts`, then the tsc command, then `pnpm exec eslint src/components/landing src/lib/landing src/lib/geo "src/app/(public)"`.
Expected: all PASS; no new tsc errors; lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/landing/contact-form.tsx src/components/landing/landing-flow.tsx src/__tests__/components/landing/contact-form.test.tsx src/__tests__/components/landing/landing-flow.test.tsx
git commit -m "feat(landing): required 'Dove abiti?' field on the confirmation form"
```

---

### Task 11: Configuration and docs

**Files:**
- Modify: `.env.example` (repo root)
- Modify: `docs/setup/candidate-landing-setup.md`
- Modify: `CLAUDE.md` (repo root)
- Modify: `docs/superpowers/specs/2026-10-31-landing-candidate-geocoding-design.md`

- [ ] **Step 1: `.env.example`**

In the "Public candidate landing" section, after `LANDING_IP_SALT=`, add:

```bash
# Google Maps Platform (server only, never NEXT_PUBLIC_): "Dove abiti?" prefill,
# autocomplete and address resolution. Enable Geocoding API + Places API (New),
# restrict the key to those two APIs. Blank = ISTAT comuni fallback (dev/preview).
GOOGLE_MAPS_API_KEY=
```

and after `# LANDING_LIMIT_IMPORT_DAY=2`:

```bash
# Address autocomplete and resolution limits.
# LANDING_LIMIT_PLACE_SEARCH_IMPORT=40
# LANDING_LIMIT_PLACE_SEARCH_IP_HOUR=120
# LANDING_LIMIT_PLACE_RESOLVE_IMPORT=10
```

- [ ] **Step 2: Setup guide**

In `docs/setup/candidate-landing-setup.md`:
- Add a row/line for Google Maps Platform to the dependency map in section 0.
- Insert a new section after "## 5. Mistral — OCR ed estrazione dati", titled `## 5b. Google Maps Platform — indirizzo del candidato`, containing (in Italian, same style as the other sections):
  1. Create or choose a Google Cloud project with billing enabled.
  2. Enable **Geocoding API** and **Places API (New)**.
  3. Create an API key; under *API restrictions* allow only those two APIs. Application restrictions by IP are not possible on Vercel (dynamic egress IPs), so keep the key server-side only.
  4. Set per-API daily quotas (e.g. 1,000 requests/day each) and a budget alert on the project.
  5. Put the key in Vercel Production as `GOOGLE_MAPS_API_KEY`. Leave it unset in Preview to test the ISTAT fallback, or set a separate key.
  6. Check the current free monthly usage for Place Details Essentials and Geocoding in the console.
  7. Privacy: the landing's privacy notice must list Google as a recipient of the address.
  8. Known decision: Google's terms allow caching geocoded lat/lng for 30 days; Kubri stores them permanently by choice (as with Make).
- In section 7 (Vercel variables) add `GOOGLE_MAPS_API_KEY` to the Production list.
- In section 10 (acceptance tests) add: CV with an address → field prefilled with Google's address; CV without address → empty field, choose a city → candidate saved with coordinates; candidate detail shows the address.
- In section 11 (troubleshooting) add: suggestions are only "Comune (PROV)" → Google key missing/invalid or quota exceeded (the code fell back to ISTAT; check logs for `[landing] place search fell back`).

- [ ] **Step 3: `CLAUDE.md`**

In "Environment Variables", extend the Candidate landing bullet:

```markdown
- **Candidate landing**: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `LANDING_COOKIE_SECRET` (≥32 chars), `LANDING_IP_SALT` (≥16 chars), `GOOGLE_MAPS_API_KEY` (server only; address autocomplete/geocoding, ISTAT fallback when unset); Upstash Redis is required in production for its rate limits
```

In "Candidate ingestion", append to the landing bullet: "The candidate's address comes from the required place field: the place id is resolved server-side (`src/lib/landing/place.ts`, Google or ISTAT fallback); never accept client-sent coordinates."

- [ ] **Step 4: Spec**

In the spec's Flow section, replace `language=<page locale>` with `language=it` and `` `languageCode` = page locale `` with `` `languageCode` = `it` ``, and add one line: "All Google requests use Italian: stored addresses are read by Italian operators."

- [ ] **Step 5: Commit**

```bash
git add ../../.env.example ../../docs/setup/candidate-landing-setup.md ../../CLAUDE.md ../../docs/superpowers/specs/2026-10-31-landing-candidate-geocoding-design.md
git commit -m "docs: Google Maps setup and env for landing geocoding"
```

---

### Task 12: Final verification

- [ ] **Step 1: Full test suite**

Run: `DATABASE_URL= DIRECT_URL= pnpm exec vitest run`
Expected: everything passes except the DB-backed files that fail with "DATABASE_URL environment variable is not set" (pre-existing: lists/service, pools/access, pools/actions, pools/resolve, jobs/matcher/semantic).

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm exec tsc --noEmit -p . 2>&1 | grep -v "candidate-pdf\|CompetenceReportPdf" | grep -c error` → expected `0`.
Run: `pnpm exec eslint src/lib/geo src/lib/landing src/components/landing "src/app/(public)" src/lib/candidates/dashboard-create.ts src/lib/candidate-imports/service.ts` → expected clean.

- [ ] **Step 3: Manual check without a Google key (local dev)**

With the dashboard dev server on the dev DB and an enabled landing: upload a CV that has an address in a known comune → the field shows "Comune (PROV)" prefilled; clear it, type "tori" → "Torino (TO)" appears; choose it, confirm → the candidate detail shows "Torino (TO)" as address/location; the DB row has `latitude`/`longitude` set and `rawPayload.place.source = "istat"`.

- [ ] **Step 4: Report**

Summarize the results, the commits, and what remains to verify with a real Google key on preview.
