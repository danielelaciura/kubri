# Kubri Chatbot — Design

> Stato: bozza da revisionare · Data: 2026-10-24
> Origine: sessione di design a partire dall'analisi dello scenario Make "Kubri - Whatsapp Bot".
> Posizione: `apps/chatbot/` nel monorepo `kubri` (D19). Regole di progetto: `apps/chatbot/CLAUDE.md`. Spec e piani del chatbot: `apps/chatbot/docs/superpowers/`.

---

## 1. Contesto e obiettivo

Oggi il chatbot di Kubri vive su Make.com. L'analisi dello scenario ha evidenziato:

- prompt d'intervista duplicati per ogni pool e divergenti;
- flusso controllato dall'LLM, con stati liberi e vicoli ciechi silenziosi;
- consensi registrati prima di essere dati;
- profilo riscritto per intero a ogni turno;
- webhook verso Kubri che invia dati vecchi di un turno;
- nessuna deduplica né serializzazione dei messaggi;
- messaggi non testuali ignorati;
- lock-in sui thread dell'AI Agent di Make.

**Obiettivo:** costruire un **motore di interviste conversazionali** indipendente da Make. Il motore esegue questionari dichiarativi su chat, è multilingua e multi-campagna, e produce profili candidato strutturati e normalizzati, che invia alla piattaforma Kubri.

**Principio guida:** *flusso deterministico nel codice; l'LLM interpreta il linguaggio, non guida la conversazione.*

### 1.1 Obiettivi della v1

- Canale WhatsApp (Meta Cloud API) su uno o più numeri.
- Campagne per azienda, più una campagna **standard Kubri**, definite come file JSON versionati.
- Flusso dell'intervista interamente configurabile per campagna (tranne la scelta della lingua).
- Schema standard del profilo candidato, più campi personalizzati tipizzati per campagna.
- Comprensione robusta di risposte parziali, fuori contesto, con più informazioni insieme, e di richieste di modifica.
- Italiano di default; traduzione via LLM nella lingua del candidato, con traduzioni curate facoltative.
- Consensi bloccanti, versionati e tracciati.
- Storico completo delle conversazioni.
- Integrazione con la piattaforma Kubri tramite il webhook esistente.
- Generazione del CV in PDF, attivabile per campagna.
- Test automatici e un sistema di **evals** strutturato fin dall'inizio.

### 1.2 Fuori perimetro per la v1 (ma predisposti, vedi §17)

- Telegram e altri canali.
- Provisioning dei numeri tramite Twilio e contatto proattivo dei candidati.
- Trascrizione dei vocali.
- Import del CV caricato dal candidato.
- Interfacce grafiche: configurazione, consultazione delle conversazioni, editor delle campagne.
- Promemoria e follow-up automatici.

---

## 2. Decisioni prese (registro)

| # | Tema | Decisione |
|---|---|---|
| D1 | Natura dello strumento | Via di mezzo: **nucleo generico** (canali, motore, i18n, consensi, storico) più **modulo candidati** con schema standard. |
| D2 | Personalizzazione | Schema standard **più campi personalizzati tipizzati** per campagna. |
| D3 | Chi configura le campagne | Il team Kubri, tramite **file JSON versionati**, validati e importati da CLI. Struttura pronta per un futuro pannello. |
| D4 | Flusso | L'intero flusso della campagna è una **sequenza di passaggi tipizzati** configurabili. Solo la scelta della lingua è fissa. |
| D5 | Canali al lancio | **Solo WhatsApp**. Modello dati multi-numero e multi-provider fin da subito. |
| D6 | Approccio al motore | **Funzione pura** `step()` in un **monolite modulare**. Scartati XState (costo senza guadagno) e i framework ad agenti (LLM al comando, non testabile). |
| D7 | Stack | **TypeScript**, processi web e worker sullo stesso codice, **container gestito in UE**, coda **pg-boss** su Postgres. |
| D8 | Database | **Stesso Postgres della dashboard Kubri** (stesso progetto Supabase, dev con dev e prod con prod), in uno **schema `bot` separato**, con ruoli database distinti. |
| D9 | ORM | **Prisma**. |
| D10 | LLM | Provider astratto, modello configurabile per compito, minimizzazione dei dati. Candidato iniziale: **Mistral (UE)**, da confermare con gli evals. |
| D11 | Evals | Sistema di evals **fatto in casa** fin dall'inizio, con valore anche didattico. |
| D12 | Vocali | Non nella v1, ma **architettura predisposta** (modulo `media`). |
| D13 | Lingue | Italiano di default; **traduzione via LLM** con cache; **traduzioni curate facoltative** per testo e lingua; consensi con regole più restrittive. |
| D14 | Integrazione Kubri | Si mantiene **il webhook esistente** `POST /api/webhooks/make/candidate`, chiamato solo su eventi significativi e con dati aggiornati. |
| D15 | CV | Nella v1, attivabile per campagna; HTML convertito in PDF; storage privato e link firmati. |
| D16 | Consensi | Passaggio bloccante; testo versionato; titolare del trattamento per campagna; copia del testo mostrato. |
| D17 | Migrazione | Le sessioni già in corso finiscono su Make. Passaggio per numero: prima un numero di test, poi il numero Kubri. |
| D18 | Interfacce v1 | Nessuna. Solo JSON e CLI. |
| D19 | Posizione del codice | **App `apps/chatbot` nel monorepo pnpm `kubri`**, accanto a dashboard e assessment. Motivi: il contratto del webhook diventa uno schema Zod condiviso in `@kubri/contracts` (errori di contratto = errori di typecheck); un solo database e un solo flusso di migrazione; stesso stack della dashboard (Prisma 7, Zod 4, Vitest 4). Il chatbot resta isolato: proprio `package.json`, proprio Prisma client e proprie migrazioni sullo schema `bot`, deploy separato (container UE, non Vercel). Scartato il repo separato: l'isolamento che offre non serve a un team di una persona e costa un contratto da tenere allineato a mano. |
| D20 | Chiave del candidato verso Kubri | `key` = **(contatto, campagna)**: la stessa persona che rifà la stessa campagna aggiorna lo stesso candidato in dashboard (note e tag conservati). Lo storico resta nel bot (`ProfileChange`, sessioni). Campagne diverse → pool diversi → candidati diversi. Vedi §12.1. |
| D21 | Pool Kubri | `Campaign.externalKey` = chiave del pool esistente lato dashboard (`global`, `culligan`, …). |
| D22 | Canale esplicito | Il payload verso Kubri porta sempre un campo **`channel` esplicito** (`whatsapp`, in futuro `telegram`…), servirà anche per il contatto proattivo. `source_organization` vale `kubri-chatbot` e non è più usato per ricavare il canale; la dashboard va adeguata per leggere `channel` (vedi §12.1). |
| D23 | Consensi per campagna | Ogni campagna, compresa la standard Kubri, ha i propri testi di consenso, versioni e titolare. Fino ai testi ufficiali si usano testi **segnaposto** marcati come tali (`textVersion` `placeholder-…`), che non devono andare in produzione. |
| D24 | Abbandono e `@stop` | Si distingue per **soglia**: prima dell'accettazione dei consensi obbligatori non si conserva nulla oltre alla prova minima del rifiuto; dopo l'accettazione la sessione abbandonata resta in attesa per il **follow-up** (da definire, §17) e viene cancellata solo dopo un periodo di conservazione configurabile (durata da definire, §18). Vedi §10.6. |
| D25 | Forma del profilo | Mappa piatta con chiavi puntate (`jobPreferences.preferredJob`); la struttura annidata esiste solo nella mappatura verso Kubri. |
| D26 | Versione della campagna | Non sta nel file JSON: la assegna l'import. |
| D27 | Opzioni di `choice` | Oggetti `{ id, description }`; la descrizione guida l'LLM. |
| D28 | Esiti predefiniti | `questions.terminated` e `consent.declined` (non facoltativo) → `@stop`; gli altri → passaggio successivo o `@end`. |
| D29 | Campi di sistema | `lat`, `lng`, `phone` sono `systemOnly`: non si chiedono e non si estraggono. |
| D30 | Soglia dei consensi nel validatore | Ogni campagna ha almeno un consenso obbligatorio, non condizionato (`when` vietato), e il suo rifiuto porta sempre a `@stop`, e nessun blocco `questions`/`cv_offer` è raggiungibile senza passare da un consenso obbligatorio. |
| D48 | Consensi di una campagna | **Esattamente un consenso obbligatorio** per campagna: l'informativa del titolare dell'azienda che ha richiesto il questionario. L'unico altro consenso è `kubri_global`, **facoltativo**: se accettato il candidato diventa visibile anche nel pool global (`is_kubri_privacy_accepted` → `sharedWithGlobal`), se rifiutato resta conservato e visibile solo nel pool della campagna. Il validatore rifiuta un secondo consenso obbligatorio (`multiple_mandatory_consents`). (Numerata D48 perché D31–D47 sono riservate al piano 04, che le inserisce prima di questa riga.) |

