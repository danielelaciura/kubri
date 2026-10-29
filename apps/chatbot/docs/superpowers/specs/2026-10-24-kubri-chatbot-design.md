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
| D47 | Evento della soglia verso Kubri | Si chiama `consents.accepted`, come nel §12.1. |
| D48 | Consensi di una campagna | **Esattamente un consenso obbligatorio** per campagna: l'informativa del titolare dell'azienda che ha richiesto il questionario. L'unico altro consenso è `kubri_global`, **facoltativo**: se accettato il candidato diventa visibile anche nel pool global (`is_kubri_privacy_accepted` → `sharedWithGlobal`), se rifiutato resta conservato e visibile solo nel pool della campagna. Il validatore rifiuta un secondo consenso obbligatorio (`multiple_mandatory_consents`). |
| D49 | Conferma della cancellazione | `delete_data` (LLM o parole chiave) non tocca nulla: imposta la conferma in sospeso e invia `system.delete_confirm`. Al turno dopo, in ogni fase (anche `closed`), un sì (scelta `yes` o parola chiave breve: "sì", "yes", "ok", "confermo", …) o la richiesta ripetuta cancella: job `delete-contact` + `system.delete_done`, più `StopSession(delete_data, delete)` nelle fasi `language` e `flow` (dopo il completamento o a sessione chiusa la sessione passa a `closed` e cancella il job). Un `opt_out` annulla la cancellazione e chiude come opt-out. Qualunque altra risposta invia `system.delete_cancelled` e riprende da dove si era senza elaborare il messaggio. |
| D50 | Consenso e dati nello stesso messaggio | Sul passaggio `consent` la patch del turno si applica dopo la registrazione della risposta e l'aggiornamento della soglia: se il messaggio accetta il consenso obbligatorio ("sì, mi chiamo Mario") i dati si tengono e il blocco successivo salta le domande già valorizzate. Ordine: `RecordConsent` → `consents.accepted` → `ApplyPatch`. Prima della soglia, o dopo il rifiuto del consenso obbligatorio, i dati si scartano. |
| D51 | Risposta alla domanda corrente | Un valore salvato in precedenza (per esempio da una risposta parziale) non vale da solo come risposta: si avanza solo se il campo è valorizzato **e** il turno l'ha cambiato oppure `completeness` è `complete`. Esauriti gli approfondimenti, un valore già salvato si conserva (niente `unresolved`). |
| D52 | Intercettazioni prima della patch | Intenti globali, `edit_request`, `help` e `off_topic` si gestiscono prima di applicare la patch: da questi messaggi non si salva nessun dato estratto. |
| D53 | Conferme in sospeso | Un sì/no deterministico (parole chiave, messaggio intero) prevale sull'interpretazione dell'LLM per ogni tipo di conferma; dopo una cancellazione confermata il profilo viene svuotato anche nello stato del motore; una conferma incoerente con la fase viene scartata con `FlagSession`, senza bloccare la sessione. |
| D54 | Posizione di `kubri_global` | `kubri_global` deve seguire il consenso obbligatorio nel flusso. |
| D55 | Ripresa dopo conferme e approfondimenti | Dopo una modifica confermata (o annullata) di un altro campo si ripete la domanda corrente, così un approfondimento in sospeso non si perde; solo la modifica del campo della domanda corrente fa avanzare. Una nuova estrazione identica al valore salvato non è una risposta e non produce `ApplyPatch` (confronto per valore, non per riferimento). La richiesta di conferma di un valore incerto e il "no" a quella conferma consumano un approfondimento: al limite la domanda si chiude come da §7.2 punto 3 (`unresolved` + `FlagSession` se obbligatoria). Il motivo dello stop è `consent_declined` solo dopo un rifiuto; nei log un campo sconosciuto proposto dall'LLM compare come `<unknown>`. |
| D56 | Facoltativa senza valore | Domanda facoltativa con risposta completa ma senza valore (es. "non ho studiato"): si avanza senza registrare nulla; per una obbligatoria resta un approfondimento. |
| D57 | Stop dopo il consenso | `@stop` dopo la soglia dei consensi conserva i dati per impostazione predefinita (`onStop.data` = `keep`): il candidato resta in dashboard ed è candidabile al follow-up. Prima della soglia si cancella sempre (D24); la cancellazione esplicita passa solo da `delete_data` con conferma (D49). |
| D60 | Slug del numero | `SenderNumber.slug` univoco, citato da `trigger.sender`; il numero è univoco per (`channel`, `phoneE164`). |
| D61 | Checksum della versione | sha256 del JSON canonico (chiavi ordinate) della definizione parsata, default inclusi. Stesso checksum → nessuna versione nuova; un file uguale a una versione precedente la riusa (con `--activate` è un rollback). |
| D62 | Attivazione | Campagna nuova `paused`; import senza `--activate` non cambia la versione attiva; `--activate` imposta `activeVersionId` e `status = active`. Le colonne di instradamento di `Campaign` copiano la versione attiva (o l'ultima importata finché non ce n'è una). |
| D63 | Collisioni | Parole chiave confrontate in modo esatto (dopo trim e minuscolo) e al più una campagna di default per numero, solo contro le campagne `active` dello stesso numero, a ogni import, in una transazione serializzabile. Le campagne in pausa non collidono. Due import concorrenti della stessa campagna possono fallire con conflitto di serializzazione o di unicità: la CLI risponde "import concorrente, riprova" ed esce con codice non zero. |
| D64 | Organizzazione della campagna | Fissa tra le versioni (`organization_mismatch`); il numero può cambiare. |
| D65 | Consensi segnaposto | Una `textVersion` `placeholder-…` o un testo di consenso che contiene il marcatore `[TESTO SEGNAPOSTO]` è un **avviso** solo con `NODE_ENV` esplicitamente `development` o `test`; con `production`, con `NODE_ENV` non impostato o con qualunque altro valore è un **errore** (nessun default silenzioso). Vale sia per `campaigns import` sia per `campaigns validate`, che stampano l'ambiente effettivo accanto ai problemi. La CLI contro prod gira con `NODE_ENV=production` (da impostare in `.env.prod`). |
| D66 | `providerConfig` | Solo identificativi e nomi di segreti (`phoneNumberId`, `wabaId`, `accessTokenSecret` in UPPER_SNAKE_CASE), schema strict in `src/channels/provider-config.ts`; v1 solo `meta`. |
| D67 | Stato iniziale del numero | `senders add` crea il numero `active` (provisioning manuale); default del DB `provisioning`. |
| D68 | Definizione memorizzata | `CampaignVersion.definition` = definizione parsata in forma canonica; alla lettura si ri-parsa con lo schema (`LoadedCampaign`). |
| D69 | Campagna standard v1 | Costruita dal §6 (export di Make non disponibile, testi da rifinire sul questionario "global"); consensi dell'Appendice A con titolare e link per esteso; `privacyUrl` provvisorio da confermare (§18, punto 5). |
| D70 | Traduzione dei testi | Si traduce il modello italiano con i segnaposto, poi si interpolano i parametri: i valori del candidato non vanno mai al traduttore e la cache vale per tutti. Le etichette dei campi sono testi tradotti a loro volta. |
| D71 | Segnaposto | `{nome}` (lettere, cifre, `_`, `.`); senza parametro resta visibile ed è riportato in `missingParams`; un valore inserito non viene riletto; una traduzione che non conserva esattamente l'insieme dei segnaposto è scartata. |
| D72 | Ripiego sull'italiano | Traduttore in errore o traduzione scartata → testo italiano, non salvato in cache; un errore della cache non blocca mai la risposta. |
| D73 | `isCurated` | Vero per l'originale italiano, una traduzione curata della campagna o una voce di cache `reviewed`; falso per ogni traduzione LLM non rivista. È `Consent.textShownIsCurated`. |
| D74 | Testi critici | I testi dei passaggi `consent` (inline o per `ref`), riconosciuti da i18n dalla campagna. Non curati → traduzione + riga con il link al testo ufficiale (`link` del passaggio, altrimenti `privacyUrl`). `requireCurated` rinviato. |
| D75 | Parametri del catalogo | Tipizzati (`text`, `number`, `field`, `value`, `flag`): `field` → etichetta leggibile, `value` → sì/no, "(nessun valore)", elenco con virgole, data gg/mm/aaaa; `flag` sceglie solo la variante. |
| D76 | `purpose` dei testi | `clarify` con `missing` → riga "Mi serve ancora un dettaglio: {missing}" + domanda, in un messaggio; `rephrase` → riga introduttiva + domanda. `missing` è scritto dall'NLU nella lingua della sessione. Riformulazione LLM rinviata. |
| D77 | Lingua di risoluzione | `state.language ?? defaultLanguage`, letta dopo `step()`; il benvenuto esce nella lingua di default con la riga in inglese. |
| D78 | Cache delle traduzioni | Interfaccia `TranslationCache` in i18n, chiave (sha256 dell'italiano, lingua); in memoria fino al piano 08, che crea la tabella. i18n non importa `nlu` né `store` (regola di lint). |
| D79 | Simulatore | `campaigns simulate <file>` senza database; interprete `naive` deterministico più comandi `/…` che forzano ogni interpretazione e valgono con qualunque interprete; traduttore finto `[xx] …`; interfaccia `Interpreter` in `src/nlu/interpreter.ts`. |
| D80 | `LlmProvider` | `complete({ messages, model, temperature, responseFormat, maxTokens, timeoutMs })`; modalità JSON del provider, Zod unico controllo; Mistral via `fetch` senza SDK; `LlmError` tipizzato, senza corpi di richiesta o risposta nei messaggi. |
| D81 | Configurazione NLU | Separata da `parseEnv` (`simulate` senza DB): `MISTRAL_API_KEY`, `NLU_INTERPRET_MODEL` / `NLU_TRANSLATE_MODEL` (default `mistral-small-latest`), `NLU_FALLBACK_MODEL` (`mistral-medium-latest`), `NLU_TIMEOUT_MS` (15000), `NLU_HISTORY_MESSAGES` (3), `NLU_PRICES`. Vuota = assente; chiave chiesta solo per il provider reale. Modelli da confermare con gli evals. |
| D82 | Politica di chiamata | Ritentabili (timeout, rete, 429, 5xx, risposta malformata): 2 ritentativi a 500/1500 ms (o più, se `Retry-After` lo chiede), poi una chiamata al modello di riserva; 4xx: stop senza riserva; LLM non disponibile → `interpretation: null`. |
| D83 | Output dell'LLM | Prima di Zod: via `null` e stringhe vuote dai campi facoltativi, `patch` assente → `[]`, `evidence` assente → `""`, lingua minuscola al primo sottotag, via i recinti Markdown. Dopo Zod, regole del prompt sul contesto del turno: `editTarget` senza `newValue` o su un campo non raccolto è **non valido**; la `patch` di un `choice` si tiene solo per la risposta a un consenso (non con una conferma in sospeso); `offTopicReply` e `missing` oltre 25 parole o con link, email o numeri di telefono si **tolgono** (il motore usa il proprio testo). Non valido → una correzione con i problemi (senza valori) → `unclear` con confidenza 0. |
| D84 | Conferma in sospeso nel contesto | `pendingConfirmation` (tipo e campo, senza valori) nel contesto; scelte attese solo `yes`/`no`; un sì/no risponde alla conferma e non va mai nella patch; una correzione con valore nuovo ("no, è Marco") è `answer` per una conferma di valore, `edit_request` con `editTarget` per una modifica: il motore scarta la modifica in sospeso e chiede di confermare quella nuova. |
| D85 | Minimizzazione | Nome, cognome, data di nascita, indirizzo, email e i campi `sensitive` (D90) solo come `withheld`; campi di sistema assenti; storia = ultimi N messaggi del candidato, senza testi del bot. Nella storia diventano `[campo]`: i valori raccolti di quei campi, anche nelle forme scritte delle date, e quelli di una conferma in sospeso (vecchio e nuovo); i nomi già da 2 lettere, a parola intera. Il chiamante conserva per la storia una copia del messaggio in cui anche l'`evidence` della patch per quei campi diventa `[campo]` (`redactWithEvidence`), che il valore sia salvato o no. È una redazione al meglio delle possibilità: senza un'interpretazione utilizzabile (LLM non disponibile, `unclear`) non c'è `evidence`, e restano solo le espressioni regolari che sostituiscono sempre email (`[email]`) e sequenze di almeno 9 cifre con spazi, trattini o `+` (`[phone]`), anche in `scrubHistory`. Messaggio corrente intero. Unica eccezione: `question.savedValue`, il valore già salvato della domanda corrente, per completare una risposta parziale. |
| D86 | Contenuto del contesto | Campi aperti di tutta la campagna (non solo del blocco), vuoti fuori dal `flow` e prima della soglia tranne sul consenso; `format` del campo quando c'è; scelte attese per tipo di passaggio e fase; testi di riferimento in italiano; un passaggio di consenso porta `consentKey`, `optional` e `purpose` (ricavato dal ruolo del consenso, D48, non dal testo legale); `missing` e `offTopicReply` nella lingua della conversazione. |
| D87 | `NluTrace` | Interfaccia `NluTraceSink` in `nlu`; una traccia per chiamata (anche ritentativi, riserva, correzione) con `attempt` e `repair`; `input` = messaggi senza il prompt di sistema (identificato da `promptVersion`); mai bloccante; tabella nel piano 08 (`turnId` → `Turn`, scrittura nella transazione del turno). |
| D88 | Traduzione LLM | Prompt `translate-v1`, output `{ text }`, temperatura 0, segnaposto e URL conservati, `critical` fedele; nessuna correzione: un errore fa ripiegare i18n sull'italiano. |
| D89 | §5.6 punto 3 | Rinviato al piano 08: è instradamento del primo messaggio più un nuovo tipo di conferma nel motore, non NLU. |
| D90 | Campi sensibili | Flag facoltativo `sensitive` sulla definizione di un campo (standard o `custom.*`; assente = falso, i checksum delle campagne non cambiano). Il campo si chiede e si salva come gli altri, ma il suo valore non arriva mai all'LLM (D85). Sensibili nello schema standard: `workingPermit` (rivela lo status migratorio) e `jobPreferences.constraints` (spesso salute o famiglia). |
| D91 | Regole del prompt `interpret-v1` | Precedenza degli intenti (opt_out, delete_data, choice, edit_request, answer, refusal, help, off_topic, unclear); consenso accettato solo con un sì chiaro, l'ambiguo è `unclear`; storia e segnaposto `[campo]` sono dati, mai valori; ogni valore viene dal messaggio, mai dedotto (salvo `savedValue`); regole per tipo e fasce di confidenza; `edit_request` solo su campi raccolti; `offTopicReply` e `missing` al massimo 25 parole, senza link, telefoni, email, promesse o dati personali; lingua dei messaggi brevi = lingua della sessione con confidenza ≤ 0,5. `interpret-v1` si modifica sul posto finché non ha una baseline degli evals. |
| D102 | Un turno, una transazione (piano 08) | `process-contact` apre una transazione interattiva con lock advisory sul contatto; dentro: raffica, NLU con scadenza, `step()`, testi, scritture e job. Timeout = `2 × TURN_NLU_DEADLINE_MS + 30 s`. Cache delle traduzioni e tracce di traduzione scrivono su un'altra connessione. Il pool Prisma del worker si dimensiona da `WORKER_BATCH_SIZE`: `2 code × WORKER_BATCH_SIZE × 2 connessioni + 2` (`workerPoolSize`), perché un turno tiene la sua transazione mentre legge la campagna e scrive cache e tracce su un'altra connessione, e `reportFailure` (D108) tiene la sua mentre aspetta il lock e legge la campagna: con meno connessioni ogni transazione può restare ad aspettarne un'altra. |
| D103 | Accodamento transazionale (piano 08) | I job pg-boss si inseriscono con l'opzione `db` di `send()` (l'adattatore Prisma di pg-boss sulla transazione): se il turno si annulla il job non esiste. Ripiego, se non funzionasse: tabella `Outbox` con relay. pg-boss si collega con `QUEUE_DATABASE_URL` (connessione diretta / di sessione, porta 5432, mai il pooler di transazione); il ripiego su `DATABASE_URL` vale solo con `NODE_ENV` `development` o `test`, altrove il worker non parte. Ogni processo che avvia pg-boss usa le stesse impostazioni delle code (`workerQueueSettings`): l'avvio le riapplica. |
| D104 | Stato persistito (piano 08) | `Session.engineState` senza `profile`; profilo in `CandidateProfile` (`standard`, `custom`, `fieldMeta`), idratato prima di `step()` (D31). Un solo `session_started`, alla creazione della sessione. Stato illeggibile → errore generico e `needs_attention`. Una parte dello stato o del profilo scartata in lettura (D111b) lascia un `SessionFlag` `state_part_dropped` (campo = percorso, senza `needsAttention`) e un log con gli id: la conversazione continua e il campo si richiede. |
| D105 | Instradamento v1 (piano 08, chiude D89) | Parola chiave uguale al messaggio (trim, minuscolo) o campagna di default; nessuna campagna → turno `no_campaign` senza risposta. Il primo messaggio non si interpreta (benvenuto) e la lingua non si propone (§5.6 punto 3 fuori dalla v1). Una sessione `active` / `needs_attention` riceve sempre i messaggi, anche una parola chiave; sessione `completed` + parola chiave → nuova sessione. Una sola sessione aperta per contatto e numero (`openKey`). Un messaggio dopo un opt-out riporta il contatto a `opted_in`. |
| D106 | Raffica e attesa breve (piano 08) | Il job `process-contact` si riprogramma finché l'ultimo messaggio ha meno di `DEBOUNCE_MS` e il primo meno di `DEBOUNCE_MAX_WAIT_MS`. Idempotente: i job doppi sono innocui. I job di un lotto (`WORKER_BATCH_SIZE`) si chiudono uno per uno (`perJobResults` di pg-boss): un fallimento ritenta solo quel job. |
| D107 | NLU nel turno (piano 08) | Scadenza `TURN_NLU_DEADLINE_MS`; eccezione dell'interprete = NLU non disponibile; eccezione di `step()` non `EngineError` = errore generico, `FlagSession` `incoherent_state`, stato invariato. Storia per l'NLU = `Message.bodyRedacted` (`redactWithEvidence`). Media senza testo = turno `ignored_media`. |
| D108 | Invio (piano 08) | `Message` `queued` è l'outbox; ordine per `ordinal`; assegnazione con lock e lease (`SEND_LEASE_MS`, stato `sending`); invio almeno una volta; temporaneo → ritenta (backoff di pg-boss) fino a `SEND_MAX_ATTEMPTS`, poi definitivo (`too_many_attempts`); definitivo → `failed`, resto del turno `failed` (`skipped_after_failure`), evento `outbound_failed`. La chiamata al canale scade a metà lease (`SEND_LEASE_MS / 2`), così l'esito si scrive mentre l'assegnazione vale ancora: oltre è un errore temporaneo `channel_timeout` (il messaggio può essere partito: si rimanda, almeno una volta), un'eccezione dell'adattatore è `channel_exception`. `reportFailure` prende il lock advisory del contatto, così non si sovrappone a un turno che riscriverebbe lo stato letto prima, e applica solo i flag. I ritentativi pg-boss di `send-messages` sono almeno `SEND_MAX_ATTEMPTS − 1` (`sendRetryLimit`, minimo 5; il worker non parte altrimenti): un job non finisce negli scarti mentre il suo messaggio è ancora `queued`. |
| D109 | Dati alla chiusura (piano 08) | `StopSession` con `delete` cancella subito profilo, modifiche, corpi dei messaggi (non quelli in uscita da inviare) e tracce. `delete-contact` è solo accodato: il gestore è del piano 11. `Consent` sopravvive al contatto (`contactId` e `sessionId` a `NULL`, `contactHash`, D111e). |
| D110 | Tracce e cache (piano 08) | `NluTrace` scritta nella transazione del turno (id scelto in anticipo); `input` solo sulla prima chiamata di ogni catena. `TranslationCache` su tabella. Scadenza delle tracce: piano 11. |
| D111 | Modelli (piano 08) | `CvDocument` nel piano 10, `InboundDeadLetter` nel 09, `Session.origin` rinviato. Aggiunta `SessionFlag`. `Turn.sessionId` facoltativo (turni senza sessione). |
| D111a | Nomi di `Message` (piano 08, revisione dei Task 1–7) | `direction` vale `inbound` / `outbound` (non `in` / `out`); `type` per ora `text`, `audio`, `image`, `document`, `location`, `unsupported`. `interactive` e `template` non esistono finché il piano 09 non li usa: li aggiunge la sua migrazione. |
| D111b | Formato di `Session.engineState` e del profilo (piano 08, revisione) | `engineState` porta `v: 1`; una riga senza `v` è il formato 1. In lettura le chiavi sconosciute si scartano e i campi mancanti prendono il default: solo uno stato senza `phase` valida, o con una lingua non valida, è illeggibile (D104). Una `pendingConfirmation` sconosciuta o rotta si scarta (`null`) e si segnala al chiamante (`onDropped`, solo il percorso, mai il valore). In `fieldMeta` una `source` sconosciuta diventa `system`, una voce con stato o confidenza non validi si scarta (il campo si richiede); entrambi segnalati. Le colonne del profilo non hanno un numero di formato: un cambiamento incompatibile passa da una migrazione. |
| D111c | Integrità delle sessioni e dei turni (piano 08, revisione) | Migrazione `runtime_integrity`. `Turn.contactId` (chiave esterna, `ON DELETE CASCADE`, indice con `startedAt`): i turni senza sessione se ne vanno con il contatto; nullable solo per le righe precedenti, il runtime lo scrive sempre. Un `CHECK` scritto a mano lega `openKey` a `status`: `active` e `needs_attention` sono sempre aperte (il candidato può ancora scrivere), `stopped` e `abandoned` mai, `completed` può essere l'una o l'altra (aperta nella fase dopo il completamento, D105; chiusa dopo un opt-out o quando la sostituisce un'altra campagna). Una parola chiave non sostituisce mai una sessione `active` / `needs_attention` (D105): apre una nuova sessione solo dopo una `completed`, che resta `completed`. Il ramo di `closeOpenKey` che porta a `abandoned` una precedente ancora aperta è una rete di sicurezza, non un percorso previsto. |
| D111d | Link mostrato con il consenso (piano 08, revisione) | `Consent.linkShown`: il link al testo ufficiale mostrato accanto a un testo non curato (D74), `null` se non è stato mostrato. Con `textShown` registra esattamente ciò che il candidato ha visto. |
| D111e | Prova minima del contatto (piano 08, revisione; corregge D109) | `Consent.contactHash` = HMAC-SHA256 di `"<channel>:<externalId>"` con la chiave `CONSENT_HASH_SECRET` (almeno 32 caratteri, nel gestore dei segreti; obbligatoria per il worker, che non parte senza). Uno sha256 semplice di un numero di telefono si inverte provando tutti i numeri. La chiave non si ruota sul posto: le prove già scritte non corrisponderebbero più. |

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
  "onStop": { "data": "keep" },
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
- `onStop.data`: cosa fare dei dati quando la sessione si chiude con `@stop`: `keep` (predefinito) oppure `delete`.
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

**Campi sensibili** (D90): un campo, standard o personalizzato, può avere `"sensitive": true`. Si chiede e si salva come gli altri, ma il suo valore non arriva mai all'LLM: nel contesto compare solo come `withheld` e nella storia diventa `[campo]` (§8.2). Nello schema standard sono sensibili `workingPermit` e `jobPreferences.constraints`. I dati personali (`firstName`, `lastName`, `birthday`, `address`, `email`) sono trattati allo stesso modo senza bisogno del flag; `phone`, `lat`, `lng` sono di sistema e non compaiono affatto.

**Stato per campo**, conservato accanto al valore: `confidence` (0–1), `status` (`confirmed` | `inferred` | `unresolved`) e `source` dell'ultimo aggiornamento.

---

## 7. Motore (`engine`)

### 7.1 Firma

```ts
step(state: SessionState, event: EngineEvent, campaign: CampaignDefinition)
  → { state: SessionState, effects: Effect[] }
```

- **Pura:** nessuna rete, nessun database, nessun orologio implicito (l'ora arriva nell'evento).
- **Stato:** `{ phase, stepId, questionId, clarifications, pendingConfirmation, outcomes, language, consentsAccepted, profile }` (`profile`: istantanea del profilo, D31). `consentsAccepted` diventa `true` quando il consenso obbligatorio della campagna (uno solo, D48) è accettato, e torna `false` se viene rifiutato (soglia D24, §10.6, D38). `phase` vale `language`, `flow`, `post_completion` oppure `closed`.
- **Eventi:** `user_turn` (con `Interpretation`), `session_started`, `timeout`, `admin_action` (futuro), `outbound_failed`.
- **Effetti:** `SendText`, `SendChoice` (bottoni interattivi, futuro), `ApplyPatch`, `RecordConsent`, `SetLanguage`, `CompleteSession`, `StopSession`, `EnqueueJob` (`kubri-webhook`, `cv`, `geocoding`), `FlagSession`.
- `campaign` è la definizione già validata della versione a cui la sessione è legata (piano 04).
- Effetti aggiunti dal piano 04: `RecordPatchRejections` (valori scartati, senza il valore),
  `MarkFieldUnresolved`, `OptOut`; job `delete-contact` (D39, D49). `SendChoice` resta futuro.

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

- fase (`language` / `flow` / `post_completion` / `closed`) e lingua della sessione;
- passaggio corrente (id, tipo, testo di riferimento in italiano per `choice` e `cv_offer`; per
  un consenso `consentKey`, `optional` e lo scopo in poche parole, ricavato dal ruolo del
  consenso, D86);
- domanda corrente (testo in italiano, `field`, tipo, descrizione, `format`, opzioni, `hint`,
  obbligatorietà) e, se parte della risposta è già salvata, `savedValue`: è l'unico valore di un
  campo personale o sensibile che può arrivare all'LLM, perché serve al turno (completare una
  risposta parziale, D85);
