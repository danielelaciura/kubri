import type { Candidate, Availability, InterviewStatus } from "@/types";

const BOM = "\uFEFF";

const HEADERS = [
  "Nome",
  "Nazionalità",
  "Lingue",
  "Competenze",
  "Disponibilità",
  "Città",
  "Stato intervista",
  "Data",
  "Canale",
];

function escapeCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function availabilityLabel(a: Availability): string {
  switch (a) {
    case "immediate":
      return "Immediata";
    case "within_1_month":
      return "Entro 1 mese";
    default:
      return "Altro";
  }
}

function statusLabel(s: InterviewStatus): string {
  switch (s) {
    case "completed":
      return "Completata";
    case "in_progress":
      return "In corso";
    case "abandoned":
      return "Abbandonata";
    default:
      return "Incompleta";
  }
}

export function candidatesToCsv(candidates: Candidate[]): string {
  const rows = candidates.map((c) =>
    [
      c.name,
      c.nationality,
      c.languages.join(", "),
      c.skills.join(", "),
      availabilityLabel(c.availability),
      c.city,
      statusLabel(c.interviewStatus),
      c.createdAt.toLocaleDateString("it-IT"),
      c.channel,
    ]
      .map(escapeCell)
      .join(",")
  );

  return BOM + [HEADERS.join(","), ...rows].join("\n");
}
