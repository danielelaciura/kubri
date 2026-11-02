# Provare il chatbot in locale: dal terminale a WhatsApp

L'unica guida per provare tutto il flusso (piani 01–10) prima della messa in produzione. Si sale
di livello solo quando il precedente funziona:

| Livello | Cosa si prova | Serve |
|---|---|---|
| 1 | Intervista nel terminale, senza LLM | Docker |
| 2 | La stessa con l'LLM vero (Mistral) | `MISTRAL_API_KEY` |
| 3 | Il candidato arriva nella dashboard | dashboard in locale (database di dev su Supabase) |
| 4 | L'intervista su WhatsApp | app Meta di sviluppo, numero di prova, tunnel |
| 5 | Evals (facoltativo) | `MISTRAL_API_KEY` |

La messa in produzione (Supabase, hosting, passaggio da Make) è nel piano 11; l'ultima sezione
spiega come il database locale diventa quello di Supabase.

## 0. Com'è fatto, in due righe

- **Chatbot:** due processi (`web` riceve i webhook di Meta, `worker` fa le interviste) e un
  database Postgres con i suoi schemi `bot` e `bot_queue`. In locale il database è un Postgres in
  Docker (porta 54329); in produzione sarà lo **stesso** Postgres di Supabase della dashboard, ma
  in schemi separati.
- **Dashboard:** Next.js; in locale usa il database di **dev** su Supabase cloud
  (`apps/dashboard/.env.local`).
- **Le due app non condividono tabelle.** Il chatbot manda il candidato alla dashboard via HTTP
  (`POST /api/webhooks/chatbot/candidate`). Per questo in locale possono stare su due database
  diversi senza problemi.

## 1. Branch e installazione

Si prova tutto dal branch ombrello `docs/chatbot-spec-into-monorepo`: contiene i piani 01–10,
l'endpoint della dashboard (PR #81) ed è allineato a `main`.

```bash
git fetch origin
git switch docs/chatbot-spec-into-monorepo
git pull
pnpm install
```

## 2. Database del chatbot (Docker)

```bash
cd apps/chatbot
pnpm db:up          # Postgres 16 su localhost:54329, database kubri_bot_dev e kubri_bot_test
```

Al primo avvio Docker crea i due database e, nello schema `public`, delle tabelle finte della
dashboard: servono solo a dimostrare che il bot non le tocca mai.

## 3. Il file `apps/chatbot/.env`

Copiare `.env.example` in `.env` (è gitignored: mai versionarlo) e completare:

```bash
NODE_ENV=development
LOG_LEVEL=info
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:54329/kubri_bot_dev?schema=bot
# Qualunque valore di almeno 32 caratteri, SOLO per lo sviluppo.
CONSENT_HASH_SECRET=dev-only-consent-hash-secret-0123456789
# Per provare con calma: il bot aspetta 1,5 s dopo l'ultimo messaggio prima di rispondere.
DEBOUNCE_MS=1500
```

Le altre variabili si aggiungono ai livelli 2, 3 e 4.

## 4. Migrazioni e dati di partenza

```bash
pnpm db:deploy
pnpm cli orgs add kubri --name "Kubri S.r.l."
pnpm cli senders add kubri-main --phone +390000000000 --name "Kubri (locale)" --org kubri \
  --phone-number-id 000000000000000 --waba-id 000000000000000 --token-secret META_TOKEN_DEV
pnpm cli campaigns import campaigns/kubri-standard.json --activate
pnpm cli campaigns list
```

- Gli id di Meta qui sono finti: bastano per i livelli 1–3. Al livello 4 si sostituiscono con
  quelli veri (§8).
- `campaigns import` avvisa che i consensi sono **segnaposto** (`[TESTO SEGNAPOSTO]`): in
  sviluppo è un avviso, in produzione un errore. I testi ufficiali sono un punto aperto (spec §18).
- Se `orgs add` o `senders add` dicono che esistono già, va bene: il database li ha da una prova
  precedente.

## 5. Livello 1 — intervista nel terminale, senza LLM

