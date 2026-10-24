# Piano 02 — Schema del profilo e delle campagne

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Definire in TypeScript e Zod il profilo candidato (campi standard e personalizzati,
validazione delle patch) e la campagna (testi, condizioni, passaggi, transizioni). Il piano
include un validatore che accetta solo campagne coerenti e restituisce errori leggibili, con il
percorso esatto.

**Architecture:** Tutto il codice di questo piano è **puro**: niente database, niente rete,
niente file system. Moduli coinvolti:
- `src/i18n`: testi localizzati;
- `src/profile`: registro dei campi, valori, patch;
- `src/campaigns`: schema, condizioni, flusso, controlli.

Il validatore lavora in due passaggi: prima lo schema Zod (forma), poi controlli semantici
indipendenti in `src/campaigns/checks/`, uno per file, ognuno `(campaign) => CampaignIssue[]`.
`flow.ts` (transizioni ed esiti) e `conditions/evaluate.ts` serviranno anche al motore nel
piano 04.

**Tech Stack:** TypeScript strict, Zod 4, Vitest.

**Spec:** §5 (campagna), §6 (profilo), §8.4 (validazione delle patch).

**Prerequisito:** piano 01 completato. Tutti i comandi si eseguono da `apps/chatbot/` nel monorepo `kubri` (spec D19); il branch si crea dalla root, partendo da `main`.

```bash
git switch main && git pull
git switch -c feat/chatbot-profile-campaign-schema
cd apps/chatbot
```

---

## Decisioni prese in questo piano (da riportare nella spec, §2)

- **Profilo piatto con chiavi puntate.** Il profilo standard è una mappa piatta
  `Record<chiave, valore>`, con chiavi come `jobPreferences.preferredJob`. La struttura
  annidata la costruisce solo la mappatura verso Kubri (piano 10). Patch, condizioni e storico
  ragionano così su una sola chiave per campo.
- **Versione assegnata all'import.** La `version` non sta nel file JSON: la assegna l'import
  (piano 03).
- **Opzioni di `choice` come oggetti** `{ id, description }`. La `description` la legge
  l'LLM per classificare la risposta.
- **Esiti predefiniti:**
  - `questions.terminated` → `@stop`;
  - `consent.declined` → `@stop`, se il consenso non è `optional`;
  - tutti gli altri esiti → il passaggio successivo, oppure `@end` dopo l'ultimo.
- **Campi di sistema.** `lat`, `lng` e `phone` sono `systemOnly`: non si chiedono nelle
  domande e l'LLM non li può scrivere.

## Mappa dei file

| File | Responsabilità |
|---|---|
| `src/i18n/localized-text.ts` | codici lingua e testo localizzato (`it` obbligatorio) |
| `src/profile/field-definition.ts` | tipi `FieldType`, `FieldFormat`, `FieldDefinition` |
| `src/profile/standard-fields.ts` | registro dei campi standard (§6) |
| `src/profile/field-value.ts` | schema Zod del valore per un campo |
| `src/profile/custom-fields.ts` | definizione dei campi personalizzati |
| `src/profile/field-ref.ts` | risoluzione di un riferimento (`firstName`, `custom.x`) |
| `src/profile/patch.ts` | validazione delle patch prodotte dall'LLM |
| `src/campaigns/schema/ids.ts` | schemi per id e slug |
| `src/campaigns/schema/conditions.ts` | schema delle condizioni |
| `src/campaigns/conditions/evaluate.ts` | valutatore delle condizioni e raccolta dei riferimenti |
| `src/campaigns/schema/steps.ts` | schemi dei passaggi, delle domande e delle transizioni |
| `src/campaigns/schema/campaign.ts` | schema della campagna |
| `src/campaigns/flow.ts` | esiti dei passaggi e risoluzione delle transizioni |
| `src/campaigns/issues.ts` | tipo `CampaignIssue` e helper |
| `src/campaigns/checks/*.ts` | un controllo semantico per file |
| `src/campaigns/validate.ts` | punto d'ingresso `validateCampaign()` |
| `tests/unit/campaigns/fixtures.ts` | campagna minima valida, condivisa dai test |

---

### Task 1: Testi localizzati

**Files:**
- Create: `src/i18n/localized-text.ts`
- Test: `tests/unit/i18n/localized-text.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, expect, it } from "vitest";
import { LanguageCodeSchema, LocalizedTextSchema } from "../../../src/i18n/localized-text";

describe("LanguageCodeSchema", () => {
  it("accepts ISO 639-1 lowercase codes", () => {
    expect(LanguageCodeSchema.safeParse("ar").success).toBe(true);
  });

  it.each(["IT", "ita", "i", "it-IT"])("rejects %s", (code) => {
    expect(LanguageCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe("LocalizedTextSchema", () => {
  it("accepts Italian with optional curated translations", () => {
    const result = LocalizedTextSchema.safeParse({ it: "Ciao", en: "Hello" });
    expect(result.success).toBe(true);
  });

  it("requires the Italian text", () => {
    const result = LocalizedTextSchema.safeParse({ en: "Hello" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/Italian/);
  });

  it("rejects empty texts", () => {
    expect(LocalizedTextSchema.safeParse({ it: "   " }).success).toBe(false);
  });

  it("rejects invalid language keys", () => {
    expect(LocalizedTextSchema.safeParse({ it: "Ciao", english: "Hello" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/i18n`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare**

`src/i18n/localized-text.ts`:

```ts
import { z } from "zod";

export const DEFAULT_LANGUAGE = "it";

export const LanguageCodeSchema = z.string().regex(/^[a-z]{2}$/, "ISO 639-1 lowercase code");
export type LanguageCode = z.infer<typeof LanguageCodeSchema>;

// Italian is the reference language (spec §9); other keys are optional curated translations.
export const LocalizedTextSchema = z
  .record(LanguageCodeSchema, z.string().trim().min(1))
  .refine((text) => typeof text[DEFAULT_LANGUAGE] === "string", {
    error: "Italian (it) text is required",
  });
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test tests/unit/i18n && pnpm typecheck`
Expected: `8 passed`; typecheck pulito.

- [ ] **Step 5: Commit**

```bash
git add src/i18n tests/unit/i18n
git commit -m "feat(i18n): add localized text schema with mandatory italian"
```

---

### Task 2: Definizione dei campi e registro standard

**Files:**
- Create: `src/profile/field-definition.ts`, `src/profile/standard-fields.ts`
- Test: `tests/unit/profile/standard-fields.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, expect, it } from "vitest";
import {
  STANDARD_FIELD_DEFINITIONS as STANDARD_FIELDS,
  getStandardField,
} from "../../../src/profile/standard-fields";

describe("standard fields registry", () => {
  it("has unique keys", () => {
    const keys = STANDARD_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every field a description for the LLM", () => {
    for (const field of STANDARD_FIELDS) {
      expect(field.description.length, field.key).toBeGreaterThan(10);
    }
  });

  it("declares options for every enum field", () => {
    for (const field of STANDARD_FIELDS) {
      if (field.type === "enum") expect(field.options?.length, field.key).toBeGreaterThan(0);
    }
  });

  it("finds fields by key, including dotted keys", () => {
    expect(getStandardField("drivingLicense")?.type).toBe("bool");
    expect(getStandardField("jobPreferences.preferredJob")?.type).toBe("text");
  });

  it("returns undefined for unknown keys", () => {
    expect(getStandardField("favouriteColour")).toBeUndefined();
  });

  it("marks system fields that questions and the LLM must not write", () => {
    const systemOnly = STANDARD_FIELDS.filter((f) => f.systemOnly === true).map((f) => f.key);
    expect(systemOnly.sort()).toEqual(["lat", "lng", "phone"]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/profile`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare `src/profile/field-definition.ts`**

```ts
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
}
```

- [ ] **Step 4: Implementare `src/profile/standard-fields.ts`**

```ts
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
```

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test tests/unit/profile && pnpm typecheck && pnpm lint`
Expected: `6 passed`; typecheck e lint puliti.

- [ ] **Step 6: Commit**

```bash
git add src/profile tests/unit/profile
git commit -m "feat(profile): add standard candidate field registry"
```

---

### Task 3: Schema del valore di un campo

**Files:**
- Create: `src/profile/field-value.ts`
- Test: `tests/unit/profile/field-value.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "../../../src/profile/field-definition";
import { valueSchemaFor } from "../../../src/profile/field-value";

const field = (def: Partial<FieldDefinition> & Pick<FieldDefinition, "type">): FieldDefinition => ({
  key: "test",
  description: "test field",
  ...def,
});

function accepts(def: FieldDefinition, value: unknown): boolean {
  return valueSchemaFor(def).safeParse(value).success;
}

