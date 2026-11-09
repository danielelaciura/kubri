import { createHash } from "node:crypto";
import type { CampaignDefinition } from "./schema/campaign";

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * A copy with object keys sorted at every depth and `undefined` properties dropped.
 * Array order is meaningful (the flow!) and is kept.
 */
export function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Cannot canonicalize a non-finite number");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => (item === undefined ? null : canonicalize(item)));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: JsonObject = {};
    for (const key of Object.keys(record).sort()) {
      const child = record[key];
      if (child !== undefined) out[key] = canonicalize(child);
    }
    return out;
  }
  throw new TypeError(`Cannot canonicalize a value of type ${typeof value}`);
}

export interface CanonicalCampaign {
  /** What gets stored in CampaignVersion.definition. */
  readonly json: JsonObject;
  /** sha256 (hex) of the canonical JSON text. */
  readonly checksum: string;
}

/**
 * Works on the parsed definition (Zod defaults applied), so formatting, key order and
 * spelling out a default value do not produce a new version.
 */
export function canonicalCampaign(definition: CampaignDefinition): CanonicalCampaign {
  const json = canonicalize(definition);
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new TypeError("A campaign definition must be an object");
  }
  const checksum = createHash("sha256").update(JSON.stringify(json)).digest("hex");
  return { json, checksum };
}
