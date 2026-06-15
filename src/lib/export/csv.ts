import type { Candidate } from "@/types";
import type { Dictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/types";
import { displayCountry } from "@/lib/candidates/country";

const BOM = "﻿";

function escapeCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function candidatesToCsv(
  candidates: Candidate[],
  listsByCandidateId: Record<string, string[]> = {},
  dictionary: Dictionary,
  locale: Locale,
): string {
  const csv = dictionary.csv;

  const HEADERS = [
    csv.headerFirstName,
    csv.headerLastName,
    csv.headerDateOfBirth,
    csv.headerCountryOfOrigin,
    csv.headerAddress,
    csv.headerPhone,
    csv.headerLegalStatus,
    csv.headerWorkingPermit,
    csv.headerMotherTongue,
    csv.headerOtherLanguages,
    csv.headerSkills,
    csv.headerWorkExperience,
    csv.headerDesiredJob,
    csv.headerLists,
    csv.headerDate,
    csv.headerChannel,
  ];

  const rows = candidates.map((c) =>
    [
      c.firstName,
      c.lastName,
      c.dateOfBirth,
      displayCountry(c.countryOfOrigin, locale) ?? c.countryOfOrigin,
      c.address,
      c.phone,
      c.legalStatus,
      c.workingPermit ? csv.yes : csv.no,
      c.languages.language,
      c.languages.additionalLanguages.join("; "),
      c.skillsAndCompetences.join("; "),
      c.workExperience.join("; "),
      c.jobPreferences.desiredJob,
      (listsByCandidateId[c.id] ?? []).join("; "),
      c.createdAt.toLocaleDateString("it-IT"),
      c.channel,
    ]
      .map(escapeCell)
      .join(",")
  );

  return BOM + [HEADERS.join(","), ...rows].join("\n");
}
