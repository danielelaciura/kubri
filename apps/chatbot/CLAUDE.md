# CLAUDE.md — Kubri Chatbot

## Project

Kubri Chatbot is the **conversational interview engine** that screens job candidates over
WhatsApp for Kubri S.r.l. (Italian Società Benefit). It replaces the Make.com scenario
"Kubri - Whatsapp Bot".

It runs declarative, versioned **campaign questionnaires** over chat, in the candidate's
language, and produces **structured, normalized candidate profiles** that are pushed to the
Kubri platform (the operator dashboard, separate repo `kubri`).

Target users are entry-level candidates (warehouse, cleaning, catering, retail, logistics),
often with language barriers or informal work experience. Clients are social cooperatives,
employment agencies, public employment centers and companies.

This app lives at `apps/chatbot/` (package `@kubri/chatbot`) in the `kubri` pnpm monorepo,
next to `apps/dashboard` and `apps/assessment`. The repo-root `CLAUDE.md` describes the
dashboard; **this file is the rulebook for the chatbot** and overrides it inside `apps/chatbot/`.
The dashboard's conventions (Next.js, shadcn, dictionaries, `src/lib/make/`) do not apply here.

**The design spec is the source of truth:**
`docs/superpowers/specs/2026-10-24-kubri-chatbot-design.md` (inside `apps/chatbot/`, in Italian). Plans are
`docs/superpowers/plans/2026-10-24-*.md`, roadmap first (`…-00-roadmap.md`). Chatbot specs and plans
live here, never in the repo-root `docs/` (that one belongs to the dashboard). Read the relevant
section before working on a module. If code and spec disagree, raise it — don't silently
diverge. Record new decisions in the spec's decision log (§2).

## Guiding principle

**Deterministic flow in code; the LLM interprets language, it never drives the conversation.**

- The conversation state is always `(campaignVersion, phase, stepId, questionId, …)` — never a
  free-form value written by the LLM.
- The LLM returns a typed `Interpretation` (language, intent, patch, completeness). The engine
  decides what happens next.
- The bot is **never silent without a recorded reason**: every turn ends with a reply to the
  candidate or with a logged + flagged error (`needs_attention`).

## Architecture

Modular monolith, TypeScript, one codebase started as two processes:

- **web** — receives the Meta webhook, verifies the signature, dedups by `providerMessageId`,
  stores the message, enqueues a job, returns 200 in milliseconds.
- **worker** — consumes the pg-boss queue: per-contact lock, debounce of message bursts, NLU,
  engine step, transactional persistence, ordered sending, integrations.

### Module boundaries (non-negotiable)

Each external dependency is touched by exactly one module:

| Module | Only it may talk to |
|---|---|
| `channels` | Meta Cloud API (future: Twilio, Telegram) |
| `nlu` | the LLM provider |
| `store` | the database (Prisma) |
| `integrations` | Kubri webhook, PDF rendering |
| `engine` | **nothing** — it is a pure function |

Other modules: `ingress` (HTTP routes), `campaigns` (schema, validation, import, versions),
`profile` (standard schema, custom fields, patch validation, Kubri mapping), `media` (downloads;
future transcription / document extraction), `i18n` (text resolution), `runtime` (worker turn
orchestration), `evals`, `cli`.

### The engine is pure

```ts
step(state, event, campaignVersion) → { state, effects }
```

- No network, no DB, no `Date.now()` (time comes in the event), no randomness.
- Effects are **data** (`SendText`, `ApplyPatch`, `RecordConsent`, `EnqueueJob`, `FlagSession`, …);
  `runtime` executes them.
- Any new behaviour goes in as a new event, effect or step type — never as I/O inside the engine.

## Campaigns

- Campaigns are **JSON files in `campaigns/`**, authored by the Kubri team. No UI.
- A campaign defines the **whole flow** as an ordered list of typed steps
  (`message`, `choice`, `consent`, `questions`, `cv_offer`, `end`). Only the initial `language`
  step and the post-completion phase are fixed in code.
