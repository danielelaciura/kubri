# Piano 01 — Fondamenta

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creare lo scheletro dell'app `apps/chatbot` (`@kubri/chatbot`) nel monorepo `kubri`
con tooling, configurazione, logging, database locale che simula quello condiviso con la
dashboard, Prisma sullo schema `bot`, CLI e CI. Alla fine tutti i controlli sono verdi.

**Monorepo (spec D19).** L'app vive in `apps/chatbot/`, accanto a `apps/dashboard` e
`apps/assessment`. Convenzioni valide per tutto il piano:
- **Tutti i comandi dei task si eseguono da `apps/chatbot/`**, salvo dove è indicato "dalla
  root". `pnpm add` lanciato lì aggiunge la dipendenza solo a `@kubri/chatbot`.
- Il lockfile è unico, `pnpm-lock.yaml` nella root. Per questo i `git add .` dei task si
  intendono come `git add . ../../pnpm-lock.yaml`.
- Le impostazioni di pnpm (`onlyBuiltDependencies`) stanno solo in `pnpm-workspace.yaml` nella
  root: pnpm ignora il campo `pnpm` nel `package.json` di un pacchetto del workspace.
- Il `vitest.config.ts` della root copre solo `packages/*` e l'assessment: il chatbot ha il suo,
  come la dashboard.
- Il chatbot **non ha uno script `build`** (gira con `tsx`), quindi `pnpm -r build` della root
  lo salta.
- Effetto collaterale da conoscere: il `pnpm install` della root, e quindi quello di Vercel per
  la dashboard, installa anche le dipendenze del chatbot ed esegue il suo `postinstall`
  (`prisma generate`, che non richiede il database). Costa qualche secondo di build; se
  diventasse un problema si filtra l'install su Vercel.

**Prerequisito:** lavorare sul branch `feat/chatbot-foundations`, creato da `main` dalla root.

**Architecture:** Monolite modulare TypeScript eseguito con `tsx`, sia in sviluppo sia in
produzione (niente build JS, il typecheck è separato). Prisma 7 con generatore
`prisma-client` e adapter `pg`, con tutti i modelli nello schema Postgres `bot` tramite
`@@schema`. Le migrazioni del bot vengono registrate in `bot._prisma_migrations`: un test di
integrazione lo dimostra su un database che contiene anche le tabelle simulate della dashboard.

**Tech Stack:** Node 22, pnpm 10, TypeScript 5 (strict), Vitest 4, ESLint 9 +
typescript-eslint, Prettier, Zod 4, pino, commander, Prisma 7 (`@prisma/adapter-pg`),
Postgres 16 (Docker), GitHub Actions.

**Spec:** §4.3 (struttura), §10 (schema `bot`, ruoli §10.5), §16 (ambienti e sicurezza).

---

## Mappa dei file

Percorsi relativi ad `apps/chatbot/`, salvo le righe marcate *(root)*.

| File | Responsabilità |
|---|---|
| `package.json`, `.nvmrc`, `.gitignore`, `.prettierrc.json` | metadati, script, tooling |
| *(root)* `package.json` | script `chatbot:cli` e `chatbot:test` per richiamare l'app dalla root |
| *(root)* `.worktreeinclude` | copia `apps/chatbot/.env` nei nuovi worktree |
| *(root)* `CLAUDE.md` | cita la nuova app nella struttura del monorepo |
| `tsconfig.json` | TypeScript strict, risoluzione `Bundler` |
| `vitest.config.ts` | progetti `unit` e `integration` |
| `eslint.config.js` | regole TS strict e **confini dei moduli** |
| `src/version.ts` | versione dell'applicazione |
| `src/config/env.ts` | parsing e validazione delle variabili d'ambiente |
| `src/observability/logger.ts` | logger pino con oscuramento dei dati personali |
| `src/store/connection-string.ts` | conversione dell'URL Prisma in URL per `pg` |
| `src/store/db.ts` | creazione del client Prisma (unico punto) |
| `src/cli/program.ts`, `src/cli/main.ts` | CLI `kubri-bot` |
| `prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/**` | schema `bot` e migrazioni |
| `docker-compose.yml`, `docker/postgres/**` | Postgres locale con la dashboard simulata |
| `.env.example`, `.env.test` | variabili d'ambiente (nessun segreto) |
| `db/roles.sql`, `db/README.md` | ruoli database per Supabase (manuale) |
| *(root)* `.github/workflows/chatbot-ci.yml` | CI del chatbot, attivata solo dai percorsi che lo riguardano |
| `tests/unit/**`, `tests/integration/**` | test |

