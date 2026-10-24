# Piano 03 — Registro delle campagne

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare le campagne dal file JSON al database: modelli Prisma `SenderNumber`,
`Campaign` e `CampaignVersion` (immutabile), import con checksum e controllo delle collisioni
di parole chiave e di campagna di default, CLI per organizzazioni, numeri e campagne, e la
campagna standard Kubri (`campaigns/kubri-standard.json`) validata in CI.

**Architecture:** Le parti pure stanno in `src/campaigns/`:
- `checksum.ts`: JSON canonico e checksum;
- `triggers.ts`: collisioni su una lista di campagne attive;
- `publishable.ts`: guardia dei consensi segnaposto;
- `loaded-campaign.ts`: tipo `LoadedCampaign`.

Le query stanno **solo** in `src/store/` (`organizations.ts`, `senders.ts`, `campaigns.ts`).
`src/campaigns/import.ts` fa da regista: valida (`validateCampaign`), applica la guardia,
calcola il checksum e solo allora chiama lo store. Lo store risolve organizzazione e numero,
controlla le collisioni e scrive la versione in **una transazione serializzabile**. La CLI
(`src/cli/`) riceve le dipendenze (`CliDeps`) per iniezione: i comandi senza database si
testano con test unitari, quelli con il database con test di integrazione sul Postgres locale.

**Tech Stack:** TypeScript strict, Zod 4, Prisma 7 (adapter `pg`), commander 15, Vitest 4,
Postgres 16 in Docker.

**Spec:** §5.1 (struttura della campagna), §5.8 (validazione all'import, ultimo punto:
collisioni), §6 (campi standard), §10.1 (canali e campagne), §16.2 (ambienti), D19–D30,
Appendice A (consensi segnaposto).

**Prerequisito:** piani 01 e 02 completati. Questo piano lavora **direttamente sul branch
ombrello** `docs/chatbot-spec-into-monorepo`: niente branch nuovo, niente PR, niente push su
`main`. Tutti i comandi si eseguono da `apps/chatbot/` nel monorepo `kubri` (spec D19).

```bash
git switch docs/chatbot-spec-into-monorepo
cd apps/chatbot
pnpm db:up          # Postgres locale (container chatbot-postgres-1, porta 54329)
pnpm test && pnpm test:integration
```

Expected: tutto verde prima di iniziare. Non toccare altri container Docker presenti sulla
macchina: `pnpm db:up` avvia solo il servizio `postgres` di `docker-compose.yml`.

---

## Decisioni prese in questo piano (da riportare nella spec, §2, come D50–D59)

Il piano 04 usa D31–D39: questo piano parte da D50.

- **D50 — Slug del numero.** `SenderNumber` ha uno `slug` univoco (non previsto nel §10.1):
  è ciò che i file di campagna citano in `trigger.sender`. Il numero è univoco per
  (`channel`, `phoneE164`).
- **D51 — Checksum.** È lo sha256 del JSON canonico (chiavi ordinate a ogni livello) della
  definizione **già parsata** da Zod, con i default applicati. Formattazione, ordine delle
  chiavi e default scritti per esteso non creano una versione nuova. Se un file coincide con
  una versione precedente, quella versione viene riusata; con `--activate` l'import diventa
  un rollback.
- **D52 — Attivazione.**
  - Una campagna nuova nasce `paused`.
  - L'import senza `--activate` crea la versione ma non cambia quella attiva.
  - `--activate` imposta `activeVersionId` e `status = active`.
  - Le colonne di instradamento di `Campaign` (`senderNumberId`, `keywords`, `isDefault`,
    `externalKey`) copiano la versione attiva, oppure l'ultima importata finché non ce n'è
    una attiva. La verità resta `CampaignVersion.definition`.
- **D53 — Collisioni.**
  - Le parole chiave si confrontano in modo esatto, dopo la normalizzazione dello schema
    (trim e minuscolo).
  - Ogni numero ha al massimo una campagna di default (`trigger.isDefault`).
  - Il confronto avviene solo con le campagne `active` dello stesso numero, esclusa la
    campagna stessa.
  - Il controllo gira a ogni import, nella stessa transazione serializzabile della
    scrittura. Le campagne in pausa non collidono.
- **D54 — Organizzazione fissa.** Una campagna non può cambiare organizzazione tra una
  versione e l'altra (`organization_mismatch`). Il numero invece può cambiare.
- **D55 — Guardia dei consensi segnaposto.** Una `textVersion` che inizia con
  `placeholder-` è un **errore** con `NODE_ENV=production` e un **avviso** negli altri
  ambienti. La guardia vale sia per `campaigns import` sia per `campaigns validate`. La CLI
  lanciata contro prod deve avere `NODE_ENV=production` (va impostato in `.env.prod`).
- **D56 — `providerConfig`.** Contiene solo identificativi (`phoneNumberId`, `wabaId`) e il
  **nome** del segreto con il token (`accessTokenSecret`, in UPPER_SNAKE_CASE). Lo schema è
  `strict` e sta in `src/channels/provider-config.ts`. Nella v1 il provider è solo `meta`;
  l'enum prevede già `twilio`.
- **D57 — Stato iniziale dei numeri.** `senders add` crea il numero già `active`
  (provisioning manuale, §17). Il default del database resta `provisioning`.
- **D58 — Definizione memorizzata.** `CampaignVersion.definition` contiene la definizione
  parsata in forma canonica. Alla lettura viene ri-parsata con `CampaignDefinitionSchema` per
  ottenere il tipo statico (`LoadedCampaign`).
- **D59 — Campagna standard v1.**
  - Costruita dai campi del §6, perché l'export di Make non è ancora disponibile.
  - Le formulazioni delle domande saranno rifinite sul questionario "global" di Make.
  - I testi dei consensi riportano titolare e link per esteso: nessuna interpolazione
    `{dataController.*}` finché il motore non la definisce.
  - `privacyUrl` provvisorio: `https://kubri.it/privacy`, da confermare (§18, punto 5).

## Mappa dei file

| File | Responsabilità |
|---|---|
| `src/config/env.ts` | + `NodeEnvSchema`, `NodeEnv`, `parseNodeEnv` |
| `src/campaigns/publishable.ts` | guardia dei consensi `placeholder-` (pura) |
| `src/campaigns/checksum.ts` | JSON canonico e checksum sha256 (puro) |
| `src/campaigns/triggers.ts` | collisioni di parole chiave e di default (pure) |
| `src/campaigns/loaded-campaign.ts` | tipo `LoadedCampaign` per runtime e motore |
| `src/campaigns/import.ts` | `importCampaign`: valida, guardia, checksum, store |
| `src/channels/provider-config.ts` | schema di `providerConfig` per Meta (solo identificativi) |
| `src/store/organizations.ts` | query su `Organization` |
| `src/store/senders.ts` | query su `SenderNumber` |
| `src/store/campaigns.ts` | transazione di import, elenco, ricerca della versione attiva |
| `src/cli/deps.ts` | `CliDeps` (dipendenze iniettate) e `CliError` |
| `src/cli/commands/orgs.ts` | `orgs add` |
| `src/cli/commands/senders.ts` | `senders add` |
| `src/cli/commands/campaigns.ts` | `campaigns validate / import / list` |
| `src/cli/format-issues.ts` | stampa degli errori con il percorso |
| `src/cli/read-campaign-file.ts` | lettura e parse JSON di un file di campagna |
| `src/cli/program.ts`, `src/cli/main.ts` | registrazione dei comandi, dipendenze reali |
| `prisma/schema.prisma`, `prisma/migrations/<ts>_campaign_registry/` | modelli e migrazione |
| `campaigns/kubri-standard.json` | campagna standard Kubri |
| `tests/unit/campaigns/campaign-files.test.ts` | CI: ogni file in `campaigns/` è valido |
| `tests/integration/helpers/registry.ts`, `helpers/cli.ts` | dati di partenza e CLI sul DB di test |

`resetBotSchema` (in `tests/integration/helpers/database.ts`) **non va modificato**: svuota
già tutte le tabelle dello schema `bot` lette da `information_schema`, con `TRUNCATE …
CASCADE`, e gestisce quindi anche il riferimento circolare `Campaign` ↔ `CampaignVersion`.

---

### Task 1: `NodeEnv` e guardia dei consensi segnaposto

**Files:**
- Modify: `src/config/env.ts`
- Create: `src/campaigns/publishable.ts`
- Test: `tests/unit/config/env.test.ts`, `tests/unit/campaigns/publishable.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

In `tests/unit/config/env.test.ts` sostituire la riga di import:

```ts
import { parseEnv, parseNodeEnv } from "../../../src/config/env";
```

e aggiungere in fondo al file:

```ts
describe("parseNodeEnv", () => {
  it("defaults to development", () => {
    expect(parseNodeEnv(undefined)).toBe("development");
  });

  it("accepts production", () => {
    expect(parseNodeEnv("production")).toBe("production");
  });

  it("rejects unknown values", () => {
    expect(() => parseNodeEnv("prod")).toThrow(/NODE_ENV/);
  });
});
```

Creare `tests/unit/campaigns/publishable.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkPublishable, placeholderConsentIssues } from "../../../src/campaigns/publishable";
import { minimalCampaign, parsed } from "./fixtures";

function withPlaceholderConsent() {
  const input = minimalCampaign();
  const consent = input.flow[2];
  if (consent?.type !== "consent") throw new Error("fixture: flow[2] must be the consent");
  consent.textVersion = "placeholder-2026-10";
  return parsed(input);
}

describe("placeholderConsentIssues", () => {
  it("accepts official text versions", () => {
    expect(placeholderConsentIssues(parsed(minimalCampaign()))).toEqual([]);
  });

  it("flags placeholder- text versions with their path", () => {
    expect(placeholderConsentIssues(withPlaceholderConsent())).toEqual([
      expect.objectContaining({ path: "flow[2].textVersion", code: "placeholder_consent" }),
    ]);
  });
});

