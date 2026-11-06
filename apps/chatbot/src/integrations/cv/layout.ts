/** Identifies the CV template (D127). */
export const CV_TEMPLATE = "default-v1";

export interface CvSection {
  readonly heading: string;
  readonly lines: readonly string[];
}

export interface CvLayout {
  readonly title: string;
  readonly contacts: readonly string[];
  readonly sections: readonly CvSection[];
}

type Standard = Readonly<Record<string, unknown>>;

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const present = (values: readonly (string | null)[]): string[] =>
  values.flatMap((v) => (v === null ? [] : [v]));

const list = (value: unknown): string[] => (Array.isArray(value) ? present(value.map(str)) : []);

const yesNo = (label: string, value: unknown): string[] =>
  typeof value === "boolean" ? [`${label}: ${value ? "sì" : "no"}`] : [];

const section = (heading: string, lines: readonly string[]): CvSection[] =>
  lines.length > 0 ? [{ heading, lines }] : [];

/**
 * What the CV says and in what order (D127). The text of the template is Italian, whatever the
 * candidate's language: it is read by employers in Italy. Pure: no I/O, no randomness.
 */
export function buildCvLayout(standard: Standard, phoneE164: string): CvLayout {
  const name = present([str(standard["firstName"]), str(standard["lastName"])]).join(" ");
  const aim = str(standard["jobPreferences.preferredJob"]);
  const italian = str(standard["italianLevel"]);
  const languages = [
    ...(italian ? [`Italiano: ${italian}`] : []),
    ...list(standard["additionalLanguages"]),
  ];
  const transport = str(standard["transport"]);

  return {
    title: name || "Curriculum vitae",
    contacts: present([str(standard["location"]), phoneE164, str(standard["email"])]),
    sections: [
      ...section("Profilo", aim ? [`Cerco lavoro come: ${aim}`] : []),
      ...section("Esperienza lavorativa", list(standard["workExperience"])),
      ...section("Istruzione e formazione", list(standard["educationAndTraining"])),
      ...section("Competenze", list(standard["skillsAndCompetences"])),
      ...section("Lingue", languages),
      ...section("Informazioni utili", [
        ...yesNo("Permesso di lavoro", standard["workingPermit"]),
        ...yesNo("Patente di guida", standard["drivingLicense"]),
        ...(transport ? [`Mezzo di trasporto: ${transport}`] : []),
      ]),
    ],
  };
}