---

## 3. Glossario

- **Organization**: un'azienda cliente. Kubri è a sua volta un'organizzazione.
- **SenderNumber**: un numero WhatsApp gestito dal sistema, collegato a un provider.
- **Campaign**: una campagna di screening. Appartiene a un'organizzazione, usa un numero e si attiva con parole chiave.
- **CampaignVersion**: una versione immutabile della definizione JSON di una campagna.
- **Flow / Step (passaggio)**: la sequenza di passaggi tipizzati che compone l'intervista.
- **Contact**: una persona su un canale (WhatsApp `wa_id`).
- **Session**: un'intervista di un contatto su una versione di campagna.
- **Turn (turno)**: l'elaborazione di una "raffica" di messaggi in entrata, con la relativa risposta.
- **Interpretation**: l'output strutturato di `nlu` per un turno.
- **Effect (effetto)**: un'azione descritta dal motore come dato, ed eseguita dal runtime.
- **Patch**: un insieme di campi del profilo da aggiornare.

---

## 4. Architettura

### 4.1 Vista d'insieme

```
                 ┌──────────── processo WEB ────────────┐
Meta ──webhook──►│ ingress → channels.parse → store     │──► coda (pg-boss)
                 └──────────────────────────────────────┘
                 ┌──────────── processo WORKER ─────────┐
       coda ────►│ runtime                               │
                 │   ├─ store      (carica la sessione)  │
                 │   ├─ campaigns  (versione legata)     │
                 │   ├─ media      (audio/documenti)     │
                 │   ├─ nlu ──────► provider LLM         │
                 │   ├─ engine     (funzione pura)       │
                 │   ├─ i18n       (risolve i testi)     │
                 │   └─ esegue gli effetti:              │
                 │        store · channels.send · job    │
                 │ integrations ◄── job                  │
                 │   (webhook Kubri, CV, geocoding)      │
                 └──────────────────────────────────────┘
       cli: campaigns validate/import/simulate · evals run · ops
```

**Regola d'oro:** ogni dipendenza esterna è toccata da un solo modulo.
- Solo `channels` parla con Meta e Twilio.
- Solo `nlu` parla con l'LLM.
- Solo `store` parla con il database.
- Solo `integrations` parla con Kubri, lo storage, il servizio di geocoding e il generatore di PDF.
- `engine` non parla con nessuno.

### 4.2 Moduli

| Modulo | Responsabilità | Interfaccia |
|---|---|---|
| `channels` | Traduce dal formato del provider a eventi normalizzati e viceversa. | `verify(req)`, `parse(req) → InboundEvent[]`, `send(OutboundMessage) → { providerMessageId }`, `classifyError(err) → transient \| permanent`. Implementazione v1: `meta-cloud`. |
| `ingress` | Rotte HTTP: verifica del webhook (`GET`), ricezione (`POST`), deduplica, salvataggio, inserimento in coda. | rotte HTTP |
| `campaigns` | Schema Zod della campagna, validazione semantica, import, registro delle versioni. | `validate(json)`, `import(json) → CampaignVersion`, `getVersion(id)` |
| `profile` | Schema standard del profilo, gestione dei campi personalizzati, validazione delle patch, mappatura verso il payload Kubri. | `validatePatch(patch, campaign)`, `toKubriPayload(profile)` |
| `engine` | **Funzione pura** che fa avanzare la conversazione. | `step(state, event, campaign) → { state, effects }` |
| `nlu` | Interpretazione dei messaggi e traduzione. | `interpret(ctx) → Interpretation`, `translate(text, lang)`. Dietro c'è `LlmProvider`. |
| `media` | Scarico dei file multimediali, trascrizione (futura), estrazione dai documenti (futura). | `download(ref)`, `Transcriber`, `DocumentExtractor` |
| `i18n` | Risoluzione dei testi: traduzione curata → cache → traduzione LLM. | `resolve(textRef, lang)` |
| `runtime` | Orchestrazione del turno nel worker. | handler dei job |
| `integrations` | Consumatori dei job: `kubri-webhook`, `cv`, `geocoding`. | handler dei job |
| `store` | Accesso al database (Prisma), repository per entità, transazioni. | repository |
| `evals` | Dataset, esecuzione, misuratori, report. | CLI |
| `cli` | Comandi per il team. | `kubri-bot <comando>` |

### 4.3 Struttura nel monorepo (proposta)

Il chatbot è un'app del monorepo `kubri` (D19):

```
kubri/
├── apps/
│   ├── dashboard/              ← legge i candidati, riceve il webhook
│   ├── assessment/
│   └── chatbot/                ← questa app (struttura sotto)
├── packages/
│   └── contracts/              ← @kubri/contracts: schema Zod del payload del webhook
│                                  candidato, condiviso da chatbot (produce) e dashboard (valida)
└── docs/                       ← documenti della dashboard (il chatbot ha i suoi in apps/chatbot/docs)
```

Contenuto di `apps/chatbot/`:

```
apps/chatbot/
├── CLAUDE.md
├── docs/superpowers/           ← spec e piani del chatbot (separati da quelli della dashboard)
├── campaigns/                  ← definizioni JSON (fonte di verità versionata)
│   ├── kubri-standard.json
│   └── <org>-<campagna>.json
├── prisma/
│   └── schema.prisma           ← solo lo schema "bot"
├── src/
│   ├── channels/meta-cloud/
│   ├── ingress/
│   ├── campaigns/
│   ├── profile/
│   ├── engine/
│   ├── nlu/
│   │   ├── providers/
│   │   └── prompts/            ← prompt versionati
│   ├── media/
│   ├── i18n/
│   ├── runtime/
│   ├── integrations/
│   ├── store/
│   ├── cli/
│   ├── web.ts                  ← avvio del processo web
│   └── worker.ts               ← avvio del processo worker
├── evals/
│   ├── datasets/               ← casi JSONL, anonimizzati
│   ├── scorers/
│   └── reports/                ← risultati salvati (JSON + Markdown)
├── tests/
│   ├── unit/
│   ├── scenarios/              ← scenari YAML per campagna
│   ├── integration/
│   └── fixtures/meta/          ← payload reali di Meta
└── package.json                ← @kubri/chatbot
```

---

## 5. Definizione della campagna

### 5.1 Struttura generale