- Every text has a mandatory `it` version; other languages are optional curated translations.
- Fields are either standard-profile fields or `custom.<key>` declared in `customFields`.
- Validation (Zod + semantic checks: references, reachability, cycles, consent versions,
  keyword collisions) runs on import. **An invalid campaign must never reach the database.**
- Routing (D105, D143): the dashboard's links and QR codes prefill `[<pool key>] <text>`, as Make
  expected. The first bracketed token (then the whole message) is matched against the active
  campaigns' keywords on that number (`src/campaigns/route-keyword.ts`); no match → the sender's
  default campaign. So a client campaign's keyword is its pool key. A keyword never replaces an
  interview still running.
- Each import creates an **immutable `CampaignVersion`**. Sessions stay pinned to the version
  they started on. Never mutate a stored version.
- A question whose field is already filled with sufficient confidence is **skipped** — this is
  what handles early answers (and, later, CV import). Don't build parallel skip logic.
- Adding a step type = implement it once in the engine + extend the campaign schema + validator
  + scenario tests.

## NLU / LLM

- All LLM access goes through the `LlmProvider` interface; model is configured **per task**
  (`interpret`, `translate`, `fallback`). Initial candidate provider: Mistral (EU-hosted).
- Structured output only, validated with Zod. Invalid → one repair attempt → `intent: unclear`.
- **Data minimization:** the context sent to the LLM contains the current question, open fields,
  a compact summary of collected fields and the last N messages. Do **not** include name,
  phone, full address or birth date unless that turn needs them. Fields flagged `sensitive`
  (e.g. `workingPermit`) are withheld the same way; personal values in the history become
  `[field]` (spec §8.2, D85, D90).
- Every patch value is validated against its field type in `profile` before touching the profile.
  Low-confidence values trigger a confirmation, not a save.
- Prompts are **versioned files** in `src/nlu/prompts/`. Every call writes an `NluTrace` with the
  prompt version and model.
- **Any change to a prompt, model or the interpretation schema requires running the evals** and
  comparing against the saved baseline before merging.

## Evals

- Evals measure `nlu` quality with scores; tests verify code with pass/fail. Keep them separate.
- Datasets: `evals/datasets/<suite>.jsonl`, **anonymized** (synthetic names, addresses, phones).
  Never commit real candidate data.
- Scorers: deterministic first, structured second, LLM-as-judge only where unavoidable (and
  calibrated against human labels).
- Key metric: **hallucination rate** (fields extracted that the candidate never said). Gates
  (blocking, `evals run` exits 1, `src/evals/gates.ts`, D98):
  - calls: unavailable ≤ 2%, invalid output ≤ 2% of the runs;
  - quality: hallucinations ≤ 1%, intent accuracy ≥ 95%, language accuracy ≥ 95% (cases that
    expect a language: the `language` suite), no language losing more than 2 points against the
    baseline, compared case by case on the ids both runs share, for languages with ≥ 10 of them.
  - A gate with nothing to measure is skipped; a run whose quality gates are **all** skipped
    fails ("no gate applied"). A failing run is never saved as the baseline (except with
    `--force-baseline`).
- A reply still invalid after the repair fails its case (`invalid_output`) and is scored as no
  interpretation at all (wrong intent/language/choice, expected fields missing): evals call
  `interpretContext` directly, never the `Interpreter` that hides it behind `unclear` (D96).
- `--repeat N`: a case passes only if every run passes; accuracies, hallucinations, fields and
  the confusion matrix count every run (D96).
- `evals run` disables the fallback model (it measures the model under test alone) and records
  per run the model that answered (D96).
- The translation judge lives in `nlu` (`src/nlu/judge.ts`), never falls back to another model,
  must differ from `NLU_TRANSLATE_MODEL` and `NLU_FALLBACK_MODEL`, and is trusted only after a
  passing `evals calibrate` for that model, judge prompt and calibration dataset; `evals
  translation` stops at the first grade given by another dated model than the calibrated one
  (D100). It exits 1 when a translation fails or loses its placeholders.