Terminale 1 (il worker; le risposte del bot si stampano qui):

```bash
pnpm cli worker start
```

Terminale 2 (il candidato):

```bash
pnpm cli inbound send --sender kubri-main --from +393331112233 "Ciao! Vorrei candidarmi"
pnpm cli inbound send --sender kubri-main --from +393331112233 italiano
pnpm cli inbound send --sender kubri-main --from +393331112233 sì
```

Nel terminale 1 compaiono, in ordine:

1. il benvenuto in due lingue con sotto l'elenco `[Italiano] [English] [العربية] …` (su WhatsApp
   sarà un elenco da toccare);
2. dopo "italiano": la presentazione dell'intervista e il consenso con `[Accetto] [Non accetto]`;
3. dopo "sì": il consenso facoltativo a condividere il profilo, poi le domande.

Senza LLM le risposte le capisce un interprete semplice (`naive`): sì/no, il nome di una lingua,
gli id delle opzioni, valori scritti in modo esatto. Per un'intervista intera conviene il livello 2.
`stop` chiude la conversazione. Il messaggio
`Kubri is not configured: kubri-webhook jobs go to the dead letter queue` è normale fino al
livello 3. Ctrl-C ferma il worker; i messaggi in coda partono al riavvio.

**Provare l'instradamento come con Make.** I link e i QR della dashboard precompilano
`[<chiave del pool>] <testo>`: il chatbot apre la campagna che ha quella chiave tra le parole
chiave (D143). Per provarlo serve una seconda campagna:

```bash
python3 - <<'EOF'
import json
c = json.load(open("campaigns/kubri-standard.json"))
c.update(campaign="kubri-test", externalKey="test")
c["trigger"] = {"sender": "kubri-main", "keywords": ["test"], "isDefault": False}
json.dump(c, open("/tmp/kubri-test.json", "w"), ensure_ascii=False, indent=2)
EOF
pnpm cli campaigns import /tmp/kubri-test.json --activate
pnpm cli inbound send --sender kubri-main --from +393334445566 "[test] Ciao! Vorrei candidarmi"
```

La sessione di `+393334445566` è sulla campagna `kubri-test` (verificabile in Prisma Studio, §10);
uno slug sconosciuto (`[xyz] Ciao`) va sulla campagna di default.

## 6. Livello 2 — con l'LLM vero

Aggiungere a `.env` la chiave `MISTRAL_API_KEY` (chiedila a chi gestisce l'account Mistral; mai in
un file versionato). Poi:

```bash
pnpm cli worker start --nlu llm --translator llm
```

