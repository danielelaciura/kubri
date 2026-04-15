import type { Candidate } from "@/types";

const BOM = "\uFEFF";

const HEADERS = [
  "Nome",
  "Cognome",
  "Data di nascita",
  "Paese di origine",
  "Indirizzo",
  "Telefono",
  "Stato legale",
  "Permesso di lavoro",
  "Lingua madre",
  "Altre lingue",
  "Competenze",
  "Esperienze lavorative",
  "Lavoro desiderato",
  "Data",
  "Canale",
];

function escapeCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function candidatesToCsv(candidates: Candidate[]): string {
  const rows = candidates.map((c) =>
    [
      c.firstName,
      c.lastName,
      c.dateOfBirth,
      c.countryOfOrigin,
      c.address,
      c.phone,
      c.legalStatus,
      c.workingPermit,
      c.languages.language,
      c.languages.additionalLanguages,
      c.skillsAndCompetences.join("; "),
      c.workExperience.join("; "),
      c.jobPreferences.desiredJob,
      c.createdAt.toLocaleDateString("it-IT"),
      c.channel,
    ]
      .map(escapeCell)
      .join(",")
  );

  return BOM + [HEADERS.join(","), ...rows].join("\n");
}