- **campi ancora aperti di tutta la campagna**, con tipo e descrizione (D86): non solo del
  blocco, perché le risposte anticipate sono il meccanismo di salto del §5.3; vuoto fuori dal
  `flow` e prima della soglia dei consensi, tranne sul passaggio di consenso (D50);
- **riepilogo compatto** dei campi già raccolti: nome, cognome, data di nascita, indirizzo,
  email e i campi `sensitive` (§6, D90) compaiono solo come presenti (`withheld`), mai con il
  valore; i campi di sistema non compaiono (D85);
- **conferma in sospeso** (`value` / `edit` / `delete_data`, con il campo, senza valori): le
  scelte attese diventano solo `yes`/`no`, e un sì/no risponde alla conferma, non alla domanda
  corrente (D84);
- **scelte attese** del turno: opzioni di `choice`, `accepted`/`declined`, `yes`/`no`,
  `regenerate_cv` (D86);
- ultimi N messaggi **del candidato** (`NLU_HISTORY_MESSAGES`, default 3), senza i testi del
  bot. Nella storia i valori personali e sensibili diventano `[campo]`: quelli raccolti (anche
  le date nelle forme scritte), quelli di una conferma in sospeso e i pezzi citati come
  `evidence` dall'LLM, salvati o no (`redactWithEvidence`, applicato dal chiamante quando
  conserva il messaggio); i nomi già da 2 lettere, a parola intera. Email e numeri di telefono
  (almeno 9 cifre) diventano sempre `[email]` / `[phone]`, anche senza un'interpretazione
  utilizzabile: senza `evidence` la redazione è al meglio delle possibilità (D85). Il messaggio
  corrente è inviato intero.

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
- **Normalizzazione prima di Zod** (D83): `null` e stringhe vuote nei campi facoltativi, codici
  lingua come `IT` / `it-IT`. Gli errori non ritentabili (4xx) non passano alla riserva (D82).