---

### Task 1: Creare l'app nel workspace

**Files:**
- Create: `package.json`, `.nvmrc`, `.gitignore`, `.prettierrc.json`
- Modify *(root)*: `package.json`, `.worktreeinclude`, `CLAUDE.md`

`apps/chatbot/` contiene già `CLAUDE.md`; spec e piani stanno in `docs/superpowers/` nella root.

- [ ] **Step 1: Creare il branch (dalla root)**

```bash
git switch main && git pull
git switch -c feat/chatbot-foundations
cd apps/chatbot
```

- [ ] **Step 2: Creare `.nvmrc`**

```
22
```

- [ ] **Step 3: Creare `.gitignore`**

```gitignore
node_modules/
coverage/
src/generated/
*.log
.DS_Store

# env files hold secrets; only the example and the local test config are committed
.env*
!.env.example
!.env.test

# local eval runs; committed baselines live in evals/reports/baselines/
evals/reports/*
!evals/reports/baselines/
```

- [ ] **Step 4: Creare `package.json`**

```json
{
  "name": "@kubri/chatbot",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run --project unit",
    "test:watch": "vitest --project unit",
    "test:integration": "vitest run --project integration",
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:status": "prisma migrate status",
    "cli": "tsx --env-file=.env src/cli/main.ts"
  }
}
```

> Niente `packageManager` né `pnpm.onlyBuiltDependencies`: valgono quelli della root
> (`pnpm-workspace.yaml` elenca già `prisma` e `@prisma/engines`).

- [ ] **Step 5: Creare `.prettierrc.json`**

```json
{
  "printWidth": 100
}
```

- [ ] **Step 6: Collegare l'app alla root**

Nel `package.json` della root, aggiungere agli `scripts`:

```json
    "chatbot:cli": "pnpm --filter @kubri/chatbot cli",
    "chatbot:test": "pnpm --filter @kubri/chatbot test",
```

In `.worktreeinclude` della root, aggiungere:

```gitignore
apps/chatbot/.env
```

Nel `CLAUDE.md` della root, nell'albero di "Project Structure", aggiungere sotto `apps/`:

```
│   ├── chatbot/                    ← WhatsApp interview engine (see apps/chatbot/CLAUDE.md)
```

Poi, dalla root: `pnpm install`.
Expected: pnpm riconosce il nuovo pacchetto `@kubri/chatbot`; `pnpm-lock.yaml` si aggiorna.

- [ ] **Step 7: Commit (dalla root)**

```bash
git add apps/chatbot package.json pnpm-lock.yaml .worktreeinclude CLAUDE.md
git commit -m "chore(chatbot): add @kubri/chatbot app to the workspace"
```

---

### Task 2: TypeScript e Vitest

**Files:**
- Create: `tsconfig.json`, `vitest.config.ts`, `src/version.ts`
- Test: `tests/unit/version.test.ts`

- [ ] **Step 1: Installare le dipendenze**

```bash
pnpm add -D typescript @types/node tsx vitest
```

Expected: le dipendenze appaiono in `devDependencies` e viene creato `pnpm-lock.yaml`.

- [ ] **Step 2: Creare `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "tests", "evals", "prisma.config.ts", "vitest.config.ts"]
}
```

> `module: Preserve` + `moduleResolution: Bundler`: il codice gira sempre con `tsx`, quindi
> non servono le estensioni `.js` negli import. È una scelta voluta, vedi l'header del piano.

- [ ] **Step 3: Creare `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/integration/setup-env.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          // Integration tests share one database: run files sequentially.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
```

- [ ] **Step 4: Scrivere il test che fallisce**

`tests/unit/version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { VERSION } from "../../src/version";

describe("VERSION", () => {
  it("is a semver string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 5: Eseguire il test e verificare che fallisca**

Run: `pnpm test`
Expected: FAIL, `Cannot find module '../../src/version'` (oppure "Failed to resolve import").

- [ ] **Step 6: Implementare**

`src/version.ts`:

```ts
export const VERSION = "0.0.0";
```

- [ ] **Step 7: Eseguire test e typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: `1 passed`; `tsc` senza output.

> Il typecheck può segnalare `vitest.config.ts` incluso ma i progetti `integration` puntano a
> file non ancora esistenti: non è un errore di `tsc`, solo di runtime quando si esegue
> `test:integration`. I file arrivano nel Task 7.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "chore: add TypeScript strict config and Vitest projects"
```

---

### Task 3: ESLint (con i confini dei moduli) e Prettier

**Files:**
- Create: `eslint.config.js`, `.prettierignore`

