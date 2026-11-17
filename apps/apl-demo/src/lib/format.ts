import { SECTORS } from "./data";
import type { ApplicationStatus, AppealResponseState, Candidate } from "./types";

export function relativeDay(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "oggi";
  if (days === 1) return "ieri";
  if (days < 7) return `${days} giorni fa`;
  if (days < 14) return "1 settimana fa";
  if (days < 30) return `${Math.floor(days / 7)} settimane fa`;
  return `${Math.floor(days / 30)} mesi fa`;
}

export function fullName(c: Candidate): string {
  return `${c.firstName} ${c.lastName}`;
}

/** Nome mostrato all'agenzia finché l'associazione non ha inviato il profilo. */
export function anonymousName(c: Candidate): string {
  return `${c.firstName.charAt(0)}. ${c.lastName.charAt(0)}.`;
}

export function initials(c: Candidate): string {
  return `${c.firstName.charAt(0)}${c.lastName.charAt(0)}`;
}

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  proposto: "Proposto",
  in_valutazione: "In valutazione",
  presentato: "Presentato all'azienda",
  colloquio: "Colloquio",
  assunto: "Assunto",
  non_selezionato: "Non selezionato",
};

export const STATUS_ORDER: ApplicationStatus[] = [
  "proposto",
  "in_valutazione",
  "presentato",
  "colloquio",
  "assunto",
  "non_selezionato",
];

export const APPEAL_STATE_LABEL: Record<AppealResponseState, string> = {
  notificata: "Notificata",
  vista: "Ha visto l'appello",
  ha_risposto: "Ha risposto",
};

/** Settore dell'offerta, dedotto dalle competenze richieste. */
export function sectorOf(skills: string[]): string | null {
  let best: string | null = null;
  let bestHits = 0;
  for (const [name, profile] of Object.entries(SECTORS)) {
    const hits = skills.filter((s) => profile.skills.includes(s)).length;
    if (hits > bestHits) {
      best = name;
      bestHits = hits;
    }
  }
  return best;
}