describe("valueSchemaFor", () => {
  it("text: trims and rejects empty strings", () => {
    expect(valueSchemaFor(field({ type: "text" })).parse("  Mario ")).toBe("Mario");
    expect(accepts(field({ type: "text" }), "  ")).toBe(false);
    expect(accepts(field({ type: "text" }), 12)).toBe(false);
  });

  it("bool: only real booleans", () => {
    expect(accepts(field({ type: "bool" }), true)).toBe(true);
    expect(accepts(field({ type: "bool" }), "true")).toBe(false);
  });

  it("number: finite numbers only", () => {
    expect(accepts(field({ type: "number" }), 45.4)).toBe(true);
    expect(accepts(field({ type: "number" }), Number.POSITIVE_INFINITY)).toBe(false);
    expect(accepts(field({ type: "number" }), "45")).toBe(false);
  });

  it("date: ISO calendar dates", () => {
    expect(accepts(field({ type: "date" }), "1990-04-21")).toBe(true);
    expect(accepts(field({ type: "date" }), "21/04/1990")).toBe(false);
    expect(accepts(field({ type: "date" }), "1990-02-31")).toBe(false);
  });

  it("enum: only declared options", () => {
    const def = field({ type: "enum", options: ["base", "avanzato"] });
    expect(accepts(def, "base")).toBe(true);
    expect(accepts(def, "intermedio")).toBe(false);
  });

  it("enum without options is a programming error", () => {
    expect(() => valueSchemaFor(field({ type: "enum" }))).toThrow(/options/);
  });

  it("list: non-empty array of non-empty strings", () => {
    expect(accepts(field({ type: "list" }), ["B", "C"])).toBe(true);
    expect(accepts(field({ type: "list" }), [])).toBe(false);
    expect(accepts(field({ type: "list" }), ["B", " "])).toBe(false);
  });

  it.each([
    ["email", "mario@example.com", "mario@"],
    ["e164", "+393331234567", "3331234567"],
    ["iso-country", "MA", "Marocco"],
    ["iso-language", "ar", "arabo"],
  ] as const)("text format %s", (format, valid, invalid) => {
    const def = field({ type: "text", format });
    expect(accepts(def, valid)).toBe(true);
    expect(accepts(def, invalid)).toBe(false);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/profile/field-value.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare**

`src/profile/field-value.ts`:

```ts
import { z } from "zod";
import type { FieldDefinition, FieldFormat } from "./field-definition";

const E164 = /^\+[1-9]\d{6,14}$/;

function textSchema(format: FieldFormat | undefined): z.ZodType {
  switch (format) {
    case "email":
      return z.email();
    case "e164":
      return z.string().regex(E164);
    case "iso-country":
      return z.string().regex(/^[A-Z]{2}$/);
    case "iso-language":
      return z.string().regex(/^[a-z]{2}$/);
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
      return z.iso.date();
    case "enum": {
      const options = def.options ?? [];
      if (options.length === 0) throw new Error(`enum field "${def.key}" has no options`);
      return z.enum(options as [string, ...string[]]);
    }
    case "list":
      return z.array(z.string().trim().min(1)).min(1);
  }
}
```

> In Zod 4, `z.number()` rifiuta già `Infinity` e `NaN`, e `z.iso.date()` rifiuta le date di
> calendario impossibili come il 31 febbraio. Se il test sulla data `1990-02-31` fallisce con
> la versione installata, aggiungere
> `.refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().startsWith(d))`.

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test tests/unit/profile && pnpm typecheck && pnpm lint`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/profile tests/unit/profile
git commit -m "feat(profile): validate field values by type and format"
```

---

### Task 4: Campi personalizzati e risoluzione dei riferimenti

**Files:**
- Create: `src/profile/custom-fields.ts`, `src/profile/field-ref.ts`
- Test: `tests/unit/profile/custom-fields.test.ts`, `tests/unit/profile/field-ref.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/profile/custom-fields.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CustomFieldDefinitionSchema,
  toFieldDefinition,
} from "../../../src/profile/custom-fields";

const base = {
  key: "vat_openness",
  type: "enum",
  options: ["si", "no", "da_valutare"],
  label: { it: "Disponibilità ad aprire P.IVA" },
  description: "Se il candidato è disposto ad aprire una partita IVA.",
};

describe("CustomFieldDefinitionSchema", () => {
  it("accepts a valid enum field", () => {
    expect(CustomFieldDefinitionSchema.safeParse(base).success).toBe(true);
  });

  it("requires options for enum fields", () => {
    const { options: _omit, ...withoutOptions } = base;
    const result = CustomFieldDefinitionSchema.safeParse(withoutOptions);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["options"]);
  });

  it("rejects options on non-enum fields", () => {
    const result = CustomFieldDefinitionSchema.safeParse({ ...base, type: "bool" });
    expect(result.success).toBe(false);
  });

  it("requires snake_case keys", () => {
    expect(CustomFieldDefinitionSchema.safeParse({ ...base, key: "VatOpenness" }).success).toBe(
      false,
    );
  });
});

describe("toFieldDefinition", () => {
  it("prefixes the key with custom.", () => {
    const def = toFieldDefinition(CustomFieldDefinitionSchema.parse(base));
    expect(def).toEqual({
      key: "custom.vat_openness",
      type: "enum",
      options: ["si", "no", "da_valutare"],
      description: "Se il candidato è disposto ad aprire una partita IVA.",
    });
  });
});
```

`tests/unit/profile/field-ref.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CustomFieldDefinitionSchema } from "../../../src/profile/custom-fields";
import { resolveField } from "../../../src/profile/field-ref";

const custom = [
  CustomFieldDefinitionSchema.parse({
    key: "night_shifts",
    type: "bool",
    label: { it: "Turni notturni" },
    description: "Disponibile a lavorare di notte.",
  }),
];

describe("resolveField", () => {
  it("resolves standard fields", () => {
    expect(resolveField("drivingLicense", custom)?.type).toBe("bool");
  });

  it("resolves declared custom fields", () => {
    expect(resolveField("custom.night_shifts", custom)?.key).toBe("custom.night_shifts");
  });

  it("returns undefined for undeclared custom fields", () => {
    expect(resolveField("custom.unknown", custom)).toBeUndefined();
  });

  it("returns undefined for unknown standard fields", () => {
    expect(resolveField("nickname", custom)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/profile`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare `src/profile/custom-fields.ts`**

```ts
import { z } from "zod";
import { LocalizedTextSchema } from "../i18n/localized-text";
import type { FieldDefinition } from "./field-definition";

export const CUSTOM_FIELD_PREFIX = "custom.";

export const CustomFieldDefinitionSchema = z
  .strictObject({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case key"),
    type: z.enum(["text", "bool", "number", "date", "enum", "list"]),
    options: z.array(z.string().trim().min(1)).min(1).optional(),
    label: LocalizedTextSchema,
    description: z.string().trim().min(1),
  })
  .superRefine((field, ctx) => {
    if (field.type === "enum" && !field.options) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "enum fields require options" });
    }
    if (field.type !== "enum" && field.options) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "only enum fields take options" });
    }
  });

export type CustomFieldDefinition = z.infer<typeof CustomFieldDefinitionSchema>;

export function toFieldDefinition(field: CustomFieldDefinition): FieldDefinition {
  return {
    key: `${CUSTOM_FIELD_PREFIX}${field.key}`,
    type: field.type,
    description: field.description,
    ...(field.options ? { options: field.options } : {}),
  };
}
```

- [ ] **Step 4: Implementare `src/profile/field-ref.ts`**

```ts
import { CUSTOM_FIELD_PREFIX, toFieldDefinition, type CustomFieldDefinition } from "./custom-fields";
import type { FieldDefinition } from "./field-definition";
import { getStandardField } from "./standard-fields";

/** Resolves "firstName" or "custom.<key>" against the standard registry and the campaign. */
export function resolveField(
  ref: string,
  customFields: readonly CustomFieldDefinition[],
): FieldDefinition | undefined {
  if (!ref.startsWith(CUSTOM_FIELD_PREFIX)) return getStandardField(ref);
  const key = ref.slice(CUSTOM_FIELD_PREFIX.length);
  const custom = customFields.find((field) => field.key === key);
  return custom ? toFieldDefinition(custom) : undefined;
}
```

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test tests/unit/profile && pnpm typecheck && pnpm lint`
Expected: tutti verdi.

> Se il lint segnala `@typescript-eslint/no-unused-vars` su `_omit` nel test, aggiungere a
> `eslint.config.js`, nel blocco `rules` generale:
> `"@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }]`.

- [ ] **Step 6: Commit**

```bash
git add src/profile tests/unit/profile eslint.config.js
git commit -m "feat(profile): add typed custom fields and field reference resolution"
```

---

### Task 5: Validazione delle patch

**Files:**
- Create: `src/profile/patch.ts`
- Test: `tests/unit/profile/patch.test.ts`

La patch è ciò che l'LLM propone di scrivere nel profilo. Questo modulo decide cosa può
entrare: niente campi inventati, niente valori del tipo sbagliato, niente campi di sistema.
I rifiuti non contengono il valore, così si possono registrare senza dati personali.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, expect, it } from "vitest";
import { CustomFieldDefinitionSchema } from "../../../src/profile/custom-fields";
import { validatePatch, type PatchEntry } from "../../../src/profile/patch";

const custom = [
  CustomFieldDefinitionSchema.parse({
    key: "night_shifts",
    type: "bool",
    label: { it: "Turni notturni" },
    description: "Disponibile a lavorare di notte.",
  }),
];

const entry = (field: string, value: unknown, confidence = 0.9): PatchEntry => ({
  field,
  value,
  confidence,
  evidence: "…",
});

describe("validatePatch", () => {
  it("accepts valid standard and custom values, normalized by the schema", () => {
    const result = validatePatch(
      [entry("firstName", "  Mario "), entry("custom.night_shifts", true)],
      custom,
    );

    expect(result.rejected).toEqual([]);
    expect(result.accepted.map((e) => [e.field, e.value])).toEqual([
      ["firstName", "Mario"],
      ["custom.night_shifts", true],
    ]);
  });

  it("rejects unknown fields", () => {
    const result = validatePatch([entry("nickname", "Super Mario")], custom);
    expect(result.rejected).toEqual([{ field: "nickname", reason: "unknown_field" }]);
  });

  it("rejects system-only fields", () => {
    const result = validatePatch([entry("phone", "+393331234567")], custom);
    expect(result.rejected).toEqual([{ field: "phone", reason: "system_only_field" }]);
  });

  it("rejects values of the wrong type without echoing them", () => {
    const result = validatePatch([entry("drivingLicense", "sì")], custom);
    expect(result.rejected).toEqual([{ field: "drivingLicense", reason: "invalid_value" }]);
    expect(JSON.stringify(result.rejected)).not.toContain("sì");
  });

  it.each([-0.1, 1.1, Number.NaN])("rejects confidence %s", (confidence) => {
    const result = validatePatch([entry("firstName", "Mario", confidence)], custom);
    expect(result.rejected[0]?.reason).toBe("invalid_confidence");
  });

  it("rejects every entry of a field that appears twice", () => {
    const result = validatePatch(
      [entry("firstName", "Mario"), entry("firstName", "Luigi")],
      custom,
    );
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      { field: "firstName", reason: "duplicate_field" },
      { field: "firstName", reason: "duplicate_field" },
    ]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/profile/patch.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare**

`src/profile/patch.ts`:

```ts
import type { CustomFieldDefinition } from "./custom-fields";
import { resolveField } from "./field-ref";
import { valueSchemaFor } from "./field-value";

export interface PatchEntry {
  readonly field: string;
  readonly value: unknown;
  /** 0..1, as estimated by the LLM. */
  readonly confidence: number;
  /** The part of the candidate's message the value comes from. */
  readonly evidence: string;
}

export type PatchRejectionReason =
  | "unknown_field"
  | "system_only_field"
  | "invalid_value"
  | "invalid_confidence"
  | "duplicate_field";

/** Carries no value on purpose: rejections are logged and values are personal data. */
export interface RejectedPatchEntry {
  readonly field: string;
  readonly reason: PatchRejectionReason;
}

export interface PatchValidationResult {
  readonly accepted: PatchEntry[];
  readonly rejected: RejectedPatchEntry[];
}

export function validatePatch(
  entries: readonly PatchEntry[],
  customFields: readonly CustomFieldDefinition[],
): PatchValidationResult {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.field, (counts.get(e.field) ?? 0) + 1);

  const accepted: PatchEntry[] = [];
  const rejected: RejectedPatchEntry[] = [];

  for (const e of entries) {
    const reason = rejectionReason(e, counts, customFields);
    if (reason) {
      rejected.push({ field: e.field, reason });
      continue;
    }
    const def = resolveField(e.field, customFields);
    // def is defined here: rejectionReason returned undefined.
    const parsed = def ? valueSchemaFor(def).safeParse(e.value) : undefined;
    if (!parsed?.success) {
      rejected.push({ field: e.field, reason: "invalid_value" });
      continue;
    }
    accepted.push({ ...e, value: parsed.data });
  }

  return { accepted, rejected };
}

function rejectionReason(
  e: PatchEntry,
  counts: ReadonlyMap<string, number>,
  customFields: readonly CustomFieldDefinition[],
): PatchRejectionReason | undefined {
  if ((counts.get(e.field) ?? 0) > 1) return "duplicate_field";
  if (!(e.confidence >= 0 && e.confidence <= 1)) return "invalid_confidence";
  const def = resolveField(e.field, customFields);
  if (!def) return "unknown_field";
  if (def.systemOnly === true) return "system_only_field";
  return undefined;
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test tests/unit/profile && pnpm typecheck && pnpm lint`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/profile tests/unit/profile
git commit -m "feat(profile): validate LLM patches against field definitions"
```

---

### Task 6: Condizioni (schema e valutatore)

**Files:**
- Create: `src/campaigns/schema/conditions.ts`, `src/campaigns/conditions/evaluate.ts`
- Test: `tests/unit/campaigns/conditions.test.ts`

Semantica fissata qui e usata anche dal motore:
- per i campi lista, `eq` e `in` significano "contiene";
- un valore mancante (`undefined`, `null`, lista vuota) rende falsi `eq`, `in`, `gt` e `lt`, e
  veri `neq` e `notIn`.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, expect, it } from "vitest";
import {
  conditionRefs,
  evaluateCondition,
  type ConditionContext,
} from "../../../src/campaigns/conditions/evaluate";
import { ConditionSchema, type Condition } from "../../../src/campaigns/schema/conditions";

const ctx: ConditionContext = {
  values: { drivingLicense: true, transport: "bici", languages: ["en", "fr"], age: 30 },
  outcomes: { cv_info: "yes" },
};

const evaluate = (c: Condition): boolean => evaluateCondition(c, ctx);

describe("ConditionSchema", () => {
  it("accepts nested conditions", () => {
    const result = ConditionSchema.safeParse({
      all: [{ field: "drivingLicense", eq: true }, { not: { step: "cv_info", outcome: "no" } }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects two operators on the same field condition", () => {
    expect(ConditionSchema.safeParse({ field: "x", eq: 1, neq: 2 }).success).toBe(false);
  });

  it("rejects an empty all", () => {
    expect(ConditionSchema.safeParse({ all: [] }).success).toBe(false);
  });
});

describe("evaluateCondition", () => {
  it("eq / neq on scalars", () => {
    expect(evaluate({ field: "transport", eq: "bici" })).toBe(true);
    expect(evaluate({ field: "transport", neq: "auto" })).toBe(true);
  });

  it("eq / in mean 'contains' on lists", () => {
    expect(evaluate({ field: "languages", eq: "fr" })).toBe(true);
    expect(evaluate({ field: "languages", in: ["de", "en"] })).toBe(true);
    expect(evaluate({ field: "languages", notIn: ["de"] })).toBe(true);
  });

  it("gt / lt on numbers only", () => {
    expect(evaluate({ field: "age", gt: 18 })).toBe(true);
    expect(evaluate({ field: "transport", lt: 5 })).toBe(false);
  });

  it("missing values: only neq, notIn and notExists are true", () => {
    expect(evaluate({ field: "email", eq: "x" })).toBe(false);
    expect(evaluate({ field: "email", in: ["x"] })).toBe(false);
    expect(evaluate({ field: "email", gt: 1 })).toBe(false);
    expect(evaluate({ field: "email", neq: "x" })).toBe(true);
    expect(evaluate({ field: "email", notIn: ["x"] })).toBe(true);
    expect(evaluate({ field: "email", notExists: true })).toBe(true);
    expect(evaluate({ field: "email", exists: true })).toBe(false);
  });

  it("treats empty lists as missing", () => {
    expect(evaluateCondition({ field: "l", exists: true }, { values: { l: [] }, outcomes: {} })).toBe(
      false,
    );
  });

  it("step outcomes", () => {
    expect(evaluate({ step: "cv_info", outcome: "yes" })).toBe(true);
    expect(evaluate({ step: "privacy", outcome: "accepted" })).toBe(false);
  });

  it("all / any / not", () => {
    expect(
      evaluate({ all: [{ field: "drivingLicense", eq: true }, { field: "age", gt: 18 }] }),
    ).toBe(true);
    expect(evaluate({ any: [{ field: "age", lt: 18 }, { field: "transport", eq: "bici" }] })).toBe(
      true,
    );
    expect(evaluate({ not: { field: "drivingLicense", eq: true } })).toBe(false);
  });
});

describe("conditionRefs", () => {
  it("collects field and step references from nested conditions", () => {
    const refs = conditionRefs({
      any: [
        { field: "drivingLicense", eq: true },
        { not: { step: "cv_info", outcome: "yes" } },
        { all: [{ field: "custom.night_shifts", exists: true }] },
      ],
    });
    expect(refs).toEqual({
      fields: ["drivingLicense", "custom.night_shifts"],
      outcomes: [{ step: "cv_info", outcome: "yes" }],
    });
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/campaigns/conditions.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare `src/campaigns/schema/conditions.ts`**

```ts
import { z } from "zod";

const ScalarSchema = z.union([z.string(), z.number(), z.boolean()]);
export type Scalar = z.infer<typeof ScalarSchema>;

export type FieldCondition =
  | { field: string; eq: Scalar }
  | { field: string; neq: Scalar }
  | { field: string; in: Scalar[] }
  | { field: string; notIn: Scalar[] }
  | { field: string; exists: true }
  | { field: string; notExists: true }
  | { field: string; gt: number }
  | { field: string; lt: number };

export type Condition =
  | FieldCondition
  | { step: string; outcome: string }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

const field = z.string().min(1);

// Conditions are data, never code (spec §5.5).
export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ field, eq: ScalarSchema }),
    z.strictObject({ field, neq: ScalarSchema }),
    z.strictObject({ field, in: z.array(ScalarSchema).min(1) }),
    z.strictObject({ field, notIn: z.array(ScalarSchema).min(1) }),
    z.strictObject({ field, exists: z.literal(true) }),
    z.strictObject({ field, notExists: z.literal(true) }),
    z.strictObject({ field, gt: z.number() }),
    z.strictObject({ field, lt: z.number() }),
    z.strictObject({ step: z.string().min(1), outcome: z.string().min(1) }),
    z.strictObject({ all: z.array(ConditionSchema).min(1) }),
    z.strictObject({ any: z.array(ConditionSchema).min(1) }),
    z.strictObject({ not: ConditionSchema }),
  ]),
);
```

- [ ] **Step 4: Implementare `src/campaigns/conditions/evaluate.ts`**

```ts
import type { Condition, Scalar } from "../schema/conditions";

export interface ConditionContext {
  /** Profile values keyed by field ref ("firstName", "custom.x"). */
  readonly values: Readonly<Record<string, unknown>>;
  /** Outcome of each completed step, keyed by step id. */
  readonly outcomes: Readonly<Record<string, string>>;
}

export function evaluateCondition(c: Condition, ctx: ConditionContext): boolean {
  if ("all" in c) return c.all.every((inner) => evaluateCondition(inner, ctx));
  if ("any" in c) return c.any.some((inner) => evaluateCondition(inner, ctx));
  if ("not" in c) return !evaluateCondition(c.not, ctx);
  if ("step" in c) return ctx.outcomes[c.step] === c.outcome;

  const value = ctx.values[c.field];
  if ("exists" in c) return isPresent(value);
  if ("notExists" in c) return !isPresent(value);
  if (!isPresent(value)) return "neq" in c || "notIn" in c;
  if ("eq" in c) return matches(value, c.eq);
  if ("neq" in c) return !matches(value, c.neq);
  if ("in" in c) return c.in.some((expected) => matches(value, expected));
  if ("notIn" in c) return !c.notIn.some((expected) => matches(value, expected));
  if ("gt" in c) return typeof value === "number" && value > c.gt;
  return typeof value === "number" && value < c.lt;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
}

function matches(value: unknown, expected: Scalar): boolean {
  return Array.isArray(value) ? value.includes(expected) : value === expected;
}

export interface ConditionRefs {
  fields: string[];
  outcomes: { step: string; outcome: string }[];
}

export function conditionRefs(c: Condition): ConditionRefs {
  const refs: ConditionRefs = { fields: [], outcomes: [] };
  collect(c, refs);
  return refs;
}

function collect(c: Condition, refs: ConditionRefs): void {
  if ("all" in c) c.all.forEach((inner) => { collect(inner, refs); });
  else if ("any" in c) c.any.forEach((inner) => { collect(inner, refs); });
  else if ("not" in c) collect(c.not, refs);
  else if ("step" in c) refs.outcomes.push({ step: c.step, outcome: c.outcome });
  else refs.fields.push(c.field);
}
```

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test tests/unit/campaigns && pnpm typecheck && pnpm lint && pnpm format`
Expected: tutti verdi (Prettier può riformattare le `forEach`).

- [ ] **Step 6: Commit**

```bash
git add src/campaigns tests/unit/campaigns
git commit -m "feat(campaigns): add declarative conditions with evaluator"
```

---

### Task 7: Schemi di id, passaggi e campagna

**Files:**
- Create: `src/campaigns/schema/ids.ts`, `src/campaigns/schema/steps.ts`, `src/campaigns/schema/campaign.ts`
- Create: `tests/unit/campaigns/fixtures.ts`
- Test: `tests/unit/campaigns/campaign-schema.test.ts`

- [ ] **Step 1: Creare la campagna di test condivisa**

`tests/unit/campaigns/fixtures.ts`:

```ts
import type { CampaignInput } from "../../../src/campaigns/schema/campaign";

/** A small but complete valid campaign. Tests clone it and break one thing at a time. */
export function minimalCampaign(): CampaignInput {
  return {
    campaign: "acme-magazzino",
    organization: "acme",
    externalKey: "acme",
    trigger: { sender: "kubri-main", keywords: ["acme"] },
    dataController: { name: "ACME S.r.l.", privacyUrl: "https://example.com/privacy" },
    customFields: [
      {
        key: "night_shifts",
        type: "bool",
        label: { it: "Turni notturni" },
        description: "Disponibile a lavorare di notte.",
      },
    ],
    texts: {
      cv_explain: { it: "Un CV è un documento che riassume le tue esperienze." },
    },
    flow: [
      { id: "intro", type: "message", text: { it: "Ciao! Ti farò qualche domanda." } },
      {
        id: "cv_info",
        type: "choice",
        prompt: { it: "Sai cos'è un CV?" },
        options: [
          { id: "yes", description: "Sa cos'è un CV e vuole proseguire" },
          { id: "no", description: "Non vuole proseguire" },
          { id: "idk", description: "Non sa cos'è un CV" },
        ],
        on: { no: "@stop", idk: { reply: "cv_explain", then: "@repeat" } },
      },
      {
        id: "privacy",
        type: "consent",
        consentKey: "acme_privacy",
        textVersion: "2026-10",
        text: { it: "Accetti l'informativa sulla privacy?" },
        link: "https://example.com/privacy",
      },
      {
        id: "anagrafica",
        type: "questions",
        questions: [
          { id: "nome", field: "firstName", prompt: { it: "Come ti chiami?" } },
          { id: "patente", field: "drivingLicense", prompt: { it: "Hai la patente?" } },
          {
            id: "notte",
            field: "custom.night_shifts",
            prompt: { it: "Lavoreresti anche di notte?" },
            when: { field: "drivingLicense", eq: true },
          },
        ],
      },
      { id: "fine", type: "end", text: { it: "Grazie!" } },
    ],
  };
}
```

- [ ] **Step 2: Scrivere i test che falliscono**

`tests/unit/campaigns/campaign-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CampaignDefinitionSchema } from "../../../src/campaigns/schema/campaign";
import { minimalCampaign } from "./fixtures";

describe("CampaignDefinitionSchema", () => {
  it("accepts the minimal campaign and applies defaults", () => {
    const parsed = CampaignDefinitionSchema.parse(minimalCampaign());

    expect(parsed.defaultLanguage).toBe("it");
    expect(parsed.onStop).toEqual({ data: "delete" });
    expect(parsed.trigger.isDefault).toBe(false);
    expect(parsed.afterCompletion).toEqual({ allowEdits: true, allowCvRegeneration: false });
  });

  it("applies step and question defaults", () => {
    const parsed = CampaignDefinitionSchema.parse(minimalCampaign());
    const consent = parsed.flow.find((s) => s.type === "consent");
    const questions = parsed.flow.find((s) => s.type === "questions");

    expect(consent?.type === "consent" && consent.optional).toBe(false);
    expect(questions?.type === "questions" && questions.questions[0]).toMatchObject({
      required: true,
      maxClarifications: 2,
    });
  });

  it("lowercases and trims trigger keywords", () => {
    const input = minimalCampaign();
    input.trigger.keywords = ["  ACME "];
    expect(CampaignDefinitionSchema.parse(input).trigger.keywords).toEqual(["acme"]);
  });

  it("accepts text references", () => {
    const input = minimalCampaign();
    input.flow[0] = { id: "intro", type: "message", text: { ref: "cv_explain" } };
    expect(CampaignDefinitionSchema.safeParse(input).success).toBe(true);
  });

  it("rejects unknown step types", () => {
    const input = minimalCampaign() as { flow: unknown[] };
    input.flow.push({ id: "x", type: "appointment" });
    expect(CampaignDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects unknown properties (typos must not pass silently)", () => {
    const input = { ...minimalCampaign(), extrnalKey: "typo" };
    expect(CampaignDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects choices with fewer than two options", () => {
    const input = minimalCampaign();
    input.flow[1] = {
      id: "cv_info",
      type: "choice",
      prompt: { it: "?" },
      options: [{ id: "yes", description: "sì" }],
    };
    expect(CampaignDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects invalid ids", () => {
    const input = minimalCampaign();
    input.flow[0] = { id: "Intro-1", type: "message", text: { it: "Ciao" } };
    expect(CampaignDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects maxClarifications above 5", () => {
    const input = minimalCampaign();
    input.flow[3] = {
      id: "anagrafica",
      type: "questions",
      questions: [{ id: "nome", field: "firstName", prompt: { it: "?" }, maxClarifications: 9 }],
    };
    expect(CampaignDefinitionSchema.safeParse(input).success).toBe(false);
  });
});
```

- [ ] **Step 3: Verificare che falliscano**

Run: `pnpm test tests/unit/campaigns/campaign-schema.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 4: Implementare `src/campaigns/schema/ids.ts`**

```ts
import { z } from "zod";

/** Step, question, option, consent and text ids. */
export const IdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case id");

/** Campaign, organization and sender slugs. */
export const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kebab-case slug");
```

- [ ] **Step 5: Implementare `src/campaigns/schema/steps.ts`**

```ts
import { z } from "zod";
import { LocalizedTextSchema } from "../../i18n/localized-text";
import { ConditionSchema } from "./conditions";
import { IdSchema } from "./ids";

// A text is either inline or a reference to the campaign's `texts` map.
// The ref object comes first: a {ref} object is not a valid LocalizedText anyway.
export const TextValueSchema = z.union([
  z.strictObject({ ref: IdSchema }),
  LocalizedTextSchema,
]);
export type TextValue = z.infer<typeof TextValueSchema>;

export const SPECIAL_TARGETS = ["@stop", "@repeat", "@end"] as const;
export type SpecialTarget = (typeof SPECIAL_TARGETS)[number];

export const TargetSchema = z.union([z.enum(SPECIAL_TARGETS), IdSchema]);
export type Target = z.infer<typeof TargetSchema>;

export const TransitionSchema = z.union([
  TargetSchema,
  z.strictObject({ reply: IdSchema, then: TargetSchema }),
]);
export type Transition = z.infer<typeof TransitionSchema>;

const OnSchema = z.record(IdSchema, TransitionSchema).optional();

const stepBase = {
  id: IdSchema,
  when: ConditionSchema.optional(),
};

export const MessageStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal("message"),
  text: TextValueSchema,
  on: OnSchema,
});

