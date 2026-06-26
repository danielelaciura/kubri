import { DOMAIN_IDS, DOMAIN_LABELS, COMPETENCE_LEVELS } from "@kubri/contracts";

// Contact fields that must never reach the LLM, stripped defensively in case a
// caller passes a wider object than the bare assessment answers. Note: this
// strips only structured contact keys. Free-text questionnaire answers
// (work-experience descriptions etc.) are the report's source material and are
// intentionally sent — a user could type PII into them, which is inherent to
// the design.
const PII_KEYS = new Set(["firstName", "lastName", "phone", "email", "location", "latitude", "longitude"]);

function stripPii(answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (!PII_KEYS.has(k)) out[k] = v;
  }
  return out;
}

export function buildReportPrompt(answers: Record<string, unknown>): { system: string; user: string } {
  const domains = DOMAIN_IDS.map((id) => `- ${id} (${DOMAIN_LABELS[id]})`).join("\n");
  const levels = COMPETENCE_LEVELS.join(", ");

  const system = [
    "Sei un analista di competenze per Kubri. Dalle risposte a un questionario di self-assessment",
    "produci un report in italiano. Raggruppa le competenze emerse SOLO in questi domini fissi (usa gli id esatti):",
    domains,
    "",
    "Regole:",
    "- Non inventare domini diversi da quelli elencati. Ometti un dominio se non emergono competenze.",
    `- Per ogni competenza assegna un livello tra: ${levels}.`,
    "- 'note' è una frase breve che contestualizza la competenza dalle risposte.",
    "- 'intro' è una sintesi narrativa di 3-4 frasi del profilo, in seconda persona (\"tu\").",
    "- Non usare nomi propri o dati personali: NON ci sono nel testo che ricevi.",
    "",
    "Rispondi SOLO con JSON valido di forma:",
    '{ "intro": string, "domains": [ { "id": <uno degli id>, "competences": [ { "name": string, "level": <livello>, "note": string } ] } ] }',
  ].join("\n");

  const user = "Risposte al questionario (JSON):\n" + JSON.stringify(stripPii(answers), null, 2);

  return { system, user };
}
