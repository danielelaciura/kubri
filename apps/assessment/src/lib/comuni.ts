export type Comune = {
  nome: string;
  sigla: string;
  lat: number;
  lon: number;
};

const normalize = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/**
 * Filter comuni by a free-text query. Accent/case-insensitive. Prefix matches
 * rank before substring matches; results are capped to `limit`.
 */
export function searchComuni(query: string, comuni: Comune[], limit = 50): Comune[] {
  const q = normalize(query);
  if (!q) return [];
  const prefix: Comune[] = [];
  const substr: Comune[] = [];
  for (const c of comuni) {
    const n = normalize(c.nome);
    if (n.startsWith(q)) prefix.push(c);
    else if (n.includes(q)) substr.push(c);
    // Once we have `limit` prefix matches, substring matches can never rank in,
    // so stop scanning — the trailing `.slice` keeps only the prefix block.
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...substr].slice(0, limit);
}

let cache: Comune[] | null = null;

/** Fetch the static comuni dataset once and memoize it. */
export async function loadComuni(): Promise<Comune[]> {
  if (cache) return cache;
  const res = await fetch("/comuni.json");
  if (!res.ok) throw new Error(`comuni.json -> ${res.status}`);
  cache = (await res.json()) as Comune[];
  return cache;
}

/** The label stored in `Candidate.location`, e.g. "Roma (RM)". */
export const comuneLabel = (c: Comune) => `${c.nome} (${c.sigla})`;