export const ChoiceOptionSchema = z.strictObject({
  id: IdSchema,
  /** Read by the LLM to classify the candidate's answer. */
  description: z.string().trim().min(1),
});

export const ChoiceStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal("choice"),
  prompt: TextValueSchema,
  options: z.array(ChoiceOptionSchema).min(2),
  on: OnSchema,
});

export const ConsentStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal("consent"),
  consentKey: IdSchema,
  textVersion: z.string().trim().min(1),
  text: TextValueSchema,
  link: z.url().optional(),
  optional: z.boolean().default(false),
  on: OnSchema,
});

export const QuestionSchema = z.strictObject({
  id: IdSchema,
  /** A standard field key or "custom.<key>". */
  field: z.string().min(1),
  prompt: TextValueSchema,
  required: z.boolean().default(true),
  /** Extraction guidance for the LLM, specific to this question. */
  hint: z.string().trim().min(1).optional(),
  when: ConditionSchema.optional(),
  terminateIf: ConditionSchema.optional(),
  maxClarifications: z.number().int().min(0).max(5).default(2),
});
export type Question = z.infer<typeof QuestionSchema>;

export const QuestionsStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal("questions"),
  title: TextValueSchema.optional(),
  questions: z.array(QuestionSchema).min(1),
  on: OnSchema,
});

