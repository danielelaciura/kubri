export type FieldType = "text" | "bool" | "number" | "date" | "enum" | "list";

export type FieldFormat = "email" | "e164" | "iso-country" | "iso-language";

export interface FieldDefinition {
  readonly key: string;
  readonly type: FieldType;
  /** Read by the LLM: what the field means and how to normalize it. */
  readonly description: string;
  readonly options?: readonly string[];
  readonly format?: FieldFormat;
  /** Written by the system only (channel, geocoding): never asked, never extracted. */
  readonly systemOnly?: boolean;
  /**
   * Special-category or similarly delicate data (health, family, immigration status): saved
   * like any other field, but its value never reaches the LLM (spec §8.2).
   */
  readonly sensitive?: true;
}