- Per-run reports go in `evals/reports/` (JSON + Markdown) and stay local (gitignored).
  Baselines (`evals/baselines/`) and judge calibrations (`evals/calibration/`) are committed
  (D97).
- **The project owner is learning evals through this project.** When working on evals, explain
  the concept behind each piece (what it measures, why, trade-offs) in plain terms, not just the
  code.

## Database

- Same Postgres as the Kubri dashboard (same Supabase project: dev↔dev, prod↔prod), but **only
  the `bot` schema** (plus `bot_queue` for pg-boss).
- **Never read or write the dashboard's schema** from this app, and never create migrations that
  touch it. Integration with the dashboard is the webhook (see below). Sharing the monorepo does
  not change this: never import from `apps/dashboard` (its Prisma client included) — shared
  code goes in `packages/*`.
- ORM: Prisma, `schema.prisma` covers only the `bot` schema. Raw SQL is allowed only where Prisma
  can't express it (advisory locks, `ON CONFLICT DO NOTHING` dedup) and must live in `store`.
- All IDs are UUIDs.
- Prisma 7 emits unqualified SQL for a single schema: after `prisma migrate dev`, qualify every object with `"bot".` (a unit test enforces it).
- Things that must happen together go in **one transaction**: session state, profile patch +
  `ProfileChange`, `Consent`, message status updates and job enqueueing (transactional outbox).
- A conversation turn is one interactive transaction that holds the contact's advisory lock
  (plan 08, D102): never call the LLM or the network from `store`, and keep `store` functions
  free of that kind of waiting.
- pg-boss uses the **direct / session connection (port 5432)**, `QUEUE_DATABASE_URL`, never the
  transaction pooler: it needs session state. The runtime's advisory locks are transaction-scoped
  (`pg_advisory_xact_lock`) and work behind the pooler too.
- Migrations to prod are applied **manually before** deploying code that needs them (same flow as
  the dashboard). Never `prisma db push` or `migrate reset` against a shared database.

## Integration with the Kubri platform

- The chatbot's own dashboard endpoint (spec §12.1, D130): `POST {KUBRI_BASE_URL}/api/webhooks/chatbot/candidate`,
  `Authorization: Bearer <CHATBOT_WEBHOOK_SECRET>` (same value in both apps), body
  `{ key, externalKey, data }`. Make's webhook (`/api/webhooks/make/candidate`) is not used. The
  payload schema and its example live in `@kubri/contracts` (`chatbotCandidateWebhookSchema`,
  `CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE`), shared with the dashboard: change them there, together
  with the dashboard, never fork them. The example is the contract test.
- `key` = `<Contact.id>:<Campaign.id>`; `externalKey` = the dashboard pool key; `data.channel`
  is always explicit (spec D20–D22). The first send happens when mandatory consents are
  accepted (D24) — before that there is no candidate.
- `data` is the **full, current profile read from the DB when the job runs** (`loadSnapshot`),
  mapped to snake_case keys (`src/integrations/kubri/payload.ts`, spec §12.1) and validated with
  the shared schema before it leaves (a failure is a `KubriContractError`). No coordinates (the
  dashboard geocodes, D124), no CV link. Booleans are real booleans.
- Sent **only on significant events** (`consents.accepted`, `block.completed`,
  `interview.completed`, `profile.updated`) — never per message. The dashboard drops a send
  older than the stored one (`last_updated`).
- 5xx/429/timeout/network/`invalid_response` → pg-boss retry (`KUBRI_WEBHOOK_RETRY_LIMIT`, hours
  of backoff); a redirect, other 4xx, a contract error or the last attempt → dead letter
  (`JobQueue.deadLetter`, with the reason) + flag `kubri_webhook_failed` (D126).
