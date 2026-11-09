import type { FieldDefinition } from "./field-definition";

export const ITALIAN_LEVELS = ["nessuno", "base", "intermedio", "avanzato", "madrelingua"] as const;

// Spec §6. Values are normalized in Italian, except proper names and institutions.
export const STANDARD_FIELDS = [
  { key: "firstName", type: "text", description: "Nome di battesimo del candidato." },
  { key: "lastName", type: "text", description: "Cognome del candidato." },
  {
    key: "birthday",
    type: "date",
    description: "Data di nascita, in formato ISO AAAA-MM-GG.",
  },
  {
    key: "country",
    type: "text",
    format: "iso-country",
    description: "Paese d'origine, codice ISO 3166-1 alpha-2 maiuscolo (es. IT, MA, UA).",
  },
  {
    key: "address",
    type: "text",
    description: "Indirizzo di residenza così come dichiarato dal candidato.",
  },
  {
    key: "location",
    type: "text",
    description: "Comune o località di residenza, normalizzato in italiano.",
  },
  {
    key: "lat",
    type: "number",
    systemOnly: true,
    description: "Latitudine della residenza, calcolata dal geocoding.",
  },
  {
    key: "lng",
    type: "number",
    systemOnly: true,
    description: "Longitudine della residenza, calcolata dal geocoding.",
  },
  {
    key: "phone",
    type: "text",
    format: "e164",
    systemOnly: true,
    description: "Numero di telefono in formato E.164, ricavato dal canale.",
  },
  { key: "email", type: "text", format: "email", description: "Indirizzo email del candidato." },
  {
    key: "language",
    type: "text",
    format: "iso-language",
    description: "Lingua madre, codice ISO 639-1 minuscolo (es. it, ar, uk).",
  },
  {
    key: "italianLevel",
    type: "enum",
    options: ITALIAN_LEVELS,
    description: "Livello di conoscenza dell'italiano.",
  },
  {
    key: "additionalLanguages",
    type: "list",
    description: 'Altre lingue parlate, ciascuna come "lingua (livello)", in italiano.',
  },
  {
    key: "transport",
    type: "text",
    description: "Mezzo di trasporto abituale, in italiano (es. auto, bicicletta, mezzi pubblici).",
  },
  {
    key: "drivingLicense",
    type: "bool",
    description: "Possiede una patente di guida valida. Patente scaduta o sospesa = false.",
  },
  {
    key: "drivingLicenseTypes",
    type: "list",
    description: "Categorie di patente possedute (es. B, C, CQC).",
  },
  {
    key: "workingPermit",
    type: "bool",
    // Reveals the immigration status.
    sensitive: true,
    description: "Può lavorare legalmente in Italia (cittadinanza UE o permesso valido) = true.",
  },
  {
    key: "educationAndTraining",
    type: "list",
    description: 'Titoli di studio e corsi, ciascuno come "anno - anno Istituto (Paese): Titolo".',
  },
  {
    key: "workExperience",
    type: "list",
    description: 'Esperienze lavorative, ciascuna come "anno - anno Luogo (Paese): Ruolo".',
  },
  {
    key: "skillsAndCompetences",
    type: "list",
    description: "Competenze pratiche e trasversali, in italiano.",
  },
  {
    key: "jobPreferences.preferredJob",
    type: "text",
    description: "Lavoro desiderato, in italiano.",
  },
  {
    key: "jobPreferences.preferredLocation",
    type: "text",
    description: "Zona in cui preferisce lavorare.",
  },
  {
    key: "jobPreferences.constraints",
    type: "text",
    // Often health or family circumstances.
    sensitive: true,
    description: "Vincoli di orario, turni, salute o famiglia.",
  },
  {
    key: "jobPreferences.partTime",
    type: "bool",
    description: "Preferisce un lavoro part-time = true; full-time = false.",
  },
  {
    key: "jobPreferences.hasDesiredJobExperience",
    type: "text",
    description: "Esperienza nel lavoro desiderato, sintetizzata in italiano.",
  },
  {
    key: "learningPreferences.isInterested",
    type: "bool",
    description: "È interessato a corsi di formazione.",
  },
  {
    key: "learningPreferences.preference",
    type: "text",
    description: "Quale formazione gli interessa, in italiano.",
  },
] as const satisfies readonly FieldDefinition[];

export type StandardFieldKey = (typeof STANDARD_FIELDS)[number]["key"];

// The `as const` tuple keeps literal keys for StandardFieldKey; this view is what code iterates
// (not every tuple member declares optional properties like `systemOnly`).
export const STANDARD_FIELD_DEFINITIONS: readonly FieldDefinition[] = STANDARD_FIELDS;

const BY_KEY: ReadonlyMap<string, FieldDefinition> = new Map(
  STANDARD_FIELDS.map((field) => [field.key, field]),
);

export function getStandardField(key: string): FieldDefinition | undefined {
  return BY_KEY.get(key);
}
