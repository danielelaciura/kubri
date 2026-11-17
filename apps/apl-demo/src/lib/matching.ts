// Matching dimostrativo, deterministico e spiegabile: nessuna AI, solo regole
// semplici che imitano quello che farà il matching reale (competenze, ruolo,
// territorio, disponibilità, livello di italiano).
import type { Association, Availability, Candidate, ItalianLevel, Match, Offer } from "./types";

const ITALIAN_RANK: Record<ItalianLevel, number> = { Base: 1, Intermedio: 2, Avanzato: 3 };
const AVAILABILITY_RANK: Record<Availability, number> = {
  Immediata: 1,
  "Entro 2 settimane": 2,
  "Entro 1 mese": 3,
};

export const MATCH_THRESHOLD = 55;

export function scoreCandidate(offer: Pick<Offer, "title" | "skills" | "city" | "italian" | "startBy">, c: Candidate): Match {
  const reasons: string[] = [];
  let score = 0;

  const shared = offer.skills.filter((s) => c.skills.includes(s));
  if (offer.skills.length > 0) score += Math.round((45 * shared.length) / offer.skills.length);
  if (shared.length > 0) reasons.push(`${shared.length} competenze su ${offer.skills.length}: ${shared.join(", ")}`);

  if (c.roles.includes(offer.title)) {
    score += 15;
    reasons.push(`Ruolo cercato: ${offer.title}`);
  }

  if (c.city === offer.city) {
    score += 15;
    reasons.push(`Vive a ${c.city}`);
  } else {
    score += 8;
    reasons.push(`Vive a ${c.city}, nella stessa provincia`);
  }

  const offerStart = (AVAILABILITY_RANK as Record<string, number>)[offer.startBy] ?? 3;
  if (AVAILABILITY_RANK[c.availability] <= offerStart) {
    score += 12;
    reasons.push(`Disponibilità: ${c.availability.toLowerCase()}`);
  } else {
    score += 4;
  }

  if (ITALIAN_RANK[c.italian] >= ITALIAN_RANK[offer.italian]) {
    score += 13;
    reasons.push(`Italiano ${c.italian.toLowerCase()}`);
  }

  return { candidate: c, score: Math.min(score, 99), reasons };
}

/** Motivazione compatta per le tabelle: "3/4 competenze · ruolo cercato · vive a Torino". */
export function shortReasons(reasons: string[]): string {
  return reasons
    .slice(0, 3)
    .map((r) =>
      r
        .replace(/^(\d+) competenze su (\d+):.*$/, "$1/$2 competenze")
        .replace(/^Ruolo cercato:.*$/, "ruolo cercato")
        .replace(/, nella stessa provincia$/, ""),
    )
    .join(" · ");
}

export function matchesFor(offer: Offer, candidates: Candidate[]): Match[] {
  return candidates
    .map((c) => scoreCandidate(offer, c))
    .filter((m) => m.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}

export interface AssociationMatch {
  association: Association;
  compatible: number;
  /** Notificata per affinità di settore/territorio anche senza candidati nel database. */
  byAffinity: boolean;
}

/** Associazioni da coinvolgere nell'appello: chi ha candidati compatibili + chi lavora nel settore. */
export function associationsFor(offer: Offer, matches: Match[], associations: Association[], sector: string | null): AssociationMatch[] {
  return associations
    .map((a) => {
      const compatible = matches.filter((m) => m.candidate.associationId === a.id).length;
      const byAffinity = compatible === 0 && sector !== null && a.sectors.includes(sector);
      return { association: a, compatible, byAffinity };
    })
    .filter((x) => x.compatible > 0 || x.byAffinity)
    .sort((a, b) => b.compatible - a.compatible);
}