```json
{
  "campaign": "culligan-vendita",
  "organization": "culligan",
  "externalKey": "culligan",
  "trigger": { "sender": "kubri-main", "keywords": ["culligan"] },
  "defaultLanguage": "it",
  "dataController": { "name": "Culligan Italiana S.p.A.", "privacyUrl": "https://…" },
  "onStop": { "data": "delete" },
  "customFields": [
    { "key": "vat_openness", "type": "enum", "options": ["si", "no", "da_valutare"],
      "label": { "it": "Disponibilità ad aprire P.IVA" },
      "description": "Se il candidato è disposto ad aprire una partita IVA." }
  ],
  "texts": {
    "cv_explain": { "it": "Un CV (curriculum vitae) è un documento che…" }
  },
  "flow": [ … ],
  "afterCompletion": { "allowEdits": true, "allowCvRegeneration": true }
}
```

- `campaign`: slug univoco. `version`: progressivo, assegnato all'import (non è nel file JSON, D26).
- `externalKey`: la chiave del pool lato Kubri, inviata nel webhook.
- `trigger.sender`: il numero (SenderNumber) su cui la campagna è attiva. `keywords`: parole chiave che, nel primo messaggio, instradano su questa campagna.
- `dataController`: il titolare del trattamento, citato nei consensi.
- `onStop.data`: cosa fare dei dati quando la sessione si chiude con `@stop`: `delete` oppure `keep`.
- `texts`: testi riutilizzabili, referenziati per chiave.
- Ogni testo è un oggetto `{ "it": "…", "<lang>": "…" }`. L'italiano è **obbligatorio**, le altre lingue sono traduzioni curate facoltative.

### 5.2 Tipi di passaggio (v1)

| Tipo | Scopo | Configurazione principale | Esiti |
|---|---|---|---|
| `message` | Invia un testo informativo | `text` | `next` |
| `choice` | Domanda chiusa interpretata dall'LLM | `prompt`, `options` (es. `yes`/`no`/`idk` o personalizzate, ognuna con una descrizione per l'LLM) | uno per opzione |
| `consent` | Consenso bloccante | `consentKey`, `textVersion`, `text`, `link`, `optional` | `accepted`, `declined` |
| `questions` | Un blocco dell'intervista | `title`, `questions[]` | `completed`, `terminated` |
| `cv_offer` | Propone di generare il CV | `prompt` | `yes`, `no` |
| `end` | Chiusura e passaggio a "completato" | `text` | — |

**Passaggi predisposti per il futuro** (vedi §17): `document_import`, `appointment`, `media_request`.

### 5.3 Domande (dentro `questions`)

```json
{
  "id": "patente",
  "field": "drivingLicense",
  "prompt": { "it": "Hai la patente di guida? Se sì, quale?" },
  "required": true,
  "hint": "Se dice di avere la patente ma scaduta, è false.",
  "when": { "field": "transport", "neq": "auto" },
  "maxClarifications": 2
}
```

- `field`: un campo dello schema standard (§6) oppure `custom.<key>`.
- `prompt`: la domanda di riferimento. Il motore la può far **riformulare** in modo naturale nella lingua del candidato.
- `hint`: istruzioni per l'estrazione specifiche della domanda. Le legge solo l'LLM.
- `when`: condizione per porre la domanda. `terminateIf`: condizione che termina il blocco o l'intervista (es. consenso negato).
- `maxClarifications`: numero massimo di approfondimenti prima di andare avanti.
- **Una domanda il cui campo è già valorizzato con confidenza sufficiente viene saltata.** È il meccanismo che gestisce sia le risposte anticipate sia, in futuro, l'import del CV.

### 5.4 Transizioni

- Per impostazione predefinita si passa al passaggio successivo dell'elenco.
- `on` permette di sostituirla per esito: `"on": { "no": "@stop", "idk": { "reply": "cv_explain", "then": "@repeat" } }`.
- Destinazioni possibili:
  - un `id` di passaggio;
  - `@stop`: chiude senza completare e applica `onStop`;
  - `@repeat`: ripete il passaggio corrente;
  - `@end`: va alla chiusura.
- Un esito può avere `reply`, cioè un testo da inviare prima della transizione.

### 5.5 Condizioni

Le condizioni sono dati, non codice. Operatori: `eq`, `neq`, `in`, `notIn`, `exists`, `notExists`, `gt`, `lt`; combinatori: `all`, `any`, `not`. Possono riferirsi a campi del profilo, a campi personalizzati e ad esiti di passaggi precedenti (`"step": "cv_info", "outcome": "yes"`).

### 5.6 Passaggio fisso iniziale: la lingua

Prima del `flow` il motore esegue sempre un passaggio di sistema, `language`. I punti 1 e 3 sono una proposta non ancora discussa: su Make il benvenuto è solo in italiano.
1. Invia un messaggio di benvenuto breve, in italiano più una riga in inglese (testo di sistema configurabile), che chiede in quale lingua proseguire.
2. Interpreta la risposta. Riconosce i nomi delle lingue scritti in qualunque lingua ("Arabo" → `ar`), oppure rileva la lingua del testo. Default `it`.
3. Se il primo messaggio contiene già testo oltre alla parola chiave, e la lingua è rilevata con alta confidenza, la propone direttamente per conferma.
4. Salva `Session.language` e `Contact.preferredLanguage`.

### 5.7 Fase dopo il completamento

Quando la sessione è `completed`, i messaggi successivi vengono interpretati in "modalità post-intervista":
- **richiesta di modifica** → si individua il campo, si mostra il valore vecchio e quello nuovo, si conferma, si salva come `ProfileChange(source: edit)` e si invia l'evento `profile.updated` (se `allowEdits`);
- **rigenerazione del CV** → passaggio `cv_offer` (se `allowCvRegeneration`);
- **altro** → risposta cortese che indica cosa è possibile fare.

### 5.8 Validazione all'import (CLI)

Una campagna viene rifiutata se:
- non rispetta lo schema Zod;
- ha `id` di passaggio o di domanda duplicati o inesistenti nelle transizioni;
- un `field` non appartiene né allo schema standard né ai `customFields`;
- un passaggio non è raggiungibile;
- c'è un ciclo diverso da `@repeat`;
- una condizione si riferisce a un campo o a un passaggio inesistente;
- un `consent` è senza `textVersion` o senza `dataController`;
- un testo manca della versione `it`;
- un `reply` o un `textRef` non esiste in `texts`;
- un `trigger.keywords` collide con un'altra campagna attiva sullo stesso numero.

L'import crea una nuova `CampaignVersion` immutabile e, se richiesto, la imposta come attiva. Le sessioni in corso restano sulla versione con cui sono iniziate.

---

## 6. Schema standard del profilo candidato

I valori vengono **normalizzati in italiano** (tranne i nomi propri e delle istituzioni) e nei formati indicati.

| Campo | Tipo | Formato / note |
|---|---|---|
| `firstName`, `lastName` | string | |
| `birthday` | date | salvato come data ISO; reso `dd/mm/yyyy` verso Kubri |
| `country` | string | paese d'origine, ISO 3166-1 alpha-2 |
| `address` | string | indirizzo di residenza come dichiarato |
| `location` | string | comune o località normalizzata |
| `lat`, `lng` | number | da geocoding |
| `phone` | string | E.164, ricavato dal canale |
| `email` | string | validata |
| `language` | string | lingua madre, ISO 639-1 |
| `italianLevel` | enum | es. `nessuno`, `base`, `intermedio`, `avanzato`, `madrelingua` |
| `additionalLanguages` | string[] | "lingua (livello)" |
| `transport` | string | mezzo di trasporto |
| `drivingLicense` | boolean | |
| `drivingLicenseTypes` | string[] | es. `B`, `C` (facoltativo) |
| `workingPermit` | boolean | |
| `educationAndTraining` | string[] | "anno - anno Istituto (Paese): Titolo" |
| `workExperience` | string[] | "anno - anno Luogo (Paese): Ruolo" |
| `skillsAndCompetences` | string[] | |
| `jobPreferences.preferredJob` | string | |
| `jobPreferences.preferredLocation` | string | |
| `jobPreferences.constraints` | string | vincoli (orari, turni, salute…) |
| `jobPreferences.partTime` | boolean | |
| `jobPreferences.hasDesiredJobExperience` | string | |
| `learningPreferences.isInterested` | boolean | |
| `learningPreferences.preference` | string | |

