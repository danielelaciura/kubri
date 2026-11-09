import { CUSTOM_FIELD_PREFIX, type CustomFieldDefinition } from "../profile/custom-fields";
import type { StandardFieldKey } from "../profile/standard-fields";
import type { LocalizedText } from "./localized-text";

/** Shown to the candidate in confirmations (D75): lowercase, they end up mid-sentence. */
export const STANDARD_FIELD_LABELS: Readonly<Record<StandardFieldKey, LocalizedText>> = {
  firstName: { it: "nome" },
  lastName: { it: "cognome" },
  birthday: { it: "data di nascita" },
  country: { it: "paese d'origine" },
  address: { it: "indirizzo" },
  location: { it: "comune di residenza" },
  lat: { it: "latitudine" },
  lng: { it: "longitudine" },
  phone: { it: "telefono" },
  email: { it: "email" },
  language: { it: "lingua madre" },
  italianLevel: { it: "livello di italiano" },
  additionalLanguages: { it: "altre lingue" },
  transport: { it: "mezzo di trasporto" },
  drivingLicense: { it: "patente di guida" },
  drivingLicenseTypes: { it: "categorie di patente" },
  workingPermit: { it: "permesso di lavoro" },
  educationAndTraining: { it: "studi e formazione" },
  workExperience: { it: "esperienze di lavoro" },
  skillsAndCompetences: { it: "competenze" },
  "jobPreferences.preferredJob": { it: "lavoro desiderato" },
  "jobPreferences.preferredLocation": { it: "zona di lavoro preferita" },
  "jobPreferences.constraints": { it: "vincoli di orario o di salute" },
  "jobPreferences.partTime": { it: "part-time" },
  "jobPreferences.hasDesiredJobExperience": { it: "esperienza nel lavoro desiderato" },
  "learningPreferences.isInterested": { it: "interesse per i corsi" },
  "learningPreferences.preference": { it: "corso preferito" },
};

function isStandardKey(ref: string): ref is StandardFieldKey {
  return Object.hasOwn(STANDARD_FIELD_LABELS, ref);
}

/**
 * "firstName" → "nome", "custom.x" → the campaign label. An unknown ref has no label: the
 * caller shows it as is and never sends it to the translator (it is not a reviewed text).
 */
export function fieldLabel(
  ref: string,
  customFields: readonly CustomFieldDefinition[],
): LocalizedText | undefined {
  if (ref.startsWith(CUSTOM_FIELD_PREFIX)) {
    const key = ref.slice(CUSTOM_FIELD_PREFIX.length);
    return customFields.find((field) => field.key === key)?.label;
  }
  return isStandardKey(ref) ? STANDARD_FIELD_LABELS[ref] : undefined;
}
