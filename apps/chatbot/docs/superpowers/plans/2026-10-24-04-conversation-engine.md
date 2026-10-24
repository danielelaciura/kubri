# Piano 04 — Motore conversazionale e scenari

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire il cuore del chatbot: la funzione pura
`step(state, event, campaign) → { state, effects }` che fa avanzare un'intervista
(fase della lingua, passaggi della campagna, fase dopo il completamento) e un harness di
**scenari YAML** con NLU finta che verifica conversazioni intere su una campagna di test e,
dopo il piano 03, sulla campagna standard Kubri.

**Architecture:** Tutto il codice di `src/engine/` è **puro**: niente database, rete, file
system, orologio o casualità (le regole di lint lo impongono). Il motore riceve la
`CampaignDefinition` già validata (piano 02), uno `SessionState` serializzabile e un
`EngineEvent` che porta l'ora. Restituisce il nuovo stato e una lista di **effetti come dati**
(`SendText`, `ApplyPatch`, `RecordConsent`, `EnqueueJob`, `FlagSession`, …) che il runtime
(piano 08) eseguirà. I testi non vengono risolti: gli effetti portano un `TextRef` (testo della
campagna, testo di un passaggio, chiave del catalogo di sistema) che i18n risolverà nel piano 05.
Internamente ogni chiamata lavora su un accumulatore locale (`Turn`): le funzioni del motore lo
modificano, ma l'oggetto non esce mai da `step()`, che resta deterministica. Il motore riusa
`resolveTransition`, `evaluateCondition` e `validatePatch` del piano 02; l'unica aggiunta a
`src/campaigns` è l'helper puro `nextEligibleStep`.

**Tech Stack:** TypeScript strict, Zod 4, Vitest 4, `yaml` (solo per i test degli scenari).

**Spec:** §5 (campagna, §5.3 salto dei campi, §5.4 transizioni, §5.6 lingua, §5.7 dopo il
completamento), §7 (motore), §8.3 (`Interpretation`), §10.6 (soglia dei consensi, D24), §13
(errori del motore), §14 (scenari), §18 punto 13 (`@end`).

