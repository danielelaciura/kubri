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