- [ ] **Step 1: Installare**

```bash
pnpm add -D eslint @eslint/js typescript-eslint prettier
```

- [ ] **Step 2: Creare `eslint.config.js`**

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Module boundaries from CLAUDE.md, enforced mechanically.
const ENGINE_FORBIDDEN_IMPORTS = [
  "**/store/**",
  "**/channels/**",
  "**/nlu/**",
  "**/integrations/**",
  "**/runtime/**",
  "**/ingress/**",
  "**/generated/**",
  "@prisma/*",
  "pg",
  "pg-boss",
  "node:*",
];

export default tseslint.config(
  { ignores: ["node_modules/**", "src/generated/**", "coverage/**", "evals/reports/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    // Only the store module talks to the database.
    files: ["src/**/*.ts"],
    ignores: ["src/store/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@prisma/*", "**/generated/**", "pg"],
              message: "Only src/store may access the database (CLAUDE.md).",
            },
          ],
        },
      ],
    },
  },
  {
    // The engine is a pure function: no I/O, no clock, no randomness.
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ENGINE_FORBIDDEN_IMPORTS,
              message: "engine must stay pure (CLAUDE.md).",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", "fetch", "setTimeout", "setInterval", "process"],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Time must come from the event." },
        { object: "Math", property: "random", message: "The engine must be deterministic." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Time must come from the event.",
        },
      ],
    },
  },
  {
    files: ["**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
```

- [ ] **Step 3: Creare `.prettierignore`**

```
node_modules
src/generated
prisma/migrations
pnpm-lock.yaml
evals/reports
```

- [ ] **Step 4: Verificare che la regola del motore funzioni**

Creare temporaneamente `src/engine/lint-probe.ts`:

```ts
export const now = (): number => Date.now();
```

Run: `pnpm lint`
Expected: FAIL, con `no-restricted-properties` e il messaggio "Time must come from the event."

Poi cancellare il file:

```bash
rm src/engine/lint-probe.ts
```

- [ ] **Step 5: Eseguire lint e format**

Run: `pnpm lint && pnpm format && pnpm format:check`
Expected: nessun errore; `All matched files use Prettier code style!`

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: add ESLint with module-boundary rules and Prettier"
```

---

### Task 4: Configurazione dell'ambiente

**Files:**
- Create: `src/config/env.ts`, `.env.example`
- Test: `tests/unit/config/env.test.ts`

L'URL del database **deve** puntare allo schema `bot`. È una protezione contro l'errore più
grave possibile in un database condiviso: scrivere nello schema della dashboard.

- [ ] **Step 1: Installare Zod**

```bash
pnpm add zod
```

- [ ] **Step 2: Scrivere i test che falliscono**

`tests/unit/config/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "../../../src/config/env";

const VALID_URL = "postgresql://postgres:postgres@localhost:54329/kubri_bot_dev?schema=bot";

describe("parseEnv", () => {
  it("parses a valid environment and applies defaults", () => {
    const env = parseEnv({ DATABASE_URL: VALID_URL });

    expect(env).toEqual({
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      DATABASE_URL: VALID_URL,
      PORT: 3000,
    });
  });

  it("coerces PORT to a number", () => {
    expect(parseEnv({ DATABASE_URL: VALID_URL, PORT: "8080" }).PORT).toBe(8080);
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a DATABASE_URL that does not target the bot schema", () => {
    const publicUrl = "postgresql://postgres:postgres@localhost:54329/kubri_bot_dev";
    expect(() => parseEnv({ DATABASE_URL: publicUrl })).toThrow(/schema=bot/);
  });

  it("does not leak the database password in the error message", () => {
    const secretUrl = "postgresql://postgres:s3cr3t@localhost:54329/db";
    let message = "";
    try {
      parseEnv({ DATABASE_URL: secretUrl });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).not.toContain("s3cr3t");
  });
});
```

- [ ] **Step 3: Verificare che falliscano**

Run: `pnpm test tests/unit/config/env.test.ts`
Expected: FAIL, `Cannot find module '../../../src/config/env'`.

- [ ] **Step 4: Implementare**

`src/config/env.ts`:

```ts
import { z } from "zod";

const BOT_SCHEMA = "bot";

function targetsBotSchema(url: string): boolean {
  try {
    return new URL(url).searchParams.get("schema") === BOT_SCHEMA;
  } catch {
    return false;
  }
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is required" })
    .refine(targetsBotSchema, {
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
```

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test tests/unit/config/env.test.ts`
Expected: `5 passed`.

- [ ] **Step 6: Creare `.env.example`**

```dotenv
NODE_ENV=development
LOG_LEVEL=debug
PORT=3000
# Local Docker Postgres (docker-compose.yml). Must always target ?schema=bot.
DATABASE_URL=postgresql://postgres:postgres@localhost:54329/kubri_bot_dev?schema=bot
```

```bash
cp .env.example .env
```

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: validate environment with zod and enforce the bot schema"
```

---

### Task 5: Logger con oscuramento dei dati personali

**Files:**
- Create: `src/observability/logger.ts`
- Test: `tests/unit/observability/logger.test.ts`

- [ ] **Step 1: Installare pino**

```bash
pnpm add pino
```

- [ ] **Step 2: Scrivere i test che falliscono**

`tests/unit/observability/logger.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createLogger } from "../../../src/observability/logger";

function captureLogger() {
  const lines: string[] = [];
  const logger = createLogger({
    level: "info",
    destination: {
      write(message: string) {
        lines.push(message);
      },
    },
  });
  const entries = (): Record<string, unknown>[] =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, entries };
}

describe("createLogger", () => {
  it("redacts personal data at the top level", () => {
    const { logger, entries } = captureLogger();

    logger.info({ phone: "+393331234567", sessionId: "s-1" }, "turn processed");

    expect(entries()[0]).toMatchObject({
      phone: "[REDACTED]",
      sessionId: "s-1",
      msg: "turn processed",
    });
  });

  it("redacts personal data one level deep", () => {
    const { logger, entries } = captureLogger();

    logger.info({ contact: { firstName: "Mario", address: "Via Roma 1", id: "c-1" } });

    expect(entries()[0]?.["contact"]).toEqual({
      firstName: "[REDACTED]",
      address: "[REDACTED]",
      id: "c-1",
    });
  });

  it("redacts message bodies and credentials", () => {
    const { logger, entries } = captureLogger();

    logger.info({ message: { body: "ho la patente" }, authorization: "Bearer x" });

    expect(entries()[0]).toMatchObject({
      message: { body: "[REDACTED]" },
      authorization: "[REDACTED]",
    });
  });

  it("does not add pid and hostname to every line", () => {
    const { logger, entries } = captureLogger();

    logger.info("hello");

    expect(entries()[0]).not.toHaveProperty("pid");
    expect(entries()[0]).not.toHaveProperty("hostname");
  });
});
```

- [ ] **Step 3: Verificare che falliscano**

Run: `pnpm test tests/unit/observability`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 4: Implementare**

`src/observability/logger.ts`:

```ts
import { pino, type DestinationStream, type Logger } from "pino";

// Personal data and credentials must never reach the logs (CLAUDE.md, privacy rule 3).
// Log identifiers (sessionId, contactId, turnId) instead.
const SENSITIVE_KEYS = [
  "phone",
  "phoneE164",
  "firstName",
  "lastName",
  "address",
  "birthday",
  "email",
  "body",
  "text",
  "authorization",
  "accessToken",
  "appSecret",
  "token",
  "secret",
  "password",
] as const;

export const REDACT_PATHS: readonly string[] = SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`]);