e rispondere come farebbe un candidato, con frasi normali ("mi chiamo Mario Rossi", "ho fatto il
magazziniere per due anni a Milano"). Senza database c'è anche il simulatore, utile per rifare
la stessa intervista più volte:

```bash
pnpm cli campaigns simulate campaigns/kubri-standard.json --nlu llm --translator llm --traces
```

Annotare i casi in cui l'LLM sbaglia: diventano casi delle evals (§9).

## 7. Livello 3 — il candidato arriva nella dashboard

La dashboard locale usa il database di **dev** su Supabase: i candidati di prova finiscono lì, nel
pool `global` (la chiave esterna della campagna standard) o `test` (la campagna del §5). Entrambi
i pool esistono già nel dev.

1. Un segreto condiviso: `openssl rand -hex 32`. Lo stesso valore in **due** file:
   - `apps/dashboard/.env.local`: `CHATBOT_WEBHOOK_SECRET=<valore>`
   - `apps/chatbot/.env`: `CHATBOT_WEBHOOK_SECRET=<valore>` e
     `KUBRI_BASE_URL=http://localhost:3001`
   Facoltativo, per coordinate al numero civico: `GOOGLE_MAPS_API_KEY` nella dashboard (senza, la
   dashboard usa i comuni ISTAT).
2. Avviare la dashboard sulla porta **3001** (la 3000 è del processo web del chatbot):

   ```bash
   pnpm --filter kubri-dashboard exec next dev -p 3001
   ```

3. Riavviare il worker (livello 1 o 2) e fare un'intervista. Il candidato compare in dashboard
   appena il candidato accetta il consenso obbligatorio (evento `consents.accepted`) e si
   aggiorna a ogni blocco completato e alla fine.

Cosa controllare in dashboard: il candidato nel pool giusto, canale `whatsapp`, i campi
dell'intervista, le coordinate se l'indirizzo è valido. **Il CV non compare in dashboard**: è una
scelta (piano 10), il candidato lo riceve solo in chat.

Se il candidato non arriva: nel log del worker cercare `kubri webhook`; un `401` è il segreto
diverso tra le due app, `unknown_pool` un pool che nel dev non c'è. Gli invii falliti stanno negli
scarti:

```bash
psql postgresql://postgres:postgres@localhost:54329/kubri_bot_dev -c \
  "select name, data->>'reason', count(*) from bot_queue.job where name like '%-dead' group by 1, 2;"
```

## 8. Livello 4 — WhatsApp

Serve a provare il bot su WhatsApp vero con un'app Meta **di sviluppo**, separata da quella del
numero usato oggi da Make: il numero di Make non si tocca finché non si fa il passaggio (piano 11).

### 8.1 Cosa serve

- Un account Meta for Developers con un'app di tipo **Business** e il prodotto **WhatsApp**.
- Il **numero di prova** che Meta assegna all'app.
- Fino a 5 telefoni **destinatari autorizzati** (con un numero di prova Meta consente di
  scrivere solo a quelli).
- Un tunnel verso il processo web locale: `cloudflared tunnel --url http://localhost:3000`
  oppure `ngrok http 3000`.

### 8.2 Dati dalla console di Meta

| Dato | Dove | Va in |
|---|---|---|
| App secret | Impostazioni dell'app → Di base | `.env`: `META_APP_SECRET` |
| Token di accesso | WhatsApp → Configurazione API (quello temporaneo dura 24 ore) | `.env`: `META_TOKEN_DEV` |
| ID del numero di telefono | WhatsApp → Configurazione API | `SenderNumber` (sotto) |
| ID dell'account WhatsApp Business | idem | `SenderNumber` (sotto) |
| Token di verifica | lo scegli tu | `.env`: `META_VERIFY_TOKEN` |
| Versione della Graph API | in alto nella Configurazione API | `.env`: `META_GRAPH_VERSION` (default `v23.0`) |

Il token non va mai nel database: il numero conserva solo il **nome** della variabile
(`META_TOKEN_DEV`).

### 8.3 Collegare `kubri-main` al numero di prova

Il numero creato al §4 ha id finti. Nel database **locale** si aggiornano così (non esiste ancora
un comando `senders update`):

```bash
psql postgresql://postgres:postgres@localhost:54329/kubri_bot_dev -c "
update bot.\"SenderNumber\" set
  \"phoneE164\" = '+<numero di prova>',
  \"providerConfig\" = '{\"phoneNumberId\": \"<ID del numero>\", \"wabaId\": \"<ID dell account>\", \"accessTokenSecret\": \"META_TOKEN_DEV\"}'
where slug = 'kubri-main';"
```

### 8.4 Avviare

```bash
pnpm cli web start                                                  # terminale 1
pnpm cli worker start --channel meta --nlu llm --translator llm     # terminale 2
cloudflared tunnel --url http://localhost:3000                      # terminale 3
```

(`--nlu naive --translator fake` funziona anche qui, senza Mistral.) In console Meta: WhatsApp →
Configurazione → Webhook → **Modifica**: URL `https://<indirizzo del tunnel>/webhooks/whatsapp`,
token di verifica = `META_VERIFY_TOKEN`, **Verifica e salva**, poi sottoscrivere il campo
**messages**.

### 8.5 Lista di controllo

Dal telefono autorizzato, scrivere al numero di prova:

- [ ] "ciao" → benvenuto con il pulsante **Lingua / Language** che apre l'elenco di 10 lingue.
- [ ] Il consenso ha i bottoni **Accetto / Non accetto**; dopo "Accetto" la conversazione
      prosegue e in `Consent` c'è la riga con il testo mostrato.
- [ ] Le domande sì/no (patente, permesso di lavoro) hanno **Sì / No**; il livello di italiano un
      elenco; le domande libere (nome, lavori) nessun bottone.
- [ ] Rispondere a mano dove ci sono i bottoni funziona lo stesso.
- [ ] Un bottone di un messaggio **vecchio** non risponde alla domanda attuale (viene letto come
      testo).
- [ ] Un vocale o un documento riceve "Per ora riesco a leggere solo messaggi di testo…".
- [ ] Spunte blu e "sta scrivendo" mentre il bot elabora.
- [ ] Alla domanda sul CV, "sì" → arriva un **PDF** in chat; "no" → nessun PDF.
- [ ] Con il livello 3 attivo, il candidato è in dashboard (senza CV).
- [ ] "stop" chiude la conversazione; riscrivendo ne parte una nuova.
- [ ] Nei log non compare alcun nome, numero o testo del candidato.
- [ ] `InboundDeadLetter` è vuota (§10).

Per instradare un QR di cliente su WhatsApp, scrivere `[test] Ciao` con la campagna del §5
importata.

### 8.6 Quando qualcosa non va

- **La verifica del webhook fallisce:** token diverso da `META_VERIFY_TOKEN`, o il tunnel non
  raggiunge il web (`curl https://<tunnel>/health` deve rispondere `{"status":"ok"}`).
- **401 sui POST:** `META_APP_SECRET` sbagliato.
- **Il messaggio arriva ma il bot tace:** `InboundDeadLetter` con motivo `unknown_sender` =
  `phoneNumberId` del §8.3 sbagliato; poi i log del worker.
- **`not_allowed` (131030):** il telefono non è tra i destinatari autorizzati.
- **`auth_failed` (190):** il token temporaneo è scaduto (24 ore): rigenerarlo e riavviare il worker.
- **`outside_window`:** più di 24 ore dall'ultimo messaggio del candidato; fuori finestra servono i
  template (non nella v1).

### 8.7 Payload veri per i test

I messaggi veri sono in `Message.payloadRaw`. Per farne fixture: copiarli in
`tests/fixtures/meta/real-<tipo>.json` **sostituendo** numeri, nomi, id e testi con valori
inventati, e aggiungere un caso a `tests/unit/channels/meta-cloud/parse.test.ts`.

## 9. Livello 5 — evals (facoltativo)

Misurano quanto bene l'LLM capisce i candidati, su casi inventati, con soglie (invenzioni ≤ 1%,
intenti e lingua ≥ 95%). La prima esecuzione salva la baseline:

```bash
pnpm cli evals run --suite extraction --save-baseline
pnpm cli evals run --suite intent --save-baseline
pnpm cli evals run --suite choice --save-baseline
pnpm cli evals run --suite language --save-baseline
```

`pnpm cli evals calibrate` fallirà finché le etichette umane del giudice delle traduzioni non sono
riviste e ampliate (`evals translation --uncalibrated` per provarlo comunque). Dettagli:
`apps/chatbot/CLAUDE.md`, sezione Evals.

## 10. Guardare i dati e ripartire da zero

```bash
pnpm exec prisma studio     # Session, Message, Consent, Turn, CandidateProfile, InboundDeadLetter
```

Per cancellare **tutto** il database locale (dev e test) e ricominciare dal §2:

```bash
docker compose down -v && pnpm db:up && pnpm db:deploy
```

(poi di nuovo il §4). Non tocca nulla su Supabase.

## 11. Dal locale alla produzione: come si uniscono i database

Il Postgres in Docker **simula** quello di Supabase: stesso Postgres 16, il chatbot solo negli
schemi `bot` e `bot_queue`, e nello schema `public` le tabelle (finte) della dashboard, che il bot
non tocca. In Supabase cambia solo **dove** stanno gli schemi, non come funziona il codice.

| | Locale | Dev | Produzione |
|---|---|---|---|
| Database del chatbot | Docker, `kubri_bot_dev` | progetto Supabase **dev**, schemi `bot` e `bot_queue` | progetto Supabase **prod**, schemi `bot` e `bot_queue` |
| Database della dashboard | Supabase dev (`public`) | Supabase dev (`public`) | Supabase prod (`public`) |
| Migrazioni del chatbot | `pnpm db:deploy` | `pnpm db:deploy` con l'URL di dev | `pnpm db:deploy` con l'URL di prod, **prima** del deploy del codice |
| Dove girano web e worker | il tuo Mac | container in UE (piano 11) | container in UE (piano 11) |