export const CvOfferStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal("cv_offer"),
  prompt: TextValueSchema,
  on: OnSchema,
});

export const EndStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal("end"),
  text: TextValueSchema,
});

export const StepSchema = z.discriminatedUnion("type", [
  MessageStepSchema,
  ChoiceStepSchema,
  ConsentStepSchema,
  QuestionsStepSchema,
  CvOfferStepSchema,
  EndStepSchema,
]);
export type Step = z.infer<typeof StepSchema>;
export type StepType = Step["type"];
```

- [ ] **Step 6: Implementare `src/campaigns/schema/campaign.ts`**

```ts
import { z } from "zod";
import { LanguageCodeSchema, LocalizedTextSchema } from "../../i18n/localized-text";
import { CustomFieldDefinitionSchema } from "../../profile/custom-fields";
import { IdSchema, SlugSchema } from "./ids";
import { StepSchema } from "./steps";

// Spec §5.1. `version` is not part of the file: the import assigns it (plan 03).
export const CampaignDefinitionSchema = z.strictObject({
  campaign: SlugSchema,
  organization: SlugSchema,
  /** The pool key on the Kubri platform, sent with the webhook. */
  externalKey: z.string().trim().min(1),
  trigger: z.strictObject({
    sender: SlugSchema,
    keywords: z.array(z.string().trim().toLowerCase().min(2)).default([]),
    /** The campaign used on this sender when no keyword matches. */
    isDefault: z.boolean().default(false),
  }),
  defaultLanguage: LanguageCodeSchema.default("it"),
  dataController: z.strictObject({
    name: z.string().trim().min(1),
    privacyUrl: z.url(),
  }),
  onStop: z.strictObject({ data: z.enum(["delete", "keep"]) }).default({ data: "delete" }),
  customFields: z.array(CustomFieldDefinitionSchema).default([]),
  texts: z.record(IdSchema, LocalizedTextSchema).default({}),
  flow: z.array(StepSchema).min(1),
  afterCompletion: z
    .strictObject({
      allowEdits: z.boolean().default(true),
      allowCvRegeneration: z.boolean().default(false),
    })
    .default({ allowEdits: true, allowCvRegeneration: false }),
});