- `src/integrations/` is the only code that calls Kubri or renders PDFs; `runtime` uses it
  through interfaces (`KubriClient`, `renderCv`), so tests use `FakeKubriClient`.
- CV (D127–D131): only when the candidate asks (`cv_offer` "yes" or asking again after the end).
  The `cv` job renders the PDF in memory, uploads it to Meta outside any transaction and queues
  a `document` message under the contact's lock; the requesting `turnId` makes it idempotent. It
  never goes to the dashboard and is never stored. A definitive failure or the last attempt sends
  `cv.failed` once and flags `cv_failed`.

## WhatsApp specifics

- Verify `X-Hub-Signature-256` on every POST; handle the `GET` `hub.challenge` verification.
- Parse **all** entries/changes/messages/statuses in a payload (Make only read the first).
- Dedup on `providerMessageId` (unique). Malformed payloads → `InboundDeadLetter` + 200.
  DB down → 500 so Meta retries.
- Free-form messages only inside the **24h window**; outside it, templates only.
- Classify Meta errors as transient (retry) or permanent (`failed`, stop the rest of the turn).
- Interactive limits: 3 buttons of 20 characters, or a list of 10 rows of 24 (button 20), body 1024:
  enforced in `src/channels/interactive.ts`. Closed questions (language, consent, yes/no, options) go
  out as buttons or lists built by `awaitedChoices` (`src/engine/choices.ts`, pure, derived from the
  state); a tap is understood without the LLM (`interpretReply`). Never add a "send buttons" effect
  to the engine: a new step type that waits for a closed answer extends `awaitedChoices`. Tap ids
  carry their question (`q:<questionId>:yes`, …) so a tap on an old widget is read as text (D114).
- A delivery `failed` never waits on the contact lock inside the webhook: it enqueues
  `report-failure` (D120). Unreadable payloads → `InboundDeadLetter` + 200.
- With `NODE_ENV=production` the worker refuses `--channel console`, `--nlu naive` and
  `--translator fake`. Local end-to-end testing (terminal, dashboard, WhatsApp dev number): `docs/local-test-setup.md`.
- Model data as multi-number / multi-provider from day one (`SenderNumber.provider`), even though
  v1 only implements `meta-cloud`.

## Privacy & security (GDPR — candidate data is sensitive personal data)

1. Consent is a **blocking** step; store key, text version, language, the **exact text shown**,
   data controller, outcome and timestamp. Never record consent before the answer.
2. Consent/privacy texts are never sent as an unreviewed LLM translation alone — include the
   link to the official text and record which text was shown.
3. **No personal data in logs.** Log IDs (`sessionId`, `contactId`, `turnId`), never names,
   phones, addresses or message bodies.
4. Secrets only in env / platform secret manager; the DB stores references, never credentials.
5. CVs are never stored: they are generated in memory and delivered as a WhatsApp document
   (D129). Media, when stored, live in **private storage** behind expiring signed links.
6. Right to be forgotten: `delete-contact` cascades over sessions, messages, profiles, traces
   and media (there are no CV files); keep only minimal consent proof.

## Testing

- **Unit:** engine, campaign validator, conditions, patch validation, Kubri mapping, Meta error
  classification, webhook parser (use real Meta payloads in `tests/fixtures/meta/`).
- **Scenarios:** every campaign in `campaigns/` must have scenario tests (YAML, fake NLU) for at
  least: happy path, declined consent, partial answers, early answer (skip), post-completion
  edit, CV yes/no. They run in CI on every campaign change.
- **Integration:** worker + real Postgres + fake channel + fake LLM (dedup, ordering, debounce,
  locking, rollback, retries, dead letters, 24h window).
- **Contract:** Kubri webhook payload (`buildKubriPayload` must produce the shared example).
- Tests never call the real LLM or Meta. Real-LLM checks belong in evals or the `simulate` CLI.

## Code conventions