export interface LoggerOptions {
  level: string;
  destination?: DestinationStream;
}

export function createLogger({ level, destination }: LoggerOptions): Logger {
  const options = {
    level,
    base: undefined,
    redact: { paths: [...REDACT_PATHS], censor: "[REDACTED]" },
  };
  return destination ? pino(options, destination) : pino(options);
}
```

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test tests/unit/observability && pnpm typecheck && pnpm lint`
Expected: `4 passed`; typecheck e lint puliti.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: add pino logger that redacts personal data"
```

---

### Task 6: Postgres locale e Prisma sullo schema `bot`

**Files:**
- Create: `docker-compose.yml`, `docker/postgres/01-init.sh`, `docker/postgres/sql/dashboard-sim.sql`
- Create: `prisma.config.ts`, `prisma/schema.prisma`, `.env.test`
- Create: `src/store/connection-string.ts`, `src/store/db.ts`
- Test: `tests/unit/store/connection-string.test.ts`

Il Postgres locale **simula il database condiviso**: lo schema `public` contiene una tabella
della "dashboard" e la *sua* `_prisma_migrations`. Il bot non deve toccarle.

- [ ] **Step 1: Creare `docker/postgres/sql/dashboard-sim.sql`**

```sql
-- Simulates the Kubri dashboard, which owns the public schema of the shared database.
-- The bot must never touch these tables (see tests/integration/db-isolation.test.ts).
CREATE TABLE IF NOT EXISTS public.dashboard_sentinel (
  id integer PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS public."_prisma_migrations" (
  id                  varchar(36)  PRIMARY KEY,
  checksum            varchar(64)  NOT NULL,
  finished_at         timestamptz,
  migration_name      varchar(255) NOT NULL,
  logs                text,
  rolled_back_at      timestamptz,
  started_at          timestamptz  NOT NULL DEFAULT now(),
  applied_steps_count integer      NOT NULL DEFAULT 0
);
```

- [ ] **Step 2: Creare `docker/postgres/01-init.sh`**

```sh
#!/bin/sh
# Runs once, on first container start (docker-entrypoint-initdb.d).
set -e

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE kubri_bot_test"

for db in "$POSTGRES_DB" kubri_bot_test; do
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$db" \
    -f /docker-entrypoint-initdb.d/sql/dashboard-sim.sql
done
```

```bash
chmod +x docker/postgres/01-init.sh
```

- [ ] **Step 3: Creare `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: kubri_bot_dev
    ports:
      - "54329:5432"
    volumes:
      - ./docker/postgres:/docker-entrypoint-initdb.d:ro
      - kubri-bot-pg:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      timeout: 3s
      retries: 20

volumes:
  kubri-bot-pg:
```

- [ ] **Step 4: Avviare e verificare**

```bash
pnpm db:up
docker compose exec postgres psql -U postgres -d kubri_bot_test -c '\dt public.*'
```

Expected: le tabelle `_prisma_migrations` e `dashboard_sentinel` compaiono in `public`.

> Se il container esisteva già senza init: `docker compose down -v && pnpm db:up`.

- [ ] **Step 5: Installare Prisma**

```bash
pnpm add @prisma/client @prisma/adapter-pg pg
pnpm add -D prisma dotenv @types/pg
```

Expected: le dipendenze vengono installate. Se pnpm segnala script di build ignorati per
pacchetti Prisma, eseguire `pnpm approve-builds` e approvarli.

- [ ] **Step 6: Creare `prisma.config.ts`**

```ts
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Already-set variables win (dotenv does not override): integration tests and CI pass
// their own DATABASE_URL explicitly.
config({ path: ".env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // ?schema=bot also places Prisma's own _prisma_migrations table in the bot schema,
    // away from the dashboard's one in public.
    url: process.env["DATABASE_URL"] ?? "",
  },
});
```

- [ ] **Step 7: Creare `prisma/schema.prisma`**

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

  @@schema("bot")
}
```