export type CampaignDefinition = z.infer<typeof CampaignDefinitionSchema>;
export type CampaignInput = z.input<typeof CampaignDefinitionSchema>;
```

- [ ] **Step 7: Verificare che passino**

Run: `pnpm test tests/unit/campaigns && pnpm typecheck && pnpm lint`
Expected: tutti verdi.

> Se il test `rejects unknown step types` non compila per il cast, va bene: il cast
> `as { flow: unknown[] }` serve proprio a passare un input volutamente fuori dal tipo.
> Se TypeScript lo rifiuta ("conversion may be a mistake"), usare `as unknown as { flow: unknown[] }`.

- [ ] **Step 8: Commit**

```bash
git add src/campaigns tests/unit/campaigns
git commit -m "feat(campaigns): add step and campaign definition schemas"
```

---

### Task 8: Esiti e transizioni (`flow.ts`)

**Files:**
- Create: `src/campaigns/flow.ts`
- Test: `tests/unit/campaigns/flow.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, expect, it } from "vitest";
import { resolveTransition, stepOutcomes } from "../../../src/campaigns/flow";
import { CampaignDefinitionSchema } from "../../../src/campaigns/schema/campaign";
import type { Step } from "../../../src/campaigns/schema/steps";
import { minimalCampaign } from "./fixtures";

const flow = CampaignDefinitionSchema.parse(minimalCampaign()).flow;
const step = (id: string): Step => {
  const found = flow.find((s) => s.id === id);
  if (!found) throw new Error(`no step ${id}`);
  return found;
};

describe("stepOutcomes", () => {
  it.each([
    ["intro", ["next"]],
    ["cv_info", ["yes", "no", "idk"]],
    ["privacy", ["accepted", "declined"]],
    ["anagrafica", ["completed", "terminated"]],
    ["fine", []],
  ])("%s → %j", (id, outcomes) => {
    expect(stepOutcomes(step(id))).toEqual(outcomes);
  });
});