Cosa succede, in ordine (piano 11 per i dettagli):

1. **Ruoli**, una volta per progetto Supabase (dev, poi prod), collegati come `postgres` sulla
   connessione diretta: `psql "<URL diretto>" -v bot_migrator_password=… -v bot_app_password=…
   -f db/roles.sql`. Crea gli schemi `bot` e `bot_queue` e due utenti: `bot_migrator` (fa le
   migrazioni) e `bot_app` (usato da web e worker). Nessuno dei due può leggere o scrivere le
   tabelle della dashboard.
2. **Migrazioni**: `DATABASE_URL="<URL diretto 5432 come bot_migrator>?schema=bot" pnpm db:deploy`.
   Le migrazioni del chatbot hanno ogni oggetto qualificato con `"bot".` (un test lo controlla) e
   la loro tabella `_prisma_migrations` sta nello schema `bot`: non si mescolano mai con quelle
   della dashboard. Non si usa mai `migrate dev`, `db push` o `migrate reset` su Supabase.
3. **Connessioni del runtime**, come utente `bot_app`:
   - `DATABASE_URL` = pooler di transazione (porta **6543**) con `?schema=bot`, per le query;
   - `QUEUE_DATABASE_URL` = connessione di sessione (porta **5432**), per pg-boss, che ha bisogno
     di uno stato di sessione. pg-boss crea da solo le sue tabelle in `bot_queue`.
4. **I dati locali non si portano.** Docker è solo per provare: in dev e prod si parte da schemi
   vuoti e si importano organizzazione, numeri e campagne con la CLI puntata al database giusto
   (`NODE_ENV=production` per prod, che rifiuta i consensi segnaposto).
5. **Il legame con la dashboard resta HTTP**: in prod `KUBRI_BASE_URL` è l'URL della dashboard su
   Vercel e `CHATBOT_WEBHOOK_SECRET` è lo stesso valore impostato su Vercel. Il fatto che i due
   stiano nello stesso database serve per il futuro (statistiche, storico delle conversazioni in
   dashboard tramite un ruolo in sola lettura), non oggi.

Perché in Docker e non direttamente su Supabase dev: i test di integrazione cancellano e ricreano
lo schema a ogni esecuzione, e una prova locale non deve poter toccare dati condivisi. Quando il
flusso funziona in locale, il passo successivo è lo stesso flusso con il chatbot puntato a
Supabase dev (punti 1–4), che è la prova generale della produzione.

### Prima del primo deploy del worker (dev e prod)

- **Ordine:** prima la dashboard con `/api/webhooks/chatbot/candidate` e `CHATBOT_WEBHOOK_SECRET`
  su Vercel, poi il worker. Al contrario gli invii vengono ritentati per qualche ora
  (`KUBRI_WEBHOOK_RETRY_LIMIT` = 10) e poi finiscono negli scarti con il flag
  `kubri_webhook_failed`.
- **Vecchi job `cv`** creati prima del piano 10 (solo `{sessionId}`, senza `turnId`): eliminarli
  dalla coda prima di avviare il nuovo worker, altrimenti falliscono a ogni ritentativo:

  ```sql
  delete from bot_queue.job
  where name = 'cv' and state in ('created', 'retry') and not (data ? 'turnId');
  ```
