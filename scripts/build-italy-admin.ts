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

  // Italy bounding box (rough) — used to discard avalla rows with garbage
  // values (e.g. lat==lng, swapped fields, sentinel zeros).
  function isPlausibleItaly(lat: number, lng: number): boolean {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= 35 &&
      lat <= 48 &&
      lng >= 6 &&
      lng <= 19 &&
      lat !== lng
    );
  }

  const coordIndex = new Map<string, { lat: number; lng: number }>();
  const provAggregate = new Map<string, { latSum: number; lngSum: number; n: number }>();
  for (const c of coords) {
    if (!isPlausibleItaly(c.lat, c.lng)) continue;
    const provKey = pad3(c.codice_prov_istat);
    const key = provKey + pad3(c.codice_comu_istat);
    coordIndex.set(key, { lat: c.lat, lng: c.lng });
    const agg = provAggregate.get(provKey) ?? { latSum: 0, lngSum: 0, n: 0 };
    agg.latSum += c.lat;
    agg.lngSum += c.lng;
    agg.n++;
    provAggregate.set(provKey, agg);
  }
  const provCentroid = new Map<string, { lat: number; lng: number }>();
  for (const [k, a] of provAggregate) {
    provCentroid.set(k, { lat: a.latSum / a.n, lng: a.lngSum / a.n });
  }

  // Pass 1: classify each name row as direct hit, province-centroid hit, or
  // unresolved. While doing it, accumulate per-region coords (using the
  // matteocontrini region name) so we can derive a region-level fallback for
  // anything that province-centroid couldn't help with (e.g. provinces newer
  // than the avalla dataset, like 111 = Sud Sardegna).
  type Resolved = {
    name: NameRow;
    coord: { lat: number; lng: number } | null;
    via: "direct" | "province" | "region" | null;
  };
  const resolved: Resolved[] = [];
  const regionAggregate = new Map<string, { latSum: number; lngSum: number; n: number }>();
  for (const n of names) {
    const direct = coordIndex.get(n.codice);
    if (direct) {
      resolved.push({ name: n, coord: direct, via: "direct" });
      const r = regionAggregate.get(n.regione.nome) ?? { latSum: 0, lngSum: 0, n: 0 };
      r.latSum += direct.lat;
      r.lngSum += direct.lng;
      r.n++;
      regionAggregate.set(n.regione.nome, r);
      continue;
    }
    const provKey = n.codice.slice(0, 3);
    const provFb = provCentroid.get(provKey);
    if (provFb) {
      resolved.push({ name: n, coord: provFb, via: "province" });
      continue;
    }
    resolved.push({ name: n, coord: null, via: null });
  }

  const regionCentroid = new Map<string, { lat: number; lng: number }>();
  for (const [k, a] of regionAggregate) {
    regionCentroid.set(k, { lat: a.latSum / a.n, lng: a.lngSum / a.n });
  }

  const rows: Row[] = [];
  const fallbackProv: string[] = [];
  const fallbackReg: string[] = [];
  const dropped: string[] = [];
  for (const r of resolved) {
    let coord = r.coord;
    let via = r.via;
    if (!coord) {
      const reg = regionCentroid.get(r.name.regione.nome);
      if (reg) {
        coord = reg;
        via = "region";
      }
    }
    if (!coord) {
      dropped.push(`${r.name.nome} (${r.name.codice})`);
      continue;
    }
    if (via === "province") fallbackProv.push(`${r.name.nome} (${r.name.codice})`);
    if (via === "region") fallbackReg.push(`${r.name.nome} (${r.name.codice})`);
    rows.push({
      municipality: r.name.nome,
      province: r.name.provincia.nome,
      provinceCode: r.name.sigla,
      region: r.name.regione.nome,
      latitude: coord.lat,
      longitude: coord.lng,
    });
  }

  if (dropped.length > names.length * 0.01) {
    throw new Error(
      `Too many comuni dropped without coords (${dropped.length}/${names.length}). Sample: ${dropped.slice(0, 10).join(", ")}`,
    );
  }
  if (fallbackProv.length > 0) {
    console.warn(
      `Province centroid fallback for ${fallbackProv.length} comuni. Sample: ${fallbackProv.slice(0, 5).join(", ")}...`,
    );
  }
  if (fallbackReg.length > 0) {
    console.warn(
      `Region centroid fallback for ${fallbackReg.length} comuni. Sample: ${fallbackReg.slice(0, 5).join(", ")}...`,
    );
  }
  if (dropped.length > 0) {
    console.warn(
      `Dropped ${dropped.length} comuni without coords: ${dropped.slice(0, 5).join(", ")}...`,
    );
  }

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