- **Controlli sul contesto dopo Zod** (D83): `editTarget` senza valore nuovo o su un campo non
  raccolto → correzione; patch di un `choice` fuori dalla risposta a un consenso → tolta;
  `offTopicReply` e `missing` troppo lunghi o con link, email o telefoni → tolti, perché
  arrivano al candidato così come sono scritti.

### 8.5 Provider e modelli

- Interfaccia `LlmProvider` con `complete({ messages, model, temperature, responseFormat, maxTokens, timeoutMs })` (D80).
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
- **Modelli e parametri (D70, D71, D75).** Si traduce il testo italiano con i segnaposto `{…}`,
  poi si inseriscono i parametri. Le etichette dei campi standard sono in
  `src/i18n/field-labels.ts`; quelle dei campi personalizzati sono il `label` della campagna.
- **Ripiego (D72).** Se la traduzione non è disponibile o rompe i segnaposto si invia
  l'italiano. Mai silenzio.
- **Testi critici (D74).** Riconosciuti dal passaggio `consent`; il runtime salva in `Consent`
  il testo risolto e `isCurated` (D73).

---

## 10. Modello dati

Schema Postgres **`bot`**, nello stesso progetto Supabase della dashboard. Tutte le chiavi primarie sono UUID.

### 10.1 Canali e campagne