I campi personalizzati (`custom.*`) hanno tipo `text`, `bool`, `number`, `date`, `enum`, `list` e sono validati secondo la definizione della campagna.

**Stato per campo**, conservato accanto al valore: `confidence` (0–1), `status` (`confirmed` | `inferred` | `unresolved`) e `source` dell'ultimo aggiornamento.

---

## 7. Motore (`engine`)

### 7.1 Firma

```ts
step(state: SessionState, event: EngineEvent, campaign: CampaignVersion)
  → { state: SessionState, effects: Effect[] }
```

- **Pura:** nessuna rete, nessun database, nessun orologio implicito (l'ora arriva nell'evento).
- **Stato:** `{ phase, stepId, questionId, clarifications, pendingConfirmation, outcomes, language, consentsAccepted }`. `consentsAccepted` diventa `true` quando tutti i consensi obbligatori raggiunti sono stati accettati (soglia D24, §10.6). `phase` vale `language`, `flow`, `post_completion` oppure `closed`.
- **Eventi:** `user_turn` (con `Interpretation`), `session_started`, `timeout`, `admin_action` (futuro), `outbound_failed`.
- **Effetti:** `SendText`, `SendChoice` (bottoni interattivi, futuro), `ApplyPatch`, `RecordConsent`, `SetLanguage`, `CompleteSession`, `StopSession`, `EnqueueJob` (`kubri-webhook`, `cv`, `geocoding`), `FlagSession`.

### 7.2 Semantica di un turno

1. **Intenti globali**, valutati per primi in qualunque fase: `opt_out` ("stop") e `delete_data`. Vengono riconosciuti sia dall'LLM sia da parole chiave deterministiche, così funzionano anche se l'LLM non è disponibile.
2. **Patch:** tutti i campi estratti e validi vengono applicati, **anche quelli non richiesti**. Sotto la soglia di confidenza del campo il valore non viene salvato: il motore chiede conferma.
3. **Domanda corrente:**
   - `complete` → avanza;
   - `partial` → approfondimento mirato su ciò che manca, entro `maxClarifications`;
   - `absent` → ripete la domanda riformulata.

   Dopo il limite: se la domanda è facoltativa si salta, se è obbligatoria il campo diventa `unresolved`, si avanza e si emette `FlagSession`.
4. **Fuori contesto** (`off_topic`): risposta breve, poi si ripete la domanda corrente.
5. **Richiesta di modifica** (`edit_request`): conferma con il valore vecchio e quello nuovo, poi si riprende da dove si era.
6. **Avanzamento automatico:** il motore continua finché arriva a un passaggio che attende una risposta. Più testi in un turno vengono inviati in ordine.
7. **Salto dei campi già valorizzati** (vedi §5.3).
8. **Avanzamento:** "Sezione N di M" calcolato sui blocchi `questions` raggiungibili.
9. **Protezioni:** al massimo 20 avanzamenti automatici per turno; uno stato non riconosciuto porta a messaggio generico più `FlagSession(needs_attention)`. **Mai silenzio.**

### 7.3 Consenso

- Il passaggio `consent` **blocca** l'avanzamento finché l'esito non è `accepted`, oppure `declined` se il consenso è facoltativo.
- `RecordConsent` salva la chiave, la versione del testo, la lingua, la **copia del testo mostrato**, il titolare, l'esito e la data.
- Il consenso alla condivisione nel pool globale Kubri (`kubri_global`) è un passaggio separato e facoltativo. Il suo esito determina `is_kubri_privacy_accepted` nel webhook.

---

## 8. Comprensione del linguaggio (`nlu`)

### 8.1 Compiti

1. **Interpretazione del turno** (`interpret`), una chiamata strutturata per turno, che restituisce lingua, intento, patch e completezza.
2. **Traduzione** (`translate`) dei testi della campagna, con cache.
3. **Riformulazione** facoltativa della domanda nella lingua del candidato (può coincidere con la traduzione).

Usare una sola chiamata per l'interpretazione è la scelta di partenza perché costa meno e ha meno latenza. La divisione in più chiamate (intento separato dall'estrazione) resta un'opzione da confrontare con gli evals.

### 8.2 Contesto passato all'LLM (minimizzazione)

- domanda corrente (testo, `field`, tipo, `hint`);
- campi ancora aperti del blocco, con tipo e descrizione;
- **riepilogo compatto** dei campi già raccolti, utile per capire le richieste di modifica: **senza** nome, cognome, telefono, indirizzo completo o data di nascita, a meno che non servano per il turno (per esempio per modificare quel campo);
- ultimi N messaggi della sessione (N configurabile, ridotto);
- lingua della sessione e fase (`language` / `flow` / `post_completion`).

### 8.3 Output (`Interpretation`)

```ts
interface Interpretation {
  language: { code: string; confidence: number };
  intent: "answer" | "choice" | "off_topic" | "edit_request" | "refusal"
        | "help" | "opt_out" | "delete_data" | "unclear";
  choice?: string;                       // per choice / consent / cv_offer
  patch: Array<{ field: string; value: unknown; confidence: number; evidence: string }>;
  currentQuestion: { completeness: "complete" | "partial" | "absent"; missing?: string };
  editTarget?: { field: string; newValue: unknown };
  offTopicReply?: string;
}
```

`evidence` è il pezzo di messaggio da cui deriva il valore. Serve per il debug e per gli evals sulle invenzioni.

### 8.4 Robustezza

- **Output strutturato** validato con Zod. Se non è valido si fa un tentativo di correzione, poi `intent: unclear`.
- **Timeout ed errori:** 2 ritentativi con attesa crescente, poi il modello di riserva.
- **Validazione delle patch** in `profile`: un valore non valido per il tipo viene scartato e registrato.

### 8.5 Provider e modelli

- Interfaccia `LlmProvider` con `complete({ messages, schema, model, temperature })`.
- Configurazione per compito: `interpret.model`, `translate.model`, `fallback.model`.
- Candidato iniziale: **Mistral**, ospitato in UE. La scelta finale si fa confrontando gli evals.
- **Prompt versionati** in `src/nlu/prompts/`; la versione viene salvata in ogni `NluTrace`.

---

## 9. Multilingua (`i18n`)

- Lingua di riferimento: **italiano**. Ogni testo ha `it` obbligatorio.
- Risoluzione di un testo per la lingua `L`:
  1. traduzione curata `L` nella campagna;
  2. `TranslationCache` (hash del sorgente + `L`);
  3. traduzione LLM, salvata in cache con `reviewed = false`.
- Una traduzione in cache può essere revisionata da una persona e marcata `reviewed = true`.
- **Testi critici** (consensi, informative): se manca una traduzione curata si invia la traduzione LLM **insieme al link del testo ufficiale**. In `Consent` si registra quale testo è stato mostrato. Una campagna può rendere obbligatoria la traduzione curata per alcune lingue (`requireCurated: ["ar", …]`).
- Le lingue e le domande che hanno bisogno di traduzioni curate si individuano **con gli evals** (§15).
- I valori del profilo vengono normalizzati in italiano a prescindere dalla lingua della conversazione.