- [ ] **Step 8: Generare il client automaticamente all'install**

Aggiungere in `package.json`, come primo script:

```json
    "postinstall": "prisma generate",
```

Poi:

```bash
pnpm install
```

Expected: `Generated Prisma Client … to ./src/generated/prisma`.

- [ ] **Step 9: Creare la prima migrazione**

```bash
pnpm exec prisma migrate dev --name init_organization
pnpm exec prisma generate
```

Expected: viene creato `prisma/migrations/<timestamp>_init_organization/migration.sql`, che
contiene `CREATE SCHEMA IF NOT EXISTS "bot";` e `CREATE TABLE "bot"."Organization"`. Prima di
proseguire, aprire il file e verificare che **ogni** istruzione riguardi oggetti `"bot".`.
In Prisma 7 `migrate dev` non rigenera il client da solo: per questo c'è `prisma generate`.

Verificare a mano dove è finita la tabella delle migrazioni:

```bash
docker compose exec postgres psql -U postgres -d kubri_bot_dev -c \
  "SELECT table_schema FROM information_schema.tables WHERE table_name = '_prisma_migrations' ORDER BY 1"
docker compose exec postgres psql -U postgres -d kubri_bot_dev -c \
  'SELECT count(*) FROM public."_prisma_migrations"'
```

Expected: due righe (`bot`, `public`); il conteggio in `public` è `0`.

> **STOP se il conteggio in `public` è maggiore di 0** oppure se `bot._prisma_migrations` non
> esiste. Significa che Prisma registra le migrazioni nello schema della dashboard: su un
> database condiviso è un incidente. Non proseguire; segnalare il problema e valutare
> l'alternativa (database Postgres separato per il bot, spec §10).

- [ ] **Step 10: Creare `.env.test`**

```dotenv
NODE_ENV=test
LOG_LEVEL=silent
DATABASE_URL=postgresql://postgres:postgres@localhost:54329/kubri_bot_test?schema=bot
```

> `LOG_LEVEL=silent` non è ammesso da `parseEnv` (che accetta solo i livelli che vogliamo in
> produzione). `.env.test` serve solo a Prisma e ai test di integrazione, che non chiamano
> `parseEnv`.