- **Organization**: `id`, `slug`, `name`, `kubriOrganizationId?` (collegamento futuro alla dashboard), `createdAt`.
- **SenderNumber**:
  - `id`, `slug` (citato da `trigger.sender`, D60), `organizationId?`, `channel` (`whatsapp`), `provider` (`meta` | `twilio`), `phoneE164`, `displayName`;
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
  - `engineState` (jsonb, senza profilo, D104), `language`;
  - `startedAt`, `completedAt`, `lastActivityAt`.
  - Al più una sessione **aperta** per (contatto, numero): `openKey` univoca, legata a `status` da un `CHECK` (D105, D111c): `openKey` vale `<contatto>:<numero>` mentre la sessione è aperta. `origin` non c'è ancora (D111).
- **Message**:
  - `id`, `contactId`, `senderNumberId`, `sessionId?`, `direction` (`inbound` | `outbound`, D111a);
  - `type` (`text` | `audio` | `image` | `document` | `location` | `unsupported`; `interactive` e `template` con il piano 09, D111a);
  - `body`, `mediaRef?`, `templateName?`, `payloadRaw` (jsonb, per i messaggi in entrata);
  - `stepId?`, `questionId?` (contesto al momento del messaggio);
  - `providerMessageId` (**univoco**, per la deduplica);
  - `status` (`received` | `processed` | `queued` | `sending` | `sent` | `delivered` | `read` | `failed`), `sentAt`, `deliveredAt`, `readAt`, `failedAt`, `errorCode?`;
  - `turnId?`, `createdAt`;
  - `ordinal` (sequenza globale) dà l'ordine di invio; `bodyRedacted` è la copia per la storia dell'NLU (D107); `leaseUntil` e `attempts` governano l'invio (D108).