---

## 10. Modello dati

Schema Postgres **`bot`**, nello stesso progetto Supabase della dashboard. Tutte le chiavi primarie sono UUID.

### 10.1 Canali e campagne

- **Organization**: `id`, `slug`, `name`, `kubriOrganizationId?` (collegamento futuro alla dashboard), `createdAt`.
- **SenderNumber**:
  - `id`, `organizationId?`, `channel` (`whatsapp`), `provider` (`meta` | `twilio`), `phoneE164`, `displayName`;
  - `providerConfig` (identificativi come `phoneNumberId` e `wabaId`; **le credenziali sono riferimenti a segreti, mai in chiaro**);
  - `status` (`provisioning` | `active` | `suspended`), `createdAt`.
- **Campaign**: `id`, `slug`, `organizationId`, `senderNumberId`, `keywords[]`, `externalKey`, `activeVersionId`, `status` (`active` | `paused` | `archived`), `isDefault` (la campagna standard Kubri del numero).
- **CampaignVersion**: `id`, `campaignId`, `version`, `definition` (jsonb), `checksum`, `importedAt`, `importedBy`. **Immutabile.**

### 10.2 Persone e conversazioni

- **Contact**: `id`, `channel`, `externalId` (`wa_id`), `phoneE164`, `preferredLanguage`, `createdAt`. Vincolo univoco su (`channel`, `externalId`).
- **ContactChannelState** (contatto × numero): `lastInboundAt` (finestra di 24 ore), `optInStatus`, `optInSource`, `optInAt`, `optOutAt`.
- **Session**:
  - `id`, `contactId`, `senderNumberId`, `campaignVersionId`;
  - `status` (`active` | `completed` | `stopped` | `abandoned` | `needs_attention`);
  - `engineState` (jsonb), `language`, `origin` (`inbound` | `outbound`, futuro);
  - `startedAt`, `completedAt`, `lastActivityAt`.
  - Una sola sessione `active` per (contatto, numero).
- **Message**:
  - `id`, `contactId`, `senderNumberId`, `sessionId?`, `direction` (`in` | `out`);
  - `type` (`text` | `audio` | `image` | `document` | `interactive` | `template` | `location` | `unsupported`);
  - `body`, `mediaRef?`, `templateName?`, `payloadRaw` (jsonb, per i messaggi in entrata);
  - `stepId?`, `questionId?` (contesto al momento del messaggio);
  - `providerMessageId` (**univoco**, per la deduplica);
  - `status` (`received` | `processed` | `queued` | `sent` | `delivered` | `read` | `failed`), `sentAt`, `deliveredAt`, `readAt`, `failedAt`, `errorCode?`;
  - `turnId?`, `createdAt`.
- **Turn**: `id`, `sessionId`, `inboundMessageIds[]`, `startedAt`, `completedAt`, `outcome`.

### 10.3 Profilo, consensi e tracciabilità

- **CandidateProfile**: `id`, `sessionId` (1:1), `standard` (jsonb, schema §6), `custom` (jsonb), `fieldMeta` (jsonb: confidenza, stato e fonte per campo), `cvDocumentId?`, `completedAt`, `updatedAt`.
- **ProfileChange**: `id`, `profileId`, `field`, `oldValue`, `newValue`, `source` (`extraction` | `edit` | `system` | `document_import`, estendibile), `turnId?`, `confidence?`, `createdAt`.
- **Consent**: `id`, `contactId`, `sessionId`, `consentKey`, `textVersion`, `language`, `textShown`, `textShownIsCurated`, `dataController`, `outcome`, `messageId`, `createdAt`.
- **NluTrace**: `id`, `turnId`, `task`, `promptVersion`, `provider`, `model`, `input` (jsonb), `output` (jsonb), `valid`, `latencyMs`, `inputTokens`, `outputTokens`, `costEstimate`, `error?`, `createdAt`.
- **CvDocument**: `id`, `profileId`, `kind` (`generated` | `uploaded`), `template`, `storageKey`, `createdAt`.
- **TranslationCache**: `sourceHash`, `language`, `text`, `provider`, `model`, `reviewed`, `createdAt`. Chiave primaria su (`sourceHash`, `language`).
- **InboundDeadLetter**: payload non interpretabili (`raw`, `reason`, `createdAt`).

### 10.4 Code e job

- **pg-boss** nello stesso database, nel suo schema (`bot_queue`).
- I job vengono inseriti **nella stessa transazione** che aggiorna lo stato e il profilo (outbox transazionale).
- Code: `process-contact`, `send-messages`, `kubri-webhook`, `cv`, `geocoding`, `sweep-inactive` (programmato), `delete-contact`.

### 10.5 Ruoli database

- `bot_app`: lettura e scrittura solo sugli schemi `bot` e `bot_queue`.
- `bot_migrator`: proprietario dello schema `bot`, esegue le migrazioni Prisma (DDL).
- `bot_queue` è di proprietà di `bot_app`, perché pg-boss crea e aggiorna da solo le proprie tabelle all'avvio del worker.
- In futuro `dashboard_reader`: lettura su tabelle selezionate di `bot` (es. `Message`, `Session`) per mostrare lo storico in dashboard.
- **Nessuno dei ruoli del bot può toccare lo schema della dashboard, e viceversa.**

### 10.6 Conservazione e cancellazione

- **Diritto all'oblio:** `delete-contact` cancella a cascata sessioni, messaggi, profili, tracce, file multimediali e CV. Dei consensi resta una prova minima (chiave, versione, esito, data, hash del contatto).
- Durate di conservazione configurabili per: file multimediali, `NluTrace`, `payloadRaw`, sessioni abbandonate.
- **Soglia dei consensi (D24).** Il comportamento di una sessione che non arriva al completamento dipende da dove si è fermata:

  | Caso | Prima dell'accettazione dei consensi obbligatori | Dopo l'accettazione |
  |---|---|---|
  | `@stop` (rifiuto di un consenso obbligatorio, "no" a continuare) | si cancella tutto, resta solo la prova minima del rifiuto | si applica `onStop.data` della campagna (default `delete`) |
  | Abbandono (il candidato smette di rispondere) | cancellazione dopo un breve periodo (durata da definire) | sessione `abandoned`, **candidabile al follow-up** (§17); cancellata solo allo scadere del periodo di conservazione delle sessioni abbandonate (durata da definire, §18) |

  Il motore registra nello stato il superamento della soglia (`consentsAccepted`), così `sweep-inactive` e il futuro follow-up non devono ricostruirlo. Il webhook verso Kubri parte solo dopo la soglia: prima non esiste un candidato.
- La richiesta di cancellazione va **propagata anche alla piattaforma Kubri** (meccanismo da definire, §18).

---

## 11. Percorso di un messaggio

### 11.1 Processo web

```
GET  /webhooks/whatsapp/:sender   verifica di Meta (hub.mode, hub.verify_token, hub.challenge)
POST /webhooks/whatsapp/:sender
 1. verifica X-Hub-Signature-256 con l'app secret del numero → se non valida: 401
 2. parse di TUTTE le entry, i change, i messaggi e gli stati
 3. per ogni messaggio:
      INSERT Message(in) … ON CONFLICT (providerMessageId) DO NOTHING → duplicato: ignora
      upsert Contact, aggiorna ContactChannelState.lastInboundAt
      accoda process-contact(contactId, senderId), partenza tra DEBOUNCE_MS, uno per contatto
 4. per ogni ricevuta di stato: aggiorna Message.status e i relativi orari
 5. payload non interpretabile → InboundDeadLetter, risposta 200
 6. database non disponibile → 500 (Meta ritenta, la deduplica protegge)
 7. 200
```

