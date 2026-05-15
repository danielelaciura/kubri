import { LRUCache } from "lru-cache";
import type { Candidate } from "@/types";
import { chatCompletion } from "./client";
import { LLMError } from "./errors";

export interface RerankInput {
  jd: {
    name: string;
    description: string;
    skills: string[];
    locationMunicipality: string | null;
  };
  candidates: Candidate[];
}

export interface CandidateEnrichment {
  candidateId: string;
  score: number;
  summary: string;
  matchedSkills: string[];
  missingSkills: string[];
  redFlags: string[];
}

const SYSTEM_PROMPT = `Sei un assistente che valuta la compatibilità tra un'offerta di lavoro italiana (Job Description) e un elenco di candidati. Restituisci ESCLUSIVAMENTE un oggetto JSON valido con la struttura specificata, in italiano.

CRITERI DI VALUTAZIONE (in ordine di importanza):
1. Coerenza tra il ruolo desiderato del candidato e il ruolo della JD (es. badante ↔ assistenza anziani, magazziniere ↔ logistica)
2. Sovrapposizione tra le competenze richieste dalla JD e quelle del candidato
3. Esperienza lavorativa pertinente al ruolo
4. Vincoli compatibili (turni, disponibilità a trasferte, lingue, patente, permesso di lavoro)
5. Red flag operativi (cambi di settore frequenti, sotto/sovra-qualificazione netta, gap evidenti)

SCALA SCORE 0-100:
- 90-100: candidato eccellente, settore/ruolo identici, skill match >70%
- 75-89: buon match, ruolo affine o esperienza trasferibile chiara
- 60-74: match parziale, alcune competenze rilevanti ma settore diverso
- 40-59: scarsa coerenza di ruolo, solo tratti generici utili
- 0-39: profilo non pertinente

REGOLE:
- Non inventare informazioni: usa SOLO quanto fornito nel profilo del candidato.
- matchedSkills e missingSkills devono fare riferimento alle skill della JD.
- redFlags devono essere osservazioni concrete dal profilo (max 2 voci, ognuna max 80 caratteri); se non ce ne sono restituisci [].
- summary: 1-2 frasi italiane che spiegano la valutazione complessiva (max 200 caratteri).
- Restituisci una entry per OGNI candidato fornito, nello stesso ordine.

SCHEMA DI OUTPUT (obbligatorio):
{
  "results": [
    {
      "candidateId": "string",
      "score": <numero 0-100>,
      "summary": "string",
      "matchedSkills": ["string"],
      "missingSkills": ["string"],
      "redFlags": ["string"]
    }
  ]
}`;

function formatCandidate(c: Candidate, n: number): string {
  const skills = c.skillsAndCompetences.length > 0 ? c.skillsAndCompetences.join(", ") : "—";
  const experience = c.workExperience.length > 0 ? c.workExperience.join("; ") : "—";
  const education = c.educationAndTraining.length > 0 ? c.educationAndTraining.join("; ") : "—";
  const languages = [c.languages.language, ...c.languages.additionalLanguages]
    .filter((l) => l && l.length > 0)
    .join(", ");
  return `--- Candidato ${n} ---
ID: ${c.id}
Nome: ${c.firstName} ${c.lastName}
Ruolo desiderato: ${c.jobPreferences.desiredJob || "—"}
Competenze: ${skills}
Esperienza: ${experience}
Formazione: ${education}
Lingue: ${languages || "—"}
Vincoli: ${c.jobPreferences.constraints || "nessuno"}
Patente: ${c.drivingLicense ? "sì" : "no"} | Permesso di lavoro: ${c.workingPermit ? "sì" : "non specificato"}`;
}

function buildUserMessage(input: RerankInput): string {
  const lines: string[] = [];
  lines.push("OFFERTA DI LAVORO");
  lines.push(`Titolo: ${input.jd.name}`);
  if (input.jd.description) lines.push(`Descrizione: ${input.jd.description}`);
  if (input.jd.skills.length > 0) lines.push(`Competenze richieste: ${input.jd.skills.join(", ")}`);
  if (input.jd.locationMunicipality) lines.push(`Sede: ${input.jd.locationMunicipality}`);
  lines.push("");
  lines.push(`CANDIDATI DA VALUTARE (${input.candidates.length}):`);
  lines.push("");
  for (let i = 0; i < input.candidates.length; i++) {
    lines.push(formatCandidate(input.candidates[i]!, i + 1));
    lines.push("");
  }
  return lines.join("\n");
}

interface RawResult {
  candidateId?: unknown;
  score?: unknown;
  summary?: unknown;
  matchedSkills?: unknown;
  missingSkills?: unknown;
  redFlags?: unknown;
}

function parseRerankResponse(content: string): CandidateEnrichment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new LLMError("Rerank response is not valid JSON", e);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new LLMError("Rerank response is not an object");
  }
  const results = (parsed as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    throw new LLMError("Rerank response missing 'results' array");
  }
  return results.map((r: RawResult, idx) => {
    if (typeof r.candidateId !== "string") {
      throw new LLMError(`Rerank result ${idx}: candidateId is not a string`);
    }
    const score = typeof r.score === "number" ? Math.max(0, Math.min(100, Math.round(r.score))) : 0;
    return {
      candidateId: r.candidateId,
      score,
      summary: typeof r.summary === "string" ? r.summary : "",
      matchedSkills: Array.isArray(r.matchedSkills) ? r.matchedSkills.filter((s): s is string => typeof s === "string") : [],
      missingSkills: Array.isArray(r.missingSkills) ? r.missingSkills.filter((s): s is string => typeof s === "string") : [],
      redFlags: Array.isArray(r.redFlags) ? r.redFlags.filter((s): s is string => typeof s === "string") : [],
    };
  });
}

// In-memory LRU cache: key = JD id + candidate ids signature, value = enrichments.
// Default TTL is 24 hours; tunable via LLM_RERANK_CACHE_TTL_MS for ops who want
// to trade staleness for cost. The "Aggiorna match" button on the JD page
// invalidates this cache for the specific JD on click; JD edits invalidate
// the cache for that specific JD as well.
function cacheTtlMs(): number {
  const raw = process.env["LLM_RERANK_CACHE_TTL_MS"];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 24 * 60 * 60 * 1000;
}

const cache = new LRUCache<string, CandidateEnrichment[]>({
  max: 200,
  ttl: cacheTtlMs(),
});

function cacheKey(jdId: string, candidates: Candidate[]): string {
  const ids = candidates.map((c) => c.id).sort().join(",");
  return `${jdId}:${ids}`;
}

/** Drop every cache entry that belongs to the given JD id. */
export function invalidateRerankCacheForJd(jdId: string): void {
  const prefix = `${jdId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Drop every cache entry. */
export function clearRerankCache(): void {
  cache.clear();
}

export async function rerankCandidates(
  jdId: string,
  input: RerankInput,
): Promise<CandidateEnrichment[]> {
  if (input.candidates.length === 0) return [];

  const key = cacheKey(jdId, input.candidates);
  const cached = cache.get(key);
  if (cached) return cached;

  const content = await chatCompletion({
    model: "mistral-small-latest",
    temperature: 0.2,
    jsonResponse: true,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(input) },
    ],
  });

  const enrichments = parseRerankResponse(content);
  cache.set(key, enrichments);
  return enrichments;
}

/** Test-only: clear the in-memory cache. */
export function _clearRerankCache(): void {
  cache.clear();
}