- **Turn**: `id`, `sessionId?` (facoltativo: turni senza sessione), `contactId` (D111c), `inboundMessageIds[]`, `startedAt`, `completedAt`, `outcome` (`replied` | `ignored_media` | `no_campaign` | `failed`).

### 10.3 Profilo, consensi e tracciabilità

- **CandidateProfile**: `id`, `sessionId` (1:1), `standard` (jsonb, schema §6), `custom` (jsonb), `fieldMeta` (jsonb: confidenza, stato e fonte per campo), `sharedWithGlobal` (consenso al pool globale), `completedAt`, `updatedAt`. `cvDocumentId` arriva con il piano 10 (D111).
- **ProfileChange**: `id`, `profileId`, `field`, `oldValue`, `newValue`, `source` (`extraction` | `edit` | `system` | `document_import`, estendibile), `turnId?`, `confidence?`, `createdAt`.
- **Consent**: `id`, `contactId?`, `sessionId?` (`NULL` dopo la cancellazione del contatto, D109), `consentKey`, `textVersion`, `language`, `textShown`, `textShownIsCurated`, `linkShown?` (D111d), `dataController`, `contactHash` (HMAC, D111e), `outcome`, `messageId`, `decidedAt`, `createdAt`.
- **SessionFlag**: `id`, `sessionId`, `reason`, `field?`, `needsAttention`, `turnId?`, `createdAt`. Dove `FlagSession` lascia traccia (D111); l'avviso vero è del piano 11.
- **NluTrace**: `id`, `turnId`, `task`, `promptVersion`, `provider`, `model`, `input` (jsonb), `output` (jsonb), `valid`, `latencyMs`, `inputTokens`, `outputTokens`, `costEstimate`, `error?`, `createdAt`. Più `attempt` (`primary` / `retry` / `fallback`) e `repair` (D87). Una riga per chiamata; `input` senza il prompt di sistema. Tabella creata nel piano 08.
- **CvDocument** (piano 10, D111): `id`, `profileId`, `kind` (`generated` | `uploaded`), `template`, `storageKey`, `createdAt`.
- **TranslationCache**: `sourceHash`, `language`, `text`, `provider`, `model`, `reviewed`, `createdAt`. Chiave primaria su (`sourceHash`, `language`).
- **InboundDeadLetter** (piano 09, D111): payload non interpretabili (`raw`, `reason`, `createdAt`).

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