### 11.2 Worker: `process-contact`

```
 1. pg_advisory_xact_lock(contactId) → un solo turno alla volta per persona
 2. messaggi in entrata con status=received, in ordine → la "raffica" del turno
    invia conferma di lettura e indicatore "sta scrivendo"
 3. media: audio/documento/immagine → media (v1: risposta "per ora scrivimi in testo")
 4. sessione:
      attiva → la usa
      assente → instradamento per parola chiave sulle campagne del numero,
                altrimenti la campagna di default (standard Kubri)
                → nuova Session sulla versione attiva
 5. costruisce il contesto (§8.2) → nlu.interpret → salva NluTrace
 6. engine.step(state, user_turn, campaignVersion) → nuovo stato + effetti
 7. i18n risolve i testi degli effetti SendText (fuori dalla transazione)
 8. TRANSAZIONE:
      Session.engineState / status · CandidateProfile + ProfileChange · Consent
      · Message(in) → processed · Message(out) → queued · Turn
      · job: send-messages; se c'è un evento significativo kubri-webhook / cv / geocoding
 9. commit (il lock si rilascia)
10. se nel frattempo sono arrivati altri messaggi → nuovo process-contact
```

**Attesa breve:** `DEBOUNCE_MS` è circa 3000 di default, configurabile. Riunisce i messaggi scritti a raffica in un unico turno.

### 11.3 Worker: `send-messages`

- Invia i `Message(out)` in stato `queued` del contatto **in ordine**, uno alla volta, e salva `providerMessageId` e `sentAt`.
- Prima di un messaggio libero verifica la finestra delle 24 ore. Fuori finestra sono ammessi solo template.
- Errore temporaneo → ritenta con attesa crescente. Errore definitivo → `failed` e **interruzione dei messaggi successivi del turno**, poi evento `outbound_failed` al motore.

### 11.4 Latenza attesa

Conferma di lettura e "sta scrivendo" immediati; risposta in circa `DEBOUNCE_MS` + 2–5 secondi dopo l'ultimo messaggio della raffica.

---

## 12. Integrazioni

### 12.1 Webhook verso la piattaforma Kubri

Si mantiene l'endpoint esistente. Il modulo `integrations` vi si adegua.

- `POST {KUBRI_BASE_URL}/api/webhooks/make/candidate`
- `Authorization: Bearer {KUBRI_WEBHOOK_SECRET}`
- Corpo: `{ "key": string, "externalKey": string, "data": object }`
  - `key`: identificativo stabile del candidato per quella campagna. La piattaforma fa l'upsert su (pool, `key`). **Deciso (D20): `key` = `<Contact.id>:<Campaign.id>`** (due UUID, nessun dato personale). La stessa persona che rifà la stessa campagna aggiorna la stessa riga in dashboard; ogni invio porta il profilo della sessione più recente.
  - `externalKey`: `Campaign.externalKey` (il pool lato Kubri).
  - `data`: il profilo **completo e aggiornato**, letto dal database dopo il commit e mappato con le chiavi che la piattaforma si aspetta oggi:

| Profilo | Chiave in `data` |
|---|---|
| `firstName` / `lastName` | `first_name` / `last_name` |
| `birthday` | `birthday` (`dd/mm/yyyy`) |
| `country` | `country` |
| `address`, `location` | `address`, `location` |
| `lat`, `lng` | `lat`, `lng` |
| `phone`, `email` | `phone`, `email` |
| `workingPermit` | `working_permit` (boolean) |
| `transport` | `transport` |
| `drivingLicense` | `driving_license` (boolean) |
| `educationAndTraining` | `education_and_training` |
| `workExperience` | `work_experience` |
| `skillsAndCompetences` | `skills_and_competences` |
| `language`, `additionalLanguages`, `italianLevel` | `language`, `additional_languages`, `italian_level` |
| `jobPreferences.*` | `job_preferences.{preferred_job, part_time_preference, preferred_location, constraints, has_desired_job_experience}` |
| `Session.language` | `interview_language` |
| canale | `channel` (**esplicito**, es. `whatsapp`; D22) |
| sorgente | `source_organization` = `kubri-chatbot` |
| consenso `kubri_global` | `is_kubri_privacy_accepted` (**boolean**) |
| `updatedAt` | `last_updated` (ISO) |
| `custom.*` | `custom` (oggetto; la piattaforma lo conserva nel `rawPayload`) |
| meta | `interview_status`, `cv_link_pdf` (link firmato), `campaign_version` |

- **Adeguamento lato dashboard (prerequisito del go-live, piano 10).** Oggi la dashboard ricava il canale da `source_organization` (`apps/dashboard/src/lib/make/normalize.ts`, `deriveChannelOrNull`: tutto ciò che non contiene `whatsapp` diventa `telegram`). Va fatta leggere prima `channel`, con ripiego su `source_organization` per i payload di Make ancora in arrivo. Lo schema Zod del payload si sposta in `@kubri/contracts`, condiviso da chatbot e dashboard (D19).
- **Quando:** `consents.accepted` (superamento della soglia D24: è qui che il candidato nasce in dashboard, non prima), `block.completed`, `interview.completed`, `profile.updated` (modifica dopo il completamento), `cv.generated`. Mai a ogni messaggio.
- **Ritentativi:** 5xx o timeout si ritentano con attesa crescente. 4xx (`validation_failed`, `unknown_pool`, `unauthorized`) è definitivo e finisce negli scarti con un avviso.
- **Idempotenza:** garantita dall'upsert lato piattaforma.
- **Test di contratto** (§14) per allineare la mappatura alla validazione della dashboard.

### 12.2 CV

- Attivato da `cv_offer` con esito `yes`.
- Template **HTML** per campagna (con un template di default) → PDF. Libreria da scegliere: una basata su Chromium headless o una tipo `@react-pdf`.
- Il file va in uno storage **privato** (bucket Supabase Storage dedicato al bot). Al candidato si invia un **link firmato a scadenza**, oppure il PDF come documento WhatsApp.
- Si salva in `CvDocument(kind: generated)`, poi si invia l'evento `cv.generated` a Kubri.

### 12.3 Geocoding

- Al completamento, o quando `address` cambia, dall'indirizzo **aggiornato** si ricavano `lat`/`lng`.
- Provider da scegliere. Come riserva c'è la piattaforma Kubri, che ha già un geocoding sui comuni ISTAT.

---

## 13. Gestione degli errori

**Principio: mai silenzio senza un motivo registrato.** Ogni turno finisce con una risposta al candidato oppure con un errore registrato e segnalato.

| Livello | Caso | Comportamento |
|---|---|---|
| Ingresso | Firma non valida | 401, registrazione |
| Ingresso | Payload malformato o sconosciuto | `InboundDeadLetter`, 200 |
| Ingresso | Database non disponibile | 500 (Meta ritenta) |
| LLM | Timeout o 5xx | 2 ritentativi, poi modello di riserva |
| LLM | Output non valido | 1 tentativo di correzione, poi `unclear` → chiede di riformulare |
| LLM | Valore non valido per il tipo | scartato e registrato, non entra nel profilo |
| LLM | Confidenza bassa | richiesta di conferma invece del salvataggio |
| Motore | Approfondimenti esauriti | facoltativa: salto; obbligatoria: `unresolved` + `FlagSession` |
| Motore | Troppi avanzamenti in un turno | interruzione + `needs_attention` |
| Motore | Stato incoerente | messaggio generico + `needs_attention` + avviso |
| Motore | Intenti globali (stop, cancellazione) | gestione deterministica, anche senza LLM |
| Invio | Errore temporaneo Meta (limiti, 5xx) | ritentativi con attesa crescente |
| Invio | Errore definitivo (non raggiungibile, fuori finestra 24h, template non valido) | `failed`, stop dei messaggi successivi del turno, segnalazione |
| Job | Ritentativi esauriti | coda degli scarti + avviso |
| Webhook Kubri | 5xx o timeout | ritentativi |
| Webhook Kubri | 4xx | scarti + avviso (definitivo) |
| Worker | Crash a metà turno | transazione annullata, lock rilasciato, job riconsegnato, messaggi rielaborati |
| Campagne | Campagna disattivata | sessioni attive concluse sulla loro versione; i nuovi contatti vanno sulla campagna di default |

