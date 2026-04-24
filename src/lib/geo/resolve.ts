import { ITALY_ADMIN, type ItalyAdminRow } from "./italy-admin";

export function normalizePlace(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

interface Indices {
  byMunicipality: Map<string, ItalyAdminRow>;
  byProvince: Map<string, ItalyAdminRow>;
  byRegion: Map<string, string>;
  allMunicipalities: string[];
  allProvinces: string[];
  allRegions: string[];
}

let _indices: Indices | null = null;
function indices(): Indices {
  if (_indices) return _indices;
  const byMunicipality = new Map<string, ItalyAdminRow>();
  const byProvince = new Map<string, ItalyAdminRow>();
  const byRegion = new Map<string, string>();
  for (const row of ITALY_ADMIN) {
    byMunicipality.set(normalizePlace(row.municipality), row);
    byProvince.set(normalizePlace(row.province), row);
    byRegion.set(normalizePlace(row.region), row.region);
  }
  _indices = {
    byMunicipality,
    byProvince,
    byRegion,
    allMunicipalities: [...byMunicipality.keys()],
    allProvinces: [...byProvince.keys()],
    allRegions: [...byRegion.keys()],
  };
  return _indices;
}

export interface ResolvedLocation {
  municipality?: string;
  province?: string;
  region?: string;
  confidence: "exact" | "partial" | "none";
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      const val = a[i - 1] === b[j - 1]
        ? (row[j - 1] as number)
        : 1 + Math.min(row[j - 1] as number, row[j] as number, prev);
      row[j - 1] = prev;
      prev = val;
    }
    row[n] = prev;
  }
  return row[n] as number;
}

function fuzzyFind(query: string, candidates: string[], maxDistance: number): string | undefined {
  let best: { name: string; dist: number } | undefined;
  for (const c of candidates) {
    if (Math.abs(c.length - query.length) > maxDistance) continue;
    const d = levenshtein(query, c);
    if (d <= maxDistance && (!best || d < best.dist)) best = { name: c, dist: d };
  }
  return best?.name;
}

export function resolveLocation(input: string): ResolvedLocation {
  const key = normalizePlace(input);
  if (!key) return { confidence: "none" };
  const idx = indices();

  const m = idx.byMunicipality.get(key);
  if (m) return { municipality: m.municipality, province: m.province, region: m.region, confidence: "exact" };

  const p = idx.byProvince.get(key);
  if (p) return { province: p.province, region: p.region, confidence: "exact" };

  const r = idx.byRegion.get(key);
  if (r) return { region: r, confidence: "exact" };

  const fm = fuzzyFind(key, idx.allMunicipalities, 2);
  if (fm) {
    const row = idx.byMunicipality.get(fm)!;
    return { municipality: row.municipality, province: row.province, region: row.region, confidence: "partial" };
  }
  const fp = fuzzyFind(key, idx.allProvinces, 2);
  if (fp) {
    const row = idx.byProvince.get(fp)!;
    return { province: row.province, region: row.region, confidence: "partial" };
  }
  const fr = fuzzyFind(key, idx.allRegions, 2);
  if (fr) {
    return { region: idx.byRegion.get(fr)!, confidence: "partial" };
  }

  return { confidence: "none" };
}