- TypeScript **strict**. No `any` — use `unknown` + type guards / Zod.
- Zod at every boundary (webhook input, LLM output, campaign files, outgoing payloads).
- `interface` for object shapes, `type` for unions.
- Files and folders `kebab-case`; types/classes `PascalCase`; functions/variables `camelCase`;
  constants `UPPER_SNAKE_CASE`; Prisma models `PascalCase` singular.
- Code, identifiers and code comments in **English**. Product docs and specs are in **Italian**.
- User-facing bot texts never live in code: campaign texts are in `campaigns/*.json`; system texts
  (welcome, generic errors, "not understood", opt-out confirmations) live in an Italian-first
  system catalog under `src/i18n/`.
- Keep dependencies minimal; justify each new one.

## Git

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Branches `feat/chatbot-…`, `fix/chatbot-…`; scope commits as `feat(chatbot): …`; integrate via
  PR to `main` (branch → push → PR → review → merge).
  Never push directly to `main` unless explicitly told to for that change.

## Commands

**State of the work and next steps (2026-11-02):** `docs/handoff-2026-11-02.md`.

**Trying the whole flow locally** (terminal → LLM → dashboard → WhatsApp, and how the local
Docker database maps to Supabase): `docs/local-test-setup.md`, the single setup guide.

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
pnpm cli orgs add <slug> --name <name>
pnpm cli senders add <slug> --phone <e164> --name <name> [--org <slug>] \
  --phone-number-id <id> --waba-id <id> --token-secret <SECRET_NAME>