- **Diritto all'oblio:** `delete-contact` cancella a cascata sessioni, messaggi, profili, tracce, file multimediali e CV. Dei consensi resta una prova minima (chiave, versione, esito, data, hash del contatto con chiave, D111e).
- Durate di conservazione configurabili per: file multimediali, `NluTrace`, `payloadRaw`, sessioni abbandonate.
- **Soglia dei consensi (D24).** Il comportamento di una sessione che non arriva al completamento dipende da dove si è fermata:

  | Caso | Prima dell'accettazione dei consensi obbligatori | Dopo l'accettazione |
  |---|---|---|
  | `@stop` (rifiuto di un consenso obbligatorio, "no" a continuare) | si cancella tutto, resta solo la prova minima del rifiuto | si applica `onStop.data` della campagna (default `keep`) |
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
    (il lock regge fino al commit del punto 9: l'intero turno è una transazione, D102)
    se l'ultimo messaggio ha meno di DEBOUNCE_MS, il job si riprogramma e termina (D106)
 2. messaggi in entrata con status=received, in ordine → la "raffica" del turno
    invia conferma di lettura e indicatore "sta scrivendo"
 3. media: audio/documento/immagine → media (v1: risposta "per ora scrivimi in testo")
 4. sessione:
      attiva → la usa
      assente → instradamento per parola chiave sulle campagne del numero,
                altrimenti la campagna di default (standard Kubri)
                → nuova Session sulla versione attiva
                → il primo messaggio non viene interpretato: parte il benvenuto (D105)
 5. costruisce il contesto (§8.2) → nlu.interpret → salva NluTrace
 6. engine.step(state, user_turn, campaignVersion) → nuovo stato + effetti
 7. i18n risolve i testi degli effetti SendText (dentro il turno; cache e tracce di
    traduzione su un'altra connessione, D102)
 8. scritture, nella stessa transazione del lock:
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
| **Domande su più campi** (`fields: [...]`: completezza su tutti i campi, approfondimento sul campo mancante) | Oggi si ottiene con una domanda che chiede più dati ("nome e cognome") seguita da domande di riserva sui campi mancanti: l'LLM estrae tutti i campi del messaggio e il motore salta le domande già compilate (campagna standard, nome e cognome, verificato con `mistral-medium` il 2026-10-25). Da introdurre solo se una campagna reale non si presta a questo schema. |

---

## 18. Domande aperte

Risolte (2026-10-24): chiave del candidato → D20; pool → D21; `source_organization` e canale → D22; consensi per campagna → D23; esito `@stop` e abbandono → D24; posizione del codice → D19; numero WhatsApp di sviluppo → app Meta di test dedicata con il suo numero, separata dall'app usata da Make; hosting → in UE (fornitore ancora da scegliere, punto 12); campagne senza `end` o con più `end` → D37.

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
