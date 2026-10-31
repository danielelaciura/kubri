# Landing candidate geocoding — design

Date: 2026-10-31
Status: approved in brainstorming, pending spec review
Scope: public candidate landing (`/candidati/[slug]`) only

## Problem

Candidates from the Make chatbot arrive with `lat`/`lng`: Make asks where the candidate lives and queries Google Maps. Candidates from the public CV landing have no equivalent:

- The CV extraction LLM fills `address` and `location` ("Comune (PROV)") when the CV states them.
- `buildDashboardCandidateInput` geocodes these offline with the ISTAT dataset (`geocodeFromAddress`). This works only for an exact comune name in the last comma-separated token, at comune precision.
- The landing confirmation form asks only for name, phone, email and consent.

Result: landing candidates whose CV has no address, or an address the offline geocoder cannot parse (frazioni, typos, extra tokens such as ", Italia"), are saved with `latitude = longitude = null`. They never appear in radius-based JD matching.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Precision | Street address when available (as Make/Google does today), comune accepted |
| Landing UX | "Dove abiti?" field always shown on the confirmation form, prefilled from the CV, editable |
| Required | Yes. A comune/city alone is enough; the candidate is never forced to give a street |
| Scope | Landing only. Dashboard CV import and manual form keep today's offline geocoding |
| Provider | Google Maps Platform (Geocoding API + Places API (New) Autocomplete / Place Details) |
| Architecture | Approach A: every Google call goes through our server; the key never reaches the browser |
| Google's 30-day lat/lng caching limit | **Knowingly ignored**: coordinates are stored permanently, as with Make today (see Risks) |
| Schema | No migration: place id and coordinate source go in `Candidate.rawPayload` |

## Flow

All Google requests use Italian: stored addresses are read by Italian operators.

