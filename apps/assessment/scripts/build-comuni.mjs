// Generates apps/assessment/public/comuni.json from open ISTAT-derived sources.
// One-time / occasional run: `node apps/assessment/scripts/build-comuni.mjs`.
// Output: [{ nome, sigla, lat, lon }] sorted by nome, coords rounded to 5dp.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const NAMES = "https://raw.githubusercontent.com/matteocontrini/comuni-json/master/comuni.json";
const GEO = "https://raw.githubusercontent.com/MatteoHenryChinaski/Comuni-Italiani-2018-Sql-Json-Excel/master/italy_geo.json";
const OP = "https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_IT_municipalities.geojson";

const key = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const normIstat = (istat) => {
  istat = String(istat);
  const comune = istat.slice(-3).padStart(3, "0");
  const prov = istat.slice(0, -3).padStart(3, "0");
  return prov + comune;
};
const round5 = (n) => Math.round(n * 1e5) / 1e5;
function centroid(geom) {
  let xs = 0, ys = 0, n = 0;
  (function walk(a) { if (typeof a[0] === "number") { xs += a[0]; ys += a[1]; n++; } else a.forEach(walk); })(geom.coordinates);
  return [ys / n, xs / n]; // [lat, lon]
}
const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} -> ${r.status}`); return r.json(); };

const [names, geo, op] = await Promise.all([getJson(NAMES), getJson(GEO), getJson(OP)]);

const coordsByIstat = new Map(geo.map((g) => [normIstat(g.istat), { lat: +g.lat, lon: +g.lng }]));
const opExact = new Map();
const opList = [];
for (const f of op.features) {
  const k = key(f.properties.name || "");
  const [lat, lon] = centroid(f.geometry);
  opExact.set(k, { lat, lon });
  opList.push([k, { lat, lon }]);
}

const out = [];
const failed = [];
for (const c of names) {
  let co = coordsByIstat.get(c.codice);
  if (!co) {
    const k = key(c.nome);
    co = opExact.get(k) || (opList.find(([ok]) => ok.startsWith(k)) || [])[1];
  }
  if (!co) { failed.push(c.nome); continue; }
  out.push({ nome: c.nome, sigla: c.sigla, lat: round5(co.lat), lon: round5(co.lon) });
}
if (failed.length) throw new Error(`Unresolved comuni: ${failed.length} -> ${failed.join(", ")}`);

out.sort((a, b) => a.nome.localeCompare(b.nome, "it"));
const dst = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "comuni.json");
writeFileSync(dst, JSON.stringify(out));
console.log(`Wrote ${out.length} comuni -> ${dst}`);