describe("resolveTransition", () => {
  it("defaults to the next step", () => {
    expect(resolveTransition(step("cv_info"), "yes", "privacy")).toEqual({ target: "privacy" });
  });

  it("defaults to @end after the last step", () => {
    expect(resolveTransition(step("intro"), "next", undefined)).toEqual({ target: "@end" });
  });

  it("uses an explicit target", () => {
    expect(resolveTransition(step("cv_info"), "no", "privacy")).toEqual({ target: "@stop" });
  });

  it("returns the reply of a reply-then transition", () => {
    expect(resolveTransition(step("cv_info"), "idk", "privacy")).toEqual({
      reply: "cv_explain",
      target: "@repeat",
    });
  });

  it("stops on a declined mandatory consent", () => {
    expect(resolveTransition(step("privacy"), "declined", "anagrafica")).toEqual({
      target: "@stop",
    });
  });

  it("continues on a declined optional consent", () => {
    const optional = { ...step("privacy"), optional: true } as Step;
    expect(resolveTransition(optional, "declined", "anagrafica")).toEqual({
      target: "anagrafica",
    });
  });

  it("stops when a questions block terminates", () => {
    expect(resolveTransition(step("anagrafica"), "terminated", "fine")).toEqual({
      target: "@stop",
    });
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/campaigns/flow.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare**

`src/campaigns/flow.ts`:

```ts
import type { Step, Target } from "./schema/steps";

/** The outcomes a step can produce. `end` produces none: it closes the session. */
export function stepOutcomes(step: Step): readonly string[] {
  switch (step.type) {
    case "message":
      return ["next"];
    case "choice":
      return step.options.map((option) => option.id);
    case "consent":
      return ["accepted", "declined"];
    case "questions":
      return ["completed", "terminated"];
    case "cv_offer":
      return ["yes", "no"];
    case "end":
      return [];
  }
}

export interface ResolvedTransition {
  /** Key in the campaign's `texts`, sent before moving on. */
  reply?: string;
  target: Target;
}

/**
 * Where an outcome leads. `nextStepId` is the id of the following step in `flow`
 * (undefined for the last step). Defaults are documented in plan 02.
 */
export function resolveTransition(
  step: Step,
  outcome: string,
  nextStepId: string | undefined,
): ResolvedTransition {
  const explicit = step.type === "end" ? undefined : step.on?.[outcome];
  if (explicit === undefined) return { target: defaultTarget(step, outcome, nextStepId) };
  if (typeof explicit === "string") return { target: explicit };
  return { reply: explicit.reply, target: explicit.then };
}

function defaultTarget(step: Step, outcome: string, nextStepId: string | undefined): Target {
  if (step.type === "questions" && outcome === "terminated") return "@stop";
  if (step.type === "consent" && outcome === "declined" && !step.optional) return "@stop";
  return nextStepId ?? "@end";
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test tests/unit/campaigns && pnpm typecheck && pnpm lint`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/campaigns tests/unit/campaigns
git commit -m "feat(campaigns): resolve step outcomes and transitions with defaults"
```

---

### Task 9: Tipo degli errori e controllo degli id univoci

**Files:**
- Create: `src/campaigns/issues.ts`, `src/campaigns/checks/unique-ids.ts`
- Test: `tests/unit/campaigns/checks/unique-ids.test.ts`

- [ ] **Step 1: Creare un helper di test**

Aggiungere in fondo a `tests/unit/campaigns/fixtures.ts`:

```ts
import {
  CampaignDefinitionSchema,
  type CampaignDefinition,
} from "../../../src/campaigns/schema/campaign";

/** Parses an input that is schema-valid on purpose, to exercise semantic checks. */
export function parsed(input: CampaignInput): CampaignDefinition {
  return CampaignDefinitionSchema.parse(input);
}
```

E spostare l'import esistente `import type { CampaignInput } …` in cima unendolo a questo:
il file deve avere un solo import da `schema/campaign`:

```ts
import {
  CampaignDefinitionSchema,
  type CampaignDefinition,
  type CampaignInput,
} from "../../../src/campaigns/schema/campaign";
```

- [ ] **Step 2: Scrivere i test che falliscono**

`tests/unit/campaigns/checks/unique-ids.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkUniqueIds } from "../../../../src/campaigns/checks/unique-ids";
import { minimalCampaign, parsed } from "../fixtures";

describe("checkUniqueIds", () => {
  it("passes on the minimal campaign", () => {
    expect(checkUniqueIds(parsed(minimalCampaign()))).toEqual([]);
  });

  it("reports duplicate step ids", () => {
    const input = minimalCampaign();
    input.flow.push({ id: "intro", type: "message", text: { it: "Ancora ciao" } });

    expect(checkUniqueIds(parsed(input))).toEqual([
      { path: "flow[5].id", code: "duplicate_step_id", message: 'Step id "intro" is used twice' },
    ]);
  });

  it("reports duplicate question ids across blocks", () => {
    const input = minimalCampaign();
    input.flow.splice(4, 0, {
      id: "altro",
      type: "questions",
      questions: [{ id: "nome", field: "lastName", prompt: { it: "Cognome?" } }],
    });

    expect(checkUniqueIds(parsed(input)).map((i) => i.code)).toEqual(["duplicate_question_id"]);
  });

  it("reports duplicate consent keys, option ids and custom field keys", () => {
    const input = minimalCampaign();
    input.flow.splice(3, 0, {
      id: "privacy_bis",
      type: "consent",
      consentKey: "acme_privacy",
      textVersion: "1",
      text: { it: "Ancora?" },
    });
    input.flow[1] = {
      id: "cv_info",
      type: "choice",
      prompt: { it: "?" },
      options: [
        { id: "yes", description: "sì" },
        { id: "yes", description: "sì ancora" },
      ],
    };
    input.customFields = [...(input.customFields ?? []), ...(input.customFields ?? [])];

    expect(checkUniqueIds(parsed(input)).map((i) => i.code).sort()).toEqual([
      "duplicate_consent_key",
      "duplicate_custom_field",
      "duplicate_option_id",
    ]);
  });
});
```

- [ ] **Step 3: Verificare che falliscano**

Run: `pnpm test tests/unit/campaigns/checks`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 4: Implementare `src/campaigns/issues.ts`**

```ts
export interface CampaignIssue {
  /** JSON path inside the campaign file, e.g. "flow[3].questions[1].field". */
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export function issue(path: string, code: string, message: string): CampaignIssue {
  return { path, code, message };
}

/** Yields the second and later occurrences of each value. */
export function duplicates<T>(items: readonly T[], keyOf: (item: T) => string): [T, number][] {
  const seen = new Set<string>();
  const result: [T, number][] = [];
  items.forEach((item, index) => {
    const key = keyOf(item);
    if (seen.has(key)) result.push([item, index]);
    seen.add(key);
  });
  return result;
}
```

- [ ] **Step 5: Implementare `src/campaigns/checks/unique-ids.ts`**

```ts
import { duplicates, issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";

export function checkUniqueIds(c: CampaignDefinition): CampaignIssue[] {
  const issues: CampaignIssue[] = [];

  for (const [step, i] of duplicates(c.flow, (s) => s.id)) {
    issues.push(
      issue(`flow[${i}].id`, "duplicate_step_id", `Step id "${step.id}" is used twice`),
    );
  }

  const questions = c.flow.flatMap((step, stepIndex) =>
    step.type === "questions"
      ? step.questions.map((q, qIndex) => ({ id: q.id, path: `flow[${stepIndex}].questions[${qIndex}].id` }))
      : [],
  );
  for (const [q] of duplicates(questions, (q) => q.id)) {
    issues.push(issue(q.path, "duplicate_question_id", `Question id "${q.id}" is used twice`));
  }

  const consents = c.flow.flatMap((step, stepIndex) =>
    step.type === "consent" ? [{ key: step.consentKey, path: `flow[${stepIndex}].consentKey` }] : [],
  );
  for (const [consent] of duplicates(consents, (x) => x.key)) {
    issues.push(
      issue(consent.path, "duplicate_consent_key", `Consent key "${consent.key}" is used twice`),
    );
  }

  c.flow.forEach((step, stepIndex) => {
    if (step.type !== "choice") return;
    for (const [option, i] of duplicates(step.options, (o) => o.id)) {
      issues.push(
        issue(
          `flow[${stepIndex}].options[${i}].id`,
          "duplicate_option_id",
          `Option id "${option.id}" is used twice in step "${step.id}"`,
        ),
      );
    }
  });

  for (const [field, i] of duplicates(c.customFields, (f) => f.key)) {
    issues.push(
      issue(
        `customFields[${i}].key`,
        "duplicate_custom_field",
        `Custom field "${field.key}" is declared twice`,
      ),
    );
  }

  return issues;
}
```

- [ ] **Step 6: Verificare che passino**

Run: `pnpm test tests/unit/campaigns && pnpm typecheck && pnpm lint && pnpm format`
Expected: tutti verdi.

- [ ] **Step 7: Commit**

```bash
git add src/campaigns tests/unit/campaigns
git commit -m "feat(campaigns): check unique ids in campaign definitions"
```

---

### Task 10: Controllo dei riferimenti ai testi

**Files:**
- Create: `src/campaigns/checks/text-refs.ts`
- Test: `tests/unit/campaigns/checks/text-refs.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, expect, it } from "vitest";
import { checkTextRefs } from "../../../../src/campaigns/checks/text-refs";
import { minimalCampaign, parsed } from "../fixtures";

describe("checkTextRefs", () => {
  it("passes on the minimal campaign (cv_explain is declared)", () => {
    expect(checkTextRefs(parsed(minimalCampaign()))).toEqual([]);
  });

  it("reports an undeclared {ref} text", () => {
    const input = minimalCampaign();
    input.flow[0] = { id: "intro", type: "message", text: { ref: "welcome" } };

    expect(checkTextRefs(parsed(input))).toEqual([
      {
        path: "flow[0].text.ref",
        code: "unknown_text_ref",
        message: 'Text "welcome" is not declared in texts',
      },
    ]);
  });

  it("reports an undeclared reply in a transition", () => {
    const input = minimalCampaign();
    input.texts = {};

    expect(checkTextRefs(parsed(input))).toEqual([
      {
        path: "flow[1].on.idk.reply",
        code: "unknown_text_ref",
        message: 'Text "cv_explain" is not declared in texts',
      },
    ]);
  });

  it("checks question prompts and block titles", () => {
    const input = minimalCampaign();
    input.flow[3] = {
      id: "anagrafica",
      type: "questions",
      title: { ref: "missing_title" },
      questions: [{ id: "nome", field: "firstName", prompt: { ref: "missing_prompt" } }],
    };

    expect(checkTextRefs(parsed(input)).map((i) => i.path)).toEqual([
      "flow[3].title.ref",
      "flow[3].questions[0].prompt.ref",
    ]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/campaigns/checks/text-refs.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare**

`src/campaigns/checks/text-refs.ts`:

```ts
import { issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";
import type { Step, TextValue } from "../schema/steps";

export function checkTextRefs(c: CampaignDefinition): CampaignIssue[] {
  const declared = new Set(Object.keys(c.texts));
  const issues: CampaignIssue[] = [];

  const check = (key: string, path: string): void => {
    if (!declared.has(key)) {
      issues.push(issue(path, "unknown_text_ref", `Text "${key}" is not declared in texts`));
    }
  };

  c.flow.forEach((step, i) => {
    for (const { value, path } of stepTexts(step, `flow[${i}]`)) {
      if ("ref" in value && typeof value.ref === "string") check(value.ref, `${path}.ref`);
    }
    if (step.type === "end" || !step.on) return;
    for (const [outcome, transition] of Object.entries(step.on)) {
      if (typeof transition !== "string") check(transition.reply, `flow[${i}].on.${outcome}.reply`);
    }
  });

  return issues;
}

/** Every text a step sends, in document order, with its JSON path. */
export function stepTexts(step: Step, path: string): { value: TextValue; path: string }[] {
  switch (step.type) {
    case "message":
    case "end":
      return [{ value: step.text, path: `${path}.text` }];
    case "choice":
    case "cv_offer":
      return [{ value: step.prompt, path: `${path}.prompt` }];
    case "consent":
      return [{ value: step.text, path: `${path}.text` }];
    case "questions":
      return [
        ...(step.title ? [{ value: step.title, path: `${path}.title` }] : []),
        ...step.questions.map((q, qi) => ({
          value: q.prompt,
          path: `${path}.questions[${qi}].prompt`,
        })),
      ];
  }
}
```

> Attenzione: un `LocalizedText` con la chiave `ref` non è possibile (le chiavi sono codici di
> due lettere), quindi `"ref" in value` identifica con certezza un riferimento. Il controllo
> `typeof value.ref === "string"` serve solo a TypeScript, che vede `value` come unione.

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test tests/unit/campaigns && pnpm typecheck && pnpm lint && pnpm format`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/campaigns tests/unit/campaigns
git commit -m "feat(campaigns): check text references"
```

---

### Task 11: Controllo dei riferimenti ai campi e alle condizioni

**Files:**
- Create: `src/campaigns/checks/field-refs.ts`
- Test: `tests/unit/campaigns/checks/field-refs.test.ts`

Controlla:
- che il `field` di ogni domanda esista e non sia un campo di sistema;
- che due domande non scrivano lo stesso campo;
- che ogni condizione (`when` dei passaggi e delle domande, `terminateIf`) si riferisca a campi
  esistenti e a esiti esistenti di passaggi esistenti.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, expect, it } from "vitest";
import { checkFieldRefs } from "../../../../src/campaigns/checks/field-refs";
import { minimalCampaign, parsed } from "../fixtures";

const questionsStep = (questions: object[]) => ({
  id: "anagrafica",
  type: "questions" as const,
  questions,
});

describe("checkFieldRefs", () => {
  it("passes on the minimal campaign", () => {
    expect(checkFieldRefs(parsed(minimalCampaign()))).toEqual([]);
  });

  it("reports unknown and undeclared custom fields", () => {
    const input = minimalCampaign();
    input.flow[3] = questionsStep([
      { id: "a", field: "nickname", prompt: { it: "?" } },
      { id: "b", field: "custom.uniform_size", prompt: { it: "?" } },
    ]) as never;

    expect(checkFieldRefs(parsed(input))).toEqual([
      {
        path: "flow[3].questions[0].field",
        code: "unknown_field",
        message: 'Field "nickname" is neither standard nor declared in customFields',
      },
      {
        path: "flow[3].questions[1].field",
        code: "unknown_field",
        message: 'Field "custom.uniform_size" is neither standard nor declared in customFields',
      },
    ]);
  });

  it("reports questions on system-only fields", () => {
    const input = minimalCampaign();
    input.flow[3] = questionsStep([{ id: "tel", field: "phone", prompt: { it: "?" } }]) as never;

    expect(checkFieldRefs(parsed(input)).map((i) => i.code)).toEqual(["system_only_field"]);
  });

  it("reports two questions writing the same field", () => {
    const input = minimalCampaign();
    input.flow[3] = questionsStep([
      { id: "a", field: "firstName", prompt: { it: "?" } },
      { id: "b", field: "firstName", prompt: { it: "??" } },
    ]) as never;

    expect(checkFieldRefs(parsed(input)).map((i) => [i.path, i.code])).toEqual([
      ["flow[3].questions[1].field", "duplicate_field_question"],
    ]);
  });

  it("reports conditions on unknown fields", () => {
    const input = minimalCampaign();
    input.flow[0] = {
      id: "intro",
      type: "message",
      text: { it: "Ciao" },
      when: { field: "shoeSize", gt: 40 },
    };

    expect(checkFieldRefs(parsed(input))).toEqual([
      {
        path: "flow[0].when",
        code: "unknown_condition_field",
        message: 'Condition refers to unknown field "shoeSize"',
      },
    ]);
  });

  it("reports conditions on unknown steps or impossible outcomes", () => {
    const input = minimalCampaign();
    input.flow[3] = questionsStep([
      {
        id: "nome",
        field: "firstName",
        prompt: { it: "?" },
        when: { step: "ghost", outcome: "yes" },
        terminateIf: { step: "cv_info", outcome: "maybe" },
      },
    ]) as never;

    expect(checkFieldRefs(parsed(input))).toEqual([
      {
        path: "flow[3].questions[0].when",
        code: "unknown_condition_step",
        message: 'Condition refers to unknown step "ghost"',
      },
      {
        path: "flow[3].questions[0].terminateIf",
        code: "unknown_condition_outcome",
        message: 'Step "cv_info" has no outcome "maybe"',
      },
    ]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/campaigns/checks/field-refs.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare**

`src/campaigns/checks/field-refs.ts`:

```ts
import { resolveField } from "../../profile/field-ref";
import { conditionRefs } from "../conditions/evaluate";
import { stepOutcomes } from "../flow";
import { issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";
import type { Condition } from "../schema/conditions";

export function checkFieldRefs(c: CampaignDefinition): CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  const stepsById = new Map(c.flow.map((step) => [step.id, step]));
  const askedFields = new Set<string>();

  const checkCondition = (condition: Condition | undefined, path: string): void => {
    if (!condition) return;
    const refs = conditionRefs(condition);
    for (const field of refs.fields) {
      if (!resolveField(field, c.customFields)) {
        issues.push(
          issue(path, "unknown_condition_field", `Condition refers to unknown field "${field}"`),
        );
      }
    }
    for (const { step: stepId, outcome } of refs.outcomes) {
      const step = stepsById.get(stepId);
      if (!step) {
        issues.push(
          issue(path, "unknown_condition_step", `Condition refers to unknown step "${stepId}"`),
        );
      } else if (!stepOutcomes(step).includes(outcome)) {
        issues.push(
          issue(path, "unknown_condition_outcome", `Step "${stepId}" has no outcome "${outcome}"`),
        );
      }
    }
  };

  c.flow.forEach((step, i) => {
    checkCondition(step.when, `flow[${i}].when`);
    if (step.type !== "questions") return;

    step.questions.forEach((q, qi) => {
      const path = `flow[${i}].questions[${qi}]`;
      const def = resolveField(q.field, c.customFields);
      if (!def) {
        issues.push(
          issue(
            `${path}.field`,
            "unknown_field",
            `Field "${q.field}" is neither standard nor declared in customFields`,
          ),
        );
      } else if (def.systemOnly === true) {
        issues.push(
          issue(`${path}.field`, "system_only_field", `Field "${q.field}" is written by the system only`),
        );
      } else if (askedFields.has(q.field)) {
        issues.push(
          issue(
            `${path}.field`,
            "duplicate_field_question",
            `Field "${q.field}" is already asked by another question`,
          ),
        );
      }
      askedFields.add(q.field);
      checkCondition(q.when, `${path}.when`);
      checkCondition(q.terminateIf, `${path}.terminateIf`);
    });
  });

  return issues;
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test tests/unit/campaigns && pnpm typecheck && pnpm lint && pnpm format`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/campaigns tests/unit/campaigns
git commit -m "feat(campaigns): check field and condition references"
```

---

### Task 12: Controllo delle transizioni

**Files:**
- Create: `src/campaigns/checks/transitions.ts`
- Test: `tests/unit/campaigns/checks/transitions.test.ts`

Controlla:
- che le chiavi di `on` siano esiti possibili del passaggio;
- che le destinazioni siano passaggi esistenti o destinazioni speciali;
- che `@repeat` non venga usato sui `message`: un messaggio non aspetta risposta, quindi si
  ripeterebbe all'infinito.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, expect, it } from "vitest";
import { checkTransitions } from "../../../../src/campaigns/checks/transitions";
import { minimalCampaign, parsed } from "../fixtures";

describe("checkTransitions", () => {
  it("passes on the minimal campaign", () => {
    expect(checkTransitions(parsed(minimalCampaign()))).toEqual([]);
  });

  it("reports outcomes the step cannot produce", () => {
    const input = minimalCampaign();
    input.flow[2] = {
      id: "privacy",
      type: "consent",
      consentKey: "acme_privacy",
      textVersion: "1",
      text: { it: "?" },
      on: { maybe: "@stop" },
    };

    expect(checkTransitions(parsed(input))).toEqual([
      {
        path: "flow[2].on.maybe",
        code: "unknown_outcome",
        message: 'Step "privacy" (consent) has no outcome "maybe"; expected one of: accepted, declined',
      },
    ]);
  });

  it("reports targets that are not steps", () => {
    const input = minimalCampaign();
    input.flow[0] = { id: "intro", type: "message", text: { it: "Ciao" }, on: { next: "ghost" } };

    expect(checkTransitions(parsed(input))).toEqual([
      {
        path: "flow[0].on.next",
        code: "unknown_target",
        message: 'Target "ghost" is not a step id nor @stop / @repeat / @end',
      },
    ]);
  });

  it("checks the target of reply-then transitions", () => {
    const input = minimalCampaign();
    input.flow[1] = {
      id: "cv_info",
      type: "choice",
      prompt: { it: "?" },
      options: [
        { id: "yes", description: "sì" },
        { id: "idk", description: "non so" },
      ],
      on: { idk: { reply: "cv_explain", then: "ghost" } },
    };

    expect(checkTransitions(parsed(input)).map((i) => i.path)).toEqual(["flow[1].on.idk.then"]);
  });

  it("forbids @repeat on message steps", () => {
    const input = minimalCampaign();
    input.flow[0] = { id: "intro", type: "message", text: { it: "Ciao" }, on: { next: "@repeat" } };

    expect(checkTransitions(parsed(input)).map((i) => i.code)).toEqual(["repeat_on_message"]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/campaigns/checks/transitions.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare**

`src/campaigns/checks/transitions.ts`:

```ts
import { stepOutcomes } from "../flow";
import { issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";
import { SPECIAL_TARGETS, type Target } from "../schema/steps";

export function checkTransitions(c: CampaignDefinition): CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  const stepIds = new Set(c.flow.map((step) => step.id));
  const isSpecial = (t: Target): boolean => (SPECIAL_TARGETS as readonly string[]).includes(t);

  c.flow.forEach((step, i) => {
    if (step.type === "end" || !step.on) return;
    const outcomes = stepOutcomes(step);

    for (const [outcome, transition] of Object.entries(step.on)) {
      const path = `flow[${i}].on.${outcome}`;
      if (!outcomes.includes(outcome)) {
        issues.push(
          issue(
            path,
            "unknown_outcome",
            `Step "${step.id}" (${step.type}) has no outcome "${outcome}"; expected one of: ${outcomes.join(", ")}`,
          ),
        );
      }

      const target = typeof transition === "string" ? transition : transition.then;
      const targetPath = typeof transition === "string" ? path : `${path}.then`;
      if (!isSpecial(target) && !stepIds.has(target)) {
        issues.push(
          issue(
            targetPath,
            "unknown_target",
            `Target "${target}" is not a step id nor @stop / @repeat / @end`,
          ),
        );
      }
      if (target === "@repeat" && step.type === "message") {
        issues.push(
          issue(
            targetPath,
            "repeat_on_message",
            `Step "${step.id}" is a message and does not wait for an answer: @repeat would loop`,
          ),
        );
      }
    }
  });

  return issues;
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test tests/unit/campaigns && pnpm typecheck && pnpm lint && pnpm format`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/campaigns tests/unit/campaigns
git commit -m "feat(campaigns): check transition outcomes and targets"
```

---

### Task 13: Raggiungibilità e cicli

**Files:**
- Create: `src/campaigns/checks/graph.ts`
- Test: `tests/unit/campaigns/checks/graph.test.ts`

Il flusso è un grafo:
- i nodi sono i passaggi;
- gli archi sono le transizioni di ogni esito (con i default di `flow.ts`);
- un passaggio con `when` ha anche un arco verso il successivo, perché può essere saltato.

Si segnalano due cose:
- i passaggi non raggiungibili dal primo;
- i **cicli**, cioè un arco che torna a un passaggio già sul percorso. `@repeat` (arco verso
  sé stessi) è l'unico ciclo ammesso, e non viene contato come arco.

Le destinazioni sconosciute sono già segnalate dal Task 12, quindi qui vengono ignorate.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, expect, it } from "vitest";
import { checkGraph } from "../../../../src/campaigns/checks/graph";
import { minimalCampaign, parsed } from "../fixtures";

describe("checkGraph", () => {
  it("passes on the minimal campaign (@repeat is allowed)", () => {
    expect(checkGraph(parsed(minimalCampaign()))).toEqual([]);
  });

  it("reports unreachable steps", () => {
    const input = minimalCampaign();
    input.flow[1] = {
      id: "cv_info",
      type: "choice",
      prompt: { it: "?" },
      options: [
        { id: "yes", description: "sì" },
        { id: "no", description: "no" },
      ],
      on: { yes: "anagrafica", no: "@stop" },
    };

    expect(checkGraph(parsed(input))).toEqual([
      {
        path: "flow[2]",
        code: "unreachable_step",
        message: 'Step "privacy" can never be reached',
      },
    ]);
  });

  it("keeps the next step reachable when a step can be skipped by `when`", () => {
    const input = minimalCampaign();
    input.flow[1] = {
      id: "cv_info",
      type: "choice",
      prompt: { it: "?" },
      options: [
        { id: "yes", description: "sì" },
        { id: "no", description: "no" },
      ],
      when: { field: "drivingLicense", eq: true },
      on: { yes: "anagrafica", no: "@stop" },
    };

    expect(checkGraph(parsed(input))).toEqual([]);
  });

  it("reports cycles", () => {
    const input = minimalCampaign();
    input.flow[3] = {
      id: "anagrafica",
      type: "questions",
      questions: [{ id: "nome", field: "firstName", prompt: { it: "?" } }],
      on: { completed: "intro" },
    };

    // "fine" also becomes unreachable: completed now loops back, terminated goes to @stop.
    expect(checkGraph(parsed(input))).toEqual([
      {
        path: "flow[4]",
        code: "unreachable_step",
        message: 'Step "fine" can never be reached',
      },
      {
        path: "flow[3].on",
        code: "cycle",
        message: 'Step "anagrafica" leads back to "intro": cycles are not allowed (use @repeat)',
      },
    ]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/campaigns/checks/graph.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare**

`src/campaigns/checks/graph.ts`:

```ts
import { resolveTransition, stepOutcomes } from "../flow";
import { issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";

/** Edges between step ids. Special targets (@stop, @end) and self-loops are left out. */
export function flowEdges(c: CampaignDefinition): Map<string, Set<string>> {
  const ids = new Set(c.flow.map((step) => step.id));
  const edges = new Map<string, Set<string>>();

  c.flow.forEach((step, i) => {
    const nextId = c.flow[i + 1]?.id;
    const targets = new Set<string>();
    for (const outcome of stepOutcomes(step)) {
      targets.add(resolveTransition(step, outcome, nextId).target);
    }
    // A step whose `when` is false is skipped: the next step is reachable from here too.
    if (step.when && nextId) targets.add(nextId);
    targets.delete(step.id);
    edges.set(step.id, new Set([...targets].filter((t) => ids.has(t))));
  });

  return edges;
}

export function checkGraph(c: CampaignDefinition): CampaignIssue[] {
  const first = c.flow[0];
  if (!first) return [];
  const edges = flowEdges(c);
  const indexOf = new Map(c.flow.map((step, i) => [step.id, i]));
  const issues: CampaignIssue[] = [];

  // Reachability (breadth-first from the first step).
  const reached = new Set([first.id]);
  const queue = [first.id];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const next of edges.get(id) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  c.flow.forEach((step, i) => {
    if (!reached.has(step.id)) {
      issues.push(issue(`flow[${i}]`, "unreachable_step", `Step "${step.id}" can never be reached`));
    }
  });

  // Cycles (depth-first; an edge to a step still on the current path closes a cycle).
  const onPath = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): void => {
    onPath.add(id);
    for (const next of edges.get(id) ?? []) {
      if (onPath.has(next)) {
        issues.push(
          issue(
            `flow[${indexOf.get(id) ?? -1}].on`,
            "cycle",
            `Step "${id}" leads back to "${next}": cycles are not allowed (use @repeat)`,
          ),
        );
      } else if (!done.has(next)) {
        visit(next);
      }
    }
    onPath.delete(id);
    done.add(id);
  };
  visit(first.id);

  return issues;
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test tests/unit/campaigns && pnpm typecheck && pnpm lint && pnpm format`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/campaigns tests/unit/campaigns
git commit -m "feat(campaigns): check flow reachability and cycles"
```

---

### Task 14: Controlli di trigger e consensi

**Files:**
- Create: `src/campaigns/checks/trigger.ts`, `src/campaigns/checks/consents.ts`
- Test: `tests/unit/campaigns/checks/trigger.test.ts`, `tests/unit/campaigns/checks/consents.test.ts`

Regole:
- una campagna che non è di default ha bisogno di almeno una parola chiave;
- le parole chiave non si ripetono;
- il consenso `kubri_global` (condivisione nel pool globale Kubri, spec §7.3) deve essere
  `optional`.

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/campaigns/checks/trigger.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkTrigger } from "../../../../src/campaigns/checks/trigger";
import { minimalCampaign, parsed } from "../fixtures";

describe("checkTrigger", () => {
  it("passes on the minimal campaign", () => {
    expect(checkTrigger(parsed(minimalCampaign()))).toEqual([]);
  });

  it("requires keywords on non-default campaigns", () => {
    const input = minimalCampaign();
    input.trigger = { sender: "kubri-main", keywords: [] };

    expect(checkTrigger(parsed(input))).toEqual([
      {
        path: "trigger.keywords",
        code: "missing_keywords",
        message: "A campaign that is not the sender default needs at least one keyword",
      },
    ]);
  });

  it("allows a default campaign without keywords", () => {
    const input = minimalCampaign();
    input.trigger = { sender: "kubri-main", keywords: [], isDefault: true };
    expect(checkTrigger(parsed(input))).toEqual([]);
  });

  it("reports duplicate keywords after normalization", () => {
    const input = minimalCampaign();
    input.trigger = { sender: "kubri-main", keywords: ["acme", " ACME "] };

    expect(checkTrigger(parsed(input)).map((i) => [i.path, i.code])).toEqual([
      ["trigger.keywords[1]", "duplicate_keyword"],
    ]);
  });
});
```

`tests/unit/campaigns/checks/consents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkConsents } from "../../../../src/campaigns/checks/consents";
import { minimalCampaign, parsed } from "../fixtures";

describe("checkConsents", () => {
  it("passes on the minimal campaign", () => {
    expect(checkConsents(parsed(minimalCampaign()))).toEqual([]);
  });

  it("requires the kubri_global consent to be optional", () => {
    const input = minimalCampaign();
    input.flow.splice(4, 0, {
      id: "kubri_consent",
      type: "consent",
      consentKey: "kubri_global",
      textVersion: "2026-10",
      text: { it: "Vuoi che il tuo profilo sia visibile ad altre aziende?" },
    });

    expect(checkConsents(parsed(input))).toEqual([
      {
        path: "flow[4].optional",
        code: "kubri_global_not_optional",
        message: "The kubri_global consent must be optional (spec §7.3)",
      },
    ]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/campaigns/checks`
Expected: FAIL, `Cannot find module` per i due nuovi file.

- [ ] **Step 3: Implementare `src/campaigns/checks/trigger.ts`**

```ts
import { duplicates, issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";

export function checkTrigger(c: CampaignDefinition): CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  const { keywords, isDefault } = c.trigger;

  if (!isDefault && keywords.length === 0) {
    issues.push(
      issue(
        "trigger.keywords",
        "missing_keywords",
        "A campaign that is not the sender default needs at least one keyword",
      ),
    );
  }
  for (const [keyword, i] of duplicates(keywords, (k) => k)) {
    issues.push(
      issue(`trigger.keywords[${i}]`, "duplicate_keyword", `Keyword "${keyword}" is listed twice`),
    );
  }

  return issues;
}
```

- [ ] **Step 4: Implementare `src/campaigns/checks/consents.ts`**

```ts
import { issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";

export const KUBRI_GLOBAL_CONSENT = "kubri_global";

export function checkConsents(c: CampaignDefinition): CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  c.flow.forEach((step, i) => {
    if (step.type === "consent" && step.consentKey === KUBRI_GLOBAL_CONSENT && !step.optional) {
      issues.push(
        issue(
          `flow[${i}].optional`,
          "kubri_global_not_optional",
          "The kubri_global consent must be optional (spec §7.3)",
        ),
      );
    }
  });
  return issues;
}
```

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test tests/unit/campaigns && pnpm typecheck && pnpm lint && pnpm format`
Expected: tutti verdi.

- [ ] **Step 6: Commit**

```bash
git add src/campaigns tests/unit/campaigns
git commit -m "feat(campaigns): check trigger keywords and kubri_global consent"
```

---

### Task 15: `validateCampaign()`, il punto d'ingresso

**Files:**
- Create: `src/campaigns/checks/index.ts`, `src/campaigns/validate.ts`
- Test: `tests/unit/campaigns/validate.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, expect, it } from "vitest";
import { validateCampaign } from "../../../src/campaigns/validate";
import { minimalCampaign } from "./fixtures";

describe("validateCampaign", () => {
  it("returns the parsed campaign when valid", () => {
    const result = validateCampaign(minimalCampaign());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.campaign.defaultLanguage).toBe("it");
  });

  it("reports schema errors with readable paths and stops there", () => {
    const input = minimalCampaign();
    input.flow[0] = { id: "intro", type: "message", text: { en: "Hello" } };

    const result = validateCampaign(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ path: "flow[0].text", code: "schema" }),
      );
    }
  });

  it("runs every semantic check and collects all issues", () => {
    const input = minimalCampaign();
    input.texts = {}; // unknown_text_ref
    input.flow.push({ id: "intro", type: "message", text: { it: "bis" } }); // duplicate_step_id
    input.trigger = { sender: "kubri-main", keywords: [] }; // missing_keywords

    const result = validateCampaign(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.code).sort()).toEqual(
        expect.arrayContaining(["duplicate_step_id", "missing_keywords", "unknown_text_ref"]),
      );
    }
  });

  it("rejects non-object input", () => {
    expect(validateCampaign("not a campaign").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/campaigns/validate.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare `src/campaigns/checks/index.ts`**

```ts
import type { CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";
import { checkConsents } from "./consents";
import { checkFieldRefs } from "./field-refs";
import { checkGraph } from "./graph";
import { checkTextRefs } from "./text-refs";
import { checkTransitions } from "./transitions";
import { checkTrigger } from "./trigger";
import { checkUniqueIds } from "./unique-ids";

const CHECKS: readonly ((c: CampaignDefinition) => CampaignIssue[])[] = [
  checkUniqueIds,
  checkTextRefs,
  checkFieldRefs,
  checkTransitions,
  checkGraph,
  checkTrigger,
  checkConsents,
];

export function runSemanticChecks(c: CampaignDefinition): CampaignIssue[] {
  return CHECKS.flatMap((check) => check(c));
}
```

- [ ] **Step 4: Implementare `src/campaigns/validate.ts`**

```ts
import { runSemanticChecks } from "./checks";
import type { CampaignIssue } from "./issues";
import { CampaignDefinitionSchema, type CampaignDefinition } from "./schema/campaign";

export type CampaignValidationResult =
  | { ok: true; campaign: CampaignDefinition }
  | { ok: false; issues: CampaignIssue[] };

/**
 * Shape first (Zod), then meaning (semantic checks). Keyword collisions with other
 * campaigns need the database and are checked at import time (plan 03).
 */
export function validateCampaign(input: unknown): CampaignValidationResult {
  const parsed = CampaignDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: formatPath(i.path),
        code: "schema",
        message: i.message,
      })),
    };
  }
  const issues = runSemanticChecks(parsed.data);
  return issues.length === 0 ? { ok: true, campaign: parsed.data } : { ok: false, issues };
}

function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`))
    .join("")
    .replace(/^\./, "");
}
```

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

> Se il test sugli errori di schema non trova esattamente `flow[0].text`, controllare il
> percorso che Zod restituisce per un'unione fallita (può essere `flow[0].text` oppure
> `flow[0].text.it`). Adeguare il test al percorso reale **solo se** punta comunque al testo
> del passaggio 0: lo scopo del test è che il percorso sia leggibile e preciso.

- [ ] **Step 6: Commit**

```bash
git add src/campaigns tests/unit/campaigns
git commit -m "feat(campaigns): add validateCampaign entry point"
```

---

### Task 16: Aggiornare la spec e chiudere il piano

**Files:**
- Modify: `docs/superpowers/specs/2026-10-24-kubri-chatbot-design.md`

- [ ] **Step 1: Aggiungere le decisioni al registro (§2)**

In fondo alla tabella del §2 aggiungere:

```markdown
| D25 | Forma del profilo | Mappa piatta con chiavi puntate (`jobPreferences.preferredJob`); la struttura annidata esiste solo nella mappatura verso Kubri. |
| D26 | Versione della campagna | Non sta nel file JSON: la assegna l'import. |
| D27 | Opzioni di `choice` | Oggetti `{ id, description }`; la descrizione guida l'LLM. |
| D28 | Esiti predefiniti | `questions.terminated` e `consent.declined` (non facoltativo) → `@stop`; gli altri → passaggio successivo o `@end`. |
| D29 | Campi di sistema | `lat`, `lng`, `phone` sono `systemOnly`: non si chiedono e non si estraggono. |
```

- [ ] **Step 2: Allineare l'esempio del §5.1**

Nel JSON di esempio del §5.1:
- rimuovere la riga `"version": 3,`;
- sostituire `"options": ["yes", "no", "idk"]` con l'elenco di oggetti `{ "id", "description" }`
  (come in `tests/unit/campaigns/fixtures.ts`).

- [ ] **Step 3: Controllo finale**

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration
```

Expected: tutto verde.

- [ ] **Step 4: Commit, push e PR**

```bash
git add ../../docs/superpowers/specs/2026-10-24-kubri-chatbot-design.md
git commit -m "docs: record profile and campaign schema decisions in the spec"
git push -u origin feat/chatbot-profile-campaign-schema
gh pr create --base main --title "feat(chatbot): profile and campaign schema with semantic validator" \
  --body "Piano 02 (docs/superpowers/plans/2026-10-24-chatbot-02-profile-and-campaign-schema.md)."
```