describe("checkPublishable", () => {
  it("blocks placeholder consents in production", () => {
    const result = checkPublishable(withPlaceholderConsent(), "production");

    expect(result.errors.map((i) => i.code)).toEqual(["placeholder_consent"]);
    expect(result.warnings).toEqual([]);
  });

  it.each(["development", "test"] as const)("only warns in %s", (nodeEnv) => {
    const result = checkPublishable(withPlaceholderConsent(), nodeEnv);

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((i) => i.code)).toEqual(["placeholder_consent"]);
  });

  it("returns nothing for a campaign with official texts", () => {
    expect(checkPublishable(parsed(minimalCampaign()), "production")).toEqual({
      errors: [],
      warnings: [],
    });
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/config tests/unit/campaigns/publishable.test.ts`
Expected: FAIL, `parseNodeEnv is not a function` (o errore di import) e
`Cannot find module '../../../src/campaigns/publishable'`.

- [ ] **Step 3: Implementare `src/config/env.ts`**

Il file completo diventa:

```ts
import { z } from "zod";
import { targetsBotSchema } from "./database-url";

export const NodeEnvSchema = z.enum(["development", "test", "production"]).default("development");
export type NodeEnv = z.infer<typeof NodeEnvSchema>;

const EnvSchema = z.object({
  NODE_ENV: NodeEnvSchema,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string({ error: "DATABASE_URL is required" }).refine(targetsBotSchema, {
    // The database is shared with the Kubri dashboard: never default to its schema.
    error: "DATABASE_URL must be a postgres URL ending with ?schema=bot",
  }),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: Readonly<Record<string, string | undefined>>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    // Messages only (no input values), so secrets inside URLs never reach logs.
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
}

/** NODE_ENV alone, for commands that run without a database (e.g. `campaigns validate`). */
export function parseNodeEnv(value: string | undefined): NodeEnv {
  const result = NodeEnvSchema.safeParse(value);
  if (!result.success) {
    throw new Error("Invalid environment: NODE_ENV must be development, test or production");
  }
  return result.data;
}
```

`parseNodeEnv` serve ai comandi che girano senza database (`campaigns validate`): `parseEnv`
pretende anche `DATABASE_URL`.

- [ ] **Step 4: Implementare `src/campaigns/publishable.ts`**

```ts
import type { NodeEnv } from "../config/env";
import { issue, type CampaignIssue } from "./issues";
import type { CampaignDefinition } from "./schema/campaign";

/** Spec D23 / Appendix A: placeholder consent texts must never reach production. */
export const PLACEHOLDER_TEXT_VERSION_PREFIX = "placeholder-";

export function placeholderConsentIssues(c: CampaignDefinition): CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  c.flow.forEach((step, i) => {
    if (step.type === "consent" && step.textVersion.startsWith(PLACEHOLDER_TEXT_VERSION_PREFIX)) {
      issues.push(
        issue(
          `flow[${i}].textVersion`,
          "placeholder_consent",
          `Consent "${step.consentKey}" uses the placeholder text version "${step.textVersion}": not allowed in production`,
        ),
      );
    }
  });
  return issues;
}

export interface PublishCheck {
  /** Block the import. */
  readonly errors: CampaignIssue[];
  /** Printed, but the import goes ahead. */
  readonly warnings: CampaignIssue[];
}

/** Placeholder consents are errors in production and warnings everywhere else. */
export function checkPublishable(c: CampaignDefinition, nodeEnv: NodeEnv): PublishCheck {
  const placeholders = placeholderConsentIssues(c);
  return nodeEnv === "production"
    ? { errors: placeholders, warnings: [] }
    : { errors: [], warnings: placeholders };
}
```

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 6: Commit**

```bash
git add src/config/env.ts src/campaigns/publishable.ts tests/unit/config/env.test.ts tests/unit/campaigns/publishable.test.ts
git commit -m "feat(chatbot): refuse placeholder consent versions in production"
```

---

### Task 2: JSON canonico e checksum

**Files:**
- Create: `src/campaigns/checksum.ts`
- Test: `tests/unit/campaigns/checksum.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, expect, it } from "vitest";
import { canonicalCampaign, canonicalize } from "../../../src/campaigns/checksum";
import { minimalCampaign, parsed } from "./fixtures";

describe("canonicalize", () => {
  it("sorts object keys at every depth", () => {
    const result = canonicalize({ b: 1, a: { d: [{ z: 1, y: 2 }], c: true } });

    expect(JSON.stringify(result)).toBe('{"a":{"c":true,"d":[{"y":2,"z":1}]},"b":1}');
  });

  it("keeps array order", () => {
    expect(canonicalize([3, 1, 2])).toEqual([3, 1, 2]);
  });

  it("drops undefined properties", () => {
    expect(canonicalize({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it("rejects values JSON cannot represent", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalize(() => 1)).toThrow(TypeError);
  });
});

describe("canonicalCampaign", () => {
  it("produces a sha256 hex checksum", () => {
    expect(canonicalCampaign(parsed(minimalCampaign())).checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores key order", () => {
    const original = minimalCampaign();
    const reordered = Object.fromEntries(Object.entries(original).reverse()) as typeof original;

    expect(canonicalCampaign(parsed(reordered)).checksum).toBe(
      canonicalCampaign(parsed(original)).checksum,
    );
  });

  it("ignores defaults spelled out explicitly", () => {
    const explicit = minimalCampaign();
    explicit.defaultLanguage = "it";
    explicit.onStop = { data: "delete" };

    expect(canonicalCampaign(parsed(explicit)).checksum).toBe(
      canonicalCampaign(parsed(minimalCampaign())).checksum,
    );
  });

  it("changes when the content changes", () => {
    const changed = minimalCampaign();
    changed.externalKey = "acme-2";

    expect(canonicalCampaign(parsed(changed)).checksum).not.toBe(
      canonicalCampaign(parsed(minimalCampaign())).checksum,
    );
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/campaigns/checksum.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare**

`src/campaigns/checksum.ts` (`node:crypto` è ammesso: il divieto di `node:*` vale solo per
`src/engine`):

```ts
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
```

`JsonObject` è anche il tipo che lo store scrive nella colonna `jsonb`: Prisma lo accetta come
`InputJsonValue` senza cast.

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/campaigns/checksum.ts tests/unit/campaigns/checksum.test.ts
git commit -m "feat(chatbot): add canonical json and checksum for campaign versions"
```

---

### Task 3: Collisioni di parole chiave e di campagna di default

È il punto del §5.8 che il piano 02 ha rimandato. La funzione è pura: lo store le passa le
campagne attive dello stesso numero lette dal database.

**Files:**
- Create: `src/campaigns/triggers.ts`
- Test: `tests/unit/campaigns/triggers.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
import { describe, expect, it } from "vitest";
import { findTriggerCollisions, type CampaignTrigger } from "../../../src/campaigns/triggers";
import { minimalCampaign, parsed } from "./fixtures";

// minimalCampaign(): slug "acme-magazzino", sender "kubri-main", keywords ["acme"].
const campaign = parsed(minimalCampaign());

function defaultCampaign() {
  const input = minimalCampaign();
  input.trigger = { sender: "kubri-main", keywords: [], isDefault: true };
  return parsed(input);
}

describe("findTriggerCollisions", () => {
  it("accepts disjoint keywords", () => {
    const others: CampaignTrigger[] = [
      { slug: "culligan-vendita", keywords: ["culligan"], isDefault: false },
    ];
    expect(findTriggerCollisions(campaign, others)).toEqual([]);
  });

  it("reports a keyword used by another active campaign", () => {
    const others: CampaignTrigger[] = [
      { slug: "acme-pulizie", keywords: ["pulizie", "acme"], isDefault: false },
    ];

    expect(findTriggerCollisions(campaign, others)).toEqual([
      expect.objectContaining({
        path: "trigger.keywords[0]",
        code: "keyword_collision",
        message: expect.stringContaining("acme-pulizie") as unknown,
      }),
    ]);
  });

  it("ignores the campaign's own previous version (same slug)", () => {
    const others: CampaignTrigger[] = [
      { slug: "acme-magazzino", keywords: ["acme"], isDefault: false },
    ];
    expect(findTriggerCollisions(campaign, others)).toEqual([]);
  });

  it("reports a second default campaign on the same sender", () => {
    const others: CampaignTrigger[] = [{ slug: "kubri-standard", keywords: [], isDefault: true }];

    expect(findTriggerCollisions(defaultCampaign(), others)).toEqual([
      expect.objectContaining({ path: "trigger.isDefault", code: "duplicate_default_campaign" }),
    ]);
  });

  it("allows a non-default campaign next to the default one", () => {
    const others: CampaignTrigger[] = [{ slug: "kubri-standard", keywords: [], isDefault: true }];
    expect(findTriggerCollisions(campaign, others)).toEqual([]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/campaigns/triggers.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare**

`src/campaigns/triggers.ts`:

```ts
import { issue, type CampaignIssue } from "./issues";
import type { CampaignDefinition } from "./schema/campaign";

/** How an active campaign is reached on a sender number. */
export interface CampaignTrigger {
  readonly slug: string;
  readonly keywords: readonly string[];
  readonly isDefault: boolean;
}

/**
 * Spec §5.8 (last bullet): keywords must not collide with another active campaign on the
 * same number, and a number has at most one default campaign. `others` are the active
 * campaigns of the same sender; the campaign itself (same slug) is ignored.
 * Keywords are compared exactly: the schema already trims and lowercases them.
 */
export function findTriggerCollisions(
  campaign: CampaignDefinition,
  others: readonly CampaignTrigger[],
): CampaignIssue[] {
  const rivals = others.filter((other) => other.slug !== campaign.campaign);
  const issues: CampaignIssue[] = [];

  campaign.trigger.keywords.forEach((keyword, i) => {
    for (const rival of rivals) {
      if (rival.keywords.includes(keyword)) {
        issues.push(
          issue(
            `trigger.keywords[${i}]`,
            "keyword_collision",
            `Keyword "${keyword}" is already used by active campaign "${rival.slug}" on sender "${campaign.trigger.sender}"`,
          ),
        );
      }
    }
  });

  if (campaign.trigger.isDefault) {
    for (const rival of rivals.filter((r) => r.isDefault)) {
      issues.push(
        issue(
          "trigger.isDefault",
          "duplicate_default_campaign",
          `Active campaign "${rival.slug}" is already the default on sender "${campaign.trigger.sender}"`,
        ),
      );
    }
  }

  return issues;
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/campaigns/triggers.ts tests/unit/campaigns/triggers.test.ts
git commit -m "feat(chatbot): detect keyword and default campaign collisions"
```

---

### Task 4: Campagna standard Kubri e validazione in CI di `campaigns/`

L'export del questionario "global" di Make non è ancora disponibile: la campagna è costruita
dai campi standard del §6, con un `hint` di estrazione per ogni domanda. Le formulazioni
verranno rifinite quando arriva l'export di Make. Questo cambierà solo i testi, non la
struttura (D59). Consensi: quelli dell'Appendice A, con `textVersion: "placeholder-2026-10"`.
Titolare e link sono scritti per esteso, perché il motore non definisce ancora
un'interpolazione `{dataController.*}`. Il passaggio fisso della lingua non sta nel `flow`
(§5.6).

**Files:**
- Create: `campaigns/kubri-standard.json`
- Test: `tests/unit/campaigns/campaign-files.test.ts`, `tests/unit/campaigns/kubri-standard.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/campaigns/campaign-files.test.ts` (il test di CI richiesto dalla roadmap:
gira in `pnpm test`, quindi nel job `checks` di `chatbot-ci.yml`):

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCampaign } from "../../../src/campaigns/validate";

// Every campaign the Kubri team commits must pass the same validation as the import.
const CAMPAIGNS_DIR = join(__dirname, "../../../campaigns");
const files = readdirSync(CAMPAIGNS_DIR).filter((name) => name.endsWith(".json"));

describe("committed campaign files", () => {
  it("includes the standard Kubri campaign", () => {
    expect(files).toContain("kubri-standard.json");
  });

  it.each(files)("%s is a valid campaign", (name) => {
    const input: unknown = JSON.parse(readFileSync(join(CAMPAIGNS_DIR, name), "utf8"));

    const result = validateCampaign(input);

    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it.each(files)("%s is named after its campaign slug", (name) => {
    const input = JSON.parse(readFileSync(join(CAMPAIGNS_DIR, name), "utf8")) as {
      campaign?: unknown;
    };
    expect(`${String(input.campaign)}.json`).toBe(name);
  });
});
```

`tests/unit/campaigns/kubri-standard.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { placeholderConsentIssues } from "../../../src/campaigns/publishable";
import { validateCampaign } from "../../../src/campaigns/validate";
import type { CampaignDefinition } from "../../../src/campaigns/schema/campaign";
import { STANDARD_FIELD_DEFINITIONS } from "../../../src/profile/standard-fields";

function loadStandard(): CampaignDefinition {
  const raw: unknown = JSON.parse(
    readFileSync(join(__dirname, "../../../campaigns/kubri-standard.json"), "utf8"),
  );
  const result = validateCampaign(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result.campaign;
}

describe("kubri-standard campaign", () => {
  const campaign = loadStandard();

  it("is the default campaign of the Kubri number, on the global pool", () => {
    expect(campaign.organization).toBe("kubri");
    expect(campaign.externalKey).toBe("global");
    expect(campaign.trigger).toMatchObject({ sender: "kubri-main", isDefault: true });
  });

  it("asks the Appendix A consents with placeholder versions", () => {
    const consents = campaign.flow.flatMap((step) =>
      step.type === "consent"
        ? [{ key: step.consentKey, optional: step.optional, version: step.textVersion }]
        : [],
    );
    expect(consents).toEqual([
      { key: "privacy_interview", optional: false, version: "placeholder-2026-10" },
      { key: "kubri_global", optional: true, version: "placeholder-2026-10" },
    ]);
    expect(placeholderConsentIssues(campaign)).toHaveLength(2);
  });

  it("asks every standard field that is not system-only", () => {
    const asked = campaign.flow.flatMap((step) =>
      step.type === "questions" ? step.questions.map((q) => q.field) : [],
    );
    const askable = STANDARD_FIELD_DEFINITIONS.filter((f) => f.systemOnly !== true).map(
      (f) => f.key,
    );
    expect([...asked].sort()).toEqual([...askable].sort());
  });

  it("gives every question an extraction hint", () => {
    const withoutHint = campaign.flow.flatMap((step) =>
      step.type === "questions" ? step.questions.filter((q) => !q.hint).map((q) => q.id) : [],
    );
    expect(withoutHint).toEqual([]);
  });

  it("offers the CV and ends", () => {
    expect(campaign.flow.map((step) => step.type).slice(-2)).toEqual(["cv_offer", "end"]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/campaigns/campaign-files.test.ts tests/unit/campaigns/kubri-standard.test.ts`
Expected: FAIL, `ENOENT: no such file or directory` su `campaigns`.

- [ ] **Step 3: Scrivere `campaigns/kubri-standard.json`**

Il file è già nel formato di Prettier, che controlla anche i JSON in `pnpm format:check`:

```json
{
  "campaign": "kubri-standard",
  "organization": "kubri",
  "externalKey": "global",
  "trigger": { "sender": "kubri-main", "keywords": [], "isDefault": true },
  "defaultLanguage": "it",
  "dataController": {
    "name": "Kubri S.r.l. Società Benefit",
    "privacyUrl": "https://kubri.it/privacy"
  },
  "onStop": { "data": "delete" },
  "flow": [
    {
      "id": "benvenuto",
      "type": "message",
      "text": {
        "it": "Ciao! Sono l'assistente di Kubri. Ti farò alcune domande per conoscerti e aiutarti a trovare un lavoro adatto a te. Ci vorranno circa 10 minuti, e puoi rispondere come preferisci, anche con frasi brevi."
      }
    },
    {
      "id": "privacy",
      "type": "consent",
      "consentKey": "privacy_interview",
      "textVersion": "placeholder-2026-10",
      "text": {
        "it": "[TESTO SEGNAPOSTO] Prima di iniziare: per svolgere questa intervista raccogliamo e conserviamo le informazioni che ci darai (dati personali, esperienze, preferenze di lavoro). Il titolare del trattamento è Kubri S.r.l. Società Benefit. Usiamo i tuoi dati solo per valutare la tua candidatura e metterti in contatto con opportunità di lavoro adatte a te. Puoi chiedere in qualsiasi momento di vedere, correggere o cancellare i tuoi dati scrivendo \"cancella i miei dati\". L'informativa completa è qui: https://kubri.it/privacy\nAccetti di proseguire?"
      },
      "link": "https://kubri.it/privacy",
      "optional": false
    },
    {
      "id": "pool_globale",
      "type": "consent",
      "consentKey": "kubri_global",
      "textVersion": "placeholder-2026-10",
      "text": {
        "it": "[TESTO SEGNAPOSTO] Vuoi che il tuo profilo sia visibile anche ad altre organizzazioni partner di Kubri (cooperative, agenzie per il lavoro, centri per l'impiego), per ricevere più opportunità? Puoi dire di no: la tua candidatura per questa campagna resta valida comunque. Informativa: https://kubri.it/privacy"
      },
      "link": "https://kubri.it/privacy",
      "optional": true
    },
    {
      "id": "anagrafica",
      "type": "questions",
      "title": { "it": "Iniziamo da chi sei" },
      "questions": [
        {
          "id": "nome",
          "field": "firstName",
          "prompt": { "it": "Come ti chiami?" },
          "hint": "Solo il nome di battesimo, con l'iniziale maiuscola. Se il candidato scrive nome e cognome insieme, separa il cognome nel campo lastName."
        },
        {
          "id": "cognome",
          "field": "lastName",
          "prompt": { "it": "Qual è il tuo cognome?" },
          "hint": "Riporta il cognome come lo scrive il candidato, senza tradurlo né traslitterarlo in modo diverso."
        },
        {
          "id": "nascita",
          "field": "birthday",
          "prompt": { "it": "Quando sei nato o nata? (giorno, mese e anno)" },
          "hint": "Serve la data completa. Se il candidato dice solo l'età o solo l'anno, non inventare giorno e mese: chiedi la data completa."
        },
        {
          "id": "paese",
          "field": "country",
          "prompt": { "it": "In quale Paese sei nato o nata?" },
          "hint": "Il Paese d'origine, non quello in cui vive ora. Converti il nome del Paese, in qualunque lingua, nel codice ISO a due lettere (Marocco → MA)."
        },
        {
          "id": "comune",
          "field": "location",
          "prompt": { "it": "In quale città o paese vivi adesso?" },
          "hint": "Il comune di residenza attuale, con il nome italiano ufficiale (es. Milano, Sesto San Giovanni). Se indica solo un quartiere, chiedi il comune."
        },
        {
          "id": "indirizzo",
          "field": "address",
          "prompt": { "it": "Qual è il tuo indirizzo? (via e numero civico)" },
          "required": false,
          "hint": "Riporta l'indirizzo come dichiarato. Se il candidato non vuole darlo, non insistere: la domanda è facoltativa."
        },
        {
          "id": "email",
          "field": "email",
          "prompt": { "it": "Hai un indirizzo email? Se sì, scrivilo qui." },
          "required": false,
          "hint": "Solo un indirizzo email valido. Se il candidato dice di non averne uno, lascia il campo vuoto senza insistere."
        }
      ]
    },
    {
      "id": "lingue",
      "type": "questions",
      "title": { "it": "Le lingue che parli" },
      "questions": [
        {
          "id": "lingua_madre",
          "field": "language",
          "prompt": { "it": "Qual è la tua lingua madre?" },
          "hint": "La prima lingua del candidato, come codice ISO 639-1 (arabo → ar, ucraino → uk). Non è la lingua in cui sta scrivendo ora, se dice altro."
        },
        {
          "id": "italiano",
          "field": "italianLevel",
          "prompt": {
            "it": "Come parli l'italiano? Per niente, poco, abbastanza bene, bene, oppure è la tua lingua madre?"
          },
          "hint": "Per niente → nessuno; poco → base; abbastanza bene → intermedio; bene o molto bene → avanzato; lingua madre → madrelingua. In caso di dubbio scegli il livello più basso tra quelli plausibili."
        },
        {
          "id": "altre_lingue",
          "field": "additionalLanguages",
          "prompt": {
            "it": "Parli altre lingue, oltre all'italiano e alla tua lingua madre? Quanto bene?"
          },
          "required": false,
          "hint": "Una voce per lingua, nella forma \"lingua (livello)\" in italiano, es. \"inglese (base)\". Non includere l'italiano né la lingua madre."
        }
      ]
    },
    {
      "id": "mobilita",
      "type": "questions",
      "title": { "it": "Documenti e spostamenti" },
      "questions": [
        {
          "id": "permesso",
          "field": "workingPermit",
          "prompt": {
            "it": "Puoi lavorare in Italia? Per esempio hai la cittadinanza europea o un permesso di soggiorno valido per lavoro?"
          },
          "hint": "true se ha la cittadinanza di un Paese UE o un permesso di soggiorno che consente di lavorare; false se dice di non poter lavorare. Se è in attesa di rinnovo o non è sicuro, non dedurre: chiedi un chiarimento."
        },
        {
          "id": "patente",
          "field": "drivingLicense",
          "prompt": { "it": "Hai la patente di guida?" },
          "hint": "Una patente scaduta, sospesa o ancora in corso di conseguimento è false. Una patente straniera valida è true."
        },
        {
          "id": "tipi_patente",
          "field": "drivingLicenseTypes",
          "prompt": { "it": "Che tipo di patente hai? (per esempio B, C, CQC)" },
          "required": false,
          "when": { "field": "drivingLicense", "eq": true },
          "hint": "Una voce per categoria, in maiuscolo (B, C, CE, D, CQC, AM). \"Patente della macchina\" → B."
        },
        {
          "id": "trasporto",
          "field": "transport",
          "prompt": {
            "it": "Come ti sposti di solito? (auto, moto, bici, mezzi pubblici, a piedi…)"
          },
          "hint": "Il mezzo abituale, in italiano (auto, moto, scooter, bicicletta, mezzi pubblici, a piedi). Se ne indica più di uno, elencali separati da virgola."
        }
      ]
    },
    {
      "id": "esperienze",
      "type": "questions",
      "title": { "it": "Studi ed esperienze di lavoro" },
      "questions": [
        {
          "id": "studi",
          "field": "educationAndTraining",
          "prompt": {
            "it": "Che scuole o corsi hai fatto? Dimmi anche in che anni e in quale Paese, se te lo ricordi."
          },
          "hint": "Una voce per titolo o corso, nella forma \"anno - anno Istituto (Paese): Titolo\". Se mancano gli anni scrivi solo quello che il candidato ha detto, senza inventarli. Il nome dell'istituto resta nella lingua originale."
        },
        {
          "id": "lavori",
          "field": "workExperience",
          "prompt": {
            "it": "Che lavori hai fatto finora? Vanno bene anche lavori senza contratto o all'estero. Per ognuno dimmi cosa facevi, dove e per quanto tempo."
          },
          "hint": "Una voce per esperienza, nella forma \"anno - anno Luogo (Paese): Ruolo\", con il ruolo in italiano. Conta anche il lavoro informale o in famiglia. Non inventare date: se il candidato dice \"due anni\" senza date, scrivi la durata nel ruolo."
        },
        {
          "id": "competenze",
          "field": "skillsAndCompetences",
          "prompt": {
            "it": "Cosa sai fare bene? Per esempio usare un muletto, cucinare, fare le pulizie, usare il computer, lavorare in squadra…"
          },
          "required": false,
          "hint": "Competenze pratiche e trasversali, una per voce, in italiano e brevi (es. \"uso del muletto\", \"HACCP\", \"lavoro in squadra\"). Non ripetere i ruoli già elencati nelle esperienze."
        }
      ]
    },
    {
      "id": "preferenze",
      "type": "questions",
      "title": { "it": "Il lavoro che cerchi" },
      "questions": [
        {
          "id": "lavoro_desiderato",
          "field": "jobPreferences.preferredJob",
          "prompt": { "it": "Che lavoro ti piacerebbe fare?" },
          "hint": "Il lavoro desiderato, in italiano e sintetico (es. magazziniere, addetto alle pulizie, aiuto cuoco). Se ne indica più di uno, elencali separati da virgola."
        },
        {
          "id": "esperienza_desiderato",
          "field": "jobPreferences.hasDesiredJobExperience",
          "prompt": { "it": "Hai già esperienza in questo lavoro? Se sì, quanta?" },
          "hint": "Sintetizza in italiano, es. \"sì, 2 anni in Marocco\" oppure \"no\". Se ha già raccontato questa esperienza tra i lavori fatti, riassumila senza chiederla di nuovo."
        },
        {
          "id": "zona",
          "field": "jobPreferences.preferredLocation",
          "prompt": { "it": "In quale zona vorresti lavorare? Fin dove puoi spostarti?" },
          "hint": "La zona come la descrive il candidato (città, provincia, \"vicino a casa\", \"entro 20 km\"). Normalizza i nomi dei luoghi in italiano."
        },
        {
          "id": "part_time",
          "field": "jobPreferences.partTime",
          "prompt": { "it": "Preferisci un lavoro part-time o a tempo pieno?" },
          "hint": "Part-time → true; tempo pieno → false. Se va bene entrambi, chiedi cosa preferisce; se resta indifferente, false."
        },
        {
          "id": "vincoli",
          "field": "jobPreferences.constraints",
          "prompt": {
            "it": "Ci sono orari, turni o giorni in cui non puoi lavorare? Per esempio per la famiglia o per la salute."
          },
          "required": false,
          "hint": "Riassumi i vincoli in italiano (es. \"no turni notturni\", \"solo mattina\"). Per motivi di salute riporta solo il vincolo, non la diagnosi. Se dice che non ha vincoli, scrivi \"nessuno\"."
        }
      ]
    },
    {
      "id": "formazione",
      "type": "questions",
      "title": { "it": "Formazione" },
      "questions": [
        {
          "id": "interesse_corsi",
          "field": "learningPreferences.isInterested",
          "prompt": {
            "it": "Ti interessa fare un corso di formazione, per esempio di italiano o per un nuovo lavoro?"
          },
          "hint": "Sì o forse con interesse → true; no → false."
        },
        {
          "id": "quale_corso",
          "field": "learningPreferences.preference",
          "prompt": { "it": "Che tipo di corso ti piacerebbe fare?" },
          "required": false,
          "when": { "field": "learningPreferences.isInterested", "eq": true },
          "hint": "Il tipo di formazione, in italiano e sintetico (es. \"corso di italiano\", \"patentino del muletto\", \"HACCP\")."
        }
      ]
    },
    {
      "id": "cv",
      "type": "cv_offer",
      "prompt": {
        "it": "Grazie, abbiamo quasi finito! Vuoi che prepari per te un curriculum (CV) con le informazioni che mi hai dato? Potrai usarlo per candidarti anche altrove."
      }
    },
    {
      "id": "fine",
      "type": "end",
      "text": {
        "it": "Grazie per il tuo tempo! Il tuo profilo è stato registrato. Se un'opportunità è adatta a te, verrai contattato. Se vuoi correggere qualcosa, puoi scrivermi in qualsiasi momento."
      }
    }
  ],
  "afterCompletion": { "allowEdits": true, "allowCvRegeneration": true }
}
```

Cosa garantisce la struttura:
- **D30.** `privacy` (obbligatorio, senza `when`) precede ogni blocco `questions` e il
  `cv_offer`. Il rifiuto porta a `@stop` per default (D28).
- **`kubri_global`.** È facoltativo: il suo rifiuto passa al blocco successivo.
- **Copertura del §6.** Ci sono tutti i campi standard tranne i `systemOnly` (`lat`, `lng`,
  `phone`), raggruppati come chiesto: anagrafica, lingue, documenti e spostamenti, studi ed
  esperienze, preferenze di lavoro, formazione.
- **Domande facoltative.** Sono facoltativi (`required: false`) i campi che un candidato può
  legittimamente non avere o non voler dare: indirizzo, email, altre lingue, categorie di
  patente, competenze, vincoli, tipo di corso.
- **Domande condizionate.** `tipi_patente` e `quale_corso` hanno una condizione `when` sul
  campo booleano che le precede.

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi. Se `kubri-standard.json is a valid campaign` fallisce, il test stampa
l'elenco degli errori con il percorso: correggere il JSON, mai il validatore.

- [ ] **Step 5: Commit**

```bash
git add campaigns/kubri-standard.json tests/unit/campaigns/campaign-files.test.ts tests/unit/campaigns/kubri-standard.test.ts
git commit -m "feat(chatbot): add the standard kubri campaign and validate campaign files in ci"
```

---

### Task 5: Modelli Prisma e migrazione

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_campaign_registry/migration.sql`
- Test: `tests/integration/db-isolation.test.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

In `tests/integration/db-isolation.test.ts` sostituire il test
`it("creates bot tables in the bot schema only", …)` con:

```ts
  it.each(["Organization", "SenderNumber", "Campaign", "CampaignVersion"])(
    "creates %s in the bot schema only",
    async (table) => {
      const rows = await db.$queryRaw<{ table_schema: string }[]>`
        SELECT table_schema FROM information_schema.tables WHERE table_name = ${table}
      `;
      expect(rows.map((r) => r.table_schema)).toEqual(["bot"]);
    },
  );

  it("creates the registry enums in the bot schema only", async () => {
    const rows = await db.$queryRaw<{ schema: string; name: string }[]>`
      SELECT n.nspname AS schema, t.typname AS name
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typname IN ('Channel', 'SenderProvider', 'SenderStatus', 'CampaignStatus')
      ORDER BY t.typname
    `;
    expect(rows).toEqual([
      { schema: "bot", name: "CampaignStatus" },
      { schema: "bot", name: "Channel" },
      { schema: "bot", name: "SenderProvider" },
      { schema: "bot", name: "SenderStatus" },
    ]);
  });
```

- [ ] **Step 2: Verificare che fallisca**

Run: `pnpm test:integration tests/integration/db-isolation.test.ts`
Expected: FAIL per `SenderNumber`, `Campaign`, `CampaignVersion` (`expected [] to deeply
equal [ 'bot' ]`) e per gli enum; `Organization` passa.

- [ ] **Step 3: Aggiornare `prisma/schema.prisma`**

Il file completo diventa:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  // The database is shared with the Kubri dashboard: every model lives in "bot".
  schemas  = ["bot"]
}

model Organization {
  id                  String   @id @default(uuid()) @db.Uuid
  slug                String   @unique
  name                String
  // Future link to the dashboard's Organization (spec §17).
  kubriOrganizationId String?  @db.Uuid
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  senderNumbers SenderNumber[]
  campaigns     Campaign[]

  @@schema("bot")
}

enum Channel {
  whatsapp

  @@schema("bot")
}

enum SenderProvider {
  meta
  twilio

  @@schema("bot")
}

enum SenderStatus {
  provisioning
  active
  suspended

  @@schema("bot")
}

model SenderNumber {
  id             String         @id @default(uuid()) @db.Uuid
  /// Referenced by campaign files as `trigger.sender` (spec §5.1).
  slug           String         @unique
  /// Owner of the number; null for numbers shared by several organizations.
  organizationId String?        @db.Uuid
  channel        Channel        @default(whatsapp)
  provider       SenderProvider
  phoneE164      String
  displayName    String
  /// Provider identifiers and names of secrets (spec §10.1): never credentials.
  providerConfig Json           @default("{}")
  status         SenderStatus   @default(provisioning)
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  organization Organization? @relation(fields: [organizationId], references: [id])
  campaigns    Campaign[]

  @@unique([channel, phoneE164])
  @@schema("bot")
}

enum CampaignStatus {
  active
  paused
  archived

  @@schema("bot")
}

model Campaign {
  id              String         @id @default(uuid()) @db.Uuid
  slug            String         @unique
  organizationId  String         @db.Uuid
  // Routing columns: copied from the active version (or from the latest import while the
  // campaign has never been activated). The definition in CampaignVersion stays the truth.
  senderNumberId  String         @db.Uuid
  keywords        String[]
  isDefault       Boolean        @default(false)
  externalKey     String
  status          CampaignStatus @default(paused)
  activeVersionId String?        @unique @db.Uuid
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  organization  Organization      @relation(fields: [organizationId], references: [id])
  senderNumber  SenderNumber      @relation(fields: [senderNumberId], references: [id])
  activeVersion CampaignVersion?  @relation("ActiveVersion", fields: [activeVersionId], references: [id])
  versions      CampaignVersion[] @relation("Versions")

  @@index([senderNumberId, status])
  @@schema("bot")
}

/// Immutable (CLAUDE.md): rows are inserted by the import and never updated.
model CampaignVersion {
  id         String   @id @default(uuid()) @db.Uuid
  campaignId String   @db.Uuid
  /// Assigned by the import, 1, 2, 3… per campaign (spec D26).
  version    Int
  /// The parsed definition (Zod defaults applied), in canonical form.
  definition Json
  /// sha256 of the canonical JSON of `definition`.
  checksum   String
  importedAt DateTime @default(now())
  importedBy String?

  campaign  Campaign  @relation("Versions", fields: [campaignId], references: [id])
  activeFor Campaign? @relation("ActiveVersion")

  @@unique([campaignId, version])
  @@unique([campaignId, checksum])
  @@schema("bot")
}
```

Note sul modello:
- **Riferimenti.** `Campaign.activeVersionId` punta a una delle sue `CampaignVersion`, e
  `CampaignVersion.campaignId` punta alla campagna. Prisma richiede i nomi di relazione
  (`"ActiveVersion"`, `"Versions"`) per distinguere i due legami.
- **Enum.** Prisma li crea come tipi Postgres. Anche questi vanno qualificati con `"bot".`,
  sia nel `CREATE TYPE` sia nel tipo delle colonne.
- **Unicità.** `@@unique([campaignId, checksum])` impedisce due versioni identiche della
  stessa campagna. `@@unique([campaignId, version])` protegge la numerazione.

- [ ] **Step 4: Generare la migrazione senza applicarla**

```bash
pnpm db:migrate --name campaign_registry --create-only
```

Expected: `Prisma Migrate created the following migration without applying it
<timestamp>_campaign_registry`. Si usa `--create-only` perché la qualificazione con `"bot".`
va fatta **prima** di applicare la migrazione. Se la si modifica dopo, il checksum registrato
in `bot._prisma_migrations` non coincide più e il prossimo `migrate dev` chiede un reset del
database.

- [ ] **Step 5: Qualificare ogni oggetto con `"bot".`**

Prisma 7 emette SQL non qualificato. Sostituire l'intero contenuto di
`prisma/migrations/<timestamp>_campaign_registry/migration.sql` con:

```sql
-- CreateEnum
CREATE TYPE "bot"."Channel" AS ENUM ('whatsapp');

-- CreateEnum
CREATE TYPE "bot"."SenderProvider" AS ENUM ('meta', 'twilio');

-- CreateEnum
CREATE TYPE "bot"."SenderStatus" AS ENUM ('provisioning', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "bot"."CampaignStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateTable
CREATE TABLE "bot"."SenderNumber" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "organizationId" UUID,
    "channel" "bot"."Channel" NOT NULL DEFAULT 'whatsapp',
    "provider" "bot"."SenderProvider" NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "providerConfig" JSONB NOT NULL DEFAULT '{}',
    "status" "bot"."SenderStatus" NOT NULL DEFAULT 'provisioning',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot"."Campaign" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "senderNumberId" UUID NOT NULL,
    "keywords" TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "externalKey" TEXT NOT NULL,
    "status" "bot"."CampaignStatus" NOT NULL DEFAULT 'paused',
    "activeVersionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot"."CampaignVersion" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedBy" TEXT,

    CONSTRAINT "CampaignVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SenderNumber_slug_key" ON "bot"."SenderNumber"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SenderNumber_channel_phoneE164_key" ON "bot"."SenderNumber"("channel", "phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_slug_key" ON "bot"."Campaign"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_activeVersionId_key" ON "bot"."Campaign"("activeVersionId");

-- CreateIndex
CREATE INDEX "Campaign_senderNumberId_status_idx" ON "bot"."Campaign"("senderNumberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVersion_campaignId_version_key" ON "bot"."CampaignVersion"("campaignId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVersion_campaignId_checksum_key" ON "bot"."CampaignVersion"("campaignId", "checksum");

-- AddForeignKey
ALTER TABLE "bot"."SenderNumber" ADD CONSTRAINT "SenderNumber_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "bot"."Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "bot"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Campaign" ADD CONSTRAINT "Campaign_senderNumberId_fkey" FOREIGN KEY ("senderNumberId") REFERENCES "bot"."SenderNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."Campaign" ADD CONSTRAINT "Campaign_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "bot"."CampaignVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot"."CampaignVersion" ADD CONSTRAINT "CampaignVersion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "bot"."Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Controllare a occhio che **ogni** `CREATE TYPE`, `CREATE TABLE`, `ON`, `REFERENCES` e ogni
tipo enum delle colonne (`"bot"."Channel"`, …) sia qualificato, e che il file tocchi solo
oggetti `"bot".`.

- [ ] **Step 6: Applicare la migrazione e rigenerare il client**

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
pnpm test tests/unit/store/migrations.test.ts
```

Expected: `Your database is now in sync with your schema.`, poi `Generated Prisma Client`,
poi il test delle migrazioni verde (controlla tutte le cartelle di `prisma/migrations`).
In Prisma 7 `migrate dev` non rigenera il client da solo.

- [ ] **Step 7: Verificare**

Run: `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi (`global-setup.ts` applica la nuova migrazione al database
`kubri_bot_test` con `prisma migrate deploy`).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/integration/db-isolation.test.ts
git commit -m "feat(chatbot): add sender number, campaign and campaign version models"
```

---

### Task 6: Configurazione del provider e store di organizzazioni e numeri

**Files:**
- Create: `src/channels/provider-config.ts`, `src/store/organizations.ts`, `src/store/senders.ts`
- Test: `tests/unit/channels/provider-config.test.ts`, `tests/integration/organizations-senders.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/channels/provider-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MetaProviderConfigSchema, SecretRefSchema } from "../../../src/channels/provider-config";

describe("SecretRefSchema", () => {
  it("accepts the name of a secret", () => {
    expect(SecretRefSchema.safeParse("META_TOKEN_KUBRI_MAIN").success).toBe(true);
  });

  it.each(["EAAGm0PX4ZCpsBA1234abcd", "meta_token", "", "AB"])("rejects %j", (value) => {
    expect(SecretRefSchema.safeParse(value).success).toBe(false);
  });
});

describe("MetaProviderConfigSchema", () => {
  const valid = {
    phoneNumberId: "123456789012345",
    wabaId: "987654321098765",
    accessTokenSecret: "META_TOKEN_KUBRI_MAIN",
  };

  it("accepts identifiers and a secret reference", () => {
    expect(MetaProviderConfigSchema.parse(valid)).toEqual(valid);
  });

  it("rejects extra keys, so a raw token cannot sneak in", () => {
    expect(MetaProviderConfigSchema.safeParse({ ...valid, accessToken: "EAAG..." }).success).toBe(
      false,
    );
  });

  it("rejects non-numeric ids", () => {
    expect(MetaProviderConfigSchema.safeParse({ ...valid, phoneNumberId: "abc" }).success).toBe(
      false,
    );
  });
});
```

`tests/integration/organizations-senders.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createOrganization, findOrganizationBySlug } from "../../src/store/organizations";
import {
  createSenderNumber,
  findSenderNumberByPhone,
  findSenderNumberBySlug,
} from "../../src/store/senders";
import { createTestDatabase, resetBotSchema } from "./helpers/database";

const db = createTestDatabase();

beforeEach(async () => {
  await resetBotSchema(db);
});

afterAll(async () => {
  await db.$disconnect();
});

const META_CONFIG = {
  phoneNumberId: "123456789012345",
  wabaId: "987654321098765",
  accessTokenSecret: "META_TOKEN_KUBRI_MAIN",
};

describe("organizations store", () => {
  it("creates and finds an organization by slug", async () => {
    const created = await createOrganization(db, { slug: "kubri", name: "Kubri S.r.l." });

    expect(await findOrganizationBySlug(db, "kubri")).toEqual(created);
    expect(await findOrganizationBySlug(db, "missing")).toBeNull();
  });
});

describe("senders store", () => {
  it("creates a Meta sender number and finds it by slug and phone", async () => {
    const org = await createOrganization(db, { slug: "kubri", name: "Kubri S.r.l." });

    const created = await createSenderNumber(db, {
      slug: "kubri-main",
      organizationId: org.id,
      phoneE164: "+393331234567",
      displayName: "Kubri",
      status: "active",
      provider: "meta",
      providerConfig: META_CONFIG,
    });

    expect(created).toMatchObject({ slug: "kubri-main", provider: "meta", status: "active" });
    expect(await findSenderNumberBySlug(db, "kubri-main")).toEqual(created);
    expect(await findSenderNumberByPhone(db, "+393331234567")).toEqual(created);
  });

  it("stores the provider config (identifiers and secret names only)", async () => {
    await createSenderNumber(db, {
      slug: "kubri-main",
      organizationId: null,
      phoneE164: "+393331234567",
      displayName: "Kubri",
      status: "active",
      provider: "meta",
      providerConfig: META_CONFIG,
    });

    const row = await db.senderNumber.findUniqueOrThrow({ where: { slug: "kubri-main" } });

    expect(row.providerConfig).toEqual(META_CONFIG);
    expect(row.channel).toBe("whatsapp");
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/channels && pnpm test:integration tests/integration/organizations-senders.test.ts`
Expected: FAIL, `Cannot find module` per `provider-config`, `organizations` e `senders`.

- [ ] **Step 3: Implementare `src/channels/provider-config.ts`**

Lo schema vive in `channels` perché sarà l'adattatore `meta-cloud` (piano 09) a leggere
`phoneNumberId` e a risolvere il segreto per nome:

```ts
import { z } from "zod";

/**
 * The name of an environment variable / platform secret holding a credential, never the
 * credential itself (spec §10.1, §16.3). UPPER_SNAKE_CASE rules out pasted tokens.
 */
export const SecretRefSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{2,}$/, "must be the NAME of a secret (UPPER_SNAKE_CASE), not its value");

/** SenderNumber.providerConfig for provider "meta" (WhatsApp Cloud API): identifiers only. */
export const MetaProviderConfigSchema = z.strictObject({
  phoneNumberId: z.string().regex(/^\d+$/, "numeric Meta phone number id"),
  wabaId: z.string().regex(/^\d+$/, "numeric WhatsApp Business Account id"),
  accessTokenSecret: SecretRefSchema,
});

export type MetaProviderConfig = z.infer<typeof MetaProviderConfigSchema>;
```

- [ ] **Step 4: Implementare `src/store/organizations.ts`**

```ts
import type { Database } from "./db";

export interface OrganizationRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

const SELECT = { id: true, slug: true, name: true } as const;

export async function createOrganization(
  db: Database,
  input: { slug: string; name: string },
): Promise<OrganizationRecord> {
  return db.organization.create({ data: input, select: SELECT });
}

export async function findOrganizationBySlug(
  db: Database,
  slug: string,
): Promise<OrganizationRecord | null> {
  return db.organization.findUnique({ where: { slug }, select: SELECT });
}
```

- [ ] **Step 5: Implementare `src/store/senders.ts`**

Lo store restituisce interfacce proprie (`SenderNumberRecord`), così i tipi generati da Prisma
non escono da `src/store` (regola ESLint sui confini):

```ts
import type { MetaProviderConfig } from "../channels/provider-config";
import type { Database } from "./db";

export type SenderProvider = "meta" | "twilio";
export type SenderStatus = "provisioning" | "active" | "suspended";

export interface SenderNumberRecord {
  readonly id: string;
  readonly slug: string;
  readonly organizationId: string | null;
  readonly provider: SenderProvider;
  readonly phoneE164: string;
  readonly displayName: string;
  readonly status: SenderStatus;
}

export interface CreateSenderNumberInput {
  readonly slug: string;
  readonly organizationId: string | null;
  readonly phoneE164: string;
  readonly displayName: string;
  readonly status: SenderStatus;
  // v1 implements Meta only (spec D5); Twilio gets its own config schema when it arrives.
  readonly provider: "meta";
  readonly providerConfig: MetaProviderConfig;
}

const SELECT = {
  id: true,
  slug: true,
  organizationId: true,
  provider: true,
  phoneE164: true,
  displayName: true,
  status: true,
} as const;

export async function createSenderNumber(
  db: Database,
  input: CreateSenderNumberInput,
): Promise<SenderNumberRecord> {
  return db.senderNumber.create({
    data: { ...input, providerConfig: { ...input.providerConfig } },
    select: SELECT,
  });
}

export async function findSenderNumberBySlug(
  db: Database,
  slug: string,
): Promise<SenderNumberRecord | null> {
  return db.senderNumber.findUnique({ where: { slug }, select: SELECT });
}

export async function findSenderNumberByPhone(
  db: Database,
  phoneE164: string,
): Promise<SenderNumberRecord | null> {
  return db.senderNumber.findUnique({
    where: { channel_phoneE164: { channel: "whatsapp", phoneE164 } },
    select: SELECT,
  });
}
```

- [ ] **Step 6: Verificare che passino**

Run: `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 7: Commit**

```bash
git add src/channels/provider-config.ts src/store/organizations.ts src/store/senders.ts tests/unit/channels/provider-config.test.ts tests/integration/organizations-senders.test.ts
git commit -m "feat(chatbot): add organization and sender number stores"
```

---

### Task 7: `LoadedCampaign` e store delle campagne

**Files:**
- Create: `src/campaigns/loaded-campaign.ts`, `src/store/campaigns.ts`, `tests/integration/helpers/registry.ts`
- Test: `tests/integration/campaigns-store.test.ts`

- [ ] **Step 1: Scrivere l'helper e i test che falliscono**

`tests/integration/helpers/registry.ts` crea ciò a cui i file di campagna fanno riferimento:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CampaignInput } from "../../../src/campaigns/schema/campaign";
import type { Database } from "../../../src/store/db";
import { createOrganization } from "../../../src/store/organizations";
import { createSenderNumber, type SenderNumberRecord } from "../../../src/store/senders";

/** The organizations and the sender number the campaign files refer to. */
export async function seedRegistry(db: Database): Promise<{ sender: SenderNumberRecord }> {
  const kubri = await createOrganization(db, { slug: "kubri", name: "Kubri S.r.l." });
  await createOrganization(db, { slug: "acme", name: "ACME S.r.l." });
  const sender = await createSenderNumber(db, {
    slug: "kubri-main",
    organizationId: kubri.id,
    phoneE164: "+393331234567",
    displayName: "Kubri",
    status: "active",
    provider: "meta",
    providerConfig: {
      phoneNumberId: "123456789012345",
      wabaId: "987654321098765",
      accessTokenSecret: "META_TOKEN_KUBRI_MAIN",
    },
  });
  return { sender };
}

export function loadStandardCampaign(): CampaignInput {
  const path = join(__dirname, "../../../campaigns/kubri-standard.json");
  return JSON.parse(readFileSync(path, "utf8")) as CampaignInput;
}
```

`tests/integration/campaigns-store.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalCampaign } from "../../src/campaigns/checksum";
import { CampaignDefinitionSchema, type CampaignInput } from "../../src/campaigns/schema/campaign";
import {
  findActiveCampaignByKeyword,
  findCampaignVersion,
  findDefaultCampaign,
  listCampaigns,
  saveCampaignVersion,
} from "../../src/store/campaigns";
import { minimalCampaign } from "../unit/campaigns/fixtures";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { seedRegistry } from "./helpers/registry";

const db = createTestDatabase();
let senderId = "";

beforeEach(async () => {
  await resetBotSchema(db);
  senderId = (await seedRegistry(db)).sender.id;
});

afterAll(async () => {
  await db.$disconnect();
});

function save(input: CampaignInput, activate: boolean) {
  const definition = CampaignDefinitionSchema.parse(input);
  const { json, checksum } = canonicalCampaign(definition);
  return saveCampaignVersion(db, {
    definition,
    canonical: json,
    checksum,
    activate,
    importedBy: "test",
  });
}

describe("saveCampaignVersion", () => {
  it("creates the campaign and version 1, paused unless activated", async () => {
    const result = await save(minimalCampaign(), false);

    expect(result).toMatchObject({ ok: true, outcome: "created", version: 1, active: false });
    expect(await listCampaigns(db)).toEqual([
      {
        slug: "acme-magazzino",
        organizationSlug: "acme",
        senderSlug: "kubri-main",
        status: "paused",
        isDefault: false,
        keywords: ["acme"],
        activeVersion: null,
        latestVersion: 1,
      },
    ]);
  });

  it("stores the canonical definition and its checksum", async () => {
    const result = await save(minimalCampaign(), false);
    if (!result.ok) throw new Error("expected ok");

    const row = await db.campaignVersion.findUniqueOrThrow({ where: { id: result.versionId } });
    const expected = canonicalCampaign(CampaignDefinitionSchema.parse(minimalCampaign()));

    expect(row.checksum).toBe(expected.checksum);
    expect(row.definition).toEqual(expected.json);
    expect(row.importedBy).toBe("test");
  });

  it("returns the loaded campaign by version id", async () => {
    const result = await save(minimalCampaign(), false);
    if (!result.ok) throw new Error("expected ok");

    const loaded = await findCampaignVersion(db, result.versionId);

    expect(loaded).toMatchObject({
      versionId: result.versionId,
      campaignId: result.campaignId,
      campaignSlug: "acme-magazzino",
      version: 1,
    });
    expect(loaded?.definition).toEqual(CampaignDefinitionSchema.parse(minimalCampaign()));
  });

  it("finds an active campaign by keyword and the default campaign", async () => {
    await save(minimalCampaign(), true);
    const standard = minimalCampaign();
    standard.campaign = "kubri-standard";
    standard.organization = "kubri";
    standard.trigger = { sender: "kubri-main", keywords: [], isDefault: true };
    await save(standard, true);

    expect((await findActiveCampaignByKeyword(db, senderId, " ACME "))?.campaignSlug).toBe(
      "acme-magazzino",
    );
    expect(await findActiveCampaignByKeyword(db, senderId, "culligan")).toBeNull();
    expect((await findDefaultCampaign(db, senderId))?.campaignSlug).toBe("kubri-standard");
  });

  it("does not route to paused campaigns", async () => {
    await save(minimalCampaign(), false);

    expect(await findActiveCampaignByKeyword(db, senderId, "acme")).toBeNull();
  });

  it("reports an unknown organization or sender without writing anything", async () => {
    const noOrg = minimalCampaign();
    noOrg.organization = "nobody";
    const noSender = minimalCampaign();
    noSender.trigger = { sender: "nowhere", keywords: ["acme"] };

    expect(await save(noOrg, false)).toEqual({
      ok: false,
      issues: [expect.objectContaining({ path: "organization", code: "unknown_organization" })],
    });
    expect(await save(noSender, false)).toEqual({
      ok: false,
      issues: [expect.objectContaining({ path: "trigger.sender", code: "unknown_sender" })],
    });
    expect(await db.campaign.count()).toBe(0);
  });

  it("refuses to move a campaign to another organization", async () => {
    await save(minimalCampaign(), false);
    const moved = minimalCampaign();
    moved.organization = "kubri";

    expect(await save(moved, false)).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "organization_mismatch" })],
    });
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test:integration tests/integration/campaigns-store.test.ts`
Expected: FAIL, `Cannot find module '../../src/store/campaigns'`.

- [ ] **Step 3: Implementare `src/campaigns/loaded-campaign.ts`**

```ts
import type { CampaignDefinition } from "./schema/campaign";

/**
 * A stored, immutable campaign version as the rest of the system sees it. The runtime
 * (plan 08) pins sessions to `versionId`; the engine (plan 04) only reads `definition`.
 */
export interface LoadedCampaign {
  readonly versionId: string;
  readonly campaignId: string;
  readonly campaignSlug: string;
  readonly version: number;
  readonly definition: CampaignDefinition;
}
```

- [ ] **Step 4: Implementare `src/store/campaigns.ts`**

```ts
import type { JsonObject } from "../campaigns/checksum";
import type { CampaignIssue } from "../campaigns/issues";
import type { LoadedCampaign } from "../campaigns/loaded-campaign";
import { CampaignDefinitionSchema, type CampaignDefinition } from "../campaigns/schema/campaign";
import { findTriggerCollisions } from "../campaigns/triggers";
import type { Database } from "./db";

export type CampaignStatus = "active" | "paused" | "archived";

export interface SaveCampaignVersionInput {
  /** Already validated by validateCampaign (an invalid campaign never gets here). */
  readonly definition: CampaignDefinition;
  readonly canonical: JsonObject;
  readonly checksum: string;
  readonly activate: boolean;
  readonly importedBy: string | null;
}

export type SaveCampaignVersionResult =
  | {
      ok: true;
      /** "unchanged": a version with the same checksum already existed and was reused. */
      outcome: "created" | "unchanged";
      campaignId: string;
      versionId: string;
      version: number;
      /** Whether this version is the campaign's active one after the import. */
      active: boolean;
    }
  | { ok: false; issues: CampaignIssue[] };

/**
 * Stores a campaign version in one serializable transaction: resolves organization and
 * sender by slug, checks trigger collisions against the other active campaigns of the
 * sender, reuses an identical version (same checksum) or creates version N+1, and
 * optionally activates it.
 */
export async function saveCampaignVersion(
  db: Database,
  input: SaveCampaignVersionInput,
): Promise<SaveCampaignVersionResult> {
  const { definition } = input;

  return db.$transaction(
    async (tx): Promise<SaveCampaignVersionResult> => {
      const organization = await tx.organization.findUnique({
        where: { slug: definition.organization },
      });
      if (!organization) {
        return failure(
          "organization",
          "unknown_organization",
          `Organization "${definition.organization}" does not exist (create it with: orgs add)`,
        );
      }
      const sender = await tx.senderNumber.findUnique({
        where: { slug: definition.trigger.sender },
      });
      if (!sender) {
        return failure(
          "trigger.sender",
          "unknown_sender",
          `Sender number "${definition.trigger.sender}" does not exist (create it with: senders add)`,
        );
      }

      let campaign = await tx.campaign.findUnique({ where: { slug: definition.campaign } });
      if (campaign && campaign.organizationId !== organization.id) {
        return failure(
          "organization",
          "organization_mismatch",
          `Campaign "${definition.campaign}" belongs to another organization`,
        );
      }

      const others = await tx.campaign.findMany({
        where: { senderNumberId: sender.id, status: "active", slug: { not: definition.campaign } },
        select: { slug: true, keywords: true, isDefault: true },
      });
      const collisions = findTriggerCollisions(definition, others);
      if (collisions.length > 0) return { ok: false, issues: collisions };

      const routing = {
        senderNumberId: sender.id,
        keywords: definition.trigger.keywords,
        isDefault: definition.trigger.isDefault,
        externalKey: definition.externalKey,
      };
      campaign ??= await tx.campaign.create({
        data: { slug: definition.campaign, organizationId: organization.id, ...routing },
      });

      let outcome: "created" | "unchanged" = "unchanged";
      let version = await tx.campaignVersion.findUnique({
        where: { campaignId_checksum: { campaignId: campaign.id, checksum: input.checksum } },
      });
      if (!version) {
        const latest = await tx.campaignVersion.aggregate({
          where: { campaignId: campaign.id },
          _max: { version: true },
        });
        version = await tx.campaignVersion.create({
          data: {
            campaignId: campaign.id,
            version: (latest._max.version ?? 0) + 1,
            definition: input.canonical,
            checksum: input.checksum,
            importedBy: input.importedBy,
          },
        });
        outcome = "created";
      }

      if (input.activate) {
        campaign = await tx.campaign.update({
          where: { id: campaign.id },
          data: { ...routing, status: "active", activeVersionId: version.id },
        });
      } else if (campaign.activeVersionId === null) {
        // Never activated: the routing columns follow the latest import.
        campaign = await tx.campaign.update({ where: { id: campaign.id }, data: routing });
      }

      return {
        ok: true,
        outcome,
        campaignId: campaign.id,
        versionId: version.id,
        version: version.version,
        active: campaign.status === "active" && campaign.activeVersionId === version.id,
      };
    },
    { isolationLevel: "Serializable" },
  );
}

function failure(path: string, code: string, message: string): SaveCampaignVersionResult {
  return { ok: false, issues: [{ path, code, message }] };
}

export interface CampaignSummary {
  readonly slug: string;
  readonly organizationSlug: string;
  readonly senderSlug: string;
  readonly status: CampaignStatus;
  readonly isDefault: boolean;
  readonly keywords: readonly string[];
  readonly activeVersion: number | null;
  readonly latestVersion: number;
}

export async function listCampaigns(db: Database): Promise<CampaignSummary[]> {
  const rows = await db.campaign.findMany({
    orderBy: { slug: "asc" },
    include: {
      organization: { select: { slug: true } },
      senderNumber: { select: { slug: true } },
      activeVersion: { select: { version: true } },
      versions: { select: { version: true }, orderBy: { version: "desc" }, take: 1 },
    },
  });
  return rows.map((row) => ({
    slug: row.slug,
    organizationSlug: row.organization.slug,
    senderSlug: row.senderNumber.slug,
    status: row.status,
    isDefault: row.isDefault,
    keywords: row.keywords,
    activeVersion: row.activeVersion?.version ?? null,
    latestVersion: row.versions[0]?.version ?? 0,
  }));
}

const WITH_ACTIVE_VERSION = { activeVersion: true } as const;

/** The active campaign on a sender whose keywords include `keyword` (normalized here). */
export async function findActiveCampaignByKeyword(
  db: Database,
  senderNumberId: string,
  keyword: string,
): Promise<LoadedCampaign | null> {
  const row = await db.campaign.findFirst({
    where: { senderNumberId, status: "active", keywords: { has: keyword.trim().toLowerCase() } },
    include: WITH_ACTIVE_VERSION,
  });
  return row?.activeVersion ? toLoaded(row.slug, row.activeVersion) : null;
}

/** The active default campaign of a sender (`trigger.isDefault`), if any. */
export async function findDefaultCampaign(
  db: Database,
  senderNumberId: string,
): Promise<LoadedCampaign | null> {
  const row = await db.campaign.findFirst({
    where: { senderNumberId, status: "active", isDefault: true },
    include: WITH_ACTIVE_VERSION,
  });
  return row?.activeVersion ? toLoaded(row.slug, row.activeVersion) : null;
}

/** A specific version, active or not: sessions stay pinned to the version they started on. */
export async function findCampaignVersion(
  db: Database,
  versionId: string,
): Promise<LoadedCampaign | null> {
  const row = await db.campaignVersion.findUnique({
    where: { id: versionId },
    include: { campaign: { select: { slug: true } } },
  });
  return row ? toLoaded(row.campaign.slug, row) : null;
}

interface VersionRow {
  readonly id: string;
  readonly campaignId: string;
  readonly version: number;
  readonly definition: unknown;
}

function toLoaded(campaignSlug: string, row: VersionRow): LoadedCampaign {
  return {
    versionId: row.id,
    campaignId: row.campaignId,
    campaignSlug,
    version: row.version,
    // Stored definitions were validated on import; parsing restores the static type.
    definition: CampaignDefinitionSchema.parse(row.definition),
  };
}
```

Note:
- **Isolamento.** La transazione è `Serializable`: due import concorrenti sullo stesso numero
  non possono superare entrambi il controllo delle collisioni. Uno dei due fallisce con un
  errore di serializzazione e si rilancia a mano. Per un comando CLI manuale è accettabile.
- **Indice parziale.** Non si usa un indice univoco parziale (`WHERE "isDefault" AND status =
  'active'`): Prisma non lo esprime nello schema e il prossimo `migrate dev` lo vedrebbe come
  deriva.
- **Firme per il runtime.** `findActiveCampaignByKeyword`, `findDefaultCampaign` e
  `findCampaignVersion` sono le funzioni che il runtime del piano 08 userà per instradare il
  primo messaggio e per ricaricare la versione di una sessione.

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 6: Commit**

```bash
git add src/campaigns/loaded-campaign.ts src/store/campaigns.ts tests/integration/helpers/registry.ts tests/integration/campaigns-store.test.ts
git commit -m "feat(chatbot): store immutable campaign versions with activation and lookups"
```

---

### Task 8: `importCampaign`

**Files:**
- Create: `src/campaigns/import.ts`
- Test: `tests/integration/campaign-import.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

Coprono tutti i casi chiesti dalla roadmap:
- creazione e import della campagna standard;
- reimport identico senza versione nuova;
- file modificato con versione +1;
- collisioni di parola chiave e di default;
- semantica dell'attivazione e rollback;
- campagna non valida mai scritta;
- guardia dei consensi segnaposto, nei due sensi.

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { importCampaign } from "../../src/campaigns/import";
import { findDefaultCampaign, listCampaigns } from "../../src/store/campaigns";
import { minimalCampaign } from "../unit/campaigns/fixtures";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { loadStandardCampaign, seedRegistry } from "./helpers/registry";

const db = createTestDatabase();
let senderId = "";

beforeEach(async () => {
  await resetBotSchema(db);
  senderId = (await seedRegistry(db)).sender.id;
});

afterAll(async () => {
  await db.$disconnect();
});

const DEV = { activate: true, nodeEnv: "development" } as const;

describe("importCampaign", () => {
  it("imports and activates the standard Kubri campaign", async () => {
    const result = await importCampaign(db, loadStandardCampaign(), DEV);

    expect(result).toMatchObject({ ok: true, outcome: "created", version: 1, active: true });
    expect((await findDefaultCampaign(db, senderId))?.definition.externalKey).toBe("global");
  });

  it("warns about placeholder consents outside production", async () => {
    const result = await importCampaign(db, loadStandardCampaign(), DEV);

    expect(result.ok && result.warnings.map((w) => w.code)).toEqual([
      "placeholder_consent",
      "placeholder_consent",
    ]);
  });

  it("refuses placeholder consents in production, writing nothing", async () => {
    const result = await importCampaign(db, loadStandardCampaign(), {
      activate: true,
      nodeEnv: "production",
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((i) => i.code)).toEqual([
      "placeholder_consent",
      "placeholder_consent",
    ]);
    expect(await db.campaign.count()).toBe(0);
  });

  it("accepts official consent versions in production", async () => {
    const result = await importCampaign(db, minimalCampaign(), {
      activate: true,
      nodeEnv: "production",
    });

    expect(result).toMatchObject({ ok: true, version: 1 });
  });

  it("does not create a new version for an identical re-import", async () => {
    await importCampaign(db, loadStandardCampaign(), DEV);

    const again = await importCampaign(db, loadStandardCampaign(), DEV);

    expect(again).toMatchObject({ ok: true, outcome: "unchanged", version: 1, active: true });
    expect(await db.campaignVersion.count()).toBe(1);
  });

  it("creates version 2 when the file changes", async () => {
    await importCampaign(db, loadStandardCampaign(), DEV);
    const changed = loadStandardCampaign();
    changed.afterCompletion = { allowEdits: true, allowCvRegeneration: false };

    const result = await importCampaign(db, changed, DEV);

    expect(result).toMatchObject({ ok: true, outcome: "created", version: 2, active: true });
    expect(await db.campaignVersion.count()).toBe(2);
  });

  it("keeps the active version when a new one is imported without activation", async () => {
    await importCampaign(db, loadStandardCampaign(), DEV);
    const changed = loadStandardCampaign();
    changed.afterCompletion = { allowEdits: false, allowCvRegeneration: false };

    const result = await importCampaign(db, changed, { activate: false, nodeEnv: "development" });

    expect(result).toMatchObject({ ok: true, outcome: "created", version: 2, active: false });
    const [summary] = await listCampaigns(db);
    expect(summary).toMatchObject({ status: "active", activeVersion: 1, latestVersion: 2 });
    expect((await findDefaultCampaign(db, senderId))?.version).toBe(1);
  });

  it("re-activates an older version when its file is imported again (rollback)", async () => {
    await importCampaign(db, loadStandardCampaign(), DEV);
    const changed = loadStandardCampaign();
    changed.afterCompletion = { allowEdits: false, allowCvRegeneration: false };
    await importCampaign(db, changed, DEV);

    const rollback = await importCampaign(db, loadStandardCampaign(), DEV);

    expect(rollback).toMatchObject({ ok: true, outcome: "unchanged", version: 1, active: true });
    expect((await findDefaultCampaign(db, senderId))?.version).toBe(1);
  });

  it("rejects a keyword already used by another active campaign on the same sender", async () => {
    await importCampaign(db, minimalCampaign(), DEV);
    const rival = minimalCampaign();
    rival.campaign = "acme-pulizie";
    rival.trigger = { sender: "kubri-main", keywords: ["pulizie", "acme"] };

    const result = await importCampaign(db, rival, DEV);

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ path: "trigger.keywords[1]", code: "keyword_collision" })],
    });
    expect(await db.campaign.count()).toBe(1);
  });

  it("ignores keywords of paused campaigns", async () => {
    await importCampaign(db, minimalCampaign(), { activate: false, nodeEnv: "development" });
    const rival = minimalCampaign();
    rival.campaign = "acme-pulizie";

    expect(await importCampaign(db, rival, DEV)).toMatchObject({ ok: true, active: true });
  });

  it("rejects a second default campaign on the same sender", async () => {
    await importCampaign(db, loadStandardCampaign(), DEV);
    const second = loadStandardCampaign();
    second.campaign = "kubri-standard-bis";

    const result = await importCampaign(db, second, DEV);

    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({ path: "trigger.isDefault", code: "duplicate_default_campaign" }),
      ],
    });
  });

  it("never writes an invalid campaign", async () => {
    const invalid = minimalCampaign();
    invalid.flow = invalid.flow.filter((step) => step.type !== "consent");

    const result = await importCampaign(db, invalid, DEV);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((i) => i.code)).toContain("missing_mandatory_consent");
    expect(await db.campaign.count()).toBe(0);
    expect(await db.campaignVersion.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test:integration tests/integration/campaign-import.test.ts`
Expected: FAIL, `Cannot find module '../../src/campaigns/import'`.

- [ ] **Step 3: Implementare**

`src/campaigns/import.ts` importa da `src/store` (consentito: la regola ESLint vieta fuori da
`store` solo Prisma, `pg` e il client generato):

```ts
import type { NodeEnv } from "../config/env";
import { saveCampaignVersion, type SaveCampaignVersionResult } from "../store/campaigns";
import type { Database } from "../store/db";
import { canonicalCampaign } from "./checksum";
import type { CampaignIssue } from "./issues";
import { checkPublishable } from "./publishable";
import { validateCampaign } from "./validate";

export interface ImportCampaignOptions {
  readonly activate: boolean;
  readonly nodeEnv: NodeEnv;
  readonly importedBy?: string | null;
}

export type ImportCampaignResult =
  | (Extract<SaveCampaignVersionResult, { ok: true }> & { warnings: CampaignIssue[] })
  | { ok: false; issues: CampaignIssue[] };

/**
 * Validates first and touches the database only with a valid campaign: an invalid
 * campaign never reaches the DB (CLAUDE.md). Then stores it as an immutable version.
 */
export async function importCampaign(
  db: Database,
  input: unknown,
  options: ImportCampaignOptions,
): Promise<ImportCampaignResult> {
  const validation = validateCampaign(input);
  if (!validation.ok) return { ok: false, issues: validation.issues };

  const publishable = checkPublishable(validation.campaign, options.nodeEnv);
  if (publishable.errors.length > 0) return { ok: false, issues: publishable.errors };

  const { json, checksum } = canonicalCampaign(validation.campaign);
  const saved = await saveCampaignVersion(db, {
    definition: validation.campaign,
    canonical: json,
    checksum,
    activate: options.activate,
    importedBy: options.importedBy ?? null,
  });
  return saved.ok ? { ...saved, warnings: publishable.warnings } : saved;
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/campaigns/import.ts tests/integration/campaign-import.test.ts
git commit -m "feat(chatbot): import campaigns as immutable versions with collision checks"
```

---

### Task 9: Dipendenze della CLI, `orgs add` e `senders add`

Commander 15 non fa ereditare ai sottocomandi `exitOverride()` e `configureOutput()` impostati
sul programma *dopo* averli creati. Per questo i comandi non usano `command.error()`: scrivono
l'output tramite `deps.out` / `deps.err` e, in caso di errore, lanciano un `CliError`.
`main.ts` lo intercetta, stampa il messaggio e imposta `process.exitCode`.

**Files:**
- Create: `src/cli/deps.ts`, `src/cli/commands/orgs.ts`, `src/cli/commands/senders.ts`, `tests/unit/cli/fake-deps.ts`, `tests/integration/helpers/cli.ts`
- Modify: `src/cli/program.ts`, `src/cli/main.ts`, `tests/unit/cli/program.test.ts`
- Test: `tests/integration/cli-orgs-senders.test.ts`

- [ ] **Step 1: Scrivere gli helper e i test che falliscono**

`tests/unit/cli/fake-deps.ts`:

```ts
import type { CliDeps } from "../../../src/cli/deps";
import type { NodeEnv } from "../../../src/config/env";

export interface FakeCli {
  readonly deps: CliDeps;
  readonly stdout: string[];
  readonly stderr: string[];
}

/** In-memory files, captured output, and a database that must not be touched. */
export function fakeCli(files: Record<string, string> = {}, nodeEnv: NodeEnv = "test"): FakeCli {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps: CliDeps = {
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    readFile: (path) => {
      const content = files[path];
      return content === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(content);
    },
    nodeEnv: () => nodeEnv,
    withDatabase: () => Promise.reject(new Error("unit tests must not open the database")),
  };
  return { deps, stdout, stderr };
}
```

`tests/unit/cli/program.test.ts` (il file completo diventa):

```ts
import { describe, expect, it } from "vitest";
import { createProgram } from "../../../src/cli/program";
import { VERSION } from "../../../src/version";
import { fakeCli } from "./fake-deps";

function runCli(args: string[]): { output: string; error: unknown } {
  let output = "";
  const program = createProgram(fakeCli().deps)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        output += text;
      },
      writeErr: (text) => {
        output += text;
      },
    });
  try {
    program.parse(["node", "kubri-bot", ...args]);
    return { output, error: undefined };
  } catch (error: unknown) {
    return { output, error };
  }
}

describe("kubri-bot CLI", () => {
  it("prints the version", () => {
    expect(runCli(["--version"]).output.trim()).toBe(VERSION);
  });

  it("shows its name in the help", () => {
    expect(runCli(["--help"]).output).toContain("Usage: kubri-bot");
  });

  it.each(["orgs", "senders"])("lists the %s command in the help", (name) => {
    expect(runCli(["--help"]).output).toContain(name);
  });
});
```

`tests/integration/helpers/cli.ts`:

```ts
import { readFileSync } from "node:fs";
import type { CliDeps } from "../../../src/cli/deps";
import { createProgram } from "../../../src/cli/program";
import type { Database } from "../../../src/store/db";

export interface CliRun {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly error: unknown;
}

/** Runs the CLI on the real test database and real files; only the output is captured. */
export async function runCli(db: Database, args: string[]): Promise<CliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps: CliDeps = {
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    readFile: (path) => Promise.resolve(readFileSync(path, "utf8")),
    nodeEnv: () => "development",
    // The test owns the connection: commands must not disconnect it.
    withDatabase: (fn) => fn(db),
  };
  let error: unknown;
  try {
    await createProgram(deps).parseAsync(["node", "kubri-bot", ...args]);
  } catch (e: unknown) {
    error = e;
  }
  return { stdout, stderr, error };
}

export const SENDER_ADD_ARGS = [
  "senders",
  "add",
  "kubri-main",
  "--phone",
  "+393331234567",
  "--name",
  "Kubri",
  "--org",
  "kubri",
  "--phone-number-id",
  "123456789012345",
  "--waba-id",
  "987654321098765",
  "--token-secret",
  "META_TOKEN_KUBRI_MAIN",
];

/** The organization and sender the standard campaign refers to, created through the CLI. */
export async function seedViaCli(db: Database): Promise<void> {
  await runCli(db, ["orgs", "add", "kubri", "--name", "Kubri S.r.l."]);
  await runCli(db, SENDER_ADD_ARGS);
}
```

`tests/integration/cli-orgs-senders.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../../src/cli/deps";
import { runCli, SENDER_ADD_ARGS, seedViaCli } from "./helpers/cli";
import { createTestDatabase, resetBotSchema } from "./helpers/database";

const db = createTestDatabase();

beforeEach(async () => {
  await resetBotSchema(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("orgs add", () => {
  it("creates an organization", async () => {
    const { stdout, error } = await runCli(db, ["orgs", "add", "kubri", "--name", "Kubri S.r.l."]);

    expect(error).toBeUndefined();
    expect(stdout[0]).toMatch(/^✓ organization kubri created/);
    expect(await db.organization.count()).toBe(1);
  });

  it("refuses a duplicate slug", async () => {
    await runCli(db, ["orgs", "add", "kubri", "--name", "Kubri"]);

    const { error } = await runCli(db, ["orgs", "add", "kubri", "--name", "Kubri again"]);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/already exists/);
  });

  it("refuses a slug that is not kebab-case", async () => {
    const { error } = await runCli(db, ["orgs", "add", "Kubri_SRL", "--name", "Kubri"]);

    expect(error).toBeInstanceOf(CliError);
    expect(await db.organization.count()).toBe(0);
  });
});

describe("senders add", () => {
  it("creates a Meta sender number linked to its organization", async () => {
    await seedViaCli(db);

    const sender = await db.senderNumber.findUniqueOrThrow({
      where: { slug: "kubri-main" },
      include: { organization: true },
    });
    expect(sender.organization?.slug).toBe("kubri");
    expect(sender.status).toBe("active");
    expect(sender.providerConfig).toEqual({
      phoneNumberId: "123456789012345",
      wabaId: "987654321098765",
      accessTokenSecret: "META_TOKEN_KUBRI_MAIN",
    });
  });

  it("refuses something that looks like a token instead of a secret name", async () => {
    await runCli(db, ["orgs", "add", "kubri", "--name", "Kubri"]);
    const args = [...SENDER_ADD_ARGS.slice(0, -1), "EAAGm0PX4ZCpsBAabc123"];

    const { error } = await runCli(db, args);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/accessTokenSecret/);
    expect(await db.senderNumber.count()).toBe(0);
  });

  it("refuses an unknown organization", async () => {
    const { error } = await runCli(db, SENDER_ADD_ARGS);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/Organization "kubri" does not exist/);
  });

  it("refuses a phone number already registered", async () => {
    await seedViaCli(db);
    const args = SENDER_ADD_ARGS.map((arg) => (arg === "kubri-main" ? "kubri-bis" : arg));

    const { error } = await runCli(db, args);

    expect((error as CliError).message).toMatch(/already registered/);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/cli && pnpm test:integration tests/integration/cli-orgs-senders.test.ts`
Expected: FAIL, `Cannot find module '../../../src/cli/deps'`.

- [ ] **Step 3: Implementare `src/cli/deps.ts`**

```ts
import type { NodeEnv } from "../config/env";
import type { Database } from "../store/db";

/** Everything a command touches outside itself, injected so commands are testable. */
export interface CliDeps {
  /** Writes one line to stdout. */
  readonly out: (line: string) => void;
  /** Writes one line to stderr. */
  readonly err: (line: string) => void;
  readonly readFile: (path: string) => Promise<string>;
  /** Read lazily: `campaigns validate` must work without DATABASE_URL. */
  readonly nodeEnv: () => NodeEnv;
  /** Opens a connection for the duration of `fn`, then disconnects. */
  readonly withDatabase: <T>(fn: (db: Database) => Promise<T>) => Promise<T>;
}

/** A failure already explained to the user: main prints the message and exits non-zero. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}
```

- [ ] **Step 4: Implementare `src/cli/commands/orgs.ts`**

```ts
import type { Command } from "commander";
import { SlugSchema } from "../../campaigns/schema/ids";
import { createOrganization, findOrganizationBySlug } from "../../store/organizations";
import { CliError, type CliDeps } from "../deps";

export function registerOrgCommands(program: Command, deps: CliDeps): void {
  const orgs = program.command("orgs").description("Manage organizations");

  orgs
    .command("add")
    .description("Create an organization")
    .argument("<slug>", "kebab-case slug, used by campaign files")
    .requiredOption("--name <name>", "display name")
    .action(async (slug: string, options: { name: string }) => {
      if (!SlugSchema.safeParse(slug).success) {
        throw new CliError(`Invalid slug "${slug}": use kebab-case`);
      }
      const name = options.name.trim();
      if (name === "") throw new CliError("--name cannot be empty");

      const created = await deps.withDatabase(async (db) => {
        if (await findOrganizationBySlug(db, slug)) {
          throw new CliError(`Organization "${slug}" already exists`);
        }
        return createOrganization(db, { slug, name });
      });
      deps.out(`✓ organization ${created.slug} created (${created.id})`);
    });
}
```

- [ ] **Step 5: Implementare `src/cli/commands/senders.ts`**

```ts
import type { Command } from "commander";
import { MetaProviderConfigSchema } from "../../channels/provider-config";
import { SlugSchema } from "../../campaigns/schema/ids";
import { findOrganizationBySlug } from "../../store/organizations";
import {
  createSenderNumber,
  findSenderNumberByPhone,
  findSenderNumberBySlug,
} from "../../store/senders";
import { CliError, type CliDeps } from "../deps";

const E164 = /^\+[1-9]\d{6,14}$/;

interface SenderAddOptions {
  phone: string;
  name: string;
  org?: string;
  phoneNumberId: string;
  wabaId: string;
  tokenSecret: string;
}

export function registerSenderCommands(program: Command, deps: CliDeps): void {
  const senders = program.command("senders").description("Manage WhatsApp sender numbers");

  senders
    .command("add")
    .description("Register a WhatsApp number served through the Meta Cloud API")
    .argument("<slug>", "kebab-case slug, used as trigger.sender in campaign files")
    .requiredOption("--phone <e164>", "the number in E.164 format, e.g. +393331234567")
    .requiredOption("--name <name>", "display name")
    .option("--org <slug>", "owning organization (omit for a shared number)")
    .requiredOption("--phone-number-id <id>", "Meta phone number id")
    .requiredOption("--waba-id <id>", "Meta WhatsApp Business Account id")
    .requiredOption(
      "--token-secret <NAME>",
      "NAME of the env var / secret holding the access token (never the token itself)",
    )
    .action(async (slug: string, options: SenderAddOptions) => {
      if (!SlugSchema.safeParse(slug).success) {
        throw new CliError(`Invalid slug "${slug}": use kebab-case`);
      }
      if (!E164.test(options.phone)) {
        throw new CliError(`Invalid phone "${options.phone}": use E.164, e.g. +393331234567`);
      }
      const config = MetaProviderConfigSchema.safeParse({
        phoneNumberId: options.phoneNumberId,
        wabaId: options.wabaId,
        accessTokenSecret: options.tokenSecret,
      });
      if (!config.success) {
        const details = config.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
        throw new CliError(`Invalid provider config: ${details.join("; ")}`);
      }

      const created = await deps.withDatabase(async (db) => {
        if (await findSenderNumberBySlug(db, slug)) {
          throw new CliError(`Sender "${slug}" already exists`);
        }
        if (await findSenderNumberByPhone(db, options.phone)) {
          throw new CliError(`Phone ${options.phone} is already registered`);
        }
        let organizationId: string | null = null;
        if (options.org !== undefined) {
          const org = await findOrganizationBySlug(db, options.org);
          if (!org) throw new CliError(`Organization "${options.org}" does not exist`);
          organizationId = org.id;
        }
        return createSenderNumber(db, {
          slug,
          organizationId,
          phoneE164: options.phone,
          displayName: options.name.trim(),
          // Manual provisioning: the number is already set up on Meta (spec §17).
          status: "active",
          provider: "meta",
          providerConfig: config.data,
        });
      });
      deps.out(`✓ sender ${created.slug} created (${created.id})`);
    });
}
```

- [ ] **Step 6: Aggiornare `src/cli/program.ts`**

```ts
import { Command } from "commander";
import { VERSION } from "../version";
import { registerOrgCommands } from "./commands/orgs";
import { registerSenderCommands } from "./commands/senders";
import type { CliDeps } from "./deps";

// Later plans register more commands here (simulate, evals, ops).
export function createProgram(deps: CliDeps): Command {
  const program = new Command()
    .name("kubri-bot")
    .description("Kubri Chatbot operations CLI")
    .version(VERSION);
  registerOrgCommands(program, deps);
  registerSenderCommands(program, deps);
  return program;
}
```

- [ ] **Step 7: Aggiornare `src/cli/main.ts`**

`withDatabase` apre la connessione solo quando un comando la chiede e la chiude sempre:

```ts
import { readFile } from "node:fs/promises";
import { parseEnv, parseNodeEnv } from "../config/env";
import { createDatabase } from "../store/db";
import { CliError, type CliDeps } from "./deps";
import { createProgram } from "./program";

const deps: CliDeps = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  readFile: (path) => readFile(path, "utf8"),
  nodeEnv: () => parseNodeEnv(process.env["NODE_ENV"]),
  withDatabase: async (fn) => {
    const db = createDatabase(parseEnv(process.env).DATABASE_URL);
    try {
      return await fn(db);
    } finally {
      await db.$disconnect();
    }
  },
};

try {
  await createProgram(deps).parseAsync(process.argv);
} catch (error: unknown) {
  if (!(error instanceof CliError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.exitCode;
}
```

- [ ] **Step 8: Verificare che passino**

Run: `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 9: Prova a mano sul database di sviluppo**

```bash
pnpm cli orgs add kubri --name "Kubri S.r.l."
pnpm cli senders add kubri-main --phone +393331234567 --name Kubri --org kubri \
  --phone-number-id 123456789012345 --waba-id 987654321098765 --token-secret META_TOKEN_KUBRI_MAIN
```

Expected: `✓ organization kubri created (<uuid>)` e `✓ sender kubri-main created (<uuid>)`.
I valori sono di prova: il numero reale di test verrà registrato nel piano 09.

- [ ] **Step 10: Commit**

```bash
git add src/cli/deps.ts src/cli/commands/orgs.ts src/cli/commands/senders.ts src/cli/program.ts src/cli/main.ts tests/unit/cli/fake-deps.ts tests/unit/cli/program.test.ts tests/integration/helpers/cli.ts tests/integration/cli-orgs-senders.test.ts
git commit -m "feat(chatbot): add orgs add and senders add cli commands"
```

---

### Task 10: `campaigns validate`, `campaigns import`, `campaigns list`

**Files:**
- Create: `src/cli/commands/campaigns.ts`, `src/cli/format-issues.ts`, `src/cli/read-campaign-file.ts`
- Modify: `src/cli/program.ts`, `tests/unit/cli/program.test.ts`
- Test: `tests/unit/cli/campaigns-validate.test.ts`, `tests/integration/cli-campaigns.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

In `tests/unit/cli/program.test.ts` sostituire:

```ts
  it.each(["orgs", "senders"])("lists the %s command in the help", (name) => {
```

con:

```ts
  it.each(["orgs", "senders", "campaigns"])("lists the %s command in the help", (name) => {
```

`tests/unit/cli/campaigns-validate.test.ts` (`validate` non apre il database: `fakeCli` fa
fallire ogni tentativo di aprirlo):

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CliError } from "../../../src/cli/deps";
import { createProgram } from "../../../src/cli/program";
import type { NodeEnv } from "../../../src/config/env";
import { minimalCampaign } from "../campaigns/fixtures";
import { fakeCli } from "./fake-deps";

const STANDARD = readFileSync(join(__dirname, "../../../campaigns/kubri-standard.json"), "utf8");

async function validate(content: string, nodeEnv: NodeEnv = "test") {
  const cli = fakeCli({ "c.json": content }, nodeEnv);
  let error: unknown;
  try {
    await createProgram(cli.deps).parseAsync([
      "node",
      "kubri-bot",
      "campaigns",
      "validate",
      "c.json",
    ]);
  } catch (e: unknown) {
    error = e;
  }
  return { ...cli, error };
}

describe("campaigns validate", () => {
  it("confirms a valid campaign", async () => {
    const { stdout, error } = await validate(JSON.stringify(minimalCampaign()));

    expect(error).toBeUndefined();
    expect(stdout).toEqual(['✓ c.json: campaign "acme-magazzino" is valid']);
  });

  it("prints every issue with its path and fails", async () => {
    const input = minimalCampaign();
    input.texts = {};

    const { stderr, error } = await validate(JSON.stringify(input));

    expect(error).toBeInstanceOf(CliError);
    expect(stderr[0]).toBe("✗ c.json: 1 issue(s)");
    expect(stderr[1]).toContain("flow[1].on.idk.reply");
    expect(stderr[1]).toContain("unknown_text_ref");
  });

  it("fails on a file that is not JSON", async () => {
    const { error } = await validate("{ nope");

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/not valid JSON/);
  });

  it("fails on a missing file", async () => {
    const cli = fakeCli();
    await expect(
      createProgram(cli.deps).parseAsync(["node", "kubri-bot", "campaigns", "validate", "x.json"]),
    ).rejects.toThrow(/Cannot read x.json/);
  });

  it("warns about placeholder consents outside production", async () => {
    const { stdout, stderr, error } = await validate(STANDARD, "development");

    expect(error).toBeUndefined();
    expect(stderr.filter((line) => line.includes("placeholder_consent"))).toHaveLength(2);
    expect(stdout[0]).toContain("is valid");
  });

  it("fails on placeholder consents in production", async () => {
    const { error, stderr } = await validate(STANDARD, "production");

    expect(error).toBeInstanceOf(CliError);
    expect(stderr.join("\n")).toContain("not publishable");
  });
});
```

`tests/integration/cli-campaigns.test.ts`:

```ts
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../../src/cli/deps";
import { runCli, seedViaCli } from "./helpers/cli";
import { createTestDatabase, resetBotSchema } from "./helpers/database";

const db = createTestDatabase();
const STANDARD_PATH = join(__dirname, "../../campaigns/kubri-standard.json");

beforeEach(async () => {
  await resetBotSchema(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("campaigns import and list", () => {
  it("imports, re-imports without a new version, and lists", async () => {
    await seedViaCli(db);

    const first = await runCli(db, ["campaigns", "import", STANDARD_PATH, "--activate"]);
    const second = await runCli(db, ["campaigns", "import", STANDARD_PATH, "--activate"]);
    const list = await runCli(db, ["campaigns", "list"]);

    expect(first.stdout[0]).toMatch(/created version 1, active$/);
    expect(first.stderr.filter((l) => l.includes("placeholder_consent"))).toHaveLength(2);
    expect(second.stdout[0]).toMatch(/unchanged, reusing version 1, active$/);
    expect(list.stdout).toEqual([
      "kubri-standard  [active]  org=kubri  sender=kubri-main  active=v1  latest=v1  trigger=default",
    ]);
  });

  it("imports without activating by default", async () => {
    await seedViaCli(db);

    const { stdout } = await runCli(db, ["campaigns", "import", STANDARD_PATH]);

    expect(stdout[0]).toMatch(/created version 1, not active \(use --activate\)$/);
  });

  it("stores who imported the version", async () => {
    await seedViaCli(db);

    await runCli(db, ["campaigns", "import", STANDARD_PATH, "--imported-by", "daniele"]);

    expect((await db.campaignVersion.findFirstOrThrow()).importedBy).toBe("daniele");
  });

  it("explains a refused import and fails", async () => {
    // No organization and no sender yet.
    const { stderr, error } = await runCli(db, ["campaigns", "import", STANDARD_PATH]);

    expect(error).toBeInstanceOf(CliError);
    expect(stderr.join("\n")).toContain("unknown_organization");
  });

  it("says when there are no campaigns", async () => {
    expect((await runCli(db, ["campaigns", "list"])).stdout).toEqual(["No campaigns."]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/cli && pnpm test:integration tests/integration/cli-campaigns.test.ts`
Expected: FAIL. Il test dell'help non trova `campaigns`; gli altri falliscono con
`error: unknown command 'campaigns'` oppure con l'uscita del processo (commander chiama
`process.exit` sui sottocomandi sconosciuti).

- [ ] **Step 3: Implementare `src/cli/format-issues.ts`**

```ts
import type { CampaignIssue } from "../campaigns/issues";

/** One issue per line: "  ✗ flow[3].questions[1].field  unknown_field: Field …". */
export function formatIssues(issues: readonly CampaignIssue[], marker = "✗"): string[] {
  return issues.map((i) => `  ${marker} ${i.path || "(root)"}  ${i.code}: ${i.message}`);
}
```

- [ ] **Step 4: Implementare `src/cli/read-campaign-file.ts`**

```ts
import { CliError, type CliDeps } from "./deps";

export async function readCampaignFile(deps: CliDeps, path: string): Promise<unknown> {
  let text: string;
  try {
    text = await deps.readFile(path);
  } catch {
    throw new CliError(`Cannot read ${path}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(`${path} is not valid JSON: ${detail}`);
  }
}
```

- [ ] **Step 5: Implementare `src/cli/commands/campaigns.ts`**

```ts
import type { Command } from "commander";
import { importCampaign } from "../../campaigns/import";
import { checkPublishable } from "../../campaigns/publishable";
import { validateCampaign } from "../../campaigns/validate";
import { listCampaigns } from "../../store/campaigns";
import { CliError, type CliDeps } from "../deps";
import { formatIssues } from "../format-issues";
import { readCampaignFile } from "../read-campaign-file";

export function registerCampaignCommands(program: Command, deps: CliDeps): void {
  const campaigns = program.command("campaigns").description("Validate, import and list campaigns");

  campaigns
    .command("validate")
    .description("Validate a campaign file without touching the database")
    .argument("<file>", "campaign JSON file")
    .action(async (file: string) => {
      const input = await readCampaignFile(deps, file);
      const result = validateCampaign(input);
      if (!result.ok) {
        deps.err(`✗ ${file}: ${result.issues.length} issue(s)`);
        formatIssues(result.issues).forEach(deps.err);
        throw new CliError(`Invalid campaign: ${file}`);
      }
      const { errors, warnings } = checkPublishable(result.campaign, deps.nodeEnv());
      formatIssues(warnings, "!").forEach(deps.err);
      if (errors.length > 0) {
        deps.err(`✗ ${file}: not publishable in this environment`);
        formatIssues(errors).forEach(deps.err);
        throw new CliError(`Campaign not publishable: ${file}`);
      }
      deps.out(`✓ ${file}: campaign "${result.campaign.campaign}" is valid`);
    });

  campaigns
    .command("import")
    .description("Validate a campaign file and store it as a new immutable version")
    .argument("<file>", "campaign JSON file")
    .option("--activate", "make this version the active one", false)
    .option("--imported-by <name>", "who is importing (stored on the version)")
    .action(async (file: string, options: { activate: boolean; importedBy?: string }) => {
      const input = await readCampaignFile(deps, file);
      const result = await deps.withDatabase((db) =>
        importCampaign(db, input, {
          activate: options.activate,
          nodeEnv: deps.nodeEnv(),
          importedBy: options.importedBy ?? null,
        }),
      );
      if (!result.ok) {
        deps.err(`✗ ${file}: import refused, ${result.issues.length} issue(s)`);
        formatIssues(result.issues).forEach(deps.err);
        throw new CliError(`Import refused: ${file}`);
      }
      formatIssues(result.warnings, "!").forEach(deps.err);
      const what = result.outcome === "created" ? "created" : "unchanged, reusing";
      const state = result.active ? "active" : "not active (use --activate)";
      deps.out(`✓ ${file}: ${what} version ${result.version}, ${state}`);
    });

  campaigns
    .command("list")
    .description("List campaigns with their active and latest versions")
    .action(async () => {
      const rows = await deps.withDatabase((db) => listCampaigns(db));
      if (rows.length === 0) {
        deps.out("No campaigns.");
        return;
      }
      for (const row of rows) {
        const active = row.activeVersion === null ? "-" : `v${row.activeVersion}`;
        const trigger = row.isDefault ? "default" : row.keywords.join(", ");
        deps.out(
          `${row.slug}  [${row.status}]  org=${row.organizationSlug}  sender=${row.senderSlug}  active=${active}  latest=v${row.latestVersion}  trigger=${trigger}`,
        );
      }
    });
}
```

- [ ] **Step 6: Registrare i comandi in `src/cli/program.ts`**

Il file completo diventa:

```ts
import { Command } from "commander";
import { VERSION } from "../version";
import { registerCampaignCommands } from "./commands/campaigns";
import { registerOrgCommands } from "./commands/orgs";
import { registerSenderCommands } from "./commands/senders";
import type { CliDeps } from "./deps";

// Later plans register more commands here (simulate, evals, ops).
export function createProgram(deps: CliDeps): Command {
  const program = new Command()
    .name("kubri-bot")
    .description("Kubri Chatbot operations CLI")
    .version(VERSION);
  registerOrgCommands(program, deps);
  registerSenderCommands(program, deps);
  registerCampaignCommands(program, deps);
  return program;
}
```

- [ ] **Step 7: Verificare che passino**

Run: `pnpm test && pnpm test:integration && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 8: Prova a mano sul database di sviluppo** (dopo lo Step 9 del Task 9)

```bash
pnpm cli campaigns validate campaigns/kubri-standard.json
pnpm cli campaigns import campaigns/kubri-standard.json --activate
pnpm cli campaigns import campaigns/kubri-standard.json --activate
pnpm cli campaigns list
NODE_ENV=production pnpm cli campaigns validate campaigns/kubri-standard.json; echo "exit=$?"
```

Expected:
- `validate`: due righe di avviso `! flow[1].textVersion  placeholder_consent: …` e
  `! flow[2].textVersion …`, poi `✓ campaigns/kubri-standard.json: campaign "kubri-standard"
  is valid`.
- Primo `import`: gli stessi avvisi, poi `✓ …: created version 1, active`.
- Secondo `import`: `✓ …: unchanged, reusing version 1, active`.
- `list`: `kubri-standard  [active]  org=kubri  sender=kubri-main  active=v1  latest=v1
  trigger=default`.
- Ultimo comando: `✗ …: not publishable in this environment`, i due errori
  `placeholder_consent`, `Campaign not publishable: …` e `exit=1`.

- [ ] **Step 9: Commit**

```bash
git add src/cli/commands/campaigns.ts src/cli/format-issues.ts src/cli/read-campaign-file.ts src/cli/program.ts tests/unit/cli/program.test.ts tests/unit/cli/campaigns-validate.test.ts tests/integration/cli-campaigns.test.ts
git commit -m "feat(chatbot): add campaigns validate, import and list cli commands"
```

---

### Task 11: Aggiornare spec e CLAUDE.md, chiudere il piano

**Files:**
- Modify: `docs/superpowers/specs/2026-10-24-kubri-chatbot-design.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Aggiungere le decisioni al registro (§2)**

In fondo alla tabella del §2, **dopo le righe D31–D39 del piano 04** se sono già presenti
(altrimenti subito dopo D30, lasciando il buco: i numeri sono riservati), aggiungere:

```markdown
| D50 | Slug del numero | `SenderNumber.slug` univoco, citato da `trigger.sender`; il numero è univoco per (`channel`, `phoneE164`). |
| D51 | Checksum della versione | sha256 del JSON canonico (chiavi ordinate) della definizione parsata, default inclusi. Stesso checksum → nessuna versione nuova; un file uguale a una versione precedente la riusa (con `--activate` è un rollback). |
| D52 | Attivazione | Campagna nuova `paused`; import senza `--activate` non cambia la versione attiva; `--activate` imposta `activeVersionId` e `status = active`. Le colonne di instradamento di `Campaign` copiano la versione attiva (o l'ultima importata finché non ce n'è una). |
| D53 | Collisioni | Parole chiave confrontate in modo esatto (dopo trim e minuscolo) e al più una campagna di default per numero, solo contro le campagne `active` dello stesso numero, a ogni import, in una transazione serializzabile. Le campagne in pausa non collidono. |
| D54 | Organizzazione della campagna | Fissa tra le versioni (`organization_mismatch`); il numero può cambiare. |
| D55 | Consensi segnaposto | `textVersion` `placeholder-…` → errore con `NODE_ENV=production`, avviso altrove, sia in `campaigns import` sia in `campaigns validate`. La CLI contro prod gira con `NODE_ENV=production`. |
| D56 | `providerConfig` | Solo identificativi e nomi di segreti (`phoneNumberId`, `wabaId`, `accessTokenSecret` in UPPER_SNAKE_CASE), schema strict in `src/channels/provider-config.ts`; v1 solo `meta`. |
| D57 | Stato iniziale del numero | `senders add` crea il numero `active` (provisioning manuale); default del DB `provisioning`. |
| D58 | Definizione memorizzata | `CampaignVersion.definition` = definizione parsata in forma canonica; alla lettura si ri-parsa con lo schema (`LoadedCampaign`). |
| D59 | Campagna standard v1 | Costruita dal §6 (export di Make non disponibile, testi da rifinire sul questionario "global"); consensi dell'Appendice A con titolare e link per esteso; `privacyUrl` provvisorio da confermare (§18, punto 5). |
```

- [ ] **Step 2: Allineare il §10.1**

Nel punto **SenderNumber** del §10.1 sostituire la prima riga dell'elenco con:

```markdown
  - `id`, `slug` (citato da `trigger.sender`, D50), `organizationId?`, `channel` (`whatsapp`), `provider` (`meta` | `twilio`), `phoneE164`, `displayName`;
```

- [ ] **Step 3: Documentare i comandi in `CLAUDE.md`**

Nella sezione **Commands** di `CLAUDE.md`, nel blocco `bash`, sostituire la riga
`pnpm cli --help              # kubri-bot CLI` con:

```bash
pnpm cli --help              # kubri-bot CLI
pnpm cli orgs add <slug> --name <name>
pnpm cli senders add <slug> --phone <e164> --name <name> [--org <slug>] \
  --phone-number-id <id> --waba-id <id> --token-secret <SECRET_NAME>
pnpm cli campaigns validate <file>   # no database; exits 1 on issues
pnpm cli campaigns import <file> [--activate] [--imported-by <name>]
pnpm cli campaigns list
```

e aggiungere in fondo all'elenco puntato che segue il blocco:

```markdown
- `campaigns import` creates a new immutable `CampaignVersion` only when the parsed file's
  checksum is new; without `--activate` the active version does not change. Placeholder
  consent versions (`placeholder-…`) are refused when `NODE_ENV=production`: always run the
  CLI against prod with `NODE_ENV=production` (set it in `.env.prod`).
- `--token-secret` takes the **name** of the env var holding the Meta token, never the token.
```

- [ ] **Step 4: Controllo finale**

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration
```

Expected: tutto verde.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-24-kubri-chatbot-design.md CLAUDE.md
git commit -m "docs(chatbot): record campaign registry decisions and cli commands"
```

Niente push e niente PR: il lavoro resta sul branch ombrello `docs/chatbot-spec-into-monorepo`.

---

## Punti aperti lasciati ai piani successivi

- **Regola di instradamento delle parole chiave (piano 08).** Il controllo delle collisioni
  confronta le parole chiave in modo esatto. Se il runtime riconoscerà una parola chiave
  anche *dentro* il primo messaggio ("ciao, acme magazzino"), parole come `acme` e
  `acme magazzino` si sovrapporranno senza collidere. In quel caso `findTriggerCollisions`
  va esteso con la stessa regola del runtime.
- **Pausa e archiviazione.** Mancano comandi `campaigns pause` / `archive`: si potranno
  aggiungere quando servono (piano 11, operazioni).
- **Guardia e `NODE_ENV`.** La guardia dipende dal fatto che chi lancia la CLI contro prod
  imposti `NODE_ENV=production`. Questo va verificato nella guida operativa del piano 11.