### 13.1 Osservabilità

- Log strutturati (JSON) con `sessionId`, `contactId`, `turnId`, **senza dati personali**.
- Monitoraggio degli errori con un servizio che abbia una regione UE.
- Metriche e avvisi: job negli scarti, sessioni in `needs_attention`, tasso di errore e latenza dell'LLM, messaggi `failed`, durata media del turno, costo LLM per sessione.
- Endpoint `/health` (web) e un controllo di vitalità del worker.
- Comandi CLI di diagnostica: `ops session <id>` (cronologia del turno, tracce, effetti), `ops dead-letters`.

---

## 14. Test

| Livello | Oggetto | Come |
|---|---|---|
| Unitari | `engine.step`, validatore delle campagne, condizioni, validazione delle patch, mappatura Kubri, classificazione degli errori Meta, parser dei webhook | funzioni pure; payload reali di Meta in `tests/fixtures/meta/` |
| Scenari | Conversazioni intere per ogni campagna | LLM finto con interpretazioni scritte a mano; verifiche su percorso, profilo finale ed effetti. Obbligatori per ogni campagna: percorso ideale, consenso negato, risposte parziali, risposta anticipata (salto), modifica dopo il completamento, CV sì/no. Girano in CI. |
| Integrazione | Worker + Postgres reale + canale finto + LLM finto | deduplica, ordine, attesa breve, lock, rollback, ritentativi, scarti, finestra 24h |
| Contratto | Payload verso Kubri | esempio condiviso, validato con uno schema allineato a quello della dashboard |
| Manuale | CLI `campaigns simulate` | intervista in terminale con LLM reale, senza Meta |

Esempio di scenario:

```yaml
campaign: culligan-vendita
steps:
  - user: "culligan"
    expect: { phase: language }
  - user: "italiano"
    nlu: { intent: answer, language: { code: it, confidence: 0.99 } }
    expect: { step: intro→cv_info }
  - user: "boh cos'è"
    nlu: { intent: choice, choice: idk }
    expect: { step: cv_info, sent: [cv_explain] }
```

---

## 15. Evals

Gli evals **misurano la qualità di `nlu`** e producono un punteggio, a differenza dei test, che verificano il codice e passano o falliscono. Il sistema è anche uno strumento didattico: si costruisce un ingrediente alla volta.

### 15.1 Ingredienti

1. **Dataset:** casi JSONL in `evals/datasets/<suite>.jsonl`.
   ```json
   {
     "id": "patente-scaduta-01",
     "tags": ["partial", "it", "bool", "unasked-info"],
     "context": { "phase": "flow", "question": { "id": "patente", "field": "drivingLicense" },
                  "openFields": ["drivingLicense", "transport"], "language": "it" },
     "message": "ce l'ho ma è scaduta da un anno, comunque vado in bici",
     "expected": {
       "intent": "answer",
       "patch": { "drivingLicense": false, "transport": "bicicletta" },
       "currentQuestion": { "completeness": "complete" }
     }
   }
   ```
2. **Compito:** `nlu.interpret` con un **prompt** (versione) e un **modello** specifici. Ogni combinazione è un "candidato" da confrontare.
3. **Misuratori:**
   - **deterministici**: intento, scelta, booleani, enum, date normalizzate, completezza;
   - **strutturati**: esperienze e titoli confrontati per parti (anni, luogo, ruolo);
   - **LLM come giudice**: per riformulazioni e traduzioni, con una griglia scritta e un modello diverso da quello valutato. **Tarato** su un campione valutato da una persona.
4. **Metriche e report:**
   - precisione e richiamo **per campo**;
   - **tasso di invenzione** (campi estratti mai detti: è la metrica principale);
   - accuratezza dell'intento con matrice di confusione;
   - completezza corretta;
   - tutto **diviso per lingua e per etichetta**;
   - costo e latenza medi per caso.

### 15.2 Suite iniziali

- `extraction`: estrazione e normalizzazione dei campi.
- `intent`: risposta, fuori contesto, modifica, rifiuto, stop, cancellazione.
- `choice`: sì / no / non so, consensi, offerta del CV.
- `language`: riconoscimento della lingua e dei nomi delle lingue.
- `translation` (giudice LLM): fedeltà e naturalezza dei testi tradotti, con attenzione ai consensi.

### 15.3 Fonti dei casi