- [ ] **Step 11: Scrivere il test che fallisce per la stringa di connessione**

`pg` non conosce il parametro `schema` di Prisma. Va tolto prima di passare l'URL all'adapter:
le query sono comunque qualificate con `"bot".` grazie a `@@schema`.

`tests/unit/store/connection-string.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toPgConnectionString } from "../../../src/store/connection-string";

describe("toPgConnectionString", () => {
  it("removes the prisma-only schema parameter", () => {
    expect(toPgConnectionString("postgresql://u:p@localhost:5432/db?schema=bot")).toBe(
      "postgresql://u:p@localhost:5432/db",
    );
  });

  it("keeps the other parameters", () => {
    expect(
      toPgConnectionString("postgresql://u:p@localhost:5432/db?schema=bot&sslmode=require"),
    ).toBe("postgresql://u:p@localhost:5432/db?sslmode=require");
  });
});
```

Run: `pnpm test tests/unit/store`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 12: Implementare**

`src/store/connection-string.ts`:

```ts
// Prisma's `schema` query parameter is meaningless (and potentially rejected) for node-postgres.
export function toPgConnectionString(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete("schema");
  return url.toString();
}
```

`src/store/db.ts`:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { toPgConnectionString } from "./connection-string";

export type Database = PrismaClient;

export function createDatabase(databaseUrl: string): Database {
  const adapter = new PrismaPg({ connectionString: toPgConnectionString(databaseUrl) });
  return new PrismaClient({ adapter });
}
```

- [ ] **Step 13: Verificare**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: tutto verde. Quando l'ultimo parametro viene rimosso, lo standard `URL` elimina
anche il `?`, quindi il primo test passa senza codice aggiuntivo.

- [ ] **Step 14: Commit**

```bash
git add .
git commit -m "feat: add local postgres simulating the shared db and prisma on the bot schema"
```

---

### Task 7: Test di integrazione sull'isolamento dello schema

**Files:**
- Create: `tests/integration/setup-env.ts`, `tests/integration/global-setup.ts`
- Create: `tests/integration/helpers/database.ts`
- Test: `tests/integration/db-isolation.test.ts`

- [ ] **Step 1: Creare `tests/integration/setup-env.ts`**

```ts
import { config } from "dotenv";

config({ path: ".env.test", override: true });
```

- [ ] **Step 2: Creare `tests/integration/global-setup.ts`**

```ts
import { execSync } from "node:child_process";
import { config } from "dotenv";

// Applies all migrations to the test database once per run.
export default function setup(): void {
  config({ path: ".env.test", override: true });
  execSync("pnpm exec prisma migrate deploy", { stdio: "inherit", env: process.env });
}
```

- [ ] **Step 3: Creare `tests/integration/helpers/database.ts`**

```ts
import { createDatabase, type Database } from "../../../src/store/db";

export function testDatabaseUrl(): string {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL missing: is .env.test loaded?");
  return url;
}

export function createTestDatabase(): Database {
  return createDatabase(testDatabaseUrl());
}

// Empties every bot table except the migration history. Test-only raw SQL.
export async function resetBotSchema(db: Database): Promise<void> {
  const tables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'bot' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"bot"."${t.table_name}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}
```

- [ ] **Step 4: Scrivere i test**

`tests/integration/db-isolation.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, resetBotSchema } from "./helpers/database";

const db = createTestDatabase();