pnpm cli campaigns validate <file>   # no database; exits 1 on issues
pnpm cli campaigns import <file> [--activate] [--imported-by <name>]
pnpm cli campaigns list
pnpm cli campaigns simulate <file> [--nlu naive|llm] [--translator fake|llm] [--history 3] [--traces]
pnpm cli evals run --suite <extraction|intent|choice|language> [--prompt <v>] [--model <m>] [--repeat N] [--save-baseline]
pnpm cli evals compare <baseline.json> <candidate.json>
pnpm cli evals calibrate            # check the translation judge against human grades
pnpm cli evals translation          # translate the dataset and grade it with the judge
pnpm cli worker start [--channel console|meta] [--nlu naive|llm] [--translator fake|llm]   # console: replies printed here
pnpm cli inbound send --sender <slug> --from <e164> <text...>    # a candidate writes (stored + queued)
pnpm cli web start                    # WhatsApp webhooks on PORT (needs META_APP_SECRET, META_VERIFY_TOKEN)
pnpm cli worker start --channel meta --nlu llm --translator llm   # replies go to WhatsApp (default: the terminal)
```

- **Kubri (plan 10).** The worker needs `KUBRI_BASE_URL` and `CHATBOT_WEBHOOK_SECRET` (both or
  neither; required with `NODE_ENV=production`). Without them, outside production, it starts with
  a warning and `kubri-webhook` jobs go to `kubri-webhook-dead` with reason `not_configured`.
  Setup and the dev check (shared secret, a real interview, the CV in chat):
  `docs/local-test-setup.md` (level 3). Dead letters:
  `select name, data->>'reason', count(*) from bot_queue.job where name like '%-dead' group by 1, 2;`

- `campaigns import` creates a new immutable `CampaignVersion` only when the parsed file's
  checksum is new; without `--activate` the active version does not change. Placeholder
  consents (`placeholder-…` versions, `[TESTO SEGNAPOSTO]` texts) are only warnings when
  `NODE_ENV` is explicitly `development` or `test`; with `production`, unset or anything else
  they are errors. Always run the CLI against prod with `NODE_ENV=production` (set it in
  `.env.prod`).
- `--token-secret` takes the **name** of the env var holding the Meta token, never the token.
- `campaigns simulate` runs an interview in the terminal on a campaign file, without database
  or WhatsApp. Plain answers go to the interpreter (`naive` = deterministic yes/no, option
  ids, typed values); `/…` commands force any interpretation (`/?` lists them). Texts are
  resolved by `i18n` exactly as runtime will; the fake translator shows `[en] <Italian>`.
  Piped stdin works for scripted runs (`pnpm cli campaigns simulate <file> < transcript.txt`):
  the input lines are echoed so the output reads as a transcript. With `naive`, enum answers
  must be the stored option ids (e.g. `base`, `intermedio`), not the plain phrases the prompt
  offers ("un po'"): mapping phrases is the LLM's job (`--nlu llm`, plan 06). Typing
  "nessuno" saves the literal text; use `/refuse` or `/nlu` for a "none" answer.
- `--nlu llm` / `--translator llm` call Mistral and need `MISTRAL_API_KEY` in `apps/chatbot/.env`
  (gitignored; never in a versioned file). Models: `NLU_INTERPRET_MODEL`, `NLU_TRANSLATE_MODEL`,
  `NLU_FALLBACK_MODEL` (see `.env.example`). Without the key the command stops before the
  interview with one line (`MISTRAL_API_KEY is not set…`); `naive` / `fake` never need it.
  `--traces` prints one line per LLM call on stderr, without prompt or reply; `--history` also
  sets how many earlier messages reach the LLM. Unit tests use `FakeLlmProvider`.
  **Manual check with the real LLM (owner, once the key exists):**
  `pnpm cli campaigns simulate campaigns/kubri-standard.json --nlu llm --translator llm --traces`
  (steps and expected output: plan 06, Task 13 step 9). Note the cases the LLM gets wrong: they
  seed the evals (plan 07).

- `evals` call the real LLM (`MISTRAL_API_KEY`) and cost money: run them on a prompt, model or
  interpretation-schema change, not on every commit. Reports go in `evals/reports/` (local,
  gitignored); baselines in `evals/baselines/` and judge calibrations in `evals/calibration/`
  are committed (all three outside Prettier). `--save-baseline` writes the baseline only when
  the gates pass (`--force-baseline` accepts a worse run on purpose). `evals translation`
  refuses an uncalibrated judge unless `--uncalibrated` (recorded in the report). Datasets are
  **synthetic**: never real candidate data. The judge model (`NLU_JUDGE_MODEL`) must differ
  from `NLU_TRANSLATE_MODEL` and `NLU_FALLBACK_MODEL`.
  First baseline (owner, once the key exists): `pnpm cli evals calibrate`, then
  `pnpm cli evals run --suite <suite> --save-baseline` for each of the four suites.
  **Pending: `interpret-v2` (D144) has no baseline yet.** It is the default prompt; v1 stays
  registered for the comparison. Before merging, for each of the four suites:
  `pnpm cli evals run --suite <suite> --prompt interpret-v1 --save-baseline` (v1 becomes the
  baseline), then `pnpm cli evals run --suite <suite> --save-baseline` (v2, compared with that
  baseline first; it replaces it only if the gates pass; exit 1 = do not merge). No suite scores the
  language of `offTopicReply` / `missing` yet: check it by hand with `campaigns simulate --nlu llm`
  in English.

- Local DB: Docker Postgres on port 54329, databases `kubri_bot_dev` and `kubri_bot_test`.
  Both contain simulated dashboard tables in `public`, which the bot must never touch.
- `DATABASE_URL` must always end with `?schema=bot` (enforced by `src/config/env.ts`);
  `prisma.config.ts` also refuses to run any Prisma command when it is set without it.
- After `pnpm db:migrate`, hand-qualify every generated object with `"bot".` (Prisma 7 emits
  unqualified SQL); `tests/unit/store/migrations.test.ts` fails otherwise. Also check the SQL
  only touches `"bot".` objects before committing.
- Code runs with `tsx` in every environment; there is no JS build step.
- **Worker (plan 08).** `worker start` runs the conversation turns (`process-contact`), the
  sending (`send-messages`, `report-failure`) and plan 10's jobs (`kubri-webhook`, `cv`,
  `geocoding`) on pg-boss; by default replies are printed on the
  terminal (`ConsoleChannel`), with `--channel meta` they go out through Meta's Cloud API
  (plan 09; the web process `web start` receives the webhooks). `inbound send` stores a text message as if it came from
  WhatsApp and enqueues its turn; it needs a running worker to get an answer.
- Required by the worker (it refuses to start, with one line, before connecting):
  - `CONSENT_HASH_SECRET` (≥ 32 chars, HMAC key of `Consent.contactHash`; secret manager, never
    rotated in place). `.env.test` has a dummy one; for a local run set a dev-only value.
  - `QUEUE_DATABASE_URL`: the **direct / session** connection (5432) pg-boss uses: pg-boss
    keeps session state (LISTEN/NOTIFY, its own advisory locks) that the transaction pooler
    (6543) would break. The turn's lock is transaction-scoped (`pg_advisory_xact_lock`) and
    works through either. Only with `NODE_ENV` `development` or `test` it falls back to
    `DATABASE_URL`. `inbound send` needs it too.
- Runtime settings (all optional): `DEBOUNCE_MS`, `DEBOUNCE_MAX_WAIT_MS`, `TURN_NLU_DEADLINE_MS`,
  `SEND_LEASE_MS`, `SEND_MAX_ATTEMPTS`, `WORKER_BATCH_SIZE`, `QUEUE_SCHEMA`. The worker's Prisma
  pool is `4 × WORKER_BATCH_SIZE + 8` connections (`workerPoolSize`: two per job in flight;
  report-failure, kubri-webhook, cv and geocoding run one at a time); send-messages gets at least
  `SEND_MAX_ATTEMPTS − 1` pg-boss retries (`sendRetryLimit`). Tests use `FakeChannel`, a fake
  LLM and either `MemoryJobQueue` or pg-boss on the test database.
- **Manual run (no LLM, no Meta)**, after `pnpm db:up`, with the standard campaign imported and
  activated and the `kubri-main` number created (plan 03). Terminal 1:
  `DEBOUNCE_MS=500 CONSENT_HASH_SECRET=<dev-only, 32+ chars> pnpm cli worker start`.
  Terminal 2: `pnpm cli inbound send --sender kubri-main --from +393331112233 ciao`, then
  `italiano`, then `sì`. Terminal 1 prints `→ +393331112233: …`: the welcome in two languages,
  the campaign's intro and the consent, then the optional consent; `stop` closes the
  conversation. Ctrl-C (or SIGTERM) stops the worker: it stops fetching jobs, waits for the
  running ones up to `workerStopTimeoutMs` (`turnTransactionMs` + 20 s, 90 s by default; the
  hosting grace period must be at least that), then closes the pool. Queued messages are sent at
  the next start. Inspect the
  data with `pnpm exec prisma studio` (`Session`, `Message`, `Consent`, `Turn`).

## Things NOT to do

- Do NOT let the LLM choose the next step or write session state.
- Do NOT put I/O, clocks or randomness inside `engine`.
- Do NOT rewrite the whole profile from LLM output — apply validated patches only, with a
  `ProfileChange` per field.
- Do NOT send the Kubri webhook per message or with pre-turn data.
- Do NOT touch the dashboard's DB schema, or bypass the webhook to write dashboard tables.
- Do NOT edit an imported `CampaignVersion` or an applied migration.
- Do NOT duplicate per-campaign logic in prompts — campaign differences belong in campaign JSON.
- Do NOT commit real candidate data (datasets, fixtures, logs, screenshots).
- Do NOT add a web UI in v1.
- Do NOT build v1-out-of-scope features (Telegram, Twilio, outreach, voice, CV import) beyond the
  predispositions listed in spec §17.

## Open questions

Tracked in spec §18 (second session on the same campaign, official consent texts, retention
periods, follow-up policy, deletion propagation, languages/volumes, CV templates, production
WABA ownership, EU hosting provider and LLM provider). Until official texts exist, consents use
`placeholder-…` text versions that must never reach production. Don't
assume an answer — ask, then record the decision in the spec.
