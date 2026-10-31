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