**Prerequisito:** piani 01 e 02 completati. Si lavora **direttamente sul branch ombrello
`docs/chatbot-spec-into-monorepo`**: nessun branch nuovo, niente merge su `main`, nessuna PR (la
PR bozza #66 la aggiorna il controller). Tutti i comandi si eseguono da `apps/chatbot/`.

```bash
git switch docs/chatbot-spec-into-monorepo
cd apps/chatbot
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: tutto verde prima di iniziare.

**Regola valida per ogni task:** un task si chiude solo quando
`pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` è verde. Se `format:check`
fallisce sui file appena scritti, eseguire `pnpm exec prettier --write <file>` e ripetere: è
solo formattazione, non cambia il codice.

---

## Decisioni prese in questo piano (da riportare nella spec, §2, come D31–D47)

- **D31 — Profilo nello stato del motore.** `SessionState.profile` è un'istantanea
  `campo → { value, confidence, status }`. Il motore la legge (condizioni, salto delle domande)
  e la aggiorna insieme a ogni `ApplyPatch`. `CandidateProfile` resta la fonte di verità: il
  runtime (piano 08) idrata l'istantanea prima di `step()` e salva gli effetti. Così la firma resta
  a tre argomenti, come nella spec, e `step()` resta pura e deterministica.
- **D32 — `Interpretation` definita dal motore** in `src/engine/interpretation.ts` (schema Zod
  stretto: chiavi sconosciute rifiutate); `nlu` la produrrà nel piano 06. `interpretation: null`
  nell'evento significa "NLU non disponibile".
- **D33 — Testi per riferimento.** Gli effetti portano un `TextRef`: `campaign` (chiave di
  `texts`), `step` (testo inline di un passaggio, con il percorso `stepId[.questionId]`),
  `system` (chiave tipizzata del catalogo di sistema, scritto nel piano 05), `generated` (testo
  dell'LLM già nella lingua del candidato, solo per le risposte fuori contesto).
- **D34 — Soglia di confidenza unica, 0,7** (`CONFIDENCE_THRESHOLD`). Un campo è
  "valorizzato" se non è `unresolved` e la sua confidenza è ≥ 0,7. Soglie per campo: in futuro.
- **D35 — Applicazione delle patch.** Le patch si applicano solo dopo la soglia dei consensi.
  L'estrazione non sovrascrive mai un campo già valorizzato, **tranne il campo della domanda
  corrente** (serve a completare una risposta parziale); le altre modifiche passano da
  `edit_request`. Un valore sotto soglia chiede conferma solo se riguarda il campo della domanda
  corrente; gli altri valori sotto soglia si scartano (il campo verrà chiesto più avanti).
- **D36 — Conferme sì/no.** "sì" applica; "no" annulla e ripete la domanda; qualunque altra
  risposta fa decadere la conferma e il messaggio viene elaborato come una risposta normale.
- **D37 — `@end`** (risolve §18.13): `@end` va al **primo `end` idoneo** (con `when` vera o
  assente) **dalla posizione corrente in avanti**; se non c'è, `system.closing` (con
  `CompleteSession`). La stessa regola vale quando il `flow` finisce. Prima della soglia dei
  consensi `@end` non crea un candidato: testo di chiusura + stop con cancellazione
  (`StopSession { reason: "ended_before_consent", dataPolicy: "delete" }`).
- **D38 — Soglia D24 nel motore.** `consentsAccepted` diventa vero al primo consenso
  obbligatorio accettato, ed è lì che parte l'evento `consents.accepted` verso Kubri. Il rifiuto
  di un consenso obbligatorio lo riporta a falso prima del `@stop`, quindi i dati si cancellano.
- **D39 — Politica dei dati alla chiusura.** `@stop`: `delete` prima della soglia,
  `onStop.data` della campagna dopo. `delete_data`: sempre `delete` più il job `delete-contact`.
  `opt_out` dopo il completamento non cancella nulla: registra `OptOut` e chiude la conversazione.
- **D40 — Intenti globali deterministici.** Il messaggio intero, normalizzato, deve coincidere
  con una frase dell'elenco (`stop`, `basta`, `cancella i miei dati`, …). La parola chiave ha la
  precedenza sull'LLM. Gli intenti globali valgono in ogni fase, anche `closed`, così la
  cancellazione resta sempre possibile.
- **D41 — Fase della lingua (parte deterministica).** Ordine: nome di una lingua nel testo
  (tabella) → lingua rilevata dall'LLM con confidenza ≥ 0,8 → `defaultLanguage` della campagna.
  Il punto 3 del §5.6 (proposta della lingua dal primo messaggio) è rinviato al piano 06.
- **D42 — "Sezione N di M".** M conta i blocchi `questions` la cui `when` non è falsa in quel
  momento; può quindi cambiare man mano che il profilo si riempie.
- **D43 — Approfondimenti.** `partial` chiede un approfondimento anche se il campo ha già un
  valore (entro `maxClarifications`); `refusal` su una domanda facoltativa la salta subito;
  `off_topic` e `help` non consumano approfondimenti.
- **D44 — Rigenerazione del CV dopo il completamento.** L'NLU, in modalità post-intervista,
  restituisce `intent: choice, choice: "regenerate_cv"`. Se `allowCvRegeneration` è vero il motore
  ripropone il primo passaggio `cv_offer` del `flow`; se la campagna non ne ha, risponde con
  l'aiuto post-intervista.
- **D45 — Errori del motore.** Stato incoerente o più di 20 avanzamenti automatici: lo stato
  resta invariato, il motore invia `system.generic_error` ed emette
  `FlagSession { needsAttention: true }`. L'evento `timeout` non produce effetti nella v1
  (follow-up fuori perimetro, §17).
- **D46 — Scenari.** File YAML in `tests/scenarios/<campagna>/`, eseguiti dal nuovo progetto
  Vitest `scenarios`, incluso in `pnpm test` (quindi in CI). L'NLU finta è l'interpretazione
  scritta nello YAML. Dipendenza di sviluppo `yaml`: parser YAML 1.2 senza dipendenze, con i tipi
  inclusi.
- **D47 — Nome dell'evento della soglia.** L'evento verso Kubri al superamento della soglia si
  chiama `consents.accepted` (come nel §12.1). `CLAUDE.md` lo chiama ancora `session.started`: da
  allineare.

## Mappa dei file

| File | Responsabilità |
|---|---|
| `src/campaigns/schema/steps.ts` | (modifica) alias dei tipi `ChoiceStep`, `ConsentStep`, `QuestionsStep`, `CvOfferStep` |
| `src/campaigns/flow.ts` | (modifica) `nextEligibleStep`: primo passaggio con `when` vera |
| `src/engine/interpretation.ts` | schema e tipo `Interpretation` (§8.3), `isChoice` |
| `src/engine/text-ref.ts` | `TextRef`, chiavi del catalogo di sistema, `stepTextRef`, `describeTextRef`, `toTextParam` |
| `src/engine/profile-snapshot.ts` | istantanea del profilo, soglia di confidenza, campi valorizzati |
| `src/engine/state.ts` | `SessionState`, conferme in sospeso, stato iniziale, contesto delle condizioni |
| `src/engine/events.ts` | `EngineEvent` |
| `src/engine/effects.ts` | `Effect` e tipi collegati |
| `src/engine/describe.ts` | descrizione compatta di un effetto, senza dati personali |
| `src/engine/progress.ts` | "Sezione N di M" |
| `src/engine/normalize-text.ts` | normalizzazione del testo per i confronti deterministici |
| `src/engine/global-intents.ts` | parole chiave di `opt_out` / `delete_data` e loro gestione |
| `src/engine/language.ts` | riconoscimento dei nomi delle lingue e scelta della lingua |
| `src/engine/turn.ts` | accumulatore del turno, `EngineError`, accesso al passaggio corrente |
| `src/engine/blocks.ts` | prossima domanda da porre in un blocco |
| `src/engine/advance.ts` | ingresso nei passaggi, avanzamento automatico, transizioni, `@end`, `@stop` |
| `src/engine/replies.ts` | domanda corrente, riproposta, risposta a un non-risposta |
| `src/engine/language-phase.ts` | turno nella fase della lingua |
| `src/engine/choice-answers.ts` | risposte a `choice` e `cv_offer` |
| `src/engine/consent-answer.ts` | risposte a `consent` e soglia dei consensi |
| `src/engine/patches.ts` | applicazione delle patch estratte |
| `src/engine/question-answer.ts` | risposte alle domande, approfondimenti, `unresolved` |
| `src/engine/confirmations.ts` | conferme dei valori a bassa confidenza e delle modifiche |
| `src/engine/edits.ts` | richieste di modifica |
| `src/engine/flow-turn.ts` | turno nella fase `flow` |
| `src/engine/post-completion.ts` | turno nella fase `post_completion` |
| `src/engine/step.ts` | `step()`, il punto d'ingresso |
| `tests/unit/engine/helpers.ts` | stati, interpretazioni ed eventi di comodo per i test |
| `tests/scenarios/harness/scenario.ts` | schema Zod di uno scenario YAML (NLU finta) |
| `tests/scenarios/harness/run.ts` | esecuzione di uno scenario |
| `tests/scenarios/scenarios.test.ts` | carica ed esegue tutti gli scenari |
| `tests/scenarios/campaigns/test-campaign.json` | campagna di test con campi personalizzati e condizioni |
| `tests/scenarios/test-campaign/*.yaml` | scenari della campagna di test |
| `tests/scenarios/kubri-standard/*.yaml` | scenari della campagna standard (richiede il piano 03) |

---

### Task 1: `Interpretation`

**Files:**
- Create: `src/engine/interpretation.ts`
- Test: `tests/unit/engine/interpretation.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/interpretation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  InterpretationSchema,
  isChoice,
  type Interpretation,
} from "../../../src/engine/interpretation";

const valid = {
  language: { code: "it", confidence: 0.98 },
  intent: "answer",
  patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "mi chiamo Mario" }],
  currentQuestion: { completeness: "complete" },
};

describe("InterpretationSchema", () => {
  it("accepts the spec §8.3 shape", () => {
    expect(InterpretationSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts the optional fields", () => {
    const result = InterpretationSchema.safeParse({
      ...valid,
      intent: "edit_request",
      choice: "yes",
      currentQuestion: { completeness: "partial", missing: "cognome" },
      editTarget: { field: "firstName", newValue: "Marco" },
      offTopicReply: "Sono qui per il colloquio di lavoro.",
    });
    expect(result.success).toBe(true);
  });

  it.each(["chat", "", "ANSWER"])("rejects intent %j", (intent) => {
    expect(InterpretationSchema.safeParse({ ...valid, intent }).success).toBe(false);
  });

  it("rejects a confidence outside 0..1", () => {
    const result = InterpretationSchema.safeParse({
      ...valid,
      language: { code: "it", confidence: 1.2 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys: the LLM never chooses the next step", () => {
    expect(InterpretationSchema.safeParse({ ...valid, nextStep: "fine" }).success).toBe(false);
  });

  it("requires the patch array, even when empty", () => {
    const { patch: _patch, ...withoutPatch } = valid;
    expect(InterpretationSchema.safeParse(withoutPatch).success).toBe(false);
  });
});

describe("isChoice", () => {
  const choice = (id: string): Interpretation =>
    InterpretationSchema.parse({ ...valid, intent: "choice", choice: id });

  it("matches the chosen option", () => {
    expect(isChoice(choice("yes"), "yes")).toBe(true);
    expect(isChoice(choice("no"), "yes")).toBe(false);
  });

  it("is false for other intents and without an interpretation", () => {
    expect(isChoice(InterpretationSchema.parse({ ...valid, choice: "yes" }), "yes")).toBe(false);
    expect(isChoice(null, "yes")).toBe(false);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/interpretation.test.ts`
Expected: FAIL, il modulo `src/engine/interpretation` non esiste.

- [ ] **Step 3: Implementare**

`src/engine/interpretation.ts`:

```ts
import { z } from "zod";
import { LanguageCodeSchema } from "../i18n/localized-text";

export const INTENTS = [
  "answer",
  "choice",
  "off_topic",
  "edit_request",
  "refusal",
  "help",
  "opt_out",
  "delete_data",
  "unclear",
] as const;
export type Intent = (typeof INTENTS)[number];

export const COMPLETENESS = ["complete", "partial", "absent"] as const;
export type Completeness = (typeof COMPLETENESS)[number];

const ConfidenceSchema = z.number().min(0).max(1);

/**
 * What nlu understood of one turn (spec §8.3). The engine owns this contract and nlu (plan 06)
 * produces it, so engine never imports from nlu. Patch values stay `unknown` here: they are
 * validated against the field types by `validatePatch` before touching the profile.
 */
export const InterpretationSchema = z.strictObject({
  language: z.strictObject({ code: LanguageCodeSchema, confidence: ConfidenceSchema }),
  intent: z.enum(INTENTS),
  /** For choice, consent and cv_offer steps, and for yes/no confirmations. */
  choice: z.string().min(1).optional(),
  patch: z.array(
    z.strictObject({
      field: z.string().min(1),
      value: z.unknown(),
      confidence: ConfidenceSchema,
      evidence: z.string(),
    }),
  ),
  currentQuestion: z.strictObject({
    completeness: z.enum(COMPLETENESS),
    missing: z.string().min(1).optional(),
  }),
  editTarget: z.strictObject({ field: z.string().min(1), newValue: z.unknown() }).optional(),
  offTopicReply: z.string().trim().min(1).optional(),
});
export type Interpretation = z.infer<typeof InterpretationSchema>;

/** True when the turn picked `choice` (an option id, "yes", "accepted", ...). */
export function isChoice(interpretation: Interpretation | null, choice: string): boolean {
  return interpretation?.intent === "choice" && interpretation.choice === choice;
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/engine/interpretation.ts tests/unit/engine/interpretation.test.ts
git commit -m "feat(chatbot): define the engine interpretation contract"
```

---

### Task 2: Riferimenti ai testi (`TextRef`)

**Files:**
- Create: `src/engine/text-ref.ts`
- Test: `tests/unit/engine/text-ref.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/text-ref.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  describeTextRef,
  stepTextRef,
  toTextParam,
  type TextParamValue,
  type TextRef,
} from "../../../src/engine/text-ref";

describe("stepTextRef", () => {
  it("keeps an inline text with the path of its step", () => {
    expect(stepTextRef({ it: "Ciao!" }, "intro")).toEqual({
      kind: "step",
      path: "intro",
      text: { it: "Ciao!" },
    });
  });

  it("turns a {ref} into a campaign text reference", () => {
    expect(stepTextRef({ ref: "cv_explain" }, "cv_info")).toEqual({
      kind: "campaign",
      key: "cv_explain",
    });
  });

  it("carries params only when given", () => {
    expect(stepTextRef({ it: "Ciao {name}" }, "intro", { name: "x" })).toEqual({
      kind: "step",
      path: "intro",
      text: { it: "Ciao {name}" },
      params: { name: "x" },
    });
    expect(stepTextRef({ ref: "cv_explain" }, "cv_info")).not.toHaveProperty("params");
  });
});

describe("describeTextRef", () => {
  it.each([
    [{ kind: "campaign", key: "cv_explain" }, "texts.cv_explain"],
    [{ kind: "step", path: "anagrafica.nome", text: { it: "Come ti chiami?" } }, "anagrafica.nome"],
    [{ kind: "system", key: "system.welcome" }, "system.welcome"],
    [{ kind: "generated", text: "Sono qui per il colloquio." }, "generated"],
  ] as [TextRef, string][])("%j → %s", (ref, id) => {
    expect(describeTextRef(ref)).toBe(id);
  });
});

describe("toTextParam", () => {
  it.each([
    ["Mario", "Mario"],
    [3, 3],
    [true, true],
    [null, null],
    [undefined, null],
    [["B", "C"], ["B", "C"]],
    [{ a: 1 }, '{"a":1}'],
    [[1, 2], "[1,2]"],
  ] as [unknown, TextParamValue][])("%j → %j", (value, expected) => {
    expect(toTextParam(value)).toEqual(expected);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/text-ref.test.ts`
Expected: FAIL, il modulo `src/engine/text-ref` non esiste.

- [ ] **Step 3: Implementare**

`src/engine/text-ref.ts`:

```ts
import type { TextValue } from "../campaigns/schema/steps";
import type { LocalizedText } from "../i18n/localized-text";

/**
 * Keys of the system catalog. Plan 05 writes the Italian-first texts under src/i18n; the
 * engine only names them and never resolves a text.
 */
export const SYSTEM_TEXT_KEYS = [
  "system.welcome",
  "system.not_understood",
  "system.generic_error",
  "system.help",
  "system.off_topic",
  "system.progress",
  "system.confirm_value",
  "system.confirm_edit",
  "system.edit_saved",
  "system.edit_cancelled",
  "system.edit_invalid",
  "system.edit_not_allowed",
  "system.post_completion_help",
  "system.cv_requested",
  "system.opt_out_confirm",
  "system.delete_confirm",
  "system.stopped",
  "system.closing",
  "system.session_closed",
] as const;
export type SystemTextKey = (typeof SYSTEM_TEXT_KEYS)[number];

export type TextParamValue = string | number | boolean | null | readonly string[];
export type TextParams = Readonly<Record<string, TextParamValue>>;

/** A text to send, by reference: i18n (plan 05) resolves it in the session language. */
export type TextRef =
  /** An entry of the campaign's `texts` map. */
  | { readonly kind: "campaign"; readonly key: string; readonly params?: TextParams }
  /** An inline text of a step; `path` is "stepId", "stepId.questionId" or "stepId.title". */
  | {
      readonly kind: "step";
      readonly path: string;
      readonly text: LocalizedText;
      readonly params?: TextParams;
    }
  | { readonly kind: "system"; readonly key: SystemTextKey; readonly params?: TextParams }
  /** Written by the LLM in the candidate's language (off-topic replies): sent as is. */
  | { readonly kind: "generated"; readonly text: string };

function isRef(value: TextValue): value is { ref: string } {
  return "ref" in value && typeof value.ref === "string";
}

export function stepTextRef(value: TextValue, path: string, params?: TextParams): TextRef {
  if (isRef(value)) {
    return params ? { kind: "campaign", key: value.ref, params } : { kind: "campaign", key: value.ref };
  }
  return params ? { kind: "step", path, text: value, params } : { kind: "step", path, text: value };
}

/** A stable, log-safe id: never the text itself (generated texts may echo personal data). */
export function describeTextRef(ref: TextRef): string {
  switch (ref.kind) {
    case "campaign":
      return `texts.${ref.key}`;
    case "step":
      return ref.path;
    case "system":
      return ref.key;
    case "generated":
      return "generated";
  }
}

/** Profile values are validated scalars or string lists; anything else is serialized. */
export function toTextParam(value: unknown): TextParamValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) && value.every((item): item is string => typeof item === "string")) {
    return value;
  }
  return JSON.stringify(value);
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/engine/text-ref.ts tests/unit/engine/text-ref.test.ts
git commit -m "feat(chatbot): reference engine texts without resolving them"
```

---

### Task 3: Istantanea del profilo e soglia di confidenza

**Files:**
- Create: `src/engine/profile-snapshot.ts`
- Test: `tests/unit/engine/profile-snapshot.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/profile-snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_THRESHOLD,
  fieldState,
  isFieldFilled,
  isFieldSettled,
  profileValues,
  withField,
  type ProfileSnapshot,
} from "../../../src/engine/profile-snapshot";

const profile: ProfileSnapshot = {
  firstName: { value: "Mario", confidence: 0.9, status: "inferred" },
  lastName: { value: "Rossi", confidence: 0.4, status: "inferred" },
  drivingLicense: { value: false, confidence: 1, status: "confirmed" },
  workingPermit: { value: null, confidence: 0, status: "unresolved" },
};

describe("profile snapshot", () => {
  it("uses 0.7 as the confidence threshold (D34)", () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.7);
  });

  it("reads own fields only", () => {
    expect(fieldState(profile, "firstName")?.value).toBe("Mario");
    expect(fieldState(profile, "constructor")).toBeUndefined();
  });

  it.each([
    ["firstName", true],
    ["drivingLicense", true],
    ["lastName", false],
    ["workingPermit", false],
    ["email", false],
  ])("isFieldFilled(%s) = %s", (field, expected) => {
    expect(isFieldFilled(profile, field)).toBe(expected);
  });

  it("treats unresolved fields as settled: they are not asked again", () => {
    expect(isFieldSettled(profile, "workingPermit")).toBe(true);
    expect(isFieldSettled(profile, "lastName")).toBe(false);
  });

  it("exposes values to conditions, without unresolved fields", () => {
    expect(profileValues(profile)).toEqual({
      firstName: "Mario",
      lastName: "Rossi",
      drivingLicense: false,
    });
  });

  it("returns a new snapshot", () => {
    const next = withField(profile, "email", {
      value: "a@b.it",
      confidence: 0.9,
      status: "inferred",
    });
    expect(next.email?.value).toBe("a@b.it");
    expect(profile).not.toHaveProperty("email");
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/profile-snapshot.test.ts`
Expected: FAIL, il modulo `src/engine/profile-snapshot` non esiste.

- [ ] **Step 3: Implementare**

`src/engine/profile-snapshot.ts`:

```ts
/** Spec §6: state kept next to each value. */
export type FieldStatus = "confirmed" | "inferred" | "unresolved";

export interface FieldState {
  readonly value: unknown;
  readonly confidence: number;
  readonly status: FieldStatus;
}

/** Field ref ("firstName", "custom.x") → state. Flat, like the profile itself (D25). */
export type ProfileSnapshot = Readonly<Record<string, FieldState>>;

/** Below this an extracted value is not saved: the engine asks for a confirmation (D34). */
export const CONFIDENCE_THRESHOLD = 0.7;

export function fieldState(profile: ProfileSnapshot, field: string): FieldState | undefined {
  return Object.hasOwn(profile, field) ? profile[field] : undefined;
}

/** "Already filled with sufficient confidence" (spec §5.3). */
export function isFieldFilled(profile: ProfileSnapshot, field: string): boolean {
  const state = fieldState(profile, field);
  return (
    state !== undefined && state.status !== "unresolved" && state.confidence >= CONFIDENCE_THRESHOLD
  );
}

/** Filled, or given up on (unresolved): either way the question is not asked again. */
export function isFieldSettled(profile: ProfileSnapshot, field: string): boolean {
  return isFieldFilled(profile, field) || fieldState(profile, field)?.status === "unresolved";
}

/** The values conditions are evaluated on. */
export function profileValues(profile: ProfileSnapshot): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [field, state] of Object.entries(profile)) {
    if (state.status !== "unresolved") values[field] = state.value;
  }
  return values;
}

export function withField(
  profile: ProfileSnapshot,
  field: string,
  state: FieldState,
): ProfileSnapshot {
  return { ...profile, [field]: state };
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/engine/profile-snapshot.ts tests/unit/engine/profile-snapshot.test.ts
git commit -m "feat(chatbot): add the engine profile snapshot and confidence threshold"
```

---

### Task 4: Stato, eventi, effetti e helper dei test

**Files:**
- Create: `src/engine/state.ts`, `src/engine/events.ts`, `src/engine/effects.ts`,
  `src/engine/describe.ts`, `tests/unit/engine/helpers.ts`
- Test: `tests/unit/engine/state.test.ts`, `tests/unit/engine/describe.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { conditionContext, initialSessionState } from "../../../src/engine/state";

describe("initialSessionState", () => {
  it("starts in the language phase with nothing collected", () => {
    expect(initialSessionState()).toEqual({
      phase: "language",
      stepId: null,
      questionId: null,
      clarifications: 0,
      pendingConfirmation: null,
      outcomes: {},
      language: null,
      consentsAccepted: false,
      profile: {},
    });
  });
});

describe("conditionContext", () => {
  it("exposes profile values and step outcomes, without unresolved fields", () => {
    const state = {
      ...initialSessionState(),
      outcomes: { cv_info: "yes" },
      profile: {
        drivingLicense: { value: true, confidence: 1, status: "confirmed" as const },
        workingPermit: { value: null, confidence: 0, status: "unresolved" as const },
      },
    };
    expect(conditionContext(state)).toEqual({
      values: { drivingLicense: true },
      outcomes: { cv_info: "yes" },
    });
  });
});
```

`tests/unit/engine/describe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { describeEffect } from "../../../src/engine/describe";
import type { Effect } from "../../../src/engine/effects";

const AT = "2026-10-24T10:00:00.000Z";

describe("describeEffect", () => {
  it.each([
    [{ type: "SendText", text: { kind: "system", key: "system.welcome" } }, "SendText:system.welcome"],
    [
      {
        type: "ApplyPatch",
        source: "extraction",
        fields: [
          { field: "firstName", value: "Mario", confidence: 0.9, status: "inferred" },
          { field: "drivingLicense", value: true, confidence: 0.9, status: "inferred" },
        ],
      },
      "ApplyPatch:extraction:firstName,drivingLicense",
    ],
    [
      { type: "RecordPatchRejections", rejected: [{ field: "phone", reason: "system_only_field" }] },
      "RecordPatchRejections:phone=system_only_field",
    ],
    [{ type: "MarkFieldUnresolved", field: "firstName" }, "MarkFieldUnresolved:firstName"],
    [
      {
        type: "RecordConsent",
        stepId: "privacy",
        consentKey: "acme_privacy",
        textVersion: "2026-10",
        text: { kind: "system", key: "system.welcome" },
        dataController: { name: "ACME", privacyUrl: "https://example.com/privacy" },
        language: "it",
        outcome: "accepted",
        at: AT,
      },
      "RecordConsent:acme_privacy:accepted",
    ],
    [{ type: "SetLanguage", language: "ar" }, "SetLanguage:ar"],
    [{ type: "CompleteSession", at: AT }, "CompleteSession"],
    [
      { type: "StopSession", reason: "opt_out", dataPolicy: "keep", at: AT },
      "StopSession:opt_out:keep",
    ],
    [{ type: "OptOut", at: AT }, "OptOut"],
    [
      { type: "EnqueueJob", job: { name: "kubri-webhook", event: "block.completed" } },
      "EnqueueJob:kubri-webhook:block.completed",
    ],
    [{ type: "EnqueueJob", job: { name: "cv" } }, "EnqueueJob:cv"],
    [
      { type: "FlagSession", reason: "unresolved_field", needsAttention: false, field: "firstName" },
      "FlagSession:unresolved_field:firstName",
    ],
    [
      { type: "FlagSession", reason: "incoherent_state", needsAttention: true },
      "FlagSession:incoherent_state",
    ],
  ] as [Effect, string][])("%j → %s", (effect, description) => {
    expect(describeEffect(effect)).toBe(description);
  });

  it("never includes values (they are personal data)", () => {
    const effect: Effect = {
      type: "ApplyPatch",
      source: "edit",
      fields: [{ field: "firstName", value: "Mario", confidence: 1, status: "confirmed" }],
    };
    expect(describeEffect(effect)).not.toContain("Mario");
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/state.test.ts tests/unit/engine/describe.test.ts`
Expected: FAIL, i moduli `src/engine/state` e `src/engine/describe` non esistono.

- [ ] **Step 3: Implementare `src/engine/state.ts`**

```ts
import type { ConditionContext } from "../campaigns/conditions/evaluate";
import type { LanguageCode } from "../i18n/localized-text";
import { profileValues, type ProfileSnapshot } from "./profile-snapshot";

export type Phase = "language" | "flow" | "post_completion" | "closed";

/** A low-confidence extracted value waiting for a yes/no (spec §7.2 point 2). */
export interface ValueConfirmation {
  readonly kind: "value";
  readonly field: string;
  readonly value: unknown;
  readonly confidence: number;
}

/** An edit waiting for a yes/no, with the old and the new value (spec §5.7). */
export interface EditConfirmation {
  readonly kind: "edit";
  readonly field: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
}

export type PendingConfirmation = ValueConfirmation | EditConfirmation;

/** Spec §7.1. Serializable: runtime stores it as Session.engineState (plan 08). */
export interface SessionState {
  readonly phase: Phase;
  /**
   * The step waiting for an answer. In post_completion: the cv_offer step while a CV
   * regeneration is being offered (D44), otherwise null.
   */
  readonly stepId: string | null;
  readonly questionId: string | null;
  /** Clarifications already asked for the current question. */
  readonly clarifications: number;
  readonly pendingConfirmation: PendingConfirmation | null;
  /** Outcome of each completed step. Skipped steps have none. */
  readonly outcomes: Readonly<Record<string, string>>;
  readonly language: LanguageCode | null;
  /** Spec D24 threshold: a mandatory consent accepted and none declined (D38). */
  readonly consentsAccepted: boolean;
  /**
   * The profile as the engine sees it. CandidateProfile stays the source of truth: runtime
   * hydrates this before step() and saves the ApplyPatch effects back (D31).
   */
  readonly profile: ProfileSnapshot;
}

export function initialSessionState(): SessionState {
  return {
    phase: "language",
    stepId: null,
    questionId: null,
    clarifications: 0,
    pendingConfirmation: null,
    outcomes: {},
    language: null,
    consentsAccepted: false,
    profile: {},
  };
}

export function conditionContext(state: SessionState): ConditionContext {
  return { values: profileValues(state.profile), outcomes: state.outcomes };
}
```

- [ ] **Step 4: Implementare `src/engine/events.ts`**

```ts
import type { Interpretation } from "./interpretation";

/** Spec §7.1. `at` is an ISO-8601 timestamp: the engine never reads the clock. */
export type EngineEvent =
  | { readonly type: "session_started"; readonly at: string }
  | {
      readonly type: "user_turn";
      readonly at: string;
      /**
       * The burst's text, used only for deterministic checks (global keywords, language
       * names). Never logged.
       */
      readonly text: string;
      /** null when nlu is unavailable: the engine still handles the global keywords. */
      readonly interpretation: Interpretation | null;
    }
  | { readonly type: "timeout"; readonly at: string }
  | { readonly type: "outbound_failed"; readonly at: string };

export type UserTurnEvent = Extract<EngineEvent, { type: "user_turn" }>;
```

- [ ] **Step 5: Implementare `src/engine/effects.ts`**

```ts
import type { CampaignDefinition } from "../campaigns/schema/campaign";
import type { LanguageCode } from "../i18n/localized-text";
import type { RejectedPatchEntry } from "../profile/patch";
import type { TextRef } from "./text-ref";

/** Events sent to the Kubri platform (spec §12.1). `cv.generated` is sent by the cv job. */
export type KubriEvent =
  | "consents.accepted"
  | "block.completed"
  | "interview.completed"
  | "profile.updated";

export type Job =
  | { readonly name: "kubri-webhook"; readonly event: KubriEvent }
  | { readonly name: "cv" }
  | { readonly name: "geocoding" }
  | { readonly name: "delete-contact" };

/** "clarify": targeted follow-up on what is missing; "rephrase": the same question, reworded. */
export type SendPurpose = "clarify" | "rephrase";
export type PatchSource = "extraction" | "edit";
export type DataPolicy = "delete" | "keep";
export type StopReason = "consent_declined" | "terminated" | "flow_stop" | "opt_out" | "delete_data";
export type FlagReason =
  | "unresolved_field"
  | "auto_advance_limit"
  | "incoherent_state"
  | "outbound_failed";

export interface AppliedField {
  readonly field: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly status: "confirmed" | "inferred";
}

/** Effects are data (spec §7.1): runtime (plan 08) executes them in order, in one transaction. */
export type Effect =
  | { readonly type: "SendText"; readonly text: TextRef; readonly purpose?: SendPurpose }
  | {
      readonly type: "ApplyPatch";
      readonly source: PatchSource;
      readonly fields: readonly AppliedField[];
    }
  /** Invalid extracted values: logged without the value (spec §8.4). */
  | { readonly type: "RecordPatchRejections"; readonly rejected: readonly RejectedPatchEntry[] }
  | { readonly type: "MarkFieldUnresolved"; readonly field: string }
  | {
      readonly type: "RecordConsent";
      readonly stepId: string;
      readonly consentKey: string;
      readonly textVersion: string;
      /** The text shown, by reference: runtime stores the resolved copy (spec §7.3). */
      readonly text: TextRef;
      readonly link?: string;
      readonly dataController: CampaignDefinition["dataController"];
      readonly language: LanguageCode;
      readonly outcome: "accepted" | "declined";
      readonly at: string;
    }
  | { readonly type: "SetLanguage"; readonly language: LanguageCode }
  | { readonly type: "CompleteSession"; readonly at: string }
  | {
      readonly type: "StopSession";
      readonly reason: StopReason;
      readonly dataPolicy: DataPolicy;
      readonly at: string;
    }
  /** Records the opt-out on the contact's channel state. */
  | { readonly type: "OptOut"; readonly at: string }
  | { readonly type: "EnqueueJob"; readonly job: Job }
  /** needsAttention moves the session to `needs_attention` (spec §13). */
  | {
      readonly type: "FlagSession";
      readonly reason: FlagReason;
      readonly needsAttention: boolean;
      readonly field?: string;
    };
```

- [ ] **Step 6: Implementare `src/engine/describe.ts`**

```ts
import type { Effect } from "./effects";
import { describeTextRef } from "./text-ref";

/** A compact, log-safe description of an effect: ids and field names, never values. */
export function describeEffect(effect: Effect): string {
  switch (effect.type) {
    case "SendText":
      return `SendText:${describeTextRef(effect.text)}`;
    case "ApplyPatch":
      return `ApplyPatch:${effect.source}:${effect.fields.map((f) => f.field).join(",")}`;
    case "RecordPatchRejections":
      return `RecordPatchRejections:${effect.rejected.map((r) => `${r.field}=${r.reason}`).join(",")}`;
    case "MarkFieldUnresolved":
      return `MarkFieldUnresolved:${effect.field}`;
    case "RecordConsent":
      return `RecordConsent:${effect.consentKey}:${effect.outcome}`;
    case "SetLanguage":
      return `SetLanguage:${effect.language}`;
    case "CompleteSession":
      return "CompleteSession";
    case "StopSession":
      return `StopSession:${effect.reason}:${effect.dataPolicy}`;
    case "OptOut":
      return "OptOut";
    case "EnqueueJob":
      return effect.job.name === "kubri-webhook"
        ? `EnqueueJob:kubri-webhook:${effect.job.event}`
        : `EnqueueJob:${effect.job.name}`;
    case "FlagSession":
      return effect.field
        ? `FlagSession:${effect.reason}:${effect.field}`
        : `FlagSession:${effect.reason}`;
  }
}
```

- [ ] **Step 7: Creare gli helper dei test `tests/unit/engine/helpers.ts`**

Servono a tutti i test del motore dei task successivi. Partono dalla campagna minima del piano 02
(`intro` → `cv_info` → `privacy` → `anagrafica` [`nome`, `patente`, `notte` se patente] →
`fine`).

```ts
import type { CampaignDefinition, CampaignInput } from "../../../src/campaigns/schema/campaign";
import type { Question, QuestionsStep } from "../../../src/campaigns/schema/steps";
import { describeEffect } from "../../../src/engine/describe";
import type { Effect } from "../../../src/engine/effects";
import type { EngineEvent } from "../../../src/engine/events";
import type { Interpretation } from "../../../src/engine/interpretation";
import type { FieldState } from "../../../src/engine/profile-snapshot";
import { initialSessionState, type SessionState } from "../../../src/engine/state";
import { describeTextRef } from "../../../src/engine/text-ref";
import { minimalCampaign, parsed } from "../campaigns/fixtures";

export const AT = "2026-10-24T10:00:00.000Z";

/** The minimal campaign of plan 02, optionally edited before parsing (no semantic checks). */
export function campaign(edit?: (input: CampaignInput) => void): CampaignDefinition {
  const input = minimalCampaign();
  edit?.(input);
  return parsed(input);
}

export function questionsStep(c: CampaignDefinition, id: string): QuestionsStep {
  const found = c.flow.find((s): s is QuestionsStep => s.type === "questions" && s.id === id);
  if (!found) throw new Error(`no questions step ${id}`);
  return found;
}

export function questionOf(step: QuestionsStep, id: string): Question {
  const found = step.questions.find((q) => q.id === id);
  if (!found) throw new Error(`no question ${id}`);
  return found;
}

export function interpretation(overrides: Partial<Interpretation> = {}): Interpretation {
  return {
    language: { code: "it", confidence: 0.99 },
    intent: "answer",
    patch: [],
    currentQuestion: { completeness: "absent" },
    ...overrides,
  };
}

export const choice = (id: string): Interpretation =>
  interpretation({ intent: "choice", choice: id });

export const answer = (field: string, value: unknown, confidence = 0.95): Interpretation =>
  interpretation({
    patch: [{ field, value, confidence, evidence: "…" }],
    currentQuestion: { completeness: "complete" },
  });

export function userTurn(text: string, interp: Interpretation | null = null): EngineEvent {
  return { type: "user_turn", at: AT, text, interpretation: interp };
}

export const inferred = (value: unknown): FieldState => ({
  value,
  confidence: 0.9,
  status: "inferred",
});

export function flowState(overrides: Partial<SessionState> = {}): SessionState {
  return { ...initialSessionState(), phase: "flow", language: "it", ...overrides };
}

/** The minimal campaign waiting on question `questionId` of "anagrafica", consents accepted. */
export function atQuestion(questionId: string, overrides: Partial<SessionState> = {}): SessionState {
  return flowState({
    stepId: "anagrafica",
    questionId,
    consentsAccepted: true,
    outcomes: { intro: "next", cv_info: "yes", privacy: "accepted" },
    ...overrides,
  });
}

/** Ids of the texts sent, in order. */
export const sent = (effects: readonly Effect[]): string[] =>
  effects.flatMap((e) => (e.type === "SendText" ? [describeTextRef(e.text)] : []));

/** Descriptions of the other effects, in order. */
export const others = (effects: readonly Effect[]): string[] =>
  effects.filter((e) => e.type !== "SendText").map(describeEffect);

/** The exception thrown by `fn`. */
export function thrown(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected an exception");
}
```

Questo file importa `QuestionsStep` da `steps.ts`, che arriva nel Task 5: fino ad allora
`pnpm typecheck` fallirebbe. Per questo, **in questo task**, aggiungere già in fondo a
`src/campaigns/schema/steps.ts` le quattro righe di alias (il Task 5 le usa e le testa):

```ts
export type ChoiceStep = z.infer<typeof ChoiceStepSchema>;
export type ConsentStep = z.infer<typeof ConsentStepSchema>;
export type QuestionsStep = z.infer<typeof QuestionsStepSchema>;
export type CvOfferStep = z.infer<typeof CvOfferStepSchema>;
```

- [ ] **Step 8: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 9: Commit**

```bash
git add src/engine/state.ts src/engine/events.ts src/engine/effects.ts src/engine/describe.ts \
  src/campaigns/schema/steps.ts tests/unit/engine/helpers.ts \
  tests/unit/engine/state.test.ts tests/unit/engine/describe.test.ts
git commit -m "feat(chatbot): define engine state, events and effects"
```

---

### Task 5: Prossimo passaggio idoneo (`nextEligibleStep`)

Un passaggio con `when` falsa viene saltato e **non registra alcun esito**: così
`{ step: X, outcome: Y }` è falsa per un X saltato.

**Files:**
- Modify: `src/campaigns/flow.ts`
- Test: `tests/unit/campaigns/flow.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

In `tests/unit/campaigns/flow.test.ts` sostituire la riga di import di `flow` con:

```ts
import type { ConditionContext } from "../../../src/campaigns/conditions/evaluate";
import { nextEligibleStep, resolveTransition, stepOutcomes } from "../../../src/campaigns/flow";
```

e aggiungere in fondo al file:

```ts
describe("nextEligibleStep", () => {
  const input = minimalCampaign();
  input.flow.splice(1, 0, {
    id: "license_note",
    type: "message",
    when: { field: "drivingLicense", eq: true },
    text: { it: "Bene, la patente è utile." },
  });
  const conditional = CampaignDefinitionSchema.parse(input).flow;
  const ctx = (values: Record<string, unknown> = {}): ConditionContext => ({
    values,
    outcomes: {},
  });

  it("returns the step itself when it has no condition", () => {
    expect(nextEligibleStep(conditional, 0, ctx())).toBe(0);
  });

  it("skips a step whose when is false", () => {
    expect(nextEligibleStep(conditional, 1, ctx())).toBe(2);
  });

  it("keeps a step whose when is true", () => {
    expect(nextEligibleStep(conditional, 1, ctx({ drivingLicense: true }))).toBe(1);
  });

  it("returns undefined past the end of the flow", () => {
    expect(nextEligibleStep(conditional, conditional.length, ctx())).toBeUndefined();
  });

  it("returns undefined when every remaining step is skipped", () => {
    expect(nextEligibleStep(conditional.slice(1, 2), 0, ctx())).toBeUndefined();
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/campaigns/flow.test.ts`
Expected: FAIL, `nextEligibleStep is not a function`.

- [ ] **Step 3: Implementare**

In `src/campaigns/flow.ts` sostituire la prima riga di import con:

```ts
import { evaluateCondition, type ConditionContext } from "./conditions/evaluate";
import type { Step, Target } from "./schema/steps";
```

e aggiungere in fondo al file:

```ts
/**
 * Index of the first step at or after `fromIndex` whose `when` holds (or that has none).
 * Skipped steps produce no outcome. Undefined when the flow runs out.
 */
export function nextEligibleStep(
  flow: readonly Step[],
  fromIndex: number,
  ctx: ConditionContext,
): number | undefined {
  for (let index = fromIndex; index < flow.length; index++) {
    const step = flow[index];
    if (step && (!step.when || evaluateCondition(step.when, ctx))) return index;
  }
  return undefined;
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/campaigns/flow.ts tests/unit/campaigns/flow.test.ts
git commit -m "feat(chatbot): find the next eligible step of a flow"
```

---

### Task 6: "Sezione N di M"

**Files:**
- Create: `src/engine/progress.ts`
- Test: `tests/unit/engine/progress.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/progress.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ConditionContext } from "../../../src/campaigns/conditions/evaluate";
import { sectionProgress } from "../../../src/engine/progress";
import { campaign } from "./helpers";

const ctx = (values: Record<string, unknown> = {}): ConditionContext => ({ values, outcomes: {} });

describe("sectionProgress", () => {
  it("counts the only block of the minimal campaign", () => {
    expect(sectionProgress(campaign().flow, 3, ctx())).toEqual({ current: 1, total: 1 });
  });

  describe("with several blocks", () => {
    // intro, cv_info, privacy, anagrafica, lavoro, guida (if drivingLicense), fine
    const flow = campaign((input) => {
      input.flow.splice(
        4,
        0,
        {
          id: "lavoro",
          type: "questions",
          questions: [
            { id: "desiderato", field: "jobPreferences.preferredJob", prompt: { it: "Che lavoro cerchi?" } },
          ],
        },
        {
          id: "guida",
          type: "questions",
          when: { field: "drivingLicense", eq: true },
          questions: [
            { id: "tipi", field: "drivingLicenseTypes", prompt: { it: "Quali patenti hai?" } },
          ],
        },
      );
    }).flow;

    it("numbers the current block and leaves out blocks excluded by their condition", () => {
      expect(sectionProgress(flow, 4, ctx())).toEqual({ current: 2, total: 2 });
    });

    it("includes conditional blocks when the condition holds", () => {
      expect(sectionProgress(flow, 5, ctx({ drivingLicense: true }))).toEqual({
        current: 3,
        total: 3,
      });
    });

    it("counts only the blocks already behind a non-questions step", () => {
      expect(sectionProgress(flow, 2, ctx())).toEqual({ current: 0, total: 2 });
    });
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/progress.test.ts`
Expected: FAIL, il modulo `src/engine/progress` non esiste.

- [ ] **Step 3: Implementare**

`src/engine/progress.ts`:

```ts
import { evaluateCondition, type ConditionContext } from "../campaigns/conditions/evaluate";
import type { Step } from "../campaigns/schema/steps";

export interface SectionProgress {
  readonly current: number;
  readonly total: number;
}

/**
 * "Sezione N di M" (spec §7.2 point 8). M counts the questions blocks whose `when` does not
 * exclude them right now, so it can change as the profile fills up (D42).
 */
export function sectionProgress(
  flow: readonly Step[],
  stepIndex: number,
  ctx: ConditionContext,
): SectionProgress {
  const sections = flow.flatMap((step, index) =>
    step.type === "questions" && (!step.when || evaluateCondition(step.when, ctx)) ? [index] : [],
  );
  return {
    current: sections.filter((index) => index <= stepIndex).length,
    total: sections.length,
  };
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/engine/progress.ts tests/unit/engine/progress.test.ts
git commit -m "feat(chatbot): compute the section progress of an interview"
```

---
### Task 7: Parole chiave degli intenti globali

`opt_out` e `delete_data` devono funzionare anche senza LLM (spec §7.2 punto 1). Qui solo il
riconoscimento; la gestione arriva nel Task 21.

**Files:**
- Create: `src/engine/normalize-text.ts`, `src/engine/global-intents.ts`
- Test: `tests/unit/engine/global-intents.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/global-intents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectGlobalIntent, globalIntentOf } from "../../../src/engine/global-intents";
import { normalizeText } from "../../../src/engine/normalize-text";
import { interpretation } from "./helpers";

describe("normalizeText", () => {
  it("lowercases, strips punctuation and collapses spaces", () => {
    expect(normalizeText("  STOP!!  ")).toBe("stop");
  });

  it("keeps accented letters and combining marks", () => {
    expect(normalizeText("Supprimer mes DONNÉES.")).toBe("supprimer mes données");
    expect(normalizeText("বাংলা")).toBe("বাংলা");
  });
});

describe("detectGlobalIntent", () => {
  it.each([
    ["stop", "opt_out"],
    ["STOP!", "opt_out"],
    ["Basta.", "opt_out"],
    ["Cancella i miei dati", "delete_data"],
    ["delete my data", "delete_data"],
    ["احذف بياناتي", "delete_data"],
  ])("%j → %s", (text, intent) => {
    expect(detectGlobalIntent(text)).toBe(intent);
  });

  it.each(["basta così grazie", "stoppato", "non cancellare i miei dati", ""])(
    "ignores %j: the whole message must match",
    (text) => {
      expect(detectGlobalIntent(text)).toBeUndefined();
    },
  );
});

describe("globalIntentOf", () => {
  it("prefers the deterministic keyword over the interpretation", () => {
    expect(globalIntentOf("stop", interpretation({ intent: "answer" }))).toBe("opt_out");
  });

  it("uses the LLM intent when no keyword matches", () => {
    expect(globalIntentOf("voglio smettere", interpretation({ intent: "opt_out" }))).toBe("opt_out");
    expect(globalIntentOf("togliete tutto", interpretation({ intent: "delete_data" }))).toBe(
      "delete_data",
    );
  });

  it("works without an interpretation", () => {
    expect(globalIntentOf("cancellami", null)).toBe("delete_data");
    expect(globalIntentOf("Mario", null)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/global-intents.test.ts`
Expected: FAIL, i moduli non esistono.

- [ ] **Step 3: Implementare `src/engine/normalize-text.ts`**

```ts
/** Lowercase, NFKC, punctuation and emoji replaced by spaces, single-spaced, trimmed. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 4: Implementare `src/engine/global-intents.ts`**

```ts
import type { Interpretation } from "./interpretation";
import { normalizeText } from "./normalize-text";

export type GlobalIntent = "opt_out" | "delete_data";

// Whole-message phrases, already normalized (D40). Short on purpose: a false positive stops
// an interview, a false negative still reaches the LLM.
const PHRASES: ReadonlyMap<string, GlobalIntent> = new Map([
  ["stop", "opt_out"],
  ["basta", "opt_out"],
  ["stop bot", "opt_out"],
  ["unsubscribe", "opt_out"],
  ["arrêt", "opt_out"],
  ["arret", "opt_out"],
  ["توقف", "opt_out"],
  ["cancella i miei dati", "delete_data"],
  ["elimina i miei dati", "delete_data"],
  ["cancellami", "delete_data"],
  ["delete my data", "delete_data"],
  ["supprimer mes données", "delete_data"],
  ["احذف بياناتي", "delete_data"],
]);

/** Deterministic: works without the LLM (spec §7.2 point 1). */
export function detectGlobalIntent(text: string): GlobalIntent | undefined {
  return PHRASES.get(normalizeText(text));
}

/** The keyword wins; otherwise the LLM's intent, if it is a global one. */
export function globalIntentOf(
  text: string,
  interpretation: Interpretation | null,
): GlobalIntent | undefined {
  const keyword = detectGlobalIntent(text);
  if (keyword) return keyword;
  const intent = interpretation?.intent;
  return intent === "opt_out" || intent === "delete_data" ? intent : undefined;
}
```

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 6: Commit**

```bash
git add src/engine/normalize-text.ts src/engine/global-intents.ts \
  tests/unit/engine/global-intents.test.ts
git commit -m "feat(chatbot): detect opt-out and data deletion keywords deterministically"
```

---

### Task 8: Riconoscimento della lingua

Parte deterministica del §5.6 (D41).

**Files:**
- Create: `src/engine/language.ts`
- Test: `tests/unit/engine/language.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/language.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chooseLanguage, detectLanguageName } from "../../../src/engine/language";
import { interpretation } from "./helpers";

describe("detectLanguageName", () => {
  it.each([
    ["italiano", "it"],
    ["Arabo", "ar"],
    ["العربية", "ar"],
    ["english please", "en"],
    ["vorrei parlare in français", "fr"],
    ["українська", "uk"],
    ["中文", "zh"],
  ])("%j → %s", (text, code) => {
    expect(detectLanguageName(text)).toBe(code);
  });

  it.each(["ciao", "sì", ""])("returns undefined for %j", (text) => {
    expect(detectLanguageName(text)).toBeUndefined();
  });
});

describe("chooseLanguage", () => {
  it("prefers a language name written in the text", () => {
    const interp = interpretation({ language: { code: "it", confidence: 0.99 } });
    expect(chooseLanguage("arabo", interp, "it")).toBe("ar");
  });

  it("falls back to the detected language when confident enough", () => {
    const interp = interpretation({ language: { code: "ar", confidence: 0.9 } });
    expect(chooseLanguage("مرحبا", interp, "it")).toBe("ar");
  });

  it("ignores a detection below 0.8", () => {
    const interp = interpretation({ language: { code: "en", confidence: 0.6 } });
    expect(chooseLanguage("hello?", interp, "it")).toBe("it");
  });

  it("uses the campaign default without an interpretation", () => {
    expect(chooseLanguage("ok", null, "en")).toBe("en");
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/language.test.ts`
Expected: FAIL, il modulo non esiste.

- [ ] **Step 3: Implementare**

`src/engine/language.ts`:

```ts
import type { LanguageCode } from "../i18n/localized-text";
import type { Interpretation } from "./interpretation";
import { normalizeText } from "./normalize-text";

/** Language names in Italian, English, French and the language itself, normalized. */
const LANGUAGE_NAMES: ReadonlyMap<string, LanguageCode> = new Map([
  ["italiano", "it"],
  ["italian", "it"],
  ["italien", "it"],
  ["inglese", "en"],
  ["english", "en"],
  ["anglais", "en"],
  ["francese", "fr"],
  ["french", "fr"],
  ["français", "fr"],
  ["francais", "fr"],
  ["spagnolo", "es"],
  ["spanish", "es"],
  ["español", "es"],
  ["espanol", "es"],
  ["arabo", "ar"],
  ["arabic", "ar"],
  ["arabe", "ar"],
  ["العربية", "ar"],
  ["عربي", "ar"],
  ["ucraino", "uk"],
  ["ukrainian", "uk"],
  ["українська", "uk"],
  ["russo", "ru"],
  ["russian", "ru"],
  ["русский", "ru"],
  ["rumeno", "ro"],
  ["romeno", "ro"],
  ["romanian", "ro"],
  ["română", "ro"],
  ["romana", "ro"],
  ["albanese", "sq"],
  ["albanian", "sq"],
  ["shqip", "sq"],
  ["bengalese", "bn"],
  ["bengali", "bn"],
  ["বাংলা", "bn"],
  ["urdu", "ur"],
  ["اردو", "ur"],
  ["portoghese", "pt"],
  ["portuguese", "pt"],
  ["português", "pt"],
  ["portugues", "pt"],
  ["tedesco", "de"],
  ["german", "de"],
  ["deutsch", "de"],
  ["cinese", "zh"],
  ["chinese", "zh"],
  ["中文", "zh"],
]);

/** Below this the LLM's language detection is ignored (D41). */
export const LANGUAGE_CONFIDENCE_THRESHOLD = 0.8;

/** "Arabo" → "ar": the first word of the message that names a language. */
export function detectLanguageName(text: string): LanguageCode | undefined {
  for (const word of normalizeText(text).split(" ")) {
    const code = LANGUAGE_NAMES.get(word);
    if (code) return code;
  }
  return undefined;
}

/** Spec §5.6 point 2, deterministic part: name → confident detection → campaign default. */
export function chooseLanguage(
  text: string,
  interpretation: Interpretation | null,
  fallback: LanguageCode,
): LanguageCode {
  const named = detectLanguageName(text);
  if (named) return named;
  if (interpretation && interpretation.language.confidence >= LANGUAGE_CONFIDENCE_THRESHOLD) {
    return interpretation.language.code;
  }
  return fallback;
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/engine/language.ts tests/unit/engine/language.test.ts
git commit -m "feat(chatbot): recognize language names and choose the session language"
```

---

### Task 9: Accumulatore del turno ed errori del motore

**Files:**
- Create: `src/engine/turn.ts`
- Test: `tests/unit/engine/turn.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/turn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { initialSessionState } from "../../../src/engine/state";
import {
  EngineError,
  MAX_AUTO_ADVANCES,
  createTurn,
  currentStep,
  emit,
  incoherent,
  say,
  setState,
  stepAt,
  systemText,
} from "../../../src/engine/turn";
import { AT, campaign, flowState, thrown } from "./helpers";

describe("turn", () => {
  it("allows 20 automatic advances per turn (spec §7.2 point 9)", () => {
    expect(MAX_AUTO_ADVANCES).toBe(20);
  });

  it("collects effects and replaces the state without mutating the original", () => {
    const state = initialSessionState();
    const turn = createTurn(state, campaign(), AT);

    setState(turn, { phase: "flow" });
    say(turn, systemText("system.welcome"));
    say(turn, systemText("system.not_understood"), "rephrase");
    emit(turn, { type: "OptOut", at: AT });

    expect(state.phase).toBe("language");
    expect(turn.state.phase).toBe("flow");
    expect(turn.effects).toEqual([
      { type: "SendText", text: { kind: "system", key: "system.welcome" } },
      {
        type: "SendText",
        text: { kind: "system", key: "system.not_understood" },
        purpose: "rephrase",
      },
      { type: "OptOut", at: AT },
    ]);
  });

  it("adds params to a system text only when given", () => {
    expect(systemText("system.progress", { current: 1, total: 2 })).toEqual({
      kind: "system",
      key: "system.progress",
      params: { current: 1, total: 2 },
    });
    expect(systemText("system.help")).not.toHaveProperty("params");
  });

  it("finds the current step and its index", () => {
    const turn = createTurn(flowState({ stepId: "privacy" }), campaign(), AT);
    const { step, index } = currentStep(turn);
    expect([step.id, index]).toEqual(["privacy", 2]);
  });

  it.each([null, "ghost"])("treats current step %j as an incoherent state", (stepId) => {
    const turn = createTurn(flowState({ stepId }), campaign(), AT);
    expect(thrown(() => currentStep(turn))).toMatchObject({
      name: "EngineError",
      reason: "incoherent_state",
    });
  });

  it("throws on a missing step index", () => {
    const turn = createTurn(flowState(), campaign(), AT);
    expect(thrown(() => stepAt(turn, 99))).toBeInstanceOf(EngineError);
  });

  it("incoherent() throws an EngineError", () => {
    expect(thrown(() => incoherent("boom"))).toMatchObject({
      reason: "incoherent_state",
      message: "boom",
    });
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/turn.test.ts`
Expected: FAIL, il modulo non esiste.

- [ ] **Step 3: Implementare**

`src/engine/turn.ts`:

```ts
import type { CampaignDefinition } from "../campaigns/schema/campaign";
import type { Step } from "../campaigns/schema/steps";
import type { Effect, SendPurpose } from "./effects";
import type { SessionState } from "./state";
import type { SystemTextKey, TextParams, TextRef } from "./text-ref";

/** Spec §7.2 point 9: at most 20 automatic step entries per turn. */
export const MAX_AUTO_ADVANCES = 20;

export type EngineErrorReason = "auto_advance_limit" | "incoherent_state";

/** Thrown inside the engine and caught by step(): it never escapes as an exception (D45). */
export class EngineError extends Error {
  readonly reason: EngineErrorReason;

  constructor(reason: EngineErrorReason, message: string) {
    super(message);
    this.name = "EngineError";
    this.reason = reason;
  }
}

export function incoherent(message: string): never {
  throw new EngineError("incoherent_state", message);
}

/**
 * The working copy of one step() call. It is mutated locally and never leaves step(), so
 * step() stays pure.
 */
export interface Turn {
  readonly campaign: CampaignDefinition;
  /** The event's timestamp. */
  readonly at: string;
  state: SessionState;
  readonly effects: Effect[];
  /** Steps entered so far in this turn. */
  advances: number;
}

export function createTurn(state: SessionState, campaign: CampaignDefinition, at: string): Turn {
  return { campaign, at, state, effects: [], advances: 0 };
}

export function emit(turn: Turn, ...effects: Effect[]): void {
  turn.effects.push(...effects);
}

export function setState(turn: Turn, changes: Partial<SessionState>): void {
  turn.state = { ...turn.state, ...changes };
}

export function say(turn: Turn, text: TextRef, purpose?: SendPurpose): void {
  emit(turn, purpose ? { type: "SendText", text, purpose } : { type: "SendText", text });
}

export function systemText(key: SystemTextKey, params?: TextParams): TextRef {
  return params ? { kind: "system", key, params } : { kind: "system", key };
}

export function stepAt(turn: Turn, index: number): Step {
  return turn.campaign.flow[index] ?? incoherent(`no step at index ${index}`);
}

export interface CurrentStep {
  readonly step: Step;
  readonly index: number;
}

export function currentStep(turn: Turn): CurrentStep {
  const id = turn.state.stepId;
  const index = id === null ? -1 : turn.campaign.flow.findIndex((s) => s.id === id);
  const step = turn.campaign.flow[index];
  if (!step) incoherent(`unknown current step "${id ?? "none"}"`);
  return { step, index };
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/engine/turn.ts tests/unit/engine/turn.test.ts
git commit -m "feat(chatbot): add the engine turn accumulator and errors"
```

---

### Task 10: Prossima domanda di un blocco

Qui vive il salto dei campi già valorizzati (§5.3), che gestisce le risposte anticipate: niente
logica di salto parallela altrove.

**Files:**
- Create: `src/engine/blocks.ts`
- Test: `tests/unit/engine/blocks.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/blocks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextAskableQuestion } from "../../../src/engine/blocks";
import { campaign, flowState, inferred, questionOf, questionsStep } from "./helpers";

const block = questionsStep(campaign(), "anagrafica"); // nome, patente, notte (if patente)

describe("nextAskableQuestion", () => {
  it("asks the first open question", () => {
    expect(nextAskableQuestion(block, 0, flowState())).toEqual({
      kind: "ask",
      question: questionOf(block, "nome"),
    });
  });

  it("skips questions whose field is already filled (early answers)", () => {
    const state = flowState({ profile: { firstName: inferred("Mario") } });
    expect(nextAskableQuestion(block, 0, state)).toEqual({
      kind: "ask",
      question: questionOf(block, "patente"),
    });
  });

  it("skips unresolved fields", () => {
    const state = flowState({
      profile: { firstName: { value: null, confidence: 0, status: "unresolved" } },
    });
    expect(nextAskableQuestion(block, 0, state)).toMatchObject({ question: { id: "patente" } });
  });

  it("asks again a field below the confidence threshold", () => {
    const state = flowState({
      profile: { firstName: { value: "Mrio", confidence: 0.5, status: "inferred" } },
    });
    expect(nextAskableQuestion(block, 0, state)).toMatchObject({ question: { id: "nome" } });
  });

  it("skips a question whose when is false", () => {
    const state = flowState({
      profile: { firstName: inferred("Mario"), drivingLicense: inferred(false) },
    });
    expect(nextAskableQuestion(block, 0, state)).toEqual({ kind: "completed" });
  });

  it("asks a conditional question when its when holds", () => {
    const state = flowState({
      profile: { firstName: inferred("Mario"), drivingLicense: inferred(true) },
    });
    expect(nextAskableQuestion(block, 0, state)).toMatchObject({ question: { id: "notte" } });
  });

  it("starts from the given index", () => {
    expect(nextAskableQuestion(block, 1, flowState())).toMatchObject({
      question: { id: "patente" },
    });
  });

  describe("terminateIf", () => {
    const withTerminate = questionsStep(
      campaign((input) => {
        input.flow[3] = {
          id: "anagrafica",
          type: "questions",
          questions: [
            {
              id: "patente",
              field: "drivingLicense",
              prompt: { it: "Hai la patente?" },
              terminateIf: { field: "drivingLicense", eq: false },
            },
            {
              id: "permesso",
              field: "workingPermit",
              prompt: { it: "Hai il permesso di lavoro?" },
              when: { field: "drivingLicense", eq: true },
              terminateIf: { field: "workingPermit", eq: false },
            },
          ],
        };
      }),
      "anagrafica",
    );

    it("terminates when a filled question's terminateIf holds", () => {
      const state = flowState({ profile: { drivingLicense: inferred(false) } });
      expect(nextAskableQuestion(withTerminate, 0, state)).toEqual({ kind: "terminated" });
    });

    it("does not evaluate terminateIf of a question skipped by its when", () => {
      const state = flowState({
        profile: { drivingLicense: inferred(true), workingPermit: inferred(true) },
      });
      expect(nextAskableQuestion(withTerminate, 0, state)).toEqual({ kind: "completed" });
      const skipped = flowState({
        profile: { drivingLicense: inferred(false), workingPermit: inferred(false) },
      });
      expect(nextAskableQuestion(withTerminate, 1, skipped)).toEqual({ kind: "completed" });
    });
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/blocks.test.ts`
Expected: FAIL, il modulo non esiste.

- [ ] **Step 3: Implementare**

`src/engine/blocks.ts`:

```ts
import { evaluateCondition } from "../campaigns/conditions/evaluate";
import type { Question, QuestionsStep } from "../campaigns/schema/steps";
import { isFieldSettled } from "./profile-snapshot";
import { conditionContext, type SessionState } from "./state";

export type NextQuestion =
  | { readonly kind: "ask"; readonly question: Question }
  | { readonly kind: "completed" }
  | { readonly kind: "terminated" };

/**
 * The next question to ask from `fromIndex` on (spec §5.3, §7.2 point 7):
 * - `when` false → skipped, its terminateIf is not evaluated;
 * - field already settled → skipped, but its terminateIf is evaluated (an early answer can
 *   terminate the block too);
 * - otherwise → asked.
 */
export function nextAskableQuestion(
  step: QuestionsStep,
  fromIndex: number,
  state: SessionState,
): NextQuestion {
  const ctx = conditionContext(state);
  for (const question of step.questions.slice(fromIndex)) {
    if (question.when && !evaluateCondition(question.when, ctx)) continue;
    if (!isFieldSettled(state.profile, question.field)) return { kind: "ask", question };
    if (question.terminateIf && evaluateCondition(question.terminateIf, ctx)) {
      return { kind: "terminated" };
    }
  }
  return { kind: "completed" };
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/engine/blocks.ts tests/unit/engine/blocks.test.ts
git commit -m "feat(chatbot): pick the next question of a block, skipping filled fields"
```

---

### Task 11: Ingresso nei passaggi e avanzamento automatico

Il cuore della navigazione: entrare in un passaggio, inviare i suoi testi, proseguire da soli
finché un passaggio aspetta una risposta (§7.2 punto 6), seguire transizioni e `reply`,
`@repeat`, `@end` (D37), `@stop` con la soglia D24 (D39), il limite dei 20 avanzamenti.

**Files:**
- Create: `src/engine/advance.ts`
- Test: `tests/unit/engine/advance.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/advance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CampaignDefinition, CampaignInput } from "../../../src/campaigns/schema/campaign";
import { advanceFromQuestion, enterStep, followOutcome } from "../../../src/engine/advance";
import type { SessionState } from "../../../src/engine/state";
import { createTurn, type Turn } from "../../../src/engine/turn";
import {
  AT,
  atQuestion,
  campaign,
  flowState,
  inferred,
  others,
  questionOf,
  questionsStep,
  sent,
  thrown,
} from "./helpers";

const turnFor = (state: SessionState, c: CampaignDefinition = campaign()): Turn =>
  createTurn(state, c, AT);

describe("enterStep", () => {
  it("sends a message and moves on to the next step that waits for an answer", () => {
    const turn = turnFor(flowState());
    enterStep(turn, 0);

    expect(sent(turn.effects)).toEqual(["intro", "cv_info"]);
    expect(turn.state.stepId).toBe("cv_info");
    expect(turn.state.outcomes).toEqual({ intro: "next" });
  });

  describe("step conditions", () => {
    const withNote = campaign((input) => {
      input.flow.splice(1, 0, {
        id: "license_note",
        type: "message",
        when: { field: "drivingLicense", eq: true },
        text: { it: "Bene, la patente è utile." },
      });
    });

    it("skips a step whose when is false, without recording an outcome", () => {
      const turn = turnFor(flowState(), withNote);
      enterStep(turn, 0);

      expect(sent(turn.effects)).toEqual(["intro", "cv_info"]);
      expect(turn.state.outcomes).toEqual({ intro: "next" });
    });

    it("enters it when its when holds", () => {
      const turn = turnFor(flowState({ profile: { drivingLicense: inferred(true) } }), withNote);
      enterStep(turn, 0);

      expect(sent(turn.effects)).toEqual(["intro", "license_note", "cv_info"]);
    });
  });

  it("sends a consent text with the data controller and the link as params", () => {
    const turn = turnFor(flowState());
    enterStep(turn, 2);

    expect(turn.effects).toEqual([
      {
        type: "SendText",
        text: {
          kind: "step",
          path: "privacy",
          text: { it: "Accetti l'informativa sulla privacy?" },
          params: {
            "dataController.name": "ACME S.r.l.",
            "dataController.privacyUrl": "https://example.com/privacy",
            link: "https://example.com/privacy",
          },
        },
      },
    ]);
  });

  it("opens a questions block with progress, title and the first open question", () => {
    const c = campaign((input) => {
      const block = input.flow[3];
      if (block?.type === "questions") block.title = { it: "Parliamo di te" };
    });
    const turn = turnFor(flowState({ consentsAccepted: true }), c);
    enterStep(turn, 3);

    expect(sent(turn.effects)).toEqual(["system.progress", "anagrafica.title", "anagrafica.nome"]);
    expect(turn.effects[0]).toEqual({
      type: "SendText",
      text: { kind: "system", key: "system.progress", params: { current: 1, total: 1 } },
    });
    expect([turn.state.stepId, turn.state.questionId]).toEqual(["anagrafica", "nome"]);
  });

  it("completes a block with nothing left to ask and moves on", () => {
    const state = flowState({
      consentsAccepted: true,
      profile: { firstName: inferred("Mario"), drivingLicense: inferred(false) },
    });
    const turn = turnFor(state);
    enterStep(turn, 3);

    expect(sent(turn.effects)).toEqual(["fine"]);
    expect(others(turn.effects)).toEqual([
      "EnqueueJob:kubri-webhook:block.completed",
      "CompleteSession",
      "EnqueueJob:kubri-webhook:interview.completed",
    ]);
    expect(turn.state.outcomes).toMatchObject({ anagrafica: "completed" });
    expect(turn.state.phase).toBe("post_completion");
  });

  it("terminates a block when an already filled question's terminateIf holds", () => {
    const c = campaign((input) => {
      input.flow[3] = {
        id: "anagrafica",
        type: "questions",
        questions: [
          { id: "nome", field: "firstName", prompt: { it: "Come ti chiami?" } },
          {
            id: "patente",
            field: "drivingLicense",
            prompt: { it: "Hai la patente?" },
            terminateIf: { field: "drivingLicense", eq: false },
          },
        ],
      };
    });
    const state = flowState({
      consentsAccepted: true,
      profile: { firstName: inferred("Mario"), drivingLicense: inferred(false) },
    });
    const turn = turnFor(state, c);
    enterStep(turn, 3);

    expect(sent(turn.effects)).toEqual(["system.stopped"]);
    expect(others(turn.effects)).toEqual(["StopSession:terminated:delete"]);
    expect(turn.state.outcomes).toMatchObject({ anagrafica: "terminated" });
  });

  it("throws after 20 automatic advances", () => {
    const c = campaign((input) => {
      input.flow = Array.from({ length: 25 }, (_, i) => ({
        id: `m${i}`,
        type: "message" as const,
        text: { it: `Messaggio ${i}` },
      }));
    });
    const error = thrown(() => {
      enterStep(turnFor(flowState(), c), 0);
    });
    expect(error).toMatchObject({
      name: "EngineError",
      reason: "auto_advance_limit",
    });
  });
});

describe("followOutcome", () => {
  it("records the outcome, sends the reply, then repeats the step", () => {
    const turn = turnFor(flowState({ stepId: "cv_info" }));
    followOutcome(turn, 1, "idk");

    expect(sent(turn.effects)).toEqual(["texts.cv_explain", "cv_info"]);
    expect(turn.state.outcomes).toEqual({ cv_info: "idk" });
    expect(turn.state.stepId).toBe("cv_info");
  });

  it("@stop before the consent threshold deletes everything (D24)", () => {
    const turn = turnFor(flowState({ stepId: "cv_info" }));
    followOutcome(turn, 1, "no");

    expect(sent(turn.effects)).toEqual(["system.stopped"]);
    expect(others(turn.effects)).toEqual(["StopSession:flow_stop:delete"]);
    expect(turn.state).toMatchObject({ phase: "closed", stepId: null });
  });

  it("@stop after the threshold applies the campaign's onStop", () => {
    const c = campaign((input) => {
      input.onStop = { data: "keep" };
    });
    const turn = turnFor(flowState({ stepId: "cv_info", consentsAccepted: true }), c);
    followOutcome(turn, 1, "no");

    expect(others(turn.effects)).toEqual(["StopSession:flow_stop:keep"]);
  });

  describe("@end (D37)", () => {
    const endOn = (edit: (input: CampaignInput) => void): CampaignDefinition =>
      campaign((input) => {
        input.flow[1] = {
          id: "cv_info",
          type: "choice",
          prompt: { it: "Sai cos'è un CV?" },
          options: [
            { id: "yes", description: "Sì" },
            { id: "no", description: "No" },
          ],
          on: { no: "@end" },
        };
        edit(input);
      });

    it("goes to the first end step whose when holds", () => {
      const c = endOn((input) => {
        input.flow.splice(2, 0, {
          id: "early_end",
          type: "end",
          when: { step: "cv_info", outcome: "yes" },
          text: { it: "A presto!" },
        });
      });
      const turn = turnFor(flowState({ stepId: "cv_info" }), c);
      followOutcome(turn, 1, "no");

      expect(sent(turn.effects)).toEqual(["fine"]);
      expect(others(turn.effects)).toEqual([
        "CompleteSession",
        "EnqueueJob:kubri-webhook:interview.completed",
      ]);
      expect(turn.state).toMatchObject({ phase: "post_completion", stepId: null });
    });

    it("picks an earlier end step when its when holds", () => {
      const c = endOn((input) => {
        input.flow.splice(2, 0, {
          id: "early_end",
          type: "end",
          when: { step: "cv_info", outcome: "no" },
          text: { it: "A presto!" },
        });
      });
      const turn = turnFor(flowState({ stepId: "cv_info" }), c);
      followOutcome(turn, 1, "no");

      expect(sent(turn.effects)).toEqual(["early_end"]);
    });

    it("completes with the system closing when the flow has no end step", () => {
      const c = endOn((input) => {
        input.flow.pop();
      });
      const turn = turnFor(flowState({ stepId: "cv_info" }), c);
      followOutcome(turn, 1, "no");

      expect(sent(turn.effects)).toEqual(["system.closing"]);
      expect(others(turn.effects)).toEqual([
        "CompleteSession",
        "EnqueueJob:kubri-webhook:interview.completed",
      ]);
    });
  });

  it("running past the last step behaves like @end", () => {
    const c = campaign((input) => {
      input.flow = [{ id: "intro", type: "message", text: { it: "Ciao!" } }];
    });
    const turn = turnFor(flowState(), c);
    enterStep(turn, 0);

    expect(sent(turn.effects)).toEqual(["intro", "system.closing"]);
  });

  it("treats an unknown target as an incoherent state", () => {
    const c = campaign((input) => {
      const choiceStep = input.flow[1];
      if (choiceStep?.type === "choice") choiceStep.on = { no: "ghost" };
    });
    const error = thrown(() => {
      followOutcome(turnFor(flowState(), c), 1, "no");
    });
    expect(error).toMatchObject({
      reason: "incoherent_state",
    });
  });
});

describe("advanceFromQuestion", () => {
  it("asks the next open question and resets the clarifications", () => {
    const c = campaign();
    const block = questionsStep(c, "anagrafica");
    const turn = turnFor(
      atQuestion("nome", { clarifications: 2, profile: { firstName: inferred("Mario") } }),
      c,
    );
    advanceFromQuestion(turn, 3, block, questionOf(block, "nome"));

    expect(sent(turn.effects)).toEqual(["anagrafica.patente"]);
    expect(turn.state).toMatchObject({ questionId: "patente", clarifications: 0 });
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/advance.test.ts`
Expected: FAIL, il modulo non esiste.

- [ ] **Step 3: Implementare**

`src/engine/advance.ts`:

```ts
import { evaluateCondition } from "../campaigns/conditions/evaluate";
import { nextEligibleStep, resolveTransition } from "../campaigns/flow";
import type { ConsentStep, Question, QuestionsStep, Target } from "../campaigns/schema/steps";
import { nextAskableQuestion } from "./blocks";
import type { DataPolicy, SendPurpose, StopReason } from "./effects";
import { sectionProgress } from "./progress";
import { conditionContext } from "./state";
import { stepTextRef, type TextParams, type TextRef } from "./text-ref";
import {
  EngineError,
  MAX_AUTO_ADVANCES,
  emit,
  incoherent,
  say,
  setState,
  stepAt,
  systemText,
  type Turn,
} from "./turn";

/** Enters the first eligible step at or after `fromIndex` (spec §7.2 points 6–7). */
export function enterStep(turn: Turn, fromIndex: number): void {
  const index = nextEligibleStep(turn.campaign.flow, fromIndex, conditionContext(turn.state));
  if (index === undefined) {
    endFlow(turn);
    return;
  }
  runStep(turn, index);
}

/** Sends a step's opening texts; a step that needs no answer moves on immediately. */
export function runStep(turn: Turn, index: number): void {
  turn.advances += 1;
  if (turn.advances > MAX_AUTO_ADVANCES) {
    throw new EngineError("auto_advance_limit", `more than ${MAX_AUTO_ADVANCES} steps in one turn`);
  }
  const step = stepAt(turn, index);
  setState(turn, { stepId: step.id, questionId: null, clarifications: 0 });
  switch (step.type) {
    case "message":
      say(turn, stepTextRef(step.text, step.id));
      followOutcome(turn, index, "next");
      return;
    case "choice":
    case "cv_offer":
      say(turn, stepTextRef(step.prompt, step.id));
      return;
    case "consent":
      say(turn, consentTextRef(turn, step));
      return;
    case "questions":
      startBlock(turn, index, step);
      return;
    case "end":
      completeSession(turn, stepTextRef(step.text, step.id));
      return;
  }
}

/** Records the outcome, sends the transition's reply, goes to its target (spec §5.4). */
export function followOutcome(
  turn: Turn,
  index: number,
  outcome: string,
  stopReason: StopReason = "flow_stop",
): void {
  const step = stepAt(turn, index);
  setState(turn, { outcomes: { ...turn.state.outcomes, [step.id]: outcome } });
  const { reply, target } = resolveTransition(step, outcome, turn.campaign.flow[index + 1]?.id);
  if (reply !== undefined) say(turn, { kind: "campaign", key: reply });
  goTo(turn, target, index, stopReason);
}

function goTo(turn: Turn, target: Target, fromIndex: number, stopReason: StopReason): void {
  if (target === "@stop") {
    stopSession(turn, stopReason);
    return;
  }
  if (target === "@end") {
    endFlow(turn);
    return;
  }
  if (target === "@repeat") {
    runStep(turn, fromIndex);
    return;
  }
  const index = turn.campaign.flow.findIndex((s) => s.id === target);
  if (index < 0) incoherent(`unknown target "${target}"`);
  enterStep(turn, index);
}

/** `@end` and running out of steps: the first eligible `end` step, else a system closing (D37). */
export function endFlow(turn: Turn): void {
  const ctx = conditionContext(turn.state);
  const index = turn.campaign.flow.findIndex(
    (s) => s.type === "end" && (!s.when || evaluateCondition(s.when, ctx)),
  );
  if (index >= 0) {
    runStep(turn, index);
    return;
  }
  completeSession(turn, systemText("system.closing"));
}

function completeSession(turn: Turn, closing: TextRef): void {
  say(turn, closing);
  emit(
    turn,
    { type: "CompleteSession", at: turn.at },
    { type: "EnqueueJob", job: { name: "kubri-webhook", event: "interview.completed" } },
  );
  setState(turn, {
    phase: "post_completion",
    stepId: null,
    questionId: null,
    clarifications: 0,
    pendingConfirmation: null,
  });
}

export interface StopOptions {
  readonly goodbye?: TextRef;
  readonly dataPolicy?: DataPolicy;
}

/** `@stop`, opt-out and deletion. Before the consent threshold nothing is kept (D24, D39). */
export function stopSession(turn: Turn, reason: StopReason, options: StopOptions = {}): void {
  const dataPolicy =
    options.dataPolicy ?? (turn.state.consentsAccepted ? turn.campaign.onStop.data : "delete");
  say(turn, options.goodbye ?? systemText("system.stopped"));
  emit(turn, { type: "StopSession", reason, dataPolicy, at: turn.at });
  setState(turn, {
    phase: "closed",
    stepId: null,
    questionId: null,
    clarifications: 0,
    pendingConfirmation: null,
  });
}

export function consentTextRef(turn: Turn, step: ConsentStep): TextRef {
  const { name, privacyUrl } = turn.campaign.dataController;
  const params: TextParams = {
    "dataController.name": name,
    "dataController.privacyUrl": privacyUrl,
    ...(step.link ? { link: step.link } : {}),
  };
  return stepTextRef(step.text, step.id, params);
}

export function questionTextRef(
  step: QuestionsStep,
  question: Question,
  params?: TextParams,
): TextRef {
  return stepTextRef(question.prompt, `${step.id}.${question.id}`, params);
}

export function askQuestion(
  turn: Turn,
  step: QuestionsStep,
  question: Question,
  purpose?: SendPurpose,
  params?: TextParams,
): void {
  setState(turn, { questionId: question.id });
  say(turn, questionTextRef(step, question, params), purpose);
}

function startBlock(turn: Turn, index: number, step: QuestionsStep): void {
  const next = nextAskableQuestion(step, 0, turn.state);
  if (next.kind !== "ask") {
    finishBlock(turn, index, next.kind);
    return;
  }
  const { current, total } = sectionProgress(turn.campaign.flow, index, conditionContext(turn.state));
  say(turn, systemText("system.progress", { current, total }));
  if (step.title) say(turn, stepTextRef(step.title, `${step.id}.title`));
  askQuestion(turn, step, next.question);
}

/** Moves past the current question: its terminateIf first, then the next askable question. */
export function advanceFromQuestion(
  turn: Turn,
  index: number,
  step: QuestionsStep,
  question: Question,
): void {
  if (question.terminateIf && evaluateCondition(question.terminateIf, conditionContext(turn.state))) {
    finishBlock(turn, index, "terminated");
    return;
  }
  const position = step.questions.findIndex((q) => q.id === question.id);
  const next = nextAskableQuestion(step, position + 1, turn.state);
  if (next.kind !== "ask") {
    finishBlock(turn, index, next.kind);
    return;
  }
  setState(turn, { clarifications: 0 });
  askQuestion(turn, step, next.question);
}

function finishBlock(turn: Turn, index: number, outcome: "completed" | "terminated"): void {
  setState(turn, { questionId: null });
  if (outcome === "completed") {
    emit(turn, { type: "EnqueueJob", job: { name: "kubri-webhook", event: "block.completed" } });
  }
  followOutcome(turn, index, outcome, outcome === "terminated" ? "terminated" : "flow_stop");
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/engine/advance.ts tests/unit/engine/advance.test.ts
git commit -m "feat(chatbot): enter steps and auto-advance through the flow"
```

---

### Task 12: `step()`, fase della lingua e protezioni

Il punto d'ingresso. In questo task la fase `flow` capisce solo che **non** ha capito
(`system.not_understood` + riproposta del passaggio): i task successivi aggiungono, un tipo di
risposta alla volta, ciò che il motore capisce. La fase `post_completion` risponde con l'aiuto
post-intervista (completata nel Task 22).

**Files:**
- Create: `src/engine/replies.ts`, `src/engine/language-phase.ts`, `src/engine/flow-turn.ts`,
  `src/engine/post-completion.ts`, `src/engine/step.ts`
- Test: `tests/unit/engine/step.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/step.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { EngineEvent } from "../../../src/engine/events";
import { initialSessionState } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import { AT, campaign, flowState, interpretation, others, sent, userTurn } from "./helpers";

const c = campaign();

describe("step: session start and language phase", () => {
  it("welcomes the candidate on session_started", () => {
    const state = initialSessionState();
    const result = step(state, { type: "session_started", at: AT }, c);

    expect(sent(result.effects)).toEqual(["system.welcome"]);
    expect(result.state).toEqual(state);
  });

  it("sets the language from a language name and enters the flow", () => {
    const result = step(initialSessionState(), userTurn("Arabo"), c);

    expect(others(result.effects)).toEqual(["SetLanguage:ar"]);
    expect(sent(result.effects)).toEqual(["intro", "cv_info"]);
    expect(result.state).toMatchObject({ phase: "flow", language: "ar", stepId: "cv_info" });
  });

  it("uses the detected language when confident", () => {
    const interp = interpretation({ language: { code: "ar", confidence: 0.95 } });
    const result = step(initialSessionState(), userTurn("مرحبا", interp), c);

    expect(others(result.effects)).toEqual(["SetLanguage:ar"]);
  });

  it("falls back to the campaign default language", () => {
    const interp = interpretation({ language: { code: "en", confidence: 0.5 } });
    const result = step(initialSessionState(), userTurn("ok", interp), c);

    expect(others(result.effects)).toEqual(["SetLanguage:it"]);
  });
});

describe("step: other events and phases", () => {
  it("answers in a closed session without changing it", () => {
    const state = flowState({ phase: "closed", stepId: null });
    const result = step(state, userTurn("ciao"), c);

    expect(sent(result.effects)).toEqual(["system.session_closed"]);
    expect(result.state).toEqual(state);
  });

  it("does nothing on timeout (follow-up is out of v1 scope)", () => {
    const state = flowState({ stepId: "cv_info" });
    expect(step(state, { type: "timeout", at: AT }, c)).toEqual({ state, effects: [] });
  });

  it("flags the session when an outbound message failed", () => {
    const result = step(flowState({ stepId: "cv_info" }), { type: "outbound_failed", at: AT }, c);
    expect(result.effects).toEqual([
      { type: "FlagSession", reason: "outbound_failed", needsAttention: true },
    ]);
  });

  it("says it did not understand and asks again when nlu is unavailable", () => {
    const result = step(flowState({ stepId: "cv_info" }), userTurn("boh"), c);
    expect(sent(result.effects)).toEqual(["system.not_understood", "cv_info"]);
  });

  it("answers with the post-interview help after completion", () => {
    const state = flowState({ phase: "post_completion", stepId: null });
    const result = step(state, userTurn("ciao", interpretation()), c);

    expect(sent(result.effects)).toEqual(["system.post_completion_help"]);
  });
});

describe("step: guards (spec §7.2 point 9, D45)", () => {
  const needsAttention = (reason: string) => [
    { type: "SendText", text: { kind: "system", key: "system.generic_error" } },
    { type: "FlagSession", reason, needsAttention: true },
  ];

  it("never stays silent on an incoherent state, and leaves the state as it was", () => {
    const state = flowState({ stepId: "ghost" });
    const result = step(state, userTurn("ciao"), c);

    expect(result.effects).toEqual(needsAttention("incoherent_state"));
    expect(result.state).toBe(state);
  });

  it("rejects session_started outside the language phase", () => {
    const result = step(flowState({ stepId: "cv_info" }), { type: "session_started", at: AT }, c);
    expect(result.effects).toEqual(needsAttention("incoherent_state"));
  });

  it("stops after 20 automatic advances", () => {
    const long = campaign((input) => {
      input.flow = Array.from({ length: 25 }, (_, i) => ({
        id: `m${i}`,
        type: "message" as const,
        text: { it: `Messaggio ${i}` },
      }));
    });
    const state = initialSessionState();
    const result = step(state, userTurn("italiano"), long);

    expect(result.effects).toEqual(needsAttention("auto_advance_limit"));
    expect(result.state).toBe(state);
  });

  it("is pure: same input, same output, input untouched", () => {
    const state = initialSessionState();
    const event: EngineEvent = userTurn("italiano");
    const before = structuredClone(state);

    expect(step(state, event, c)).toEqual(step(state, event, c));
    expect(state).toEqual(before);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/step.test.ts`
Expected: FAIL, il modulo `src/engine/step` non esiste.

- [ ] **Step 3: Implementare `src/engine/replies.ts`**

```ts
import type { Question, QuestionsStep } from "../campaigns/schema/steps";
import { consentTextRef, questionTextRef } from "./advance";
import type { Interpretation } from "./interpretation";
import { stepTextRef } from "./text-ref";
import { currentStep, incoherent, say, systemText, type Turn } from "./turn";

export function currentQuestion(turn: Turn, step: QuestionsStep): Question {
  return (
    step.questions.find((q) => q.id === turn.state.questionId) ??
    incoherent(`unknown current question "${turn.state.questionId ?? "none"}"`)
  );
}

/** Sends the current step's question again. */
export function repromptCurrent(turn: Turn): void {
  const { step } = currentStep(turn);
  switch (step.type) {
    case "choice":
    case "cv_offer":
      say(turn, stepTextRef(step.prompt, step.id));
      return;
    case "consent":
      say(turn, consentTextRef(turn, step));
      return;
    case "questions":
      say(turn, questionTextRef(step, currentQuestion(turn, step)));
      return;
    case "message":
    case "end":
      incoherent(`step "${step.id}" (${step.type}) never waits for an answer`);
  }
}

/** Not an answer to the current step: say so, then ask again. */
export function nonAnswer(turn: Turn, _interpretation: Interpretation | null): void {
  say(turn, systemText("system.not_understood"));
  repromptCurrent(turn);
}
```

- [ ] **Step 4: Implementare `src/engine/language-phase.ts`**

```ts
import { enterStep } from "./advance";
import type { UserTurnEvent } from "./events";
import { chooseLanguage } from "./language";
import { emit, setState, type Turn } from "./turn";

/** The fixed system step before the flow (spec §5.6, D41). */
export function handleLanguageTurn(turn: Turn, event: UserTurnEvent): void {
  const language = chooseLanguage(event.text, event.interpretation, turn.campaign.defaultLanguage);
  emit(turn, { type: "SetLanguage", language });
  setState(turn, { phase: "flow", language });
  enterStep(turn, 0);
}
```

- [ ] **Step 5: Implementare `src/engine/flow-turn.ts`**

```ts
import type { UserTurnEvent } from "./events";
import { nonAnswer } from "./replies";
import type { Turn } from "./turn";

/** A user turn while the flow waits on a step (spec §7.2). */
export function handleFlowTurn(turn: Turn, event: UserTurnEvent): void {
  nonAnswer(turn, event.interpretation);
}
```

- [ ] **Step 6: Implementare `src/engine/post-completion.ts`**

```ts
import type { UserTurnEvent } from "./events";
import type { TextRef } from "./text-ref";
import { say, systemText, type Turn } from "./turn";

/** Spec §5.7: messages after the interview is completed. */
export function handlePostCompletionTurn(turn: Turn, _event: UserTurnEvent): void {
  say(turn, postCompletionHelp(turn));
}

export function postCompletionHelp(turn: Turn): TextRef {
  const { allowEdits, allowCvRegeneration } = turn.campaign.afterCompletion;
  return systemText("system.post_completion_help", { allowEdits, allowCvRegeneration });
}
```

- [ ] **Step 7: Implementare `src/engine/step.ts`**

```ts
import type { CampaignDefinition } from "../campaigns/schema/campaign";
import type { Effect } from "./effects";
import type { EngineEvent, UserTurnEvent } from "./events";
import { handleFlowTurn } from "./flow-turn";
import { handleLanguageTurn } from "./language-phase";
import { handlePostCompletionTurn } from "./post-completion";
import type { SessionState } from "./state";
import { EngineError, createTurn, emit, incoherent, say, systemText, type Turn } from "./turn";

export interface StepResult {
  readonly state: SessionState;
  readonly effects: readonly Effect[];
}

/**
 * The engine (spec §7): pure and deterministic. Time comes from the event; `campaign` is the
 * parsed definition of the version the session is pinned to.
 */
export function step(
  state: SessionState,
  event: EngineEvent,
  campaign: CampaignDefinition,
): StepResult {
  const turn = createTurn(state, campaign, event.at);
  try {
    dispatch(turn, event);
  } catch (error) {
    if (!(error instanceof EngineError)) throw error;
    // Never silent (spec §7.2 point 9): the state stays as it was and the session needs attention.
    return {
      state,
      effects: [
        { type: "SendText", text: systemText("system.generic_error") },
        { type: "FlagSession", reason: error.reason, needsAttention: true },
      ],
    };
  }
  return { state: turn.state, effects: turn.effects };
}

function dispatch(turn: Turn, event: EngineEvent): void {
  switch (event.type) {
    case "session_started":
      if (turn.state.phase !== "language") {
        incoherent(`session_started in phase ${turn.state.phase}`);
      }
      say(turn, systemText("system.welcome"));
      return;
    case "user_turn":
      handleUserTurn(turn, event);
      return;
    case "timeout":
      // Follow-up of abandoned sessions is out of v1 scope (spec §17, D45).
      return;
    case "outbound_failed":
      emit(turn, { type: "FlagSession", reason: "outbound_failed", needsAttention: true });
      return;
  }
}

function handleUserTurn(turn: Turn, event: UserTurnEvent): void {
  switch (turn.state.phase) {
    case "closed":
      say(turn, systemText("system.session_closed"));
      return;
    case "language":
      handleLanguageTurn(turn, event);
      return;
    case "flow":
      handleFlowTurn(turn, event);
      return;
    case "post_completion":
      handlePostCompletionTurn(turn, event);
      return;
  }
}
```

- [ ] **Step 8: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 9: Commit**

```bash
git add src/engine/replies.ts src/engine/language-phase.ts src/engine/flow-turn.ts \
  src/engine/post-completion.ts src/engine/step.ts tests/unit/engine/step.test.ts
git commit -m "feat(chatbot): add the engine step entry point with language phase and guards"
```

---
### Task 13: Risposte a `choice` e `cv_offer`

**Files:**
- Create: `src/engine/choice-answers.ts`
- Modify: `src/engine/flow-turn.ts`
- Test: `tests/unit/engine/choice-answers.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/choice-answers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Interpretation } from "../../../src/engine/interpretation";
import { step } from "../../../src/engine/step";
import { campaign, choice, flowState, interpretation, others, sent, userTurn } from "./helpers";

describe("choice answers", () => {
  const c = campaign();
  const atChoice = flowState({ stepId: "cv_info", outcomes: { intro: "next" } });

  it("follows the chosen option to the next step", () => {
    const result = step(atChoice, userTurn("sì", choice("yes")), c);

    expect(sent(result.effects)).toEqual(["privacy"]);
    expect(result.state.outcomes).toEqual({ intro: "next", cv_info: "yes" });
  });

  it("sends the transition reply and repeats the step", () => {
    const result = step(atChoice, userTurn("cos'è?", choice("idk")), c);

    expect(sent(result.effects)).toEqual(["texts.cv_explain", "cv_info"]);
  });

  it("stops on an option leading to @stop (before the threshold: delete)", () => {
    const result = step(atChoice, userTurn("no", choice("no")), c);

    expect(sent(result.effects)).toEqual(["system.stopped"]);
    expect(others(result.effects)).toEqual(["StopSession:flow_stop:delete"]);
    expect(result.state.phase).toBe("closed");
  });

  it.each([
    ["an unknown option", choice("maybe")],
    ["a non-choice intent", interpretation()],
  ] as [string, Interpretation][])("asks again on %s", (_label, interp) => {
    const result = step(atChoice, userTurn("mah", interp), c);

    expect(sent(result.effects)).toEqual(["system.not_understood", "cv_info"]);
    expect(result.state.stepId).toBe("cv_info");
  });
});

describe("cv_offer answers", () => {
  const c = campaign((input) => {
    input.flow.splice(4, 0, { id: "cv", type: "cv_offer", prompt: { it: "Vuoi che prepari il tuo CV?" } });
  });
  const atCv = flowState({ stepId: "cv", consentsAccepted: true });

  it("enqueues the CV on yes, then moves on", () => {
    const result = step(atCv, userTurn("sì", choice("yes")), c);

    expect(sent(result.effects)).toEqual(["fine"]);
    expect(others(result.effects)).toEqual([
      "EnqueueJob:cv",
      "CompleteSession",
      "EnqueueJob:kubri-webhook:interview.completed",
    ]);
  });

  it("moves on without a CV on no", () => {
    const result = step(atCv, userTurn("no", choice("no")), c);

    expect(others(result.effects)).toEqual([
      "CompleteSession",
      "EnqueueJob:kubri-webhook:interview.completed",
    ]);
  });

  it("asks again on anything else", () => {
    const result = step(atCv, userTurn("forse", choice("maybe")), c);

    expect(sent(result.effects)).toEqual(["system.not_understood", "cv"]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/choice-answers.test.ts`
Expected: FAIL: le scelte valide producono `system.not_understood` invece di avanzare.

- [ ] **Step 3: Implementare `src/engine/choice-answers.ts`**

```ts
import type { ChoiceStep } from "../campaigns/schema/steps";
import { followOutcome } from "./advance";
import type { Interpretation } from "./interpretation";
import { nonAnswer } from "./replies";
import { emit, type Turn } from "./turn";

/** The option picked by a `choice` intent, if any. */
export function chosen(interpretation: Interpretation | null): string | undefined {
  return interpretation?.intent === "choice" ? interpretation.choice : undefined;
}

export function answerChoice(
  turn: Turn,
  index: number,
  step: ChoiceStep,
  interpretation: Interpretation,
): void {
  const option = chosen(interpretation);
  if (option !== undefined && step.options.some((o) => o.id === option)) {
    followOutcome(turn, index, option);
    return;
  }
  nonAnswer(turn, interpretation);
}

/** Spec §12.2: `yes` enqueues the CV generation. */
export function answerCvOffer(turn: Turn, index: number, interpretation: Interpretation): void {
  const option = chosen(interpretation);
  if (option !== "yes" && option !== "no") {
    nonAnswer(turn, interpretation);
    return;
  }
  if (option === "yes") emit(turn, { type: "EnqueueJob", job: { name: "cv" } });
  followOutcome(turn, index, option);
}
```

- [ ] **Step 4: Sostituire `src/engine/flow-turn.ts`**

```ts
import { answerChoice, answerCvOffer } from "./choice-answers";
import type { UserTurnEvent } from "./events";
import { nonAnswer } from "./replies";
import { currentStep, type Turn } from "./turn";

/** A user turn while the flow waits on a step (spec §7.2). */
export function handleFlowTurn(turn: Turn, event: UserTurnEvent): void {
  const interpretation = event.interpretation;
  if (!interpretation) {
    nonAnswer(turn, null);
    return;
  }
  const { step, index } = currentStep(turn);
  switch (step.type) {
    case "choice":
      answerChoice(turn, index, step, interpretation);
      return;
    case "cv_offer":
      answerCvOffer(turn, index, interpretation);
      return;
    default:
      nonAnswer(turn, interpretation);
  }
}
```

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 6: Commit**

```bash
git add src/engine/choice-answers.ts src/engine/flow-turn.ts \
  tests/unit/engine/choice-answers.test.ts
git commit -m "feat(chatbot): handle choice and cv_offer answers in the engine"
```

---

### Task 14: Risposte ai consensi e soglia D24

`RecordConsent` si emette solo dopo la risposta (mai prima), con la copia del testo mostrato per
riferimento. `consentsAccepted` segue la regola D38.

**Files:**
- Create: `src/engine/consent-answer.ts`
- Modify: `src/engine/flow-turn.ts`
- Test: `tests/unit/engine/consent-answer.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/consent-answer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { step } from "../../../src/engine/step";
import { AT, campaign, choice, flowState, interpretation, others, sent, userTurn } from "./helpers";

const atPrivacy = flowState({ stepId: "privacy", outcomes: { intro: "next", cv_info: "yes" } });

describe("consent answers", () => {
  it("records an accepted mandatory consent and crosses the threshold", () => {
    const result = step(atPrivacy, userTurn("accetto", choice("accepted")), campaign());

    expect(result.effects[0]).toEqual({
      type: "RecordConsent",
      stepId: "privacy",
      consentKey: "acme_privacy",
      textVersion: "2026-10",
      text: {
        kind: "step",
        path: "privacy",
        text: { it: "Accetti l'informativa sulla privacy?" },
        params: {
          "dataController.name": "ACME S.r.l.",
          "dataController.privacyUrl": "https://example.com/privacy",
          link: "https://example.com/privacy",
        },
      },
      link: "https://example.com/privacy",
      dataController: { name: "ACME S.r.l.", privacyUrl: "https://example.com/privacy" },
      language: "it",
      outcome: "accepted",
      at: AT,
    });
    expect(others(result.effects)).toEqual([
      "RecordConsent:acme_privacy:accepted",
      "EnqueueJob:kubri-webhook:consents.accepted",
    ]);
    expect(sent(result.effects)).toEqual(["system.progress", "anagrafica.nome"]);
    expect(result.state.consentsAccepted).toBe(true);
  });

  it("stops and deletes on a declined mandatory consent", () => {
    const result = step(atPrivacy, userTurn("no", choice("declined")), campaign());

    expect(others(result.effects)).toEqual([
      "RecordConsent:acme_privacy:declined",
      "StopSession:consent_declined:delete",
    ]);
    expect(sent(result.effects)).toEqual(["system.stopped"]);
    expect(result.state).toMatchObject({ phase: "closed", consentsAccepted: false });
  });

  it("asks again without recording anything when the answer is not a consent choice", () => {
    const result = step(atPrivacy, userTurn("chi siete?", interpretation()), campaign());

    expect(others(result.effects)).toEqual([]);
    expect(sent(result.effects)).toEqual(["system.not_understood", "privacy"]);
  });

  describe("with a second mandatory consent", () => {
    const c = campaign((input) => {
      input.onStop = { data: "keep" };
      input.flow.splice(3, 0, {
        id: "marketing",
        type: "consent",
        consentKey: "acme_marketing",
        textVersion: "2026-10",
        text: { it: "Accetti di ricevere offerte di lavoro?" },
      });
    });
    const atSecond = flowState({ stepId: "marketing", consentsAccepted: true });

    it("does not send consents.accepted twice", () => {
      const result = step(atSecond, userTurn("sì", choice("accepted")), c);
      expect(others(result.effects)).toEqual(["RecordConsent:acme_marketing:accepted"]);
    });

    it("a declined one resets the threshold, so data is deleted despite onStop keep (D38)", () => {
      const result = step(atSecond, userTurn("no", choice("declined")), c);

      expect(others(result.effects)).toEqual([
        "RecordConsent:acme_marketing:declined",
        "StopSession:consent_declined:delete",
      ]);
      expect(result.state.consentsAccepted).toBe(false);
    });
  });

  it("continues on a declined optional consent, threshold unchanged", () => {
    const c = campaign((input) => {
      input.flow.splice(3, 0, {
        id: "kubri",
        type: "consent",
        consentKey: "kubri_global",
        textVersion: "2026-10",
        text: { it: "Vuoi che il tuo profilo sia visibile ad altre aziende?" },
        optional: true,
      });
    });
    const result = step(
      flowState({ stepId: "kubri", consentsAccepted: true }),
      userTurn("no", choice("declined")),
      c,
    );

    expect(others(result.effects)).toEqual(["RecordConsent:kubri_global:declined"]);
    expect(sent(result.effects)).toEqual(["system.progress", "anagrafica.nome"]);
    expect(result.state.consentsAccepted).toBe(true);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/consent-answer.test.ts`
Expected: FAIL: nessun `RecordConsent`, il motore risponde `system.not_understood`.

- [ ] **Step 3: Implementare `src/engine/consent-answer.ts`**

```ts
import type { ConsentStep } from "../campaigns/schema/steps";
import { consentTextRef, followOutcome } from "./advance";
import { chosen } from "./choice-answers";
import type { Interpretation } from "./interpretation";
import { nonAnswer } from "./replies";
import { emit, incoherent, setState, type Turn } from "./turn";

/** Spec §7.3: blocking; recorded only once answered, with the text shown. */
export function answerConsent(
  turn: Turn,
  index: number,
  step: ConsentStep,
  interpretation: Interpretation,
): void {
  const outcome = chosen(interpretation);
  if (outcome !== "accepted" && outcome !== "declined") {
    nonAnswer(turn, interpretation);
    return;
  }
  const language = turn.state.language ?? incoherent("consent answered before the language");
  emit(turn, {
    type: "RecordConsent",
    stepId: step.id,
    consentKey: step.consentKey,
    textVersion: step.textVersion,
    text: consentTextRef(turn, step),
    ...(step.link ? { link: step.link } : {}),
    dataController: turn.campaign.dataController,
    language,
    outcome,
    at: turn.at,
  });
  if (!step.optional) updateThreshold(turn, outcome);
  followOutcome(turn, index, outcome, "consent_declined");
}

/** Spec D24, D38: at least one mandatory consent accepted and none declined. */
function updateThreshold(turn: Turn, outcome: "accepted" | "declined"): void {
  if (outcome === "declined") {
    setState(turn, { consentsAccepted: false });
    return;
  }
  if (turn.state.consentsAccepted) return;
  setState(turn, { consentsAccepted: true });
  // The candidate exists on the Kubri platform from here on (spec §12.1).
  emit(turn, { type: "EnqueueJob", job: { name: "kubri-webhook", event: "consents.accepted" } });
}
```

- [ ] **Step 4: Sostituire `src/engine/flow-turn.ts`**

```ts
import { answerChoice, answerCvOffer } from "./choice-answers";
import { answerConsent } from "./consent-answer";
import type { UserTurnEvent } from "./events";
import { nonAnswer } from "./replies";
import { currentStep, type Turn } from "./turn";

/** A user turn while the flow waits on a step (spec §7.2). */
export function handleFlowTurn(turn: Turn, event: UserTurnEvent): void {
  const interpretation = event.interpretation;
  if (!interpretation) {
    nonAnswer(turn, null);
    return;
  }
  const { step, index } = currentStep(turn);
  switch (step.type) {
    case "choice":
      answerChoice(turn, index, step, interpretation);
      return;
    case "consent":
      answerConsent(turn, index, step, interpretation);
      return;
    case "cv_offer":
      answerCvOffer(turn, index, interpretation);
      return;
    default:
      nonAnswer(turn, interpretation);
  }
}
```

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 6: Commit**

```bash
git add src/engine/consent-answer.ts src/engine/flow-turn.ts \
  tests/unit/engine/consent-answer.test.ts
git commit -m "feat(chatbot): record consents and track the consent threshold"
```

---

### Task 15: Applicazione delle patch

Spec §7.2 punto 2, con le regole D35.

**Files:**
- Create: `src/engine/patches.ts`
- Modify: `src/engine/flow-turn.ts`
- Test: `tests/unit/engine/patches.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/patches.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PatchEntry } from "../../../src/profile/patch";
import { applyExtractedPatch, applyFields } from "../../../src/engine/patches";
import type { SessionState } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import { createTurn, type Turn } from "../../../src/engine/turn";
import {
  AT,
  atQuestion,
  campaign,
  flowState,
  inferred,
  interpretation,
  others,
  sent,
  userTurn,
} from "./helpers";

const entry = (field: string, value: unknown, confidence = 0.9): PatchEntry => ({
  field,
  value,
  confidence,
  evidence: "…",
});
const turnFor = (state: SessionState): Turn => createTurn(state, campaign(), AT);

describe("applyExtractedPatch", () => {
  it("saves every confident valid value, asked or not, as inferred", () => {
    const turn = turnFor(atQuestion("nome"));
    const low = applyExtractedPatch(
      turn,
      [entry("firstName", "Mario"), entry("custom.night_shifts", true)],
      "firstName",
    );

    expect(low).toBeUndefined();
    expect(turn.effects).toEqual([
      {
        type: "ApplyPatch",
        source: "extraction",
        fields: [
          { field: "firstName", value: "Mario", confidence: 0.9, status: "inferred" },
          { field: "custom.night_shifts", value: true, confidence: 0.9, status: "inferred" },
        ],
      },
    ]);
    expect(turn.state.profile).toEqual({
      firstName: { value: "Mario", confidence: 0.9, status: "inferred" },
      "custom.night_shifts": { value: true, confidence: 0.9, status: "inferred" },
    });
  });

  it("saves nothing before the consent threshold", () => {
    const turn = turnFor(atQuestion("nome", { consentsAccepted: false }));
    applyExtractedPatch(turn, [entry("firstName", "Mario")], "firstName");

    expect(turn.effects).toEqual([]);
    expect(turn.state.profile).toEqual({});
  });

  it("records rejected entries without their values", () => {
    const turn = turnFor(atQuestion("nome"));
    applyExtractedPatch(
      turn,
      [entry("phone", "+393331234567"), entry("drivingLicense", "sì")],
      "firstName",
    );

    expect(turn.effects).toEqual([
      {
        type: "RecordPatchRejections",
        rejected: [
          { field: "phone", reason: "system_only_field" },
          { field: "drivingLicense", reason: "invalid_value" },
        ],
      },
    ]);
  });

  it("never overwrites a filled field other than the current question's", () => {
    const turn = turnFor(atQuestion("patente", { profile: { firstName: inferred("Mario") } }));
    applyExtractedPatch(turn, [entry("firstName", "Luigi", 0.99)], "drivingLicense");

    expect(turn.effects).toEqual([]);
  });

  it("may overwrite the current question's field (completing a partial answer)", () => {
    const turn = turnFor(
      atQuestion("nome", { profile: { firstName: inferred("Mario") } }),
    );
    applyExtractedPatch(turn, [entry("firstName", "Mario Rossi")], "firstName");

    expect(others(turn.effects)).toEqual(["ApplyPatch:extraction:firstName"]);
  });

  it("fills an unresolved field", () => {
    const turn = turnFor(
      atQuestion("nome", {
        profile: { drivingLicense: { value: null, confidence: 0, status: "unresolved" } },
      }),
    );
    applyExtractedPatch(turn, [entry("drivingLicense", true)], "firstName");

    expect(others(turn.effects)).toEqual(["ApplyPatch:extraction:drivingLicense"]);
  });

  it("returns a low-confidence value for the current field instead of saving it", () => {
    const turn = turnFor(atQuestion("nome"));
    const low = applyExtractedPatch(turn, [entry("firstName", "Mrio", 0.4)], "firstName");

    expect(low).toEqual(entry("firstName", "Mrio", 0.4));
    expect(turn.effects).toEqual([]);
  });

  it("drops a low-confidence value for another field", () => {
    const turn = turnFor(atQuestion("nome"));
    const low = applyExtractedPatch(turn, [entry("drivingLicense", true, 0.4)], "firstName");

    expect(low).toBeUndefined();
    expect(turn.effects).toEqual([]);
  });

  it("enqueues geocoding when the address changes (spec §12.3)", () => {
    const turn = turnFor(atQuestion("nome"));
    applyExtractedPatch(turn, [entry("address", "Via Roma 1, Milano")], "firstName");

    expect(others(turn.effects)).toEqual(["ApplyPatch:extraction:address", "EnqueueJob:geocoding"]);
  });
});

describe("applyFields", () => {
  it("does nothing with no fields", () => {
    const turn = turnFor(flowState());
    applyFields(turn, "edit", []);
    expect(turn.effects).toEqual([]);
  });
});

describe("step applies patches on any waiting step", () => {
  it("saves values given while answering a choice", () => {
    const state = flowState({ stepId: "cv_info", consentsAccepted: true });
    const interp = interpretation({
      intent: "choice",
      choice: "yes",
      patch: [entry("firstName", "Mario")],
    });
    const result = step(state, userTurn("sì, sono Mario", interp), campaign());

    expect(others(result.effects)).toEqual(["ApplyPatch:extraction:firstName"]);
    expect(sent(result.effects)).toEqual(["privacy"]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/patches.test.ts`
Expected: FAIL, il modulo `src/engine/patches` non esiste.

- [ ] **Step 3: Implementare `src/engine/patches.ts`**

```ts
import { validatePatch, type PatchEntry } from "../profile/patch";
import type { AppliedField, PatchSource } from "./effects";
import { CONFIDENCE_THRESHOLD, isFieldFilled, withField } from "./profile-snapshot";
import { emit, setState, type Turn } from "./turn";

/** Changing this field triggers geocoding (spec §12.3). */
const GEOCODED_FIELD = "address";

/** Saves fields and keeps the profile snapshot in step with the ApplyPatch effect. */
export function applyFields(turn: Turn, source: PatchSource, fields: readonly AppliedField[]): void {
  if (fields.length === 0) return;
  emit(turn, { type: "ApplyPatch", source, fields });
  let profile = turn.state.profile;
  for (const f of fields) {
    profile = withField(profile, f.field, {
      value: f.value,
      confidence: f.confidence,
      status: f.status,
    });
  }
  setState(turn, { profile });
  if (fields.some((f) => f.field === GEOCODED_FIELD)) {
    emit(turn, { type: "EnqueueJob", job: { name: "geocoding" } });
  }
}

/**
 * Spec §7.2 point 2 and D35: every valid, confident extracted value is saved, asked or not, but
 * only after the consent threshold and never over a filled field other than `currentField`.
 * Returns the low-confidence value for `currentField`, which needs a confirmation.
 */
export function applyExtractedPatch(
  turn: Turn,
  entries: readonly PatchEntry[],
  currentField: string | undefined,
): PatchEntry | undefined {
  if (!turn.state.consentsAccepted || entries.length === 0) return undefined;
  const { accepted, rejected } = validatePatch(entries, turn.campaign.customFields);
  if (rejected.length > 0) emit(turn, { type: "RecordPatchRejections", rejected });

  const open = accepted.filter(
    (e) => e.field === currentField || !isFieldFilled(turn.state.profile, e.field),
  );
  applyFields(
    turn,
    "extraction",
    open
      .filter((e) => e.confidence >= CONFIDENCE_THRESHOLD)
      .map(
        (e): AppliedField => ({
          field: e.field,
          value: e.value,
          confidence: e.confidence,
          status: "inferred",
        }),
      ),
  );
  return open.find((e) => e.confidence < CONFIDENCE_THRESHOLD && e.field === currentField);
}
```

- [ ] **Step 4: Sostituire `src/engine/flow-turn.ts`**

```ts
import { answerChoice, answerCvOffer } from "./choice-answers";
import { answerConsent } from "./consent-answer";
import type { UserTurnEvent } from "./events";
import { applyExtractedPatch } from "./patches";
import { currentQuestion, nonAnswer } from "./replies";
import { currentStep, type Turn } from "./turn";

/** A user turn while the flow waits on a step (spec §7.2). */
export function handleFlowTurn(turn: Turn, event: UserTurnEvent): void {
  const interpretation = event.interpretation;
  if (!interpretation) {
    nonAnswer(turn, null);
    return;
  }
  const { step, index } = currentStep(turn);
  const currentField = step.type === "questions" ? currentQuestion(turn, step).field : undefined;
  applyExtractedPatch(turn, interpretation.patch, currentField);
  switch (step.type) {
    case "choice":
      answerChoice(turn, index, step, interpretation);
      return;
    case "consent":
      answerConsent(turn, index, step, interpretation);
      return;
    case "cv_offer":
      answerCvOffer(turn, index, interpretation);
      return;
    default:
      nonAnswer(turn, interpretation);
  }
}
```

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 6: Commit**

```bash
git add src/engine/patches.ts src/engine/flow-turn.ts tests/unit/engine/patches.test.ts
git commit -m "feat(chatbot): apply validated extracted patches in the engine"
```

---

### Task 16: Risposta alla domanda corrente

Se il campo della domanda è ora valorizzato si avanza: `terminateIf`, poi la prossima domanda,
saltando i campi già pieni (è così che funziona la risposta anticipata). Il resto (risposte
parziali, assenti, rifiuti) arriva nel Task 17.

**Files:**
- Create: `src/engine/question-answer.ts`
- Modify: `src/engine/flow-turn.ts`
- Test: `tests/unit/engine/question-answer.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/question-answer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { step } from "../../../src/engine/step";
import {
  answer,
  atQuestion,
  campaign,
  inferred,
  interpretation,
  others,
  sent,
  userTurn,
} from "./helpers";

const c = campaign();

describe("answering the current question", () => {
  it("advances to the next question once the field is filled", () => {
    const result = step(atQuestion("nome"), userTurn("Mario", answer("firstName", "Mario")), c);

    expect(others(result.effects)).toEqual(["ApplyPatch:extraction:firstName"]);
    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
    expect(result.state.questionId).toBe("patente");
  });

  it("asks a conditional question when its condition now holds", () => {
    const state = atQuestion("patente", { profile: { firstName: inferred("Mario") } });
    const result = step(state, userTurn("sì", answer("drivingLicense", true)), c);

    expect(sent(result.effects)).toEqual(["anagrafica.notte"]);
  });

  it("completes the block after the last open question", () => {
    const state = atQuestion("patente", { profile: { firstName: inferred("Mario") } });
    const result = step(state, userTurn("no", answer("drivingLicense", false)), c);

    expect(sent(result.effects)).toEqual(["fine"]);
    expect(others(result.effects)).toEqual([
      "ApplyPatch:extraction:drivingLicense",
      "EnqueueJob:kubri-webhook:block.completed",
      "CompleteSession",
      "EnqueueJob:kubri-webhook:interview.completed",
    ]);
    expect(result.state.phase).toBe("post_completion");
  });

  it("skips questions answered in advance (spec §5.3)", () => {
    const interp = interpretation({
      patch: [
        { field: "firstName", value: "Mario", confidence: 0.95, evidence: "Mario" },
        { field: "drivingLicense", value: false, confidence: 0.95, evidence: "niente patente" },
      ],
    });
    const result = step(atQuestion("nome"), userTurn("Mario, niente patente", interp), c);

    expect(others(result.effects)).toEqual([
      "ApplyPatch:extraction:firstName,drivingLicense",
      "EnqueueJob:kubri-webhook:block.completed",
      "CompleteSession",
      "EnqueueJob:kubri-webhook:interview.completed",
    ]);
  });

  it("terminates the block when the answer meets terminateIf", () => {
    const withTerminate = campaign((input) => {
      input.flow[3] = {
        id: "anagrafica",
        type: "questions",
        questions: [
          { id: "nome", field: "firstName", prompt: { it: "Come ti chiami?" } },
          {
            id: "patente",
            field: "drivingLicense",
            prompt: { it: "Hai la patente?" },
            terminateIf: { field: "drivingLicense", eq: false },
          },
        ],
      };
    });
    const result = step(
      atQuestion("patente"),
      userTurn("no", answer("drivingLicense", false)),
      withTerminate,
    );

    expect(others(result.effects)).toEqual([
      "ApplyPatch:extraction:drivingLicense",
      "StopSession:terminated:delete",
    ]);
    expect(sent(result.effects)).toEqual(["system.stopped"]);
    expect(result.state.outcomes).toMatchObject({ anagrafica: "terminated" });
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/question-answer.test.ts`
Expected: FAIL: il motore risponde `system.not_understood` invece di avanzare.

- [ ] **Step 3: Implementare `src/engine/question-answer.ts`**

```ts
import type { QuestionsStep } from "../campaigns/schema/steps";
import { advanceFromQuestion } from "./advance";
import type { Interpretation } from "./interpretation";
import { isFieldFilled } from "./profile-snapshot";
import { currentQuestion, nonAnswer } from "./replies";
import type { Turn } from "./turn";

/** Spec §7.2 point 3. Runs after the turn's patch has been applied. */
export function answerQuestion(
  turn: Turn,
  index: number,
  step: QuestionsStep,
  interpretation: Interpretation,
): void {
  const question = currentQuestion(turn, step);
  if (isFieldFilled(turn.state.profile, question.field)) {
    advanceFromQuestion(turn, index, step, question);
    return;
  }
  nonAnswer(turn, interpretation);
}
```

- [ ] **Step 4: Sostituire `src/engine/flow-turn.ts`**

Ora tutti e quattro i passaggi che aspettano una risposta sono gestiti: `message` ed `end` come
passaggio corrente sono uno stato incoerente.

```ts
import { answerChoice, answerCvOffer } from "./choice-answers";
import { answerConsent } from "./consent-answer";
import type { UserTurnEvent } from "./events";
import { applyExtractedPatch } from "./patches";
import { answerQuestion } from "./question-answer";
import { currentQuestion, nonAnswer } from "./replies";
import { currentStep, incoherent, type Turn } from "./turn";

/** A user turn while the flow waits on a step (spec §7.2). */
export function handleFlowTurn(turn: Turn, event: UserTurnEvent): void {
  const interpretation = event.interpretation;
  if (!interpretation) {
    nonAnswer(turn, null);
    return;
  }
  const { step, index } = currentStep(turn);
  const currentField = step.type === "questions" ? currentQuestion(turn, step).field : undefined;
  applyExtractedPatch(turn, interpretation.patch, currentField);
  switch (step.type) {
    case "choice":
      answerChoice(turn, index, step, interpretation);
      return;
    case "consent":
      answerConsent(turn, index, step, interpretation);
      return;
    case "cv_offer":
      answerCvOffer(turn, index, interpretation);
      return;
    case "questions":
      answerQuestion(turn, index, step, interpretation);
      return;
    case "message":
    case "end":
      incoherent(`step "${step.id}" (${step.type}) never waits for an answer`);
  }
}
```

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 6: Commit**

```bash
git add src/engine/question-answer.ts src/engine/flow-turn.ts \
  tests/unit/engine/question-answer.test.ts
git commit -m "feat(chatbot): advance through questions as their fields fill up"
```

---

### Task 17: Approfondimenti, `maxClarifications` e `unresolved`

Spec §7.2 punto 3, con D43: `partial` → approfondimento mirato su ciò che manca; `absent` (o
`unclear`) → domanda riformulata; dopo il limite la facoltativa si salta, l'obbligatoria diventa
`unresolved` con `FlagSession`, e si avanza.

**Files:**
- Modify: `src/engine/question-answer.ts`
- Test: `tests/unit/engine/clarifications.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/clarifications.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CampaignDefinition } from "../../../src/campaigns/schema/campaign";
import { step } from "../../../src/engine/step";
import { atQuestion, campaign, interpretation, others, sent, userTurn } from "./helpers";

const c = campaign();
const nomePrompt = { kind: "step", path: "anagrafica.nome", text: { it: "Come ti chiami?" } };

const optionalNome = (maxClarifications: number): CampaignDefinition =>
  campaign((input) => {
    input.flow[3] = {
      id: "anagrafica",
      type: "questions",
      questions: [
        {
          id: "nome",
          field: "firstName",
          prompt: { it: "Come ti chiami?" },
          required: false,
          maxClarifications,
        },
        { id: "patente", field: "drivingLicense", prompt: { it: "Hai la patente?" } },
      ],
    };
  });

describe("clarifications", () => {
  it("rephrases the question when the answer is absent", () => {
    const result = step(atQuestion("nome"), userTurn("boh", interpretation()), c);

    expect(result.effects).toEqual([{ type: "SendText", text: nomePrompt, purpose: "rephrase" }]);
    expect(result.state.clarifications).toBe(1);
  });

  it("asks a targeted clarification on a partial answer, even with a value saved", () => {
    const interp = interpretation({
      patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "Mario" }],
      currentQuestion: { completeness: "partial", missing: "cognome" },
    });
    const result = step(atQuestion("nome"), userTurn("Mario", interp), c);

    expect(result.effects).toEqual([
      {
        type: "ApplyPatch",
        source: "extraction",
        fields: [{ field: "firstName", value: "Mario", confidence: 0.95, status: "inferred" }],
      },
      {
        type: "SendText",
        text: { ...nomePrompt, params: { missing: "cognome" } },
        purpose: "clarify",
      },
    ]);
    expect(result.state).toMatchObject({ questionId: "nome", clarifications: 1 });
  });

  it("advances on a partial answer once clarifications are used up, if a value exists", () => {
    const interp = interpretation({
      patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "Mario" }],
      currentQuestion: { completeness: "partial", missing: "cognome" },
    });
    const result = step(atQuestion("nome", { clarifications: 2 }), userTurn("Mario", interp), c);

    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
  });

  it("marks a required field unresolved, flags the session and moves on", () => {
    const result = step(
      atQuestion("nome", { clarifications: 2 }),
      userTurn("non lo dico", interpretation()),
      c,
    );

    expect(others(result.effects)).toEqual([
      "MarkFieldUnresolved:firstName",
      "FlagSession:unresolved_field:firstName",
    ]);
    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
    expect(result.state.profile.firstName).toEqual({
      value: null,
      confidence: 0,
      status: "unresolved",
    });
  });

  it("skips an optional question silently once clarifications are used up", () => {
    const result = step(atQuestion("nome"), userTurn("boh", interpretation()), optionalNome(0));

    expect(others(result.effects)).toEqual([]);
    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
  });

  it("skips an optional question at once on a refusal", () => {
    const result = step(
      atQuestion("nome"),
      userTurn("preferisco di no", interpretation({ intent: "refusal" })),
      optionalNome(2),
    );

    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
  });

  it("treats a refusal of a required question like an absent answer", () => {
    const result = step(
      atQuestion("nome"),
      userTurn("preferisco di no", interpretation({ intent: "refusal" })),
      c,
    );

    expect(result.effects).toEqual([{ type: "SendText", text: nomePrompt, purpose: "rephrase" }]);
  });

  it.each(["off_topic", "help"] as const)("%s does not use up a clarification", (intent) => {
    const result = step(atQuestion("nome"), userTurn("?", interpretation({ intent })), c);

    expect(result.state).toMatchObject({ questionId: "nome", clarifications: 0 });
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/clarifications.test.ts`
Expected: FAIL: il motore risponde `system.not_understood` invece di riformulare.

- [ ] **Step 3: Sostituire `src/engine/question-answer.ts`**

```ts
import type { Question, QuestionsStep } from "../campaigns/schema/steps";
import { advanceFromQuestion, askQuestion } from "./advance";
import type { Interpretation } from "./interpretation";
import { isFieldFilled, withField } from "./profile-snapshot";
import { currentQuestion, nonAnswer } from "./replies";
import { emit, setState, type Turn } from "./turn";

/** Spec §7.2 point 3 and D43. Runs after the turn's patch has been applied. */
export function answerQuestion(
  turn: Turn,
  index: number,
  step: QuestionsStep,
  interpretation: Interpretation,
): void {
  const question = currentQuestion(turn, step);
  if (interpretation.intent === "off_topic" || interpretation.intent === "help") {
    nonAnswer(turn, interpretation);
    return;
  }
  if (interpretation.intent === "refusal" && !question.required) {
    advanceFromQuestion(turn, index, step, question);
    return;
  }
  const filled = isFieldFilled(turn.state.profile, question.field);
  const { completeness, missing } = interpretation.currentQuestion;
  const canClarify = turn.state.clarifications < question.maxClarifications;
  if (completeness === "partial" && canClarify) {
    clarify(turn, step, question, missing);
    return;
  }
  if (filled) {
    advanceFromQuestion(turn, index, step, question);
    return;
  }
  if (canClarify) {
    rephrase(turn, step, question);
    return;
  }
  giveUp(turn, index, step, question);
}

function clarify(
  turn: Turn,
  step: QuestionsStep,
  question: Question,
  missing: string | undefined,
): void {
  setState(turn, { clarifications: turn.state.clarifications + 1 });
  askQuestion(turn, step, question, "clarify", missing ? { missing } : undefined);
}

function rephrase(turn: Turn, step: QuestionsStep, question: Question): void {
  setState(turn, { clarifications: turn.state.clarifications + 1 });
  askQuestion(turn, step, question, "rephrase");
}

/** Clarifications used up: optional → skipped; required → unresolved + FlagSession. */
function giveUp(turn: Turn, index: number, step: QuestionsStep, question: Question): void {
  if (question.required) {
    emit(
      turn,
      { type: "MarkFieldUnresolved", field: question.field },
      { type: "FlagSession", reason: "unresolved_field", needsAttention: false, field: question.field },
    );
    setState(turn, {
      profile: withField(turn.state.profile, question.field, {
        value: null,
        confidence: 0,
        status: "unresolved",
      }),
    });
  }
  advanceFromQuestion(turn, index, step, question);
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/engine/question-answer.ts tests/unit/engine/clarifications.test.ts
git commit -m "feat(chatbot): clarify partial answers and give up after maxClarifications"
```

---

### Task 18: Conferma dei valori a bassa confidenza

Sotto la soglia il valore non si salva: il motore chiede conferma (`pendingConfirmation`) e
risolve la risposta secondo D36.

**Files:**
- Create: `src/engine/confirmations.ts`
- Modify: `src/engine/question-answer.ts`, `src/engine/flow-turn.ts`
- Test: `tests/unit/engine/confirmations.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/confirmations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ValueConfirmation } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import {
  answer,
  atQuestion,
  campaign,
  choice,
  interpretation,
  others,
  sent,
  userTurn,
} from "./helpers";

const c = campaign();
const pending: ValueConfirmation = {
  kind: "value",
  field: "firstName",
  value: "Mrio",
  confidence: 0.4,
};

describe("low-confidence values", () => {
  it("asks for a confirmation instead of saving", () => {
    const interp = interpretation({
      patch: [{ field: "firstName", value: "Mrio", confidence: 0.4, evidence: "Mrio" }],
      currentQuestion: { completeness: "complete" },
    });
    const result = step(atQuestion("nome"), userTurn("Mrio", interp), c);

    expect(result.effects).toEqual([
      {
        type: "SendText",
        text: {
          kind: "system",
          key: "system.confirm_value",
          params: { field: "firstName", value: "Mrio" },
        },
      },
    ]);
    expect(result.state.pendingConfirmation).toEqual(pending);
  });

  it("saves the value as confirmed on yes and moves on", () => {
    const state = atQuestion("nome", { pendingConfirmation: pending });
    const result = step(state, userTurn("sì", choice("yes")), c);

    expect(others(result.effects)).toEqual(["ApplyPatch:extraction:firstName"]);
    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
    expect(result.state.profile.firstName).toEqual({
      value: "Mrio",
      confidence: 1,
      status: "confirmed",
    });
    expect(result.state.pendingConfirmation).toBeNull();
  });

  it("drops the value on no and asks the question again", () => {
    const state = atQuestion("nome", { pendingConfirmation: pending });
    const result = step(state, userTurn("no", choice("no")), c);

    expect(others(result.effects)).toEqual([]);
    expect(sent(result.effects)).toEqual(["anagrafica.nome"]);
    expect(result.state).toMatchObject({ pendingConfirmation: null, clarifications: 0 });
  });

  it("drops the confirmation and handles any other message as a fresh answer (D36)", () => {
    const state = atQuestion("nome", { pendingConfirmation: pending });
    const result = step(state, userTurn("Marco", answer("firstName", "Marco")), c);

    expect(others(result.effects)).toEqual(["ApplyPatch:extraction:firstName"]);
    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
    expect(result.state.profile.firstName?.value).toBe("Marco");
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/confirmations.test.ts`
Expected: FAIL: nessuna richiesta di conferma, `pendingConfirmation` resta `null`.

- [ ] **Step 3: Implementare `src/engine/confirmations.ts`**

```ts
import type { PatchEntry } from "../profile/patch";
import { advanceFromQuestion } from "./advance";
import { applyFields } from "./patches";
import { isFieldFilled } from "./profile-snapshot";
import { currentQuestion, repromptCurrent } from "./replies";
import type { PendingConfirmation } from "./state";
import { toTextParam } from "./text-ref";
import { currentStep, say, setState, systemText, type Turn } from "./turn";

/** Spec §7.2 point 2: below the threshold the value is not saved, the engine asks first. */
export function askConfirmation(turn: Turn, entry: PatchEntry): void {
  setState(turn, {
    pendingConfirmation: {
      kind: "value",
      field: entry.field,
      value: entry.value,
      confidence: entry.confidence,
    },
  });
  say(
    turn,
    systemText("system.confirm_value", { field: entry.field, value: toTextParam(entry.value) }),
  );
}

/** The candidate said yes to a pending confirmation during the flow. */
export function confirmPending(turn: Turn, pending: PendingConfirmation): void {
  if (pending.kind === "value") {
    applyFields(turn, "extraction", [
      { field: pending.field, value: pending.value, confidence: 1, status: "confirmed" },
    ]);
  }
  resumeFlow(turn);
}

/** Moves on if the current question is now answered, otherwise asks it again. */
function resumeFlow(turn: Turn): void {
  const { step, index } = currentStep(turn);
  if (step.type === "questions") {
    const question = currentQuestion(turn, step);
    if (isFieldFilled(turn.state.profile, question.field)) {
      advanceFromQuestion(turn, index, step, question);
      return;
    }
  }
  repromptCurrent(turn);
}
```

- [ ] **Step 4: Aggiornare `src/engine/question-answer.ts`**

Aggiungere gli import:

```ts
import type { PatchEntry } from "../profile/patch";
import { askConfirmation } from "./confirmations";
```

e sostituire la firma e la prima parte di `answerQuestion` con:

```ts
/** Spec §7.2 point 3 and D43. Runs after the turn's patch has been applied. */
export function answerQuestion(
  turn: Turn,
  index: number,
  step: QuestionsStep,
  interpretation: Interpretation,
  lowConfidence: PatchEntry | undefined,
): void {
  const question = currentQuestion(turn, step);
  if (lowConfidence) {
    askConfirmation(turn, lowConfidence);
    return;
  }
  if (interpretation.intent === "off_topic" || interpretation.intent === "help") {
```

(il resto della funzione resta com'è).

- [ ] **Step 5: Sostituire `src/engine/flow-turn.ts`**

```ts
import { answerChoice, answerCvOffer } from "./choice-answers";
import { confirmPending } from "./confirmations";
import { answerConsent } from "./consent-answer";
import type { UserTurnEvent } from "./events";
import { isChoice } from "./interpretation";
import { applyExtractedPatch } from "./patches";
import { answerQuestion } from "./question-answer";
import { currentQuestion, nonAnswer, repromptCurrent } from "./replies";
import { currentStep, incoherent, setState, type Turn } from "./turn";

/** A user turn while the flow waits on a step (spec §7.2). */
export function handleFlowTurn(turn: Turn, event: UserTurnEvent): void {
  const interpretation = event.interpretation;
  const pending = turn.state.pendingConfirmation;
  if (pending) {
    // D36: yes applies, no cancels, anything else drops the confirmation and goes on below.
    setState(turn, { pendingConfirmation: null });
    if (isChoice(interpretation, "yes")) {
      confirmPending(turn, pending);
      return;
    }
    if (isChoice(interpretation, "no")) {
      repromptCurrent(turn);
      return;
    }
  }
  if (!interpretation) {
    nonAnswer(turn, null);
    return;
  }
  const { step, index } = currentStep(turn);
  const currentField = step.type === "questions" ? currentQuestion(turn, step).field : undefined;
  const lowConfidence = applyExtractedPatch(turn, interpretation.patch, currentField);
  switch (step.type) {
    case "choice":
      answerChoice(turn, index, step, interpretation);
      return;
    case "consent":
      answerConsent(turn, index, step, interpretation);
      return;
    case "cv_offer":
      answerCvOffer(turn, index, interpretation);
      return;
    case "questions":
      answerQuestion(turn, index, step, interpretation, lowConfidence);
      return;
    case "message":
    case "end":
      incoherent(`step "${step.id}" (${step.type}) never waits for an answer`);
  }
}
```

- [ ] **Step 6: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 7: Commit**

```bash
git add src/engine/confirmations.ts src/engine/question-answer.ts src/engine/flow-turn.ts \
  tests/unit/engine/confirmations.test.ts
git commit -m "feat(chatbot): confirm low-confidence values before saving them"
```

---

### Task 19: Fuori contesto e aiuto

Spec §7.2 punto 4: risposta breve, poi si ripete la domanda corrente.

**Files:**
- Modify: `src/engine/replies.ts`
- Test: `tests/unit/engine/off-topic.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/off-topic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { step } from "../../../src/engine/step";
import { atQuestion, campaign, flowState, interpretation, sent, userTurn } from "./helpers";

const c = campaign();
const atChoice = flowState({ stepId: "cv_info" });

describe("off-topic and help", () => {
  it("sends the LLM's short off-topic reply as is, then the question again", () => {
    const interp = interpretation({
      intent: "off_topic",
      offTopicReply: "Sono qui per il colloquio di lavoro.",
    });
    const result = step(atChoice, userTurn("che tempo fa?", interp), c);

    expect(result.effects[0]).toEqual({
      type: "SendText",
      text: { kind: "generated", text: "Sono qui per il colloquio di lavoro." },
    });
    expect(sent(result.effects)).toEqual(["generated", "cv_info"]);
  });

  it("falls back to the system off-topic text without a reply", () => {
    const result = step(atChoice, userTurn("che tempo fa?", interpretation({ intent: "off_topic" })), c);
    expect(sent(result.effects)).toEqual(["system.off_topic", "cv_info"]);
  });

  it("sends the help text on help", () => {
    const result = step(atChoice, userTurn("aiuto", interpretation({ intent: "help" })), c);
    expect(sent(result.effects)).toEqual(["system.help", "cv_info"]);
  });

  it("works inside a questions block too", () => {
    const result = step(atQuestion("nome"), userTurn("?", interpretation({ intent: "off_topic" })), c);
    expect(sent(result.effects)).toEqual(["system.off_topic", "anagrafica.nome"]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/off-topic.test.ts`
Expected: FAIL: il primo testo è `system.not_understood`.

- [ ] **Step 3: Aggiornare `src/engine/replies.ts`**

Aggiungere l'import `type TextRef` da `./text-ref` (la riga diventa
`import { stepTextRef, type TextRef } from "./text-ref";`) e sostituire `nonAnswer` con:

```ts
/** Not an answer to the current step: a short lead text, then the question again. */
export function nonAnswer(turn: Turn, interpretation: Interpretation | null): void {
  say(turn, leadText(interpretation));
  repromptCurrent(turn);
}

function leadText(interpretation: Interpretation | null): TextRef {
  if (interpretation?.intent === "off_topic") {
    return interpretation.offTopicReply
      ? { kind: "generated", text: interpretation.offTopicReply }
      : systemText("system.off_topic");
  }
  if (interpretation?.intent === "help") return systemText("system.help");
  return systemText("system.not_understood");
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/engine/replies.ts tests/unit/engine/off-topic.test.ts
git commit -m "feat(chatbot): reply to off-topic and help messages, then ask again"
```

---

### Task 20: Richiesta di modifica durante il flusso

Spec §7.2 punto 5: conferma con il valore vecchio e quello nuovo, poi si riprende da dove si era.

**Files:**
- Create: `src/engine/edits.ts`
- Modify: `src/engine/confirmations.ts`, `src/engine/flow-turn.ts`
- Test: `tests/unit/engine/edits.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/edits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Interpretation } from "../../../src/engine/interpretation";
import type { EditConfirmation } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import {
  atQuestion,
  campaign,
  choice,
  flowState,
  inferred,
  interpretation,
  others,
  sent,
  userTurn,
} from "./helpers";

const c = campaign();
const atPatente = atQuestion("patente", { profile: { firstName: inferred("Mario") } });
const edit = (field: string, newValue: unknown): Interpretation =>
  interpretation({ intent: "edit_request", editTarget: { field, newValue } });
const pending: EditConfirmation = {
  kind: "edit",
  field: "firstName",
  oldValue: "Mario",
  newValue: "Marco",
};

describe("edit requests during the flow", () => {
  it("asks to confirm, showing the old and the new value", () => {
    const result = step(atPatente, userTurn("mi chiamo Marco", edit("firstName", "Marco")), c);

    expect(result.effects).toEqual([
      {
        type: "SendText",
        text: {
          kind: "system",
          key: "system.confirm_edit",
          params: { field: "firstName", oldValue: "Mario", newValue: "Marco" },
        },
      },
    ]);
    expect(result.state.pendingConfirmation).toEqual(pending);
  });

  it("saves the edit on yes, then resumes the current question", () => {
    const state = { ...atPatente, pendingConfirmation: pending };
    const result = step(state, userTurn("sì", choice("yes")), c);

    expect(others(result.effects)).toEqual(["ApplyPatch:edit:firstName"]);
    expect(sent(result.effects)).toEqual(["system.edit_saved", "anagrafica.patente"]);
    expect(result.state.profile.firstName).toEqual({
      value: "Marco",
      confidence: 1,
      status: "confirmed",
    });
  });

  it("cancels on no, then resumes the current question", () => {
    const state = { ...atPatente, pendingConfirmation: pending };
    const result = step(state, userTurn("no", choice("no")), c);

    expect(sent(result.effects)).toEqual(["system.edit_cancelled", "anagrafica.patente"]);
    expect(result.state.profile.firstName?.value).toBe("Mario");
  });

  it("rejects an invalid value and resumes", () => {
    const result = step(atPatente, userTurn("cambia", edit("drivingLicense", "forse")), c);
    expect(sent(result.effects)).toEqual(["system.edit_invalid", "anagrafica.patente"]);
  });

  it("rejects an edit without a target", () => {
    const result = step(atPatente, userTurn("cambia", interpretation({ intent: "edit_request" })), c);
    expect(sent(result.effects)).toEqual(["system.edit_invalid", "anagrafica.patente"]);
  });

  it("rejects edits before the consent threshold", () => {
    const result = step(
      flowState({ stepId: "cv_info" }),
      userTurn("mi chiamo Marco", edit("firstName", "Marco")),
      c,
    );
    expect(sent(result.effects)).toEqual(["system.edit_invalid", "cv_info"]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/edits.test.ts`
Expected: FAIL: nessuna richiesta di conferma della modifica.

- [ ] **Step 3: Implementare `src/engine/edits.ts`**

```ts
import { validatePatch } from "../profile/patch";
import type { Interpretation } from "./interpretation";
import { applyFields } from "./patches";
import { fieldState } from "./profile-snapshot";
import type { EditConfirmation } from "./state";
import { toTextParam } from "./text-ref";
import { say, setState, systemText, type Turn } from "./turn";

/**
 * Asks to confirm an edit, with the old and the new value (spec §5.7, §7.2 point 5).
 * Returns false when the edit cannot be used: no target, invalid value, or no consent yet.
 */
export function requestEdit(turn: Turn, interpretation: Interpretation): boolean {
  const target = interpretation.editTarget;
  if (!target || !turn.state.consentsAccepted) return false;
  const { accepted } = validatePatch(
    [{ field: target.field, value: target.newValue, confidence: 1, evidence: "" }],
    turn.campaign.customFields,
  );
  const entry = accepted[0];
  if (!entry) return false;
  const oldValue = fieldState(turn.state.profile, entry.field)?.value ?? null;
  setState(turn, {
    pendingConfirmation: { kind: "edit", field: entry.field, oldValue, newValue: entry.value },
  });
  say(
    turn,
    systemText("system.confirm_edit", {
      field: entry.field,
      oldValue: toTextParam(oldValue),
      newValue: toTextParam(entry.value),
    }),
  );
  return true;
}

/** Saves a confirmed edit as `ProfileChange(source: edit)`. */
export function saveEdit(turn: Turn, pending: EditConfirmation): void {
  applyFields(turn, "edit", [
    { field: pending.field, value: pending.newValue, confidence: 1, status: "confirmed" },
  ]);
  say(turn, systemText("system.edit_saved"));
}
```

- [ ] **Step 4: Aggiornare `src/engine/confirmations.ts`**

Aggiungere l'import `import { saveEdit } from "./edits";` e sostituire `confirmPending` con:

```ts
/** The candidate said yes to a pending confirmation during the flow. */
export function confirmPending(turn: Turn, pending: PendingConfirmation): void {
  if (pending.kind === "value") {
    applyFields(turn, "extraction", [
      { field: pending.field, value: pending.value, confidence: 1, status: "confirmed" },
    ]);
  } else {
    saveEdit(turn, pending);
  }
  resumeFlow(turn);
}
```

- [ ] **Step 5: Sostituire `src/engine/flow-turn.ts`** (versione finale)

```ts
import { answerChoice, answerCvOffer } from "./choice-answers";
import { confirmPending } from "./confirmations";
import { answerConsent } from "./consent-answer";
import { requestEdit } from "./edits";
import type { UserTurnEvent } from "./events";
import { isChoice } from "./interpretation";
import { applyExtractedPatch } from "./patches";
import { answerQuestion } from "./question-answer";
import { currentQuestion, nonAnswer, repromptCurrent } from "./replies";
import { currentStep, incoherent, say, setState, systemText, type Turn } from "./turn";

/** A user turn while the flow waits on a step (spec §7.2). */
export function handleFlowTurn(turn: Turn, event: UserTurnEvent): void {
  const interpretation = event.interpretation;
  const pending = turn.state.pendingConfirmation;
  if (pending) {
    // D36: yes applies, no cancels, anything else drops the confirmation and goes on below.
    setState(turn, { pendingConfirmation: null });
    if (isChoice(interpretation, "yes")) {
      confirmPending(turn, pending);
      return;
    }
    if (isChoice(interpretation, "no")) {
      if (pending.kind === "edit") say(turn, systemText("system.edit_cancelled"));
      repromptCurrent(turn);
      return;
    }
  }
  if (!interpretation) {
    nonAnswer(turn, null);
    return;
  }
  if (interpretation.intent === "edit_request") {
    if (!requestEdit(turn, interpretation)) {
      say(turn, systemText("system.edit_invalid"));
      repromptCurrent(turn);
    }
    return;
  }
  const { step, index } = currentStep(turn);
  const currentField = step.type === "questions" ? currentQuestion(turn, step).field : undefined;
  const lowConfidence = applyExtractedPatch(turn, interpretation.patch, currentField);
  switch (step.type) {
    case "choice":
      answerChoice(turn, index, step, interpretation);
      return;
    case "consent":
      answerConsent(turn, index, step, interpretation);
      return;
    case "cv_offer":
      answerCvOffer(turn, index, interpretation);
      return;
    case "questions":
      answerQuestion(turn, index, step, interpretation, lowConfidence);
      return;
    case "message":
    case "end":
      incoherent(`step "${step.id}" (${step.type}) never waits for an answer`);
  }
}
```

- [ ] **Step 6: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 7: Commit**

```bash
git add src/engine/edits.ts src/engine/confirmations.ts src/engine/flow-turn.ts \
  tests/unit/engine/edits.test.ts
git commit -m "feat(chatbot): confirm and apply edit requests during the flow"
```

---

### Task 21: Gestione degli intenti globali (`opt_out`, `delete_data`)

> **Decisione del proprietario (2026-10-24), prevale sul codice qui sotto:** `delete_data` **chiede conferma** prima di cancellare, sia quando arriva dall'LLM sia dalle parole chiave deterministiche. Il primo `delete_data` imposta `pendingConfirmation = { kind: "delete_data" }` e invia la chiave di sistema `system.delete_confirm` (da aggiungere all'unione delle chiavi di sistema); nessun dato viene toccato. Al turno successivo: un "sì" (scelta `yes` o parola chiave di conferma) produce `StopSession { dataPolicy: "delete" }` + `EnqueueJob delete-contact` + `system.delete_done`; qualsiasi altra risposta annulla la richiesta, invia `system.delete_cancelled` e riprende da dove si era. `opt_out` dopo il completamento conserva i dati (solo `OptOut`). Adeguare test e implementazione di questo task di conseguenza. Prima dello switch sulle fasi in `handleUserTurn`, controllare gli intenti globali anche in fase `closed` (D40); nei task 18/20/22 gestire `pendingConfirmation.kind === "delete_data"` prima del ramo value/edit.

Valutati per primi, in ogni fase (D39, D40).

**Files:**
- Modify: `src/engine/global-intents.ts`, `src/engine/step.ts`
- Test: `tests/unit/engine/global-turn.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/global-turn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { initialSessionState } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import {
  answer,
  atQuestion,
  campaign,
  flowState,
  inferred,
  interpretation,
  others,
  sent,
  userTurn,
} from "./helpers";

const c = campaign();
const keep = campaign((input) => {
  input.onStop = { data: "keep" };
});
const completed = flowState({
  phase: "post_completion",
  stepId: null,
  consentsAccepted: true,
  profile: { firstName: inferred("Mario") },
});

describe("opt_out", () => {
  it("works without the LLM and deletes everything before the threshold", () => {
    const result = step(flowState({ stepId: "cv_info" }), userTurn("STOP!"), c);

    expect(sent(result.effects)).toEqual(["system.opt_out_confirm"]);
    expect(others(result.effects)).toEqual(["StopSession:opt_out:delete", "OptOut"]);
    expect(result.state.phase).toBe("closed");
  });

  it("applies onStop after the threshold", () => {
    const interp = interpretation({ intent: "opt_out" });
    const result = step(atQuestion("nome"), userTurn("non voglio più", interp), keep);

    expect(others(result.effects)).toEqual(["StopSession:opt_out:keep", "OptOut"]);
  });

  it("wins over an answer extracted by the LLM", () => {
    const result = step(atQuestion("nome"), userTurn("stop", answer("firstName", "Stop")), c);

    expect(others(result.effects)).toEqual(["StopSession:opt_out:delete", "OptOut"]);
  });

  it("works in the language phase", () => {
    const result = step(initialSessionState(), userTurn("basta"), c);
    expect(others(result.effects)).toEqual(["StopSession:opt_out:delete", "OptOut"]);
  });

  it("keeps the data of a completed interview", () => {
    const result = step(completed, userTurn("stop"), c);

    expect(sent(result.effects)).toEqual(["system.opt_out_confirm"]);
    expect(others(result.effects)).toEqual(["OptOut"]);
    expect(result.state.phase).toBe("closed");
  });
});

describe("delete_data", () => {
  it("always deletes, even after the threshold with onStop keep", () => {
    const result = step(atQuestion("nome"), userTurn("Cancella i miei dati"), keep);

    expect(sent(result.effects)).toEqual(["system.delete_confirm"]);
    expect(others(result.effects)).toEqual([
      "EnqueueJob:delete-contact",
      "StopSession:delete_data:delete",
    ]);
  });

  it("deletes a completed interview", () => {
    const result = step(completed, userTurn("cancellami"), c);

    expect(others(result.effects)).toEqual(["EnqueueJob:delete-contact"]);
    expect(result.state.phase).toBe("closed");
  });

  it("is still possible in a closed session", () => {
    const result = step(flowState({ phase: "closed", stepId: null }), userTurn("cancellami"), c);

    expect(sent(result.effects)).toEqual(["system.delete_confirm"]);
    expect(others(result.effects)).toEqual(["EnqueueJob:delete-contact"]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/global-turn.test.ts`
Expected: FAIL: "STOP!" viene trattato come una risposta non capita.

- [ ] **Step 3: Aggiungere la gestione in `src/engine/global-intents.ts`**

Aggiungere in cima gli import:

```ts
import { stopSession } from "./advance";
import { emit, say, setState, systemText, type Turn } from "./turn";
```

e in fondo al file:

```ts
/** Spec §7.2 point 1, D39: evaluated first, in every phase. */
export function handleGlobalIntent(turn: Turn, intent: GlobalIntent): void {
  const goodbye = systemText(
    intent === "opt_out" ? "system.opt_out_confirm" : "system.delete_confirm",
  );
  if (intent === "delete_data") {
    emit(turn, { type: "EnqueueJob", job: { name: "delete-contact" } });
  }
  const { phase } = turn.state;
  if (phase === "language" || phase === "flow") {
    stopSession(turn, intent, intent === "delete_data" ? { goodbye, dataPolicy: "delete" } : { goodbye });
  } else {
    // A completed or closed interview keeps its data unless deletion was asked.
    say(turn, goodbye);
    setState(turn, { phase: "closed", stepId: null, questionId: null, pendingConfirmation: null });
  }
  if (intent === "opt_out") emit(turn, { type: "OptOut", at: turn.at });
}
```

- [ ] **Step 4: Aggiornare `src/engine/step.ts`**

Aggiungere l'import:

```ts
import { globalIntentOf, handleGlobalIntent } from "./global-intents";
```

e sostituire `handleUserTurn` con:

```ts
function handleUserTurn(turn: Turn, event: UserTurnEvent): void {
  const global = globalIntentOf(event.text, event.interpretation);
  if (global) {
    handleGlobalIntent(turn, global);
    return;
  }
  switch (turn.state.phase) {
    case "closed":
      say(turn, systemText("system.session_closed"));
      return;
    case "language":
      handleLanguageTurn(turn, event);
      return;
    case "flow":
      handleFlowTurn(turn, event);
      return;
    case "post_completion":
      handlePostCompletionTurn(turn, event);
      return;
  }
}
```

- [ ] **Step 5: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 6: Commit**

```bash
git add src/engine/global-intents.ts src/engine/step.ts tests/unit/engine/global-turn.test.ts
git commit -m "feat(chatbot): handle opt-out and data deletion in every phase"
```

---

### Task 22: Fase dopo il completamento

Spec §5.7: modifica con conferma ed evento `profile.updated` (se `allowEdits`), rigenerazione
del CV tramite `cv_offer` (se `allowCvRegeneration`, D44), altrimenti risposta cortese.

**Files:**
- Modify: `src/engine/post-completion.ts`
- Test: `tests/unit/engine/post-completion.test.ts`

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/unit/engine/post-completion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CampaignInput } from "../../../src/campaigns/schema/campaign";
import type { EditConfirmation } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import {
  answer,
  campaign,
  choice,
  flowState,
  inferred,
  interpretation,
  others,
  sent,
  userTurn,
} from "./helpers";

const completed = flowState({
  phase: "post_completion",
  stepId: null,
  consentsAccepted: true,
  profile: { firstName: inferred("Mario") },
});
const edit = interpretation({
  intent: "edit_request",
  editTarget: { field: "firstName", newValue: "Marco" },
});
const pending: EditConfirmation = {
  kind: "edit",
  field: "firstName",
  oldValue: "Mario",
  newValue: "Marco",
};
const withCv = (afterCompletion: CampaignInput["afterCompletion"]) =>
  campaign((input) => {
    input.flow.splice(4, 0, { id: "cv", type: "cv_offer", prompt: { it: "Vuoi il tuo CV?" } });
    input.afterCompletion = afterCompletion;
  });

describe("post-completion edits", () => {
  const c = campaign();

  it("asks to confirm an edit", () => {
    const result = step(completed, userTurn("mi chiamo Marco", edit), c);

    expect(sent(result.effects)).toEqual(["system.confirm_edit"]);
    expect(result.state.pendingConfirmation).toEqual(pending);
  });

  it("saves it on yes and notifies the Kubri platform", () => {
    const state = { ...completed, pendingConfirmation: pending };
    const result = step(state, userTurn("sì", choice("yes")), c);

    expect(others(result.effects)).toEqual([
      "ApplyPatch:edit:firstName",
      "EnqueueJob:kubri-webhook:profile.updated",
    ]);
    expect(sent(result.effects)).toEqual(["system.edit_saved"]);
    expect(result.state).toMatchObject({ phase: "post_completion", pendingConfirmation: null });
  });

  it("cancels it on no", () => {
    const state = { ...completed, pendingConfirmation: pending };
    const result = step(state, userTurn("no", choice("no")), c);

    expect(sent(result.effects)).toEqual(["system.edit_cancelled"]);
    expect(others(result.effects)).toEqual([]);
  });

  it("refuses edits when the campaign does not allow them", () => {
    const noEdits = campaign((input) => {
      input.afterCompletion = { allowEdits: false };
    });
    const result = step(completed, userTurn("mi chiamo Marco", edit), noEdits);

    expect(sent(result.effects)).toEqual(["system.edit_not_allowed"]);
  });

  it("rejects an invalid edit", () => {
    const invalid = interpretation({
      intent: "edit_request",
      editTarget: { field: "drivingLicense", newValue: "forse" },
    });
    const result = step(completed, userTurn("cambia la patente", invalid), c);

    expect(sent(result.effects)).toEqual(["system.edit_invalid"]);
  });

  it("ignores extracted values outside an edit request", () => {
    const result = step(completed, userTurn("Luigi", answer("firstName", "Luigi")), c);

    expect(others(result.effects)).toEqual([]);
    expect(sent(result.effects)).toEqual(["system.post_completion_help"]);
  });
});

describe("post-completion CV regeneration (D44)", () => {
  const c = withCv({ allowEdits: true, allowCvRegeneration: true });

  it("offers the CV again through the cv_offer step", () => {
    const result = step(completed, userTurn("rifammi il cv", choice("regenerate_cv")), c);

    expect(sent(result.effects)).toEqual(["cv"]);
    expect(result.state).toMatchObject({ phase: "post_completion", stepId: "cv" });
  });

  it("enqueues the CV on yes", () => {
    const result = step({ ...completed, stepId: "cv" }, userTurn("sì", choice("yes")), c);

    expect(others(result.effects)).toEqual(["EnqueueJob:cv"]);
    expect(sent(result.effects)).toEqual(["system.cv_requested"]);
    expect(result.state.stepId).toBeNull();
  });

  it("goes back to the help text on no", () => {
    const result = step({ ...completed, stepId: "cv" }, userTurn("no", choice("no")), c);

    expect(sent(result.effects)).toEqual(["system.post_completion_help"]);
    expect(result.state.stepId).toBeNull();
  });

  it("asks again on anything else", () => {
    const result = step({ ...completed, stepId: "cv" }, userTurn("boh", interpretation()), c);
    expect(sent(result.effects)).toEqual(["system.not_understood", "cv"]);
  });

  it("answers with the help text when regeneration is not allowed", () => {
    const noRegen = withCv({ allowEdits: true, allowCvRegeneration: false });
    const result = step(completed, userTurn("rifammi il cv", choice("regenerate_cv")), noRegen);

    expect(result.effects).toEqual([
      {
        type: "SendText",
        text: {
          kind: "system",
          key: "system.post_completion_help",
          params: { allowEdits: true, allowCvRegeneration: false },
        },
      },
    ]);
  });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `pnpm test tests/unit/engine/post-completion.test.ts`
Expected: FAIL: ogni messaggio riceve `system.post_completion_help`.

- [ ] **Step 3: Sostituire `src/engine/post-completion.ts`**

```ts
import type { CvOfferStep } from "../campaigns/schema/steps";
import { chosen } from "./choice-answers";
import { requestEdit, saveEdit } from "./edits";
import type { UserTurnEvent } from "./events";
import { isChoice, type Interpretation } from "./interpretation";
import { nonAnswer } from "./replies";
import { stepTextRef, type TextRef } from "./text-ref";
import { emit, say, setState, systemText, type Turn } from "./turn";

/** The choice nlu returns, in post-completion mode, for "regenerate my CV" (D44). */
export const REGENERATE_CV_CHOICE = "regenerate_cv";

/** Spec §5.7: messages after the interview is completed. */
export function handlePostCompletionTurn(turn: Turn, event: UserTurnEvent): void {
  const interpretation = event.interpretation;
  const pending = turn.state.pendingConfirmation;
  if (pending) {
    setState(turn, { pendingConfirmation: null });
    if (pending.kind === "edit" && isChoice(interpretation, "yes")) {
      saveEdit(turn, pending);
      emit(turn, { type: "EnqueueJob", job: { name: "kubri-webhook", event: "profile.updated" } });
      return;
    }
    if (isChoice(interpretation, "no")) {
      say(turn, systemText("system.edit_cancelled"));
      return;
    }
  }
  if (turn.state.stepId !== null) {
    answerCvRegeneration(turn, interpretation);
    return;
  }
  const { allowEdits, allowCvRegeneration } = turn.campaign.afterCompletion;
  if (interpretation?.intent === "edit_request") {
    if (!allowEdits) say(turn, systemText("system.edit_not_allowed"));
    else if (!requestEdit(turn, interpretation)) say(turn, systemText("system.edit_invalid"));
    return;
  }
  if (allowCvRegeneration && isChoice(interpretation, REGENERATE_CV_CHOICE)) {
    const cvOffer = turn.campaign.flow.find((s): s is CvOfferStep => s.type === "cv_offer");
    if (cvOffer) {
      setState(turn, { stepId: cvOffer.id });
      say(turn, stepTextRef(cvOffer.prompt, cvOffer.id));
      return;
    }
  }
  say(turn, postCompletionHelp(turn));
}

/** The answer to a cv_offer re-proposed after completion: no transitions are followed. */
function answerCvRegeneration(turn: Turn, interpretation: Interpretation | null): void {
  const option = chosen(interpretation);
  if (option !== "yes" && option !== "no") {
    nonAnswer(turn, interpretation);
    return;
  }
  setState(turn, { stepId: null });
  if (option === "yes") {
    emit(turn, { type: "EnqueueJob", job: { name: "cv" } });
    say(turn, systemText("system.cv_requested"));
    return;
  }
  say(turn, postCompletionHelp(turn));
}

export function postCompletionHelp(turn: Turn): TextRef {
  const { allowEdits, allowCvRegeneration } = turn.campaign.afterCompletion;
  return systemText("system.post_completion_help", { allowEdits, allowCvRegeneration });
}
```

- [ ] **Step 4: Verificare che passino**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: tutti verdi.

- [ ] **Step 5: Commit**

```bash
git add src/engine/post-completion.ts tests/unit/engine/post-completion.test.ts
git commit -m "feat(chatbot): handle edits and CV regeneration after completion"
```

---
### Task 23: Harness degli scenari, campagna di test e percorso ideale

Gli scenari (§14) sono conversazioni intere: ogni turno porta il messaggio del candidato,
l'interpretazione scritta a mano (NLU finta) e ciò che ci si aspetta dopo il turno. Girano nel
nuovo progetto Vitest `scenarios`, incluso in `pnpm test` e quindi in CI (D46).

Formato di un turno:
- `start: true` → evento `session_started`;
- `user: "<testo>"` → evento `user_turn`; `nlu:` facoltativo (assente = NLU non disponibile).
  In `nlu` valgono questi valori predefiniti: `intent: answer`, lingua `it` con confidenza 0,99,
  `patch: {}`, `completeness: absent`. `patch` si può scrivere come mappa `campo: valore`
  (confidenza 0,95) o come elenco completo di voci `{ field, value, confidence, evidence }`.
- `expect:` verifica solo le chiavi presenti: `phase`, `step`, `question`, `consentsAccepted`,
  `sent` (id dei testi inviati, **elenco esatto e ordinato**), `effects` (descrizioni degli altri
  effetti, elenco esatto e ordinato, formato di `describeEffect`), `profile` (valori dei campi
  indicati), `outcomes` (esiti dei passaggi indicati).
- Ogni turno con un messaggio deve finire con un testo o un `FlagSession` (mai silenzio): il
  test lo verifica sempre.

**Files:**
- Modify: `package.json`, `vitest.config.ts`, `../../pnpm-lock.yaml`
- Create: `tests/scenarios/harness/scenario.ts`, `tests/scenarios/harness/run.ts`,
  `tests/scenarios/scenarios.test.ts`, `tests/scenarios/campaigns/test-campaign.json`,
  `tests/scenarios/test-campaign/happy-path.yaml`

- [ ] **Step 1: Aggiungere la dipendenza `yaml`**

Run: `pnpm add -D yaml`
Expected: `devDependencies: + yaml 2.x.x`. È un parser YAML 1.2 senza dipendenze e con i tipi
inclusi; serve solo ai test.

- [ ] **Step 2: Aggiungere il progetto `scenarios`**

`vitest.config.ts`:

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
          // Whole conversations per campaign, with a fake NLU (spec §14).
          name: "scenarios",
          include: ["tests/scenarios/**/*.test.ts"],
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

In `package.json` sostituire gli script `test` e `test:watch` e aggiungere `test:scenarios`:

```json
    "test": "vitest run --project unit --project scenarios",
    "test:watch": "vitest --project unit --project scenarios",
    "test:scenarios": "vitest run --project scenarios",
```

- [ ] **Step 3: Scrivere lo schema degli scenari `tests/scenarios/harness/scenario.ts`**

```ts
import { z } from "zod";
import { COMPLETENESS, INTENTS, InterpretationSchema } from "../../../src/engine/interpretation";

/** `{ field: value }` (confidence 0.95) or the full list of entries. */
const PatchSchema = z.union([
  z.array(
    z.strictObject({
      field: z.string(),
      value: z.unknown(),
      confidence: z.number().default(0.95),
      evidence: z.string().default(""),
    }),
  ),
  z
    .record(z.string(), z.unknown())
    .transform((values) =>
      Object.entries(values).map(([field, value]) => ({
        field,
        value,
        confidence: 0.95,
        evidence: "",
      })),
    ),
]);

/** The fake NLU: the interpretation is written in the scenario, with defaults for brevity. */
const NluSchema = z
  .strictObject({
    intent: z.enum(INTENTS).default("answer"),
    language: z
      .strictObject({ code: z.string(), confidence: z.number() })
      .default({ code: "it", confidence: 0.99 }),
    choice: z.string().optional(),
    patch: PatchSchema.default([]),
    completeness: z.enum(COMPLETENESS).default("absent"),
    missing: z.string().optional(),
    editTarget: z.strictObject({ field: z.string(), newValue: z.unknown() }).optional(),
    offTopicReply: z.string().optional(),
  })
  .transform(({ completeness, missing, ...rest }) => ({
    ...rest,
    currentQuestion: missing === undefined ? { completeness } : { completeness, missing },
  }))
  .pipe(InterpretationSchema);

const ExpectationSchema = z.strictObject({
  phase: z.enum(["language", "flow", "post_completion", "closed"]).optional(),
  step: z.string().nullable().optional(),
  question: z.string().nullable().optional(),
  consentsAccepted: z.boolean().optional(),
  sent: z.array(z.string()).optional(),
  effects: z.array(z.string()).optional(),
  profile: z.record(z.string(), z.unknown()).optional(),
  outcomes: z.record(z.string(), z.string()).optional(),
});
export type Expectation = z.infer<typeof ExpectationSchema>;

const TurnSchema = z.union([
  z.strictObject({ start: z.literal(true), expect: ExpectationSchema }),
  z.strictObject({ user: z.string(), nlu: NluSchema.optional(), expect: ExpectationSchema }),
]);

export const ScenarioSchema = z.strictObject({
  description: z.string().min(1),
  /** Path of the campaign JSON, relative to apps/chatbot. */
  campaign: z.string().min(1),
  turns: z.array(TurnSchema).min(1),
});
export type Scenario = z.infer<typeof ScenarioSchema>;
```

- [ ] **Step 4: Scrivere l'esecutore `tests/scenarios/harness/run.ts`**

```ts
import type { CampaignDefinition } from "../../../src/campaigns/schema/campaign";
import { describeEffect } from "../../../src/engine/describe";
import type { Effect } from "../../../src/engine/effects";
import type { EngineEvent } from "../../../src/engine/events";
import { fieldState } from "../../../src/engine/profile-snapshot";
import { initialSessionState, type SessionState } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import { describeTextRef } from "../../../src/engine/text-ref";
import type { Expectation, Scenario } from "./scenario";

export interface TurnReport {
  readonly label: string;
  readonly expected: Expectation;
  /** Only the keys present in `expected`. */
  readonly actual: Partial<Record<keyof Expectation, unknown>>;
  /** Spec §7.2 point 9: a user turn must end with a text or a flag. */
  readonly silent: boolean;
}

const START = Date.UTC(2026, 9, 24, 10, 0, 0);

export function runScenario(scenario: Scenario, campaign: CampaignDefinition): TurnReport[] {
  let state = initialSessionState();
  return scenario.turns.map((turn, i) => {
    // Deterministic clock: one minute per turn.
    const at = new Date(START + i * 60_000).toISOString();
    const event: EngineEvent =
      "start" in turn
        ? { type: "session_started", at }
        : { type: "user_turn", at, text: turn.user, interpretation: turn.nlu ?? null };
    const result = step(state, event, campaign);
    state = result.state;
    return {
      label: `turn ${i + 1} (${"start" in turn ? "start" : JSON.stringify(turn.user)})`,
      expected: turn.expect,
      actual: observe(state, result.effects, turn.expect),
      silent: !result.effects.some((e) => e.type === "SendText" || e.type === "FlagSession"),
    };
  });
}

function observe(
  state: SessionState,
  effects: readonly Effect[],
  expected: Expectation,
): Partial<Record<keyof Expectation, unknown>> {
  const all: Record<keyof Expectation, unknown> = {
    phase: state.phase,
    step: state.stepId,
    question: state.questionId,
    consentsAccepted: state.consentsAccepted,
    sent: effects.flatMap((e) => (e.type === "SendText" ? [describeTextRef(e.text)] : [])),
    effects: effects.filter((e) => e.type !== "SendText").map(describeEffect),
    profile: Object.fromEntries(
      Object.keys(expected.profile ?? {}).map((field) => [
        field,
        fieldState(state.profile, field)?.value,
      ]),
    ),
    outcomes: Object.fromEntries(
      Object.keys(expected.outcomes ?? {}).map((id) => [id, state.outcomes[id]]),
    ),
  };
  return Object.fromEntries(
    Object.keys(expected).map((key) => [key, all[key as keyof Expectation]]),
  );
}
```

- [ ] **Step 5: Scrivere il test che esegue gli scenari `tests/scenarios/scenarios.test.ts`**

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { validateCampaign } from "../../src/campaigns/validate";
import { runScenario } from "./harness/run";
import { ScenarioSchema } from "./harness/scenario";

const APP_ROOT = join(__dirname, "../..");
const SCENARIO_FILES = readdirSync(__dirname, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".yaml"))
  .sort();
const CAMPAIGN_FILES = readdirSync(join(__dirname, "campaigns")).filter((f) => f.endsWith(".json"));

function loadCampaign(path: string) {
  const result = validateCampaign(JSON.parse(readFileSync(join(APP_ROOT, path), "utf8")));
  if (!result.ok) throw new Error(`${path} is invalid: ${JSON.stringify(result.issues)}`);
  return result.campaign;
}

describe.each(CAMPAIGN_FILES)("scenario campaign %s", (file) => {
  it("passes validateCampaign", () => {
    expect(() => loadCampaign(join("tests/scenarios/campaigns", file))).not.toThrow();
  });
});

describe.each(SCENARIO_FILES)("scenario %s", (file) => {
  it("plays as expected", () => {
    const scenario = ScenarioSchema.parse(parse(readFileSync(join(__dirname, file), "utf8")));
    const campaign = loadCampaign(scenario.campaign);
    for (const report of runScenario(scenario, campaign)) {
      const where = `${scenario.description} — ${report.label}`;
      expect(report.silent, `${where}: the bot stayed silent`).toBe(false);
      expect(report.actual, where).toEqual(report.expected);
    }
  });
});
```

- [ ] **Step 6: Scrivere la campagna di test `tests/scenarios/campaigns/test-campaign.json`**

Campagna di magazzino con due campi personalizzati (`night_shifts` bool, `forklift` enum), un
passaggio condizionato da un campo (`patente_info`), una domanda condizionata (`tipi_patente`),
un `terminateIf` (`permesso`), un passaggio condizionato da un esito (`cv`), un `reply` con
`@repeat` e i due consensi (`test_privacy` obbligatorio, `kubri_global` facoltativo) con testi
segnaposto (D23).

```json
{
  "campaign": "test-magazzino",
  "organization": "test-org",
  "externalKey": "test-pool",
  "trigger": { "sender": "kubri-test", "keywords": ["magazzino"] },
  "dataController": {
    "name": "Test Logistica S.r.l.",
    "privacyUrl": "https://example.com/privacy"
  },
  "customFields": [
    {
      "key": "night_shifts",
      "type": "bool",
      "label": { "it": "Turni notturni" },
      "description": "Disponibile a lavorare nei turni di notte."
    },
    {
      "key": "forklift",
      "type": "enum",
      "options": ["nessuna", "base", "esperto"],
      "label": { "it": "Esperienza con il muletto" },
      "description": "Esperienza nella guida del carrello elevatore (muletto)."
    }
  ],
  "texts": {
    "cv_explain": {
      "it": "Un CV (curriculum vitae) è un documento che riassume le tue esperienze di lavoro e di studio."
    }
  },
  "flow": [
    {
      "id": "intro",
      "type": "message",
      "text": { "it": "Ciao! Ti farò qualche domanda per il lavoro in magazzino." }
    },
    {
      "id": "privacy",
      "type": "consent",
      "consentKey": "test_privacy",
      "textVersion": "placeholder-2026-10",
      "text": {
        "it": "[TESTO SEGNAPOSTO] Per svolgere l'intervista raccogliamo i tuoi dati. Titolare: {dataController.name}. Informativa: {dataController.privacyUrl}. Accetti?"
      },
      "link": "https://example.com/privacy"
    },
    {
      "id": "kubri_global",
      "type": "consent",
      "consentKey": "kubri_global",
      "textVersion": "placeholder-2026-10",
      "text": {
        "it": "[TESTO SEGNAPOSTO] Vuoi che il tuo profilo sia visibile anche ad altre organizzazioni partner di Kubri?"
      },
      "optional": true
    },
    {
      "id": "anagrafica",
      "type": "questions",
      "title": { "it": "Parliamo di te" },
      "questions": [
        { "id": "nome", "field": "firstName", "prompt": { "it": "Come ti chiami?" } },
        {
          "id": "permesso",
          "field": "workingPermit",
          "prompt": { "it": "Puoi lavorare legalmente in Italia?" },
          "terminateIf": { "field": "workingPermit", "eq": false }
        },
        { "id": "patente", "field": "drivingLicense", "prompt": { "it": "Hai la patente?" } },
        {
          "id": "tipi_patente",
          "field": "drivingLicenseTypes",
          "prompt": { "it": "Quali categorie di patente hai?" },
          "required": false,
          "when": { "field": "drivingLicense", "eq": true }
        }
      ]
    },
    {
      "id": "patente_info",
      "type": "message",
      "when": { "field": "drivingLicense", "eq": true },
      "text": { "it": "Ottimo, la patente è un vantaggio per questo lavoro." }
    },
    {
      "id": "magazzino",
      "type": "questions",
      "title": { "it": "Il lavoro in magazzino" },
      "questions": [
        {
          "id": "notte",
          "field": "custom.night_shifts",
          "prompt": { "it": "Saresti disponibile a lavorare anche di notte?" }
        },
        {
          "id": "muletto",
          "field": "custom.forklift",
          "prompt": { "it": "Sai usare il muletto?" },
          "maxClarifications": 1
        },
        {
          "id": "esperienze",
          "field": "workExperience",
          "prompt": { "it": "Raccontami le tue esperienze di lavoro." }
        }
      ]
    },
    {
      "id": "cv_info",
      "type": "choice",
      "prompt": { "it": "Sai cos'è un CV?" },
      "options": [
        { "id": "yes", "description": "Sa cos'è un CV" },
        { "id": "no", "description": "Non vuole un CV" },
        { "id": "idk", "description": "Non sa cos'è un CV" }
      ],
      "on": { "idk": { "reply": "cv_explain", "then": "@repeat" } }
    },
    {
      "id": "cv",
      "type": "cv_offer",
      "when": { "step": "cv_info", "outcome": "yes" },
      "prompt": { "it": "Vuoi che prepari il tuo CV?" }
    },
    { "id": "fine", "type": "end", "text": { "it": "Grazie, abbiamo finito!" } }
  ],
  "afterCompletion": { "allowEdits": true, "allowCvRegeneration": true }
}
```

- [ ] **Step 7: Scrivere lo scenario `tests/scenarios/test-campaign/happy-path.yaml`**

```yaml
description: Percorso ideale con richiesta del CV
campaign: tests/scenarios/campaigns/test-campaign.json
turns:
  - start: true
    expect: { phase: language, sent: [system.welcome] }

  - user: "italiano"
    expect: { phase: flow, step: privacy, sent: [intro, privacy], effects: ["SetLanguage:it"] }

  - user: "sì, accetto"
    nlu: { intent: choice, choice: accepted }
    expect:
      step: kubri_global
      consentsAccepted: true
      sent: [kubri_global]
      effects:
        - "RecordConsent:test_privacy:accepted"
        - "EnqueueJob:kubri-webhook:consents.accepted"

  - user: "va bene"
    nlu: { intent: choice, choice: accepted }
    expect:
      step: anagrafica
      question: nome
      sent: [system.progress, anagrafica.title, anagrafica.nome]
      effects: ["RecordConsent:kubri_global:accepted"]

  - user: "Mario"
    nlu: { patch: { firstName: Mario } }
    expect:
      question: permesso
      sent: [anagrafica.permesso]
      effects: ["ApplyPatch:extraction:firstName"]

  - user: "sì, ho il permesso di soggiorno"
    nlu: { patch: { workingPermit: true } }
    expect:
      question: patente
      sent: [anagrafica.patente]
      effects: ["ApplyPatch:extraction:workingPermit"]

  - user: "sì"
    nlu: { patch: { drivingLicense: true } }
    expect:
      question: tipi_patente
      sent: [anagrafica.tipi_patente]
      effects: ["ApplyPatch:extraction:drivingLicense"]

  - user: "la B"
    nlu: { patch: { drivingLicenseTypes: [B] } }
    expect:
      step: magazzino
      question: notte
      sent: [patente_info, system.progress, magazzino.title, magazzino.notte]
      effects:
        - "ApplyPatch:extraction:drivingLicenseTypes"
        - "EnqueueJob:kubri-webhook:block.completed"
      outcomes: { anagrafica: completed, patente_info: next }

  - user: "sì, anche di notte"
    nlu: { patch: { custom.night_shifts: true } }
    expect:
      question: muletto
      sent: [magazzino.muletto]
      effects: ["ApplyPatch:extraction:custom.night_shifts"]

  - user: "un po'"
    nlu: { patch: { custom.forklift: base } }
    expect:
      question: esperienze
      sent: [magazzino.esperienze]
      effects: ["ApplyPatch:extraction:custom.forklift"]

  - user: "dal 2019 al 2022 magazziniere da Rossi a Milano"
    nlu:
      patch:
        workExperience: ["2019 - 2022 Magazzino Rossi (IT): Magazziniere"]
    expect:
      step: cv_info
      sent: [cv_info]
      effects:
        - "ApplyPatch:extraction:workExperience"
        - "EnqueueJob:kubri-webhook:block.completed"

  - user: "sì, lo so"
    nlu: { intent: choice, choice: "yes" }
    expect: { step: cv, sent: [cv] }

  - user: "sì grazie"
    nlu: { intent: choice, choice: "yes" }
    expect:
      phase: post_completion
      step: null
      sent: [fine]
      effects:
        - "EnqueueJob:cv"
        - "CompleteSession"
        - "EnqueueJob:kubri-webhook:interview.completed"
      outcomes:
        privacy: accepted
        kubri_global: accepted
        anagrafica: completed
        magazzino: completed
        cv_info: "yes"
        cv: "yes"
      profile:
        firstName: Mario
        workingPermit: true
        drivingLicense: true
        drivingLicenseTypes: [B]
        custom.night_shifts: true
        custom.forklift: base
        workExperience: ["2019 - 2022 Magazzino Rossi (IT): Magazziniere"]
```

- [ ] **Step 8: Verificare che l'harness sappia fallire**

Cambiare temporaneamente, nell'ultimo turno di `happy-path.yaml`, `sent: [fine]` in
`sent: [end]`.

Run: `pnpm test:scenarios`
Expected: FAIL in `scenario test-campaign/happy-path.yaml`, con un messaggio che contiene
`Percorso ideale con richiesta del CV — turn 13 ("sì grazie")` e il confronto tra `end` e
`fine`.

Ripristinare `sent: [fine]`.

- [ ] **Step 9: Verificare che passino**

```bash
pnpm exec prettier --write tests/scenarios vitest.config.ts package.json
pnpm test:scenarios
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: `scenario campaign test-campaign.json` e `scenario test-campaign/happy-path.yaml`
passano; tutti i controlli verdi. Se uno scenario fallisce, il messaggio indica il turno: prima
di toccare il motore, ricontrollare l'atteso rispetto alle regole del motore (Task 11–22).

- [ ] **Step 10: Commit**

```bash
git add package.json vitest.config.ts ../../pnpm-lock.yaml tests/scenarios
git commit -m "test(chatbot): add the YAML scenario harness with a test campaign"
```

---

### Task 24: Scenari di chiusura (consenso negato, stop, terminazione)

**Files:**
- Create: `tests/scenarios/test-campaign/declined-consent.yaml`,
  `tests/scenarios/test-campaign/stop-keyword.yaml`,
  `tests/scenarios/test-campaign/terminated.yaml`

- [ ] **Step 1: Scrivere `declined-consent.yaml`**

```yaml
description: Consenso obbligatorio negato, poi un messaggio a sessione chiusa
campaign: tests/scenarios/campaigns/test-campaign.json
turns:
  - start: true
    expect: { sent: [system.welcome] }

  - user: "italiano"
    expect: { step: privacy, sent: [intro, privacy] }

  - user: "no, non accetto"
    nlu: { intent: choice, choice: declined }
    expect:
      phase: closed
      consentsAccepted: false
      sent: [system.stopped]
      effects:
        - "RecordConsent:test_privacy:declined"
        - "StopSession:consent_declined:delete"

  - user: "ciao?"
    expect: { phase: closed, sent: [system.session_closed], effects: [] }
```

- [ ] **Step 2: Scrivere `stop-keyword.yaml`**

Senza LLM le risposte normali non si capiscono, ma "STOP" funziona comunque (D40).

```yaml
description: Stop deterministico a metà intervista, con l'LLM non disponibile
campaign: tests/scenarios/campaigns/test-campaign.json
turns:
  - start: true
    expect: { sent: [system.welcome] }

  - user: "italiano"
    expect: { step: privacy }

  - user: "accetto"
    nlu: { intent: choice, choice: accepted }
    expect: { step: kubri_global, consentsAccepted: true }

  - user: "no"
    nlu: { intent: choice, choice: declined }
    expect: { question: nome, effects: ["RecordConsent:kubri_global:declined"] }

  - user: "Mario"
    expect: { question: nome, sent: [system.not_understood, anagrafica.nome], effects: [] }

  - user: "STOP"
    expect:
      phase: closed
      sent: [system.opt_out_confirm]
      effects: ["StopSession:opt_out:delete", "OptOut"]

  - user: "ciao"
    expect: { sent: [system.session_closed] }
```

- [ ] **Step 3: Scrivere `terminated.yaml`**

```yaml
description: Permesso di lavoro assente, il blocco termina l'intervista (terminateIf)
campaign: tests/scenarios/campaigns/test-campaign.json
turns:
  - start: true
    expect: { sent: [system.welcome] }

  - user: "italiano"
    expect: { step: privacy }

  - user: "accetto"
    nlu: { intent: choice, choice: accepted }
    expect: { step: kubri_global }

  - user: "no"
    nlu: { intent: choice, choice: declined }
    expect: { question: nome }

  - user: "Mario"
    nlu: { patch: { firstName: Mario } }
    expect: { question: permesso, sent: [anagrafica.permesso] }

  - user: "no, non ce l'ho"
    nlu: { patch: { workingPermit: false } }
    expect:
      phase: closed
      sent: [system.stopped]
      effects: ["ApplyPatch:extraction:workingPermit", "StopSession:terminated:delete"]
      outcomes: { anagrafica: terminated }
```

- [ ] **Step 4: Verificare che passino**

```bash
pnpm exec prettier --write tests/scenarios
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: i tre nuovi scenari passano; tutto verde.

- [ ] **Step 5: Commit**

```bash
git add tests/scenarios/test-campaign
git commit -m "test(chatbot): add declined consent, stop and termination scenarios"
```

---

### Task 25: Scenari di risposte parziali e risposte anticipate

**Files:**
- Create: `tests/scenarios/test-campaign/partial-answers.yaml`,
  `tests/scenarios/test-campaign/early-answer.yaml`

- [ ] **Step 1: Scrivere `partial-answers.yaml`**

```yaml
description: Risposte assenti, parziali e incerte, con approfondimenti e campo non risolto
campaign: tests/scenarios/campaigns/test-campaign.json
turns:
  - start: true
    expect: { sent: [system.welcome] }

  - user: "italiano"
    expect: { step: privacy }

  - user: "accetto"
    nlu: { intent: choice, choice: accepted }
    expect: { step: kubri_global }

  - user: "no"
    nlu: { intent: choice, choice: declined }
    expect: { question: nome }

  - user: "boh"
    nlu: { intent: unclear }
    expect: { question: nome, sent: [anagrafica.nome], effects: [] }

  - user: "Mario, ho il permesso e niente patente"
    nlu: { patch: { firstName: Mario, workingPermit: true, drivingLicense: false } }
    expect:
      step: magazzino
      question: notte
      sent: [system.progress, magazzino.title, magazzino.notte]
      effects:
        - "ApplyPatch:extraction:firstName,workingPermit,drivingLicense"
        - "EnqueueJob:kubri-webhook:block.completed"

  - user: "dipende"
    nlu: { intent: answer }
    expect: { question: notte, sent: [magazzino.notte], effects: [] }

  - user: "non saprei"
    nlu: { intent: unclear }
    expect: { question: notte, sent: [magazzino.notte] }

  - user: "boh"
    nlu: { intent: unclear }
    expect:
      question: muletto
      sent: [magazzino.muletto]
      effects:
        - "MarkFieldUnresolved:custom.night_shifts"
        - "FlagSession:unresolved_field:custom.night_shifts"
      profile: { custom.night_shifts: null }

  - user: "un pochino"
    nlu:
      patch:
        - { field: custom.forklift, value: base, confidence: 0.5 }
      completeness: complete
    expect: { question: muletto, sent: [system.confirm_value], effects: [] }

  - user: "sì esatto"
    nlu: { intent: choice, choice: "yes" }
    expect:
      question: esperienze
      sent: [magazzino.esperienze]
      effects: ["ApplyPatch:extraction:custom.forklift"]
      profile: { custom.forklift: base }

  - user: "ho fatto il cameriere"
    nlu:
      patch:
        workExperience: ["2020 - 2021 Hotel Sole (IT): Cameriere"]
      completeness: partial
      missing: "altre esperienze"
    expect:
      question: esperienze
      sent: [magazzino.esperienze]
      effects: ["ApplyPatch:extraction:workExperience"]

  - user: "e poi un anno in un magazzino a Bergamo"
    nlu:
      patch:
        workExperience:
          - "2020 - 2021 Hotel Sole (IT): Cameriere"
          - "2022 - 2023 Magazzino Bianchi (IT): Magazziniere"
      completeness: complete
    expect:
      step: cv_info
      sent: [cv_info]
      effects:
        - "ApplyPatch:extraction:workExperience"
        - "EnqueueJob:kubri-webhook:block.completed"
      profile:
        workExperience:
          - "2020 - 2021 Hotel Sole (IT): Cameriere"
          - "2022 - 2023 Magazzino Bianchi (IT): Magazziniere"
```

- [ ] **Step 2: Scrivere `early-answer.yaml`**

```yaml
description: Risposte anticipate, le domande con il campo già valorizzato vengono saltate
campaign: tests/scenarios/campaigns/test-campaign.json
turns:
  - start: true
    expect: { sent: [system.welcome] }

  - user: "italiano"
    expect: { step: privacy }

  - user: "accetto"
    nlu: { intent: choice, choice: accepted }
    expect: { step: kubri_global }

  - user: "no"
    nlu: { intent: choice, choice: declined }
    expect: { question: nome }

  - user: "Mi chiamo Amina, ho il permesso di soggiorno e non ho la patente"
    nlu: { patch: { firstName: Amina, workingPermit: true, drivingLicense: false } }
    expect:
      step: magazzino
      question: notte
      sent: [system.progress, magazzino.title, magazzino.notte]
      effects:
        - "ApplyPatch:extraction:firstName,workingPermit,drivingLicense"
        - "EnqueueJob:kubri-webhook:block.completed"
      outcomes: { anagrafica: completed }

  - user: "sì anche di notte, e il muletto lo uso da anni"
    nlu: { patch: { custom.night_shifts: true, custom.forklift: esperto } }
    expect:
      question: esperienze
      sent: [magazzino.esperienze]
      effects: ["ApplyPatch:extraction:custom.night_shifts,custom.forklift"]

  - user: "magazziniera dal 2018 al 2023 da Verdi a Brescia"
    nlu:
      patch:
        workExperience: ["2018 - 2023 Magazzino Verdi (IT): Magazziniera"]
    expect:
      step: cv_info
      sent: [cv_info]
      profile: { firstName: Amina, custom.forklift: esperto }
```

- [ ] **Step 3: Verificare che passino**

```bash
pnpm exec prettier --write tests/scenarios
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: i due nuovi scenari passano; tutto verde.

- [ ] **Step 4: Commit**

```bash
git add tests/scenarios/test-campaign
git commit -m "test(chatbot): add partial and early answer scenarios"
```

---

### Task 26: Scenari di modifica dopo il completamento e CV sì/no

Il CV "sì" è già coperto dal percorso ideale; qui il "no" (dopo un `idk` con `reply` e
`@repeat`) e il salto del `cv_offer` quando `cv_info` è `no` (passaggio con `when` su un esito).

**Files:**
- Create: `tests/scenarios/test-campaign/post-completion-edit.yaml`,
  `tests/scenarios/test-campaign/cv-no.yaml`

- [ ] **Step 1: Scrivere `post-completion-edit.yaml`**

```yaml
description: Modifica dopo il completamento e rigenerazione del CV
campaign: tests/scenarios/campaigns/test-campaign.json
turns:
  - start: true
    expect: { sent: [system.welcome] }

  - user: "italiano"
    expect: { step: privacy }

  - user: "accetto"
    nlu: { intent: choice, choice: accepted }
    expect: { step: kubri_global }

  - user: "no"
    nlu: { intent: choice, choice: declined }
    expect: { question: nome }

  - user: "Sono Mario, ho il permesso e non ho la patente"
    nlu: { patch: { firstName: Mario, workingPermit: true, drivingLicense: false } }
    expect: { question: notte }

  - user: "sì di notte, il muletto lo so usare bene, magazziniere dal 2019 al 2022"
    nlu:
      patch:
        custom.night_shifts: true
        custom.forklift: esperto
        workExperience: ["2019 - 2022 Magazzino Rossi (IT): Magazziniere"]
    expect:
      step: cv_info
      effects:
        - "ApplyPatch:extraction:custom.night_shifts,custom.forklift,workExperience"
        - "EnqueueJob:kubri-webhook:block.completed"

  - user: "no, non mi serve"
    nlu: { intent: choice, choice: "no" }
    expect:
      phase: post_completion
      sent: [fine]
      effects: ["CompleteSession", "EnqueueJob:kubri-webhook:interview.completed"]
      outcomes: { cv_info: "no" }

  - user: "ho sbagliato, mi chiamo Marco"
    nlu: { intent: edit_request, editTarget: { field: firstName, newValue: Marco } }
    expect: { phase: post_completion, sent: [system.confirm_edit], effects: [] }

  - user: "sì"
    nlu: { intent: choice, choice: "yes" }
    expect:
      phase: post_completion
      sent: [system.edit_saved]
      effects: ["ApplyPatch:edit:firstName", "EnqueueJob:kubri-webhook:profile.updated"]
      profile: { firstName: Marco }

  - user: "grazie mille"
    nlu: { intent: answer }
    expect: { sent: [system.post_completion_help], effects: [] }

  - user: "mi rifai il cv?"
    nlu: { intent: choice, choice: regenerate_cv }
    expect: { phase: post_completion, step: cv, sent: [cv] }

  - user: "sì"
    nlu: { intent: choice, choice: "yes" }
    expect: { step: null, sent: [system.cv_requested], effects: ["EnqueueJob:cv"] }
```

- [ ] **Step 2: Scrivere `cv-no.yaml`**

```yaml
description: Spiegazione del CV (reply + @repeat), poi CV rifiutato
campaign: tests/scenarios/campaigns/test-campaign.json
turns:
  - start: true
    expect: { sent: [system.welcome] }

  - user: "italiano"
    expect: { step: privacy }

  - user: "accetto"
    nlu: { intent: choice, choice: accepted }
    expect: { step: kubri_global }

  - user: "no"
    nlu: { intent: choice, choice: declined }
    expect: { question: nome }

  - user: "Sono Mario, ho il permesso e non ho la patente"
    nlu: { patch: { firstName: Mario, workingPermit: true, drivingLicense: false } }
    expect: { question: notte }

  - user: "sì, muletto base, cameriere dal 2020 al 2021"
    nlu:
      patch:
        custom.night_shifts: true
        custom.forklift: base
        workExperience: ["2020 - 2021 Hotel Sole (IT): Cameriere"]
    expect: { step: cv_info, sent: [cv_info] }

  - user: "cos'è un cv?"
    nlu: { intent: choice, choice: idk }
    expect:
      step: cv_info
      sent: [texts.cv_explain, cv_info]
      outcomes: { cv_info: idk }

  - user: "ah ok, sì"
    nlu: { intent: choice, choice: "yes" }
    expect: { step: cv, sent: [cv], outcomes: { cv_info: "yes" } }

  - user: "no grazie"
    nlu: { intent: choice, choice: "no" }
    expect:
      phase: post_completion
      sent: [fine]
      effects: ["CompleteSession", "EnqueueJob:kubri-webhook:interview.completed"]
      outcomes: { cv: "no" }
```

- [ ] **Step 3: Verificare che passino**

```bash
pnpm exec prettier --write tests/scenarios
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: i due nuovi scenari passano; tutto verde. Con questo task la campagna di test copre
tutti gli scenari obbligatori del §14: percorso ideale, consenso negato, risposte parziali,
risposta anticipata, modifica dopo il completamento, CV sì/no.

- [ ] **Step 4: Commit**

```bash
git add tests/scenarios/test-campaign
git commit -m "test(chatbot): add post-completion edit and CV scenarios"
```

---

### Task 27: Aggiornare la spec

Lo stato della scheda 04 nella roadmap lo aggiorna il controller, non questo task.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-24-kubri-chatbot-design.md`

- [ ] **Step 1: Aggiungere le decisioni al registro (§2)**

Nella tabella del §2 aggiungere, **subito dopo la riga D30 e prima della riga D48** (già presente: un solo consenso obbligatorio per campagna):

```markdown
| D31 | Profilo nello stato del motore | `SessionState.profile` è un'istantanea campo → valore, confidenza, stato. Il runtime la idrata da `CandidateProfile` (fonte di verità) prima di `step()` e salva gli `ApplyPatch`; la firma resta a tre argomenti e pura. |
| D32 | Contratto `Interpretation` | Definito dal motore in `src/engine/interpretation.ts` (schema Zod stretto), prodotto da `nlu`. `interpretation: null` = NLU non disponibile. |
| D33 | Testi negli effetti | Per riferimento (`TextRef`): testo della campagna, testo inline di un passaggio, chiave del catalogo di sistema, testo generato dall'LLM (solo fuori contesto). La risoluzione è di `i18n`. |
| D34 | Soglia di confidenza | Unica, 0,7. Campo valorizzato = non `unresolved` e confidenza ≥ 0,7. Soglie per campo in futuro. |
| D35 | Applicazione delle patch | Solo dopo la soglia dei consensi; l'estrazione non sovrascrive un campo valorizzato tranne quello della domanda corrente; le altre modifiche passano da `edit_request`. Sotto soglia: conferma solo per il campo della domanda corrente, gli altri valori si scartano. |
| D36 | Conferme sì/no | "sì" applica, "no" annulla e ripete la domanda, ogni altra risposta fa decadere la conferma ed è elaborata come risposta normale. |
| D37 | `@end` | `@end` va al primo `end` idoneo dalla posizione corrente in avanti; se non c'è, `system.closing`. Prima della soglia dei consensi `@end` non crea un candidato: testo di chiusura + stop con cancellazione. Vale anche quando il `flow` finisce. |
| D38 | Soglia D24 nel motore | `consentsAccepted` diventa vero al primo consenso obbligatorio accettato (evento `consents.accepted`); il rifiuto di un obbligatorio lo riporta a falso prima del `@stop`. Con D48 il consenso obbligatorio è uno solo, quindi "primo" e "ultimo" coincidono. |
| D39 | Dati alla chiusura | `@stop`: `delete` prima della soglia, `onStop.data` dopo. `delete_data`: chiede conferma; solo dopo un sì `delete` + job `delete-contact`, altrimenti si riprende. `opt_out` dopo il completamento: solo `OptOut`, i dati restano. |
| D40 | Intenti globali deterministici | Il messaggio intero normalizzato deve coincidere con una frase dell'elenco; la parola chiave vince sull'LLM; valgono in ogni fase, anche a sessione chiusa. |
| D41 | Fase della lingua | Nome di lingua nel testo → lingua rilevata dall'LLM con confidenza ≥ 0,8 → `defaultLanguage` della campagna. Il punto 3 del §5.6 è rinviato al piano 06. |
| D42 | "Sezione N di M" | M conta i blocchi `questions` la cui `when` non è falsa in quel momento: può cambiare durante l'intervista. |
| D43 | Approfondimenti | `partial` chiede un approfondimento anche con un valore già salvato; `refusal` su una facoltativa la salta subito; `off_topic` e `help` non consumano approfondimenti. |
| D44 | Rigenerazione del CV | In post-intervista l'NLU restituisce `choice: "regenerate_cv"`; il motore ripropone il primo `cv_offer` del `flow` (se esiste e `allowCvRegeneration`). |
| D45 | Errori del motore | Stato incoerente o più di 20 avanzamenti: stato invariato, testo di errore generico, `FlagSession(needsAttention)`. `timeout` senza effetti nella v1. |
| D46 | Scenari | YAML in `tests/scenarios/<campagna>/`, progetto Vitest `scenarios` incluso in `pnpm test`; NLU finta scritta nello YAML; dipendenza di sviluppo `yaml`. |
| D47 | Evento della soglia verso Kubri | Si chiama `consents.accepted`, come nel §12.1 (in `CLAUDE.md` compare ancora `session.started`, da allineare). |
```

- [ ] **Step 2: Allineare il §7.1**

Nel blocco di codice della firma sostituire `campaign: CampaignVersion` con
`campaign: CampaignDefinition` e, sotto, aggiungere dopo l'elenco degli **Effetti**:

```markdown
- `campaign` è la definizione già validata della versione a cui la sessione è legata (piano 04).
- Effetti aggiunti dal piano 04: `RecordPatchRejections` (valori scartati, senza il valore),
  `MarkFieldUnresolved`, `OptOut`. `SendChoice` resta futuro.
```

- [ ] **Step 3: Chiudere la domanda aperta 13 (§18)**

Nella riga "Risolte (2026-10-24): …" aggiungere in fondo `; campagne senza \`end\` o con più
\`end\` → D37` e cancellare il punto `13.` dall'elenco.

- [ ] **Step 4: Controllo finale**

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
```

Expected: tutto verde.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-24-kubri-chatbot-design.md
git commit -m "docs(chatbot): record conversation engine decisions in the spec"
```

---

### Task 28: Scenari della campagna standard Kubri (**richiede il piano 03**)

> **Prerequisito bloccante:** il piano 03 deve aver creato `campaigns/kubri-standard.json` sul
> branch. Se il file non c'è, il task si ferma qui e si riprende dopo il piano 03. Il contenuto
> della campagna (id dei passaggi, delle domande e dei campi) lo decide il piano 03, che è scritto
> in parallelo: per questo gli scenari sotto si costruiscono **leggendo la campagna reale**, con
> la procedura e le regole indicate, invece di essere copiati da qui.

**Files:**
- Create: `tests/scenarios/kubri-standard/happy-path.yaml`,
  `tests/scenarios/kubri-standard/declined-consent.yaml`,
  `tests/scenarios/kubri-standard/partial-answers.yaml`,
  `tests/scenarios/kubri-standard/early-answer.yaml`,
  `tests/scenarios/kubri-standard/post-completion-edit.yaml`,
  `tests/scenarios/kubri-standard/cv-yes-no.yaml`

- [ ] **Step 1: Verificare il prerequisito e stampare la struttura della campagna**

```bash
test -f campaigns/kubri-standard.json && echo present
pnpm exec tsx -e 'import("./src/campaigns/validate.ts").then(({ validateCampaign }) => {
  const r = validateCampaign(JSON.parse(require("node:fs").readFileSync("campaigns/kubri-standard.json", "utf8")));
  if (!r.ok) { console.error(r.issues); process.exit(1); }
  for (const s of r.campaign.flow) {
    const extra = s.type === "questions"
      ? s.questions.map((q) => q.id + ":" + q.field + (q.when ? "?" : "") + (q.terminateIf ? "!" : "") + (q.required ? "" : "(opt)")).join(" ")
      : s.type === "choice" ? s.options.map((o) => o.id).join("/")
      : s.type === "consent" ? s.consentKey + (s.optional ? " (optional)" : " (mandatory)") : "";
    console.log(s.id, s.type, s.when ? "[when]" : "", extra);
  }
  console.log("afterCompletion", JSON.stringify(r.campaign.afterCompletion), "onStop", r.campaign.onStop.data);
});'
```

Expected: `present`, poi una riga per passaggio (id, tipo, `[when]` se condizionato, e per i
blocchi `questions` l'elenco `id:campo`, con `?` = condizionata, `!` = `terminateIf`, `(opt)` =
facoltativa). Se `validateCampaign` fallisce, fermarsi: va corretto il piano 03, non questo.

- [ ] **Step 2: Scrivere i sei scenari**

Per ciascun file, partire dallo scenario omonimo della campagna di test
(`tests/scenarios/test-campaign/`; per `cv-yes-no.yaml` unire `happy-path.yaml`, che termina con
il CV sì, e `cv-no.yaml`, usando due sessioni separate in due file se più leggibile: in quel caso
creare `cv-yes.yaml` e `cv-no.yaml` al posto di `cv-yes-no.yaml`), cambiare
`campaign:` in `campaigns/kubri-standard.json` e sostituire id e campi con quelli stampati allo
Step 1. Calcolare gli attesi con queste regole del motore:

1. `start` → `sent: [system.welcome]`. Il primo messaggio con un nome di lingua →
   `effects: ["SetLanguage:<codice>"]` e i testi di tutti i `message` iniziali, fino al primo
   passaggio che aspetta una risposta (testo del passaggio: il suo id; testo di una domanda:
   `<blocco>.<domanda>`; titolo: `<blocco>.title`; testo di `texts`: `texts.<chiave>`).
2. Consenso obbligatorio accettato → `RecordConsent:<chiave>:accepted` +
   `EnqueueJob:kubri-webhook:consents.accepted` (solo il primo). Rifiutato →
   `RecordConsent:<chiave>:declined` + `StopSession:consent_declined:delete`,
   `sent: [system.stopped]`. `kubri_global` è facoltativo: rifiutato si prosegue.
3. Ingresso in un blocco con almeno una domanda da porre → `system.progress`, poi il titolo (se
   c'è), poi la prima domanda il cui campo non è valorizzato e la cui `when` è vera.
4. Patch con confidenza ≥ 0,7 → `ApplyPatch:extraction:<campi nell'ordine della patch>`; un campo
   già valorizzato non viene riscritto, tranne quello della domanda corrente. `address` aggiunge
   `EnqueueJob:geocoding`.
5. Campo della domanda valorizzato → `terminateIf` (se vero: `StopSession:terminated:<policy>`),
   poi la prossima domanda da porre; fine del blocco → `EnqueueJob:kubri-webhook:block.completed`
   e il passaggio successivo con `when` vera.
6. Campo non valorizzato: `partial` → stessa domanda (approfondimento), `absent`/`unclear` →
   stessa domanda (riformulata), finché `clarifications < maxClarifications` (predefinito 2);
   poi obbligatoria → `MarkFieldUnresolved:<campo>` + `FlagSession:unresolved_field:<campo>`,
   facoltativa → salto silenzioso.
7. Valore sotto 0,7 per il campo corrente → `sent: [system.confirm_value]`; "sì" →
   `ApplyPatch:extraction:<campo>` e si avanza; "no" → stessa domanda.
8. `cv_offer` "sì" → `EnqueueJob:cv` prima degli effetti dei passaggi successivi. Passaggio
   `end` → il suo testo, `CompleteSession`, `EnqueueJob:kubri-webhook:interview.completed`,
   `phase: post_completion`.
9. Dopo il completamento: `edit_request` → `system.confirm_edit`; "sì" →
   `ApplyPatch:edit:<campo>` + `EnqueueJob:kubri-webhook:profile.updated`,
   `sent: [system.edit_saved]` (solo se `allowEdits`, altrimenti `system.edit_not_allowed`);
   `choice: regenerate_cv` → il prompt del primo `cv_offer` (solo se `allowCvRegeneration`).

Ogni scenario deve verificare almeno `sent` e `effects` in ogni turno che cambia il passaggio, e
`profile` nell'ultimo turno di `happy-path.yaml`.

- [ ] **Step 3: Verificare che passino**

```bash
pnpm exec prettier --write tests/scenarios
pnpm test:scenarios
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: tutti gli scenari di `test-campaign/` e `kubri-standard/` passano; tutto verde. Uno
scenario che fallisce indica il turno: decidere se l'atteso è sbagliato (rileggere le regole
dello Step 2) o se la campagna standard ha un problema (da segnalare al piano 03). Non cambiare il
motore per far passare uno scenario senza registrare la decisione nella spec.

- [ ] **Step 4: Commit**

```bash
git add tests/scenarios/kubri-standard
git commit -m "test(chatbot): add the mandatory scenarios for the standard Kubri campaign"
```

---

## Copertura della spec (verifica finale)

| Requisito | Task |
|---|---|
| §7.1 firma pura, stato, eventi, effetti | 4, 9, 12 |
| §8.3 `Interpretation` | 1 |
| §5.6 fase della lingua (parte deterministica) | 8, 12 |
| §5.2 esecuzione di `message`/`choice`/`consent`/`questions`/`cv_offer`/`end`, avanzamento automatico | 11, 13, 14, 16 |
| §5.4 transizioni, `reply`, `@repeat`, `@stop`, `@end` (D37) | 11 |
| `when` dei passaggi (nessun esito per i saltati) | 5, 11 |
| `when` e `terminateIf` delle domande | 10, 11, 16 |
| §5.3 salto dei campi già valorizzati | 3, 10, 16, 25 |
| §7.2.2 patch, soglia, conferma | 15, 18 |
| §7.2.3 approfondimenti, `unresolved`, `FlagSession` | 17 |
| §7.2.4 fuori contesto | 19 |
| §7.2.5 modifica con conferma | 20, 22 |
| §7.2.1 intenti globali anche senza LLM | 7, 21, 24 |
| §5.7 fase dopo il completamento | 22, 26 |
| §7.2.8 "Sezione N di M" | 6, 11 |
| §7.2.9 limite di 20, `needs_attention`, mai silenzio | 9, 11, 12, 23 |
| §10.6 / D24 soglia dei consensi e `@stop` prima/dopo | 11, 14, 21 |
| §14 scenari obbligatori, campagna di test | 23–26 |
| §14 scenari sulla campagna standard | 28 (dopo il piano 03) |
| Registro delle decisioni D31–D47 | 27 |