1. **Prefill (end of extraction).** `runLandingExtraction` returns the contact prefill as today, plus a `place` prefill:
   - Query text = draft `address`, else draft `location`. If both are empty, `place = null`.
   - Server calls the Geocoding API once (`region=it`, `components=country:IT`, `language=it`, 3 s timeout).
   - Only results whose `types` include one of `street_address`, `premise`, `subpremise`, `route`, `locality`, `postal_code`, `administrative_area_level_3`, `sublocality` are accepted. Anything broader (e.g. "Italia", a region) gives `place = null`.
   - The client receives `{ placeId, label }` only (label = Google's `formatted_address`).
   - The prefill is cached in the existing cache store (`getCacheStore()`, key `landing:prefill:<importId>`, TTL 30 min, same as the import cookie), so polling, a second tab or a reload doesn't geocode again. A cache failure only costs a repeat geocode.
   - Any Google failure gives `place = null`; extraction never fails because of geocoding.

2. **"Dove abiti?" field** on the contact form (`PlaceField`):
   - Combobox input, hint "Puoi indicare anche solo la città". Prefilled with the prefill label when present.
   - Typing (≥3 chars, 300 ms debounce) calls `searchLandingPlacesAction(slug, query, sessionToken)` → up to 5 suggestions `{ placeId, label }`.
   - Google Autocomplete (New): `includedRegionCodes: ["it"]`, `languageCode` = `it`, a client-generated UUID session token (one per field session, renewed after a selection), so the autocomplete requests are billed as one session closed by Place Details.
   - Selecting a suggestion stores `{ placeId, label }` in form state. Editing the text after a selection clears the selection.
   - Submit is blocked without a selection ("Scegli un indirizzo dalla lista"). The field error is in both dictionaries.

3. **Confirm.** The landing contact schema gains `placeId: string` (max 300 chars, required) and `placeSessionToken?: string`.
   - `confirmLandingImport` resolves the place **server-side** from the id: Google Place Details (New) with field mask `id,formattedAddress,location,addressComponents`, passing the session token when present. Coordinates sent by a client are never accepted (there is no such field).
   - From the details: `address = formattedAddress`; `location = "<locality> (<province code>)"` built from `addressComponents` (`administrative_area_level_3` first, then `locality`, for the comune — in Italy `locality` is often a frazione, e.g. Lido di Camaiore; `administrative_area_level_2` short name for the province code), falling back to the closest ISTAT comune name if the components are incomplete; `latitude`/`longitude` from `location`.
   - The resolved values override the draft's `address` / `location` and are passed to `confirmImport` as explicit coordinates (new optional `coords` input, threaded to `buildDashboardCandidateInput`, which uses them instead of `geocodeFromAddress`).
   - `rawPayloadExtra.place = { placeId, source: "google" | "istat", resolvedAt }`.
   - An invalid/unknown place id, or a Place Details failure, returns a new landing error `PLACE_INVALID`, shown as "Non riusciamo a trovare questo indirizzo. Sceglilo di nuovo dalla lista." The form keeps all typed values; only the place selection is cleared.
   - **Attach case** (same phone already in the pool): unchanged rule — the existing candidate's profile fields, including address and coordinates, are not edited. The place is still recorded in the audit metadata.

4. **ISTAT fallback.** When `GOOGLE_MAPS_API_KEY` is unset (local dev, preview) or Google errors/times out:
   - Search returns ISTAT comuni matching the query prefix (normalized with `normalizePlace`), ids `istat:<provinceCode>:<normalized municipality>`, labels "Comune (PROV)".
   - Confirm resolves `istat:` ids from `ITALY_ADMIN` (comune centroid), `source: "istat"`.
   - Prefill uses the existing offline `geocodeFromAddress` / `resolvePlaceCoords` on the draft and, if it resolves, prefills the matching `istat:` id via `istatPlaceForText`.
   - ISTAT text matching takes the comune from the last comma-separated token; a trailing "(PROV)" code picks between homonymous comuni (e.g. Calliano TN / AT), otherwise the first match wins.
   - "Google errors" includes malformed responses: a non-JSON body or an unexpected body shape counts as unavailable (`GoogleMapsUnavailableError`) and triggers the same fallback. A Place Details 400 whose message mentions the API key also counts as unavailable (other 400s mean a bad id: not found). Individual malformed results/suggestions are skipped, never thrown.
   - The landing never blocks an application because Google is down.

## Modules

| File | Purpose |
|---|---|
| `src/lib/geo/google.ts` | Minimal Google client over `fetch` (no new dependency): `geocodeAddress`, `autocompletePlaces`, `getPlaceDetails`. Timeout via `AbortSignal.timeout`, typed results, `GoogleMapsUnavailableError` on missing key / HTTP error / timeout / malformed (non-JSON or wrongly shaped) body. Always sends `language`/`languageCode` = `it`. Never logs query text. |
| `src/lib/geo/istat-places.ts` | ISTAT side of the same interface: `searchIstatPlaces(query, limit)`, `resolveIstatPlace(id)`, `istatPlaceForText(text)`, `nearestIstatLabel(latitude, longitude)`. |
| `src/lib/landing/place.ts` | Landing logic: `prefillPlace(importId, draft)`, `searchPlaces(query, sessionToken)` (Google → ISTAT fallback), `resolvePlace(placeId, sessionToken)` (none of these take a locale) → `{ address, location, latitude, longitude, placeId, source }`. |
| `src/app/(public)/candidati/[slug]/actions.ts` | New `searchLandingPlacesAction`. `runLandingExtractionAction` and `confirmLandingImportAction` carry the place data. |
| `src/components/landing/place-field.tsx` | Accessible combobox (`role="combobox"`, `aria-expanded`, `aria-activedescendant`, listbox with options; arrows/Enter/Escape). |
| `src/components/landing/contact-form.tsx` | Adds the field; validation. |

## Abuse and cost controls

- `searchLandingPlacesAction` requires a valid `kubri_landing_import` cookie whose import is `READY` for this landing (same binding as confirm). No cookie → no search; a bot can't use our key without first passing Turnstile, the upload rate limits and a real CV extraction.
- Upstash rules (fail-closed in production, consumed sequentially like the existing ones), configurable through env:
  - `LANDING_LIMIT_PLACE_SEARCH_IMPORT` — 40 searches per import per day
  - `LANDING_LIMIT_PLACE_SEARCH_IP_HOUR` — 120 searches per IP hash per hour
  - `LANDING_LIMIT_PLACE_RESOLVE_IMPORT` — 10 Place Details per import per day (confirm attempts); `istat:` ids skip this limit (local and free)
  - Search over the limit returns an empty list plus `RATE_LIMITED`, shown with the generic "busy" message.
- Query length capped at 100 chars; whitespace collapsed; queries under 3 chars return nothing without calling Google.
- Google Cloud console setup (setup guide): API key restricted to Geocoding API + Places API (New) only (application restriction by IP isn't possible on Vercel), daily quota per API, budget alert.
- Expected cost per landing application: 1 Geocoding + 1 autocomplete session closed by 1 Place Details (Essentials). Order of magnitude €1–2 per 100 applications before the monthly free usage; very likely €0 at current volume.

## Privacy

- Only the address text / search query is sent to Google — never name, phone, email or CV content.
- Addresses and queries are never logged; errors log only the error class/name (no HTTP status).
- **Checklist (owner: Kubri, not code):** each landing's privacy notice must list Google as a recipient of the address. Google is already a recipient for chatbot candidates through Make.

## Configuration

- New env: `GOOGLE_MAPS_API_KEY` (server only, never `NEXT_PUBLIC_`). Added to `.env.example` and the landing setup guide.
- New env limits listed above, with defaults.

## Error handling summary

| Situation | Behaviour |
|---|---|
| Geocoding fails / times out at prefill | `place = null`, empty field, extraction succeeds |
| CV address too generic | `place = null` |
| No key / Google down during search | ISTAT comuni suggestions |
| No selection on submit | Client-side field error, no request |
| Place Details fails / invalid id at confirm | `PLACE_INVALID`, form kept, selection cleared |
| Search rate limit hit | Empty suggestions + "busy" message |
| Upstash unavailable in production | Search refused (fail-closed), "busy" message, WhatsApp fallback link |

## Testing

- `geo/google.ts`: mocked `fetch` — geocode result filtering by type, autocomplete mapping, details parsing (comune + province code from components), HTTP error, timeout, missing key.
- `geo/istat-places.ts`: prefix search, accent/case normalization, id round-trip, unknown id.
- `landing/place.ts`: prefill cache hit/miss, Google → ISTAT fallback, resolve for `google` and `istat` ids, invalid id.
- `landing/flow.ts`: confirm passes resolved coords and address to `confirmImport`; `PLACE_INVALID`; attach case leaves the candidate untouched; search requires a READY import and consumes the new limits.
- `dashboard-create.ts`: explicit `coords` override offline geocoding.
- Components: suggestions render, keyboard selection, edit clears selection, submit blocked without selection, prefill shown.
- Manual: preview deploy with a real key — prefill from a CV with an address, from one without, comune-only selection, Italian and English pages.

## Risks and known limitations

- **Google Maps Platform terms**: Geocoding lat/lng may be cached for at most 30 consecutive days (Service Specific Terms); place ids may be kept. We store coordinates permanently by explicit decision, matching what the Make flow already does. Revisit if Kubri wants to be strictly compliant: options are re-fetching from the stored place id before expiry, or downgrading to ISTAT comune centroids after 30 days.
- Data transfer to Google (US): covered by Google's DPA/SCCs; must be reflected in the privacy notice.
- Free-tier thresholds for Place Details Essentials are reported as 5,000 or 10,000 per month depending on the source; confirm in the Google Cloud console before launch.
- Candidates living abroad cannot select a foreign address (search restricted to Italy). Accepted: the landing serves Italian organizations.
- Dashboard CV import and manual creation keep comune-level offline geocoding (out of scope).