1. **Casi scritti a mano** (60–100 all'inizio), dall'analisi di Make e dalle conversazioni reali, **anonimizzati** con dati di fantasia.
2. **Raccolta dalla produzione** tramite `NluTrace`: confidenza bassa, candidato che corregge subito dopo, `unclear`, sessioni `needs_attention`. Una persona rivede ed etichetta, poi il caso entra nel dataset.
3. **Varianti per lingua** dello stesso caso, per misurare il divario per lingua e decidere dove servono traduzioni curate.

### 15.4 Esecuzione e soglie

- `kubri-bot evals run --suite extraction --model … --prompt …`
- Si confronta con un'esecuzione di riferimento salvata, mostrando i casi peggiorati e migliorati.
- Soglie bloccanti per i cambi di prompt o modello (iniziali, da tarare): **invenzioni ≤ 1%**, **accuratezza dell'intento ≥ 95%**, nessun peggioramento oltre 2 punti in nessuna lingua.
- Non si eseguono a ogni commit, ma a ogni modifica di prompt o modello e su richiesta.
- Risultati in `evals/reports/` (JSON + Markdown), così si vede l'andamento nel tempo.

### 15.5 Strumenti

Il motore di evals è scritto in proprio in TypeScript: dataset in JSON, misuratori come funzioni, report in Markdown. I dati non escono verso servizi esterni. promptfoo o Langfuse (installato in proprio) si potranno valutare in seguito.

---

## 16. Infrastruttura, ambienti e sicurezza

### 16.1 Hosting

- Container gestito in UE. Opzioni: Fly.io, Railway, Render (aziende statunitensi con regioni UE) oppure Scaleway, Clever Cloud (aziende europee). **Da scegliere**; criteri: regione UE, sovranità dei dati, esperienza di deploy, costo.
- Un'unica immagine, due processi: `web` (scalabile) e `worker` (1+ istanze; la correttezza è garantita dal lock per contatto).
- Connessione al database: **diretta o session pooler (5432)** per pg-boss e il worker, non il transaction pooler.

### 16.2 Ambienti

- `dev`: progetto Supabase di sviluppo, schema `bot`, numero WhatsApp di test.
- `prod`: progetto Supabase di produzione, schema `bot`, numeri reali.
- Locale: Postgres in Docker; adattatore di canale finto; CLI `simulate`.
- Migrazioni Prisma applicate **manualmente** a prod prima del deploy del codice che le richiede, come per la dashboard.

### 16.3 Sicurezza e privacy

- Verifica della firma su ogni webhook in entrata.
- Segreti (token Meta, app secret, chiavi LLM, segreto del webhook Kubri) solo in variabili d'ambiente o nel gestore dei segreti della piattaforma; nel database solo riferimenti.
- Minimizzazione dei dati verso l'LLM (§8.2); provider con hosting UE e senza addestramento sui dati.
- Log senza dati personali.
- Storage privato e link firmati a scadenza.
- Ruoli database separati (§10.5).
- Registro dei consensi con il testo mostrato.
- Diritto all'oblio e durate di conservazione (§10.6).
- Il trattamento dei dati è descritto per campagna (`dataController`).

---

## 17. Sviluppi futuri e predisposizioni

| Sviluppo | Predisposizione già nella v1 |
|---|---|
| **Telegram e altri canali** | Interfaccia `channels` e campo `Contact.channel`. |
| **Provisioning dei numeri** (anche manuale) con Twilio | `SenderNumber` con `provider` e `status`; provider separato dal canale. Il provisioning manuale consiste nell'inserire un record e i segreti. |
| **Contatto proattivo via WhatsApp** (nel rispetto dei vincoli Meta) | `ContactChannelState` (opt-in, opt-out, finestra 24h), `Session.origin = outbound`, messaggi `template`, coda programmabile, limiti di velocità nel worker, ricevute di stato per misurare l'esito. |
| **Promemoria e follow-up** (sessioni abbandonate dopo la soglia dei consensi, D24) | Job `sweep-inactive`, evento `timeout` del motore, controllo della finestra delle 24 ore, flag `consentsAccepted` nello stato, stato `abandoned` che conserva i dati fino alla scadenza. Fuori dalla finestra delle 24 ore il follow-up richiede un template approvato da Meta. |
| **Vocali** | `InboundEvent` di tipo audio, modulo `media` con `Transcriber`: l'audio trascritto entra come testo. |
| **Import del CV caricato dal candidato** | Tipo di passaggio `document_import`: scarico in storage privato → `DocumentExtractor` → patch (`source: document_import`) → riepilogo e conferma → esiti `complete` / `partial` / `failed`. Il **salto dell'intervista** non va costruito a parte: le domande con campo già valorizzato vengono saltate. `CvDocument.kind = uploaded`. |
| **Bottoni interattivi** (sì/no, consensi) | Effetto `SendChoice`; `InboundEvent` di tipo interattivo. |
| **Pannello per configurare le campagne** | Le campagne sono già documenti validati e versionati nel database: il pannello è solo un editor in più. |
| **Storico delle conversazioni in dashboard** | Stesso Postgres; ruolo `dashboard_reader` in sola lettura su `Message` e `Session`. |
| **Convergenza dei dati con la dashboard** | Stesso database (schemi separati): basteranno viste o chiavi esterne, senza procedure di copia. Collegamento `Organization.kubriOrganizationId`. |
| **Intervento di un operatore** | Evento `admin_action` del motore; sessione `needs_attention`. |
| **Nuovi tipi di passaggio** (appuntamento, richiesta di documenti) | Insieme dei tipi estendibile nel codice, poi disponibile per tutte le campagne. |

---

## 18. Domande aperte

Risolte (2026-10-24): chiave del candidato → D20; pool → D21; `source_organization` e canale → D22; consensi per campagna → D23; esito `@stop` e abbandono → D24; posizione del codice → D19; numero WhatsApp di sviluppo → app Meta di test dedicata con il suo numero, separata dall'app usata da Make; hosting → in UE (fornitore ancora da scegliere, punto 12).

1. **Seconda sessione sulla stessa campagna** (conseguenza di D20): la nuova intervista parte vuota oppure precompilata dal profilo precedente, con le domande "saltate" trasformate in conferme ("Hai ancora la patente B?")?
4. **Altri scenari Make collegati** (follow-up con `followed_up_at` / `second_follow_up_at`, Telegram): vanno rimpiazzati nella migrazione?
5. **Testi ufficiali dei consensi** e titolare del trattamento per ciascuna campagna, con le loro versioni (fino ad allora: segnaposto, D23).
6. **Durate di conservazione** per messaggi, tracce LLM, file multimediali, sessioni abbandonate prima e dopo la soglia dei consensi (D24).
7. **Follow-up delle sessioni abbandonate:** quanti tentativi, dopo quanto tempo, con quali template (D24, §17).
8. **Propagazione della cancellazione** verso la piattaforma Kubri: endpoint dedicato o evento nel webhook?
9. **Lingue reali e volumi** per scegliere le traduzioni curate prioritarie e dimensionare il worker.
10. **Template del CV:** unico o per cliente?
11. **Proprietà degli account WhatsApp Business in produzione:** numeri tutti sotto un account Kubri oppure account dei clienti? Incide su provisioning e Twilio.
12. **Fornitore di hosting in UE e provider LLM definitivo** (dopo i primi evals).
13. **Campagne senza passaggio `end` o con più `end`:** cosa fa `@end`?

---

## 19. Fasi di realizzazione (proposta)

| Fase | Contenuto | Risultato verificabile |
|---|---|---|
| **0. Fondamenta** | Repo, TypeScript, lint, CI, Prisma sullo schema `bot`, ruoli database, struttura dei moduli | CI verde, migrazione iniziale su dev |
| **1. Campagne e motore** | Schema della campagna, validatore, import, schema del profilo, `engine.step`, scenari con LLM finto, CLI `validate` / `simulate` (LLM finto) | Campagna standard Kubri e una campagna cliente validate; scenari verdi |
| **2. NLU ed evals** | `LlmProvider`, prompt di `interpret`, i18n con cache, `NluTrace`, motore di evals con dataset iniziale | `simulate` con LLM reale; primo report di evals con le soglie |
| **3. WhatsApp** | `channels/meta-cloud`, `ingress`, pg-boss, `process-contact`, `send-messages`, deduplica, attesa breve, lock, ricevute di stato | Intervista completa su un numero di test |
| **4. Integrazioni e consensi** | Webhook Kubri con mappatura e test di contratto, consensi registrati, CV, geocoding | Candidato completo visibile nella dashboard di dev |
| **5. Messa in produzione** | Osservabilità, avvisi, cancellazione e conservazione, porting delle campagne esistenti, migrazione del numero di test e poi del numero Kubri | Numero Kubri in produzione sul nuovo sistema; Make spento per WhatsApp |

---

## Appendice A — Testi segnaposto dei consensi (D23)

Da usare nella campagna standard Kubri e nelle campagne di test **finché non arrivano i testi ufficiali**. Non sono testi legali: l'import in produzione deve rifiutare ogni `textVersion` che inizia con `placeholder-`.

**`privacy_interview`** (obbligatorio, `textVersion: "placeholder-2026-10"`)

> [TESTO SEGNAPOSTO] Prima di iniziare: per svolgere questa intervista raccogliamo e conserviamo le informazioni che ci darai (dati personali, esperienze, preferenze di lavoro). Il titolare del trattamento è {dataController.name}. Usiamo i tuoi dati solo per valutare la tua candidatura e metterti in contatto con opportunità di lavoro adatte a te. Puoi chiedere in qualsiasi momento di vedere, correggere o cancellare i tuoi dati scrivendo "cancella i miei dati". L'informativa completa è qui: {dataController.privacyUrl}
> Accetti di proseguire?

**`kubri_global`** (facoltativo, `textVersion: "placeholder-2026-10"`)

> [TESTO SEGNAPOSTO] Vuoi che il tuo profilo sia visibile anche ad altre organizzazioni partner di Kubri (cooperative, agenzie per il lavoro, centri per l'impiego), per ricevere più opportunità? Puoi dire di no: la tua candidatura per questa campagna resta valida comunque. Informativa: {dataController.privacyUrl}