beforeEach(async () => {
  await resetBotSchema(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("shared database isolation", () => {
  it("creates bot tables in the bot schema only", async () => {
    const rows = await db.$queryRaw<{ table_schema: string }[]>`
      SELECT table_schema FROM information_schema.tables WHERE table_name = 'Organization'
    `;
    expect(rows.map((r) => r.table_schema)).toEqual(["bot"]);
  });

  it("records migrations in bot._prisma_migrations, never in the dashboard's table", async () => {
    const botRows = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM "bot"."_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    const publicRows = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM public."_prisma_migrations"
    `;
    expect(botRows[0]?.count).toBeGreaterThan(0n);
    expect(publicRows[0]?.count).toBe(0n);
  });

  it("leaves the dashboard tables in place", async () => {
    const rows = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'dashboard_sentinel'
    `;
    expect(rows).toHaveLength(1);
  });

  it("reads and writes an Organization", async () => {
    await db.organization.create({ data: { slug: "kubri", name: "Kubri S.r.l." } });

    const found = await db.organization.findUnique({ where: { slug: "kubri" } });

    expect(found?.name).toBe("Kubri S.r.l.");
  });
});
```

- [ ] **Step 5: Eseguire**

Run: `pnpm test:integration`
Expected: il log di `prisma migrate deploy` mostra `1 migration found` e `All migrations have
been successfully applied`, poi `4 passed`.

> Se il test sulla tabella `_prisma_migrations` fallisce: **STOP**, vale la stessa
> indicazione del Task 6, Step 9.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add .
git commit -m "test: prove bot migrations stay isolated from the dashboard schema"
```

---

### Task 8: Scheletro della CLI

**Files:**
- Create: `src/cli/program.ts`, `src/cli/main.ts`
- Test: `tests/unit/cli/program.test.ts`

- [ ] **Step 1: Installare commander**

```bash
pnpm add commander
```

- [ ] **Step 2: Scrivere i test che falliscono**

`tests/unit/cli/program.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createProgram } from "../../../src/cli/program";
import { VERSION } from "../../../src/version";

function runCli(args: string[]): { output: string; error: unknown } {
  let output = "";
  const program = createProgram()
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
});
```

Run: `pnpm test tests/unit/cli`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Implementare**

`src/cli/program.ts`:

```ts
import { Command } from "commander";
import { VERSION } from "../version";

// Commands are registered here by later plans (campaigns, evals, ops).
export function createProgram(): Command {
  return new Command()
    .name("kubri-bot")
    .description("Kubri Chatbot operations CLI")
    .version(VERSION);
}
```

`src/cli/main.ts`:

```ts
import { createProgram } from "./program";

await createProgram().parseAsync(process.argv);
```

- [ ] **Step 4: Verificare**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm cli --version`
Expected: test verdi; l'ultimo comando stampa `0.0.0`.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: add kubri-bot CLI skeleton"
```

---

### Task 9: CI su GitHub Actions

**Files:**
- Create *(root)*: `.github/workflows/chatbot-ci.yml`

Il monorepo oggi non ha CI. Questo workflow riguarda **solo il chatbot**: parte quando cambiano
`apps/chatbot/`, `packages/` (contratti condivisi) o il lockfile, e lavora in `apps/chatbot`.
Una CI per dashboard e assessment è un lavoro separato.

- [ ] **Step 1: Creare il workflow**

```yaml
name: Chatbot CI

on:
  pull_request:
    paths: &chatbot-paths
      - "apps/chatbot/**"
      - "packages/**"
      - "pnpm-lock.yaml"
      - ".github/workflows/chatbot-ci.yml"
  push:
    branches: [main]
    paths: *chatbot-paths

defaults:
  run:
    working-directory: apps/chatbot

jobs:
  checks:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: kubri_bot_test
        ports:
          - 54329:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 2s
          --health-timeout 3s
          --health-retries 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: apps/chatbot/.nvmrc
          cache: pnpm
      # Installs only the chatbot and the workspace packages it depends on.
      - run: pnpm install --frozen-lockfile --filter @kubri/chatbot...
      - run: pnpm format:check
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - name: Simulate the dashboard tables in the shared database
        run: psql -h localhost -p 54329 -U postgres -d kubri_bot_test -f docker/postgres/sql/dashboard-sim.sql
        env:
          PGPASSWORD: postgres
      - run: pnpm test:integration
```

> `pnpm/action-setup@v4` legge la versione da `packageManager` nel `package.json` della root.
> Gli anchor YAML (`&chatbot-paths`) sono supportati da GitHub Actions; se `actionlint` li
> segnala, ripetere l'elenco dei percorsi.

- [ ] **Step 2: Validare la sintassi in locale (facoltativo)**

Se `actionlint` è installato, dalla root: `actionlint .github/workflows/chatbot-ci.yml`. Altrimenti la verifica
avviene alla prima PR (piano 01 chiuso con PR, vedi Task 11).

- [ ] **Step 3: Commit**

```bash
git add ../../.github/workflows/chatbot-ci.yml
git commit -m "ci(chatbot): run format, lint, typecheck, unit and integration tests"
```

---

### Task 10: Ruoli database per Supabase (manuale)

**Files:**
- Create: `db/roles.sql`, `db/README.md`

Questo script **non viene eseguito in CI né in locale**. Si applica a mano su ogni progetto
Supabase (dev, poi prod) prima del primo deploy, nel piano 11. Va scritto ora perché fissa il
contratto di sicurezza del §10.5.

- [ ] **Step 1: Creare `db/roles.sql`**

```sql
-- Kubri Chatbot database roles (spec §10.5).
-- Apply manually, once per Supabase project, connected as "postgres" on the DIRECT url (5432):
--   psql "$SUPABASE_DIRECT_URL" \
--     -v bot_migrator_password="'…'" -v bot_app_password="'…'" -f db/roles.sql
-- Never commit the passwords.

\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS bot;
CREATE SCHEMA IF NOT EXISTS bot_queue;

-- Owns the bot schema and runs Prisma migrations.
CREATE ROLE bot_migrator LOGIN PASSWORD :bot_migrator_password;
-- Runtime role used by web and worker.
CREATE ROLE bot_app LOGIN PASSWORD :bot_app_password;

ALTER SCHEMA bot OWNER TO bot_migrator;
-- pg-boss creates and maintains its own tables inside bot_queue.
ALTER SCHEMA bot_queue OWNER TO bot_app;

GRANT USAGE ON SCHEMA bot TO bot_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bot_migrator IN SCHEMA bot
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bot_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bot_migrator IN SCHEMA bot
  GRANT USAGE, SELECT ON SEQUENCES TO bot_app;

-- The bot never touches the dashboard's schema.
REVOKE ALL ON SCHEMA public FROM bot_app, bot_migrator;
```

- [ ] **Step 2: Creare `db/README.md`**

````markdown
# Ruoli database

Il bot condivide il Postgres della dashboard Kubri (stesso progetto Supabase), ma vive solo
negli schemi `bot` e `bot_queue` (spec §10).

## Applicazione (una volta per progetto Supabase)

1. Generare due password robuste e salvarle nel gestore dei segreti.
2. Eseguire `db/roles.sql` come utente `postgres` sull'URL diretto (porta 5432).
3. Verificare l'isolamento:

   ```sql
   SET ROLE bot_app;
   SELECT 1 FROM public."Candidate" LIMIT 1;   -- atteso: permission denied
   SELECT 1 FROM bot."Organization" LIMIT 1;    -- atteso: OK (dopo le migrazioni)
   RESET ROLE;
   ```

## Stringhe di connessione

- **Migrazioni** (`bot_migrator`) e **runtime** (`bot_app`): usare la connessione diretta o il
  *session pooler* (porta 5432). pg-boss e i lock advisory non funzionano con il transaction
  pooler (6543).
- Con il pooler Supabase l'utente ha la forma `bot_app.<project-ref>`.
- Aggiungere sempre `?schema=bot` all'URL usato da Prisma.
````

- [ ] **Step 3: Commit**

```bash
git add db
git commit -m "docs: add database roles script for the shared supabase database"
```

---

### Task 11: Aggiornare CLAUDE.md e chiudere il piano

**Files:**
- Modify: `apps/chatbot/CLAUDE.md` (sezione `## Commands`)

- [ ] **Step 1: Sostituire la sezione `## Commands`**

Testo da inserire al posto del paragrafo "Not scaffolded yet…":

````markdown
## Commands

Run from `apps/chatbot/` (or from the repo root with `pnpm --filter @kubri/chatbot <script>`).

```bash
pnpm install                 # run at the repo root; also runs prisma generate
pnpm db:up                   # local Postgres (simulates the db shared with the dashboard)
pnpm db:migrate --name <x>   # new migration on the local dev db (prisma migrate dev)
pnpm db:deploy               # apply pending migrations (prod: run manually before merging)
pnpm db:status               # pending migrations
pnpm test                    # unit tests
pnpm test:integration        # integration tests (needs pnpm db:up)
pnpm typecheck && pnpm lint && pnpm format:check
pnpm cli --help              # kubri-bot CLI
```

- Local DB: Docker Postgres on port 54329, databases `kubri_bot_dev` and `kubri_bot_test`.
  Both contain simulated dashboard tables in `public`, which the bot must never touch.
- `DATABASE_URL` must always end with `?schema=bot` (enforced by `src/config/env.ts`).
- Code runs with `tsx` in every environment; there is no JS build step.
- New migrations: check the generated SQL only touches `"bot".` objects before committing.
````

- [ ] **Step 2: Controllo finale completo**

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration
```

Expected: tutto verde.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document commands in CLAUDE.md"
```

- [ ] **Step 4: Pubblicare e aprire la PR**

```bash
git push -u origin feat/chatbot-foundations
gh pr create --base main --title "feat(chatbot): foundations (plan 01)" \
  --body "Piano 01 (docs/superpowers/plans/2026-10-24-chatbot-01-foundations.md)."
```

Verificare che il workflow "Chatbot CI" parta e sia verde. Ogni piano successivo lavora su un
proprio branch `feat/…` e si chiude con una PR (CLAUDE.md, sezione Git).
