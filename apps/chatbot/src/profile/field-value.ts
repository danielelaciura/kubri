import { z } from "zod";
import type { FieldDefinition, FieldFormat } from "./field-definition";

const MIN_YEAR = 1900;
const E164 = /^\+[1-9]\d{6,14}$/;

function textSchema(format: FieldFormat | undefined): z.ZodType {
  switch (format) {
    case "email":
      return z.string().trim().pipe(z.email());
    case "e164":
      return z.string().trim().regex(E164);
    case "iso-country":
      return z
        .string()
        .trim()
        .regex(/^[A-Z]{2}$/);
    case "iso-language":
      return z
        .string()
        .trim()
        .regex(/^[a-z]{2}$/);
    case undefined:
      return z.string().trim().min(1);
  }
}

export function valueSchemaFor(def: FieldDefinition): z.ZodType {
  switch (def.type) {
    case "text":
      return textSchema(def.format);
    case "bool":
      return z.boolean();
    case "number":
      return z.number();
    case "date":
      // No clock in pure code, so no upper bound: only implausibly old years are rejected.
      return z.iso.date().refine((d) => Number(d.slice(0, 4)) >= MIN_YEAR, {
        error: `year must be ${MIN_YEAR} or later`,
      });
    case "enum": {
      const options = def.options ?? [];
      if (options.length === 0) throw new Error(`enum field "${def.key}" has no options`);
      return z.enum(options as [string, ...string[]]);
    }
    case "list":
      return z.array(z.string().trim().min(1)).min(1);
  }
}
