# Landing candidati — guida al setup

Questa guida copre tutto ciò che serve per mettere in funzione la landing pubblica
`/candidati/<slug>` (colloquio WhatsApp o caricamento CV) e l'importazione CV su cui
si appoggia. È ordinata per servizio esterno: per ognuno trovi **a cosa serve**,
**cosa succede se manca**, **i passi** e **come verificarlo**. In fondo c'è la
sequenza di go-live e la tabella di troubleshooting.

> Ambienti: **dev** = progetto Supabase `fifaoblbbwjmmbduhsac` + `.env.local`;
> **prod** = progetto Supabase `xdeglipibwlvauzykztu` + variabili Vercel "Production".
> Le preview Vercel usano le variabili "Preview".

---

## 0. Mappa delle dipendenze

| Servizio | Ruolo nella landing | Senza configurazione… | Costo indicativo |
|---|---|---|---|
| **Supabase Postgres** | tabelle `CandidateImport`, `CandidateDocument`, `CandidateLandingPage` | la pagina admin e la landing vanno in errore (`table … does not exist`) | già in uso |
| **Supabase Storage** | bucket privato `candidate-documents` con i CV | ogni upload fallisce (`STORAGE_ERROR`) | incluso nel piano |
| **Cloudflare Turnstile** | anti-bot prima di ogni upload | in prod **tutti gli upload vengono rifiutati** | gratuito |
| **Upstash Redis** | rate limit e tetto di spesa giornaliero | in prod **tutti gli upload vengono rifiutati** (fail-closed) | piano free sufficiente |
| **Mistral** | OCR (scansioni/foto) + estrazione dati dal CV | estrazione sempre in errore (`LLM_ERROR`) | ~0,1–1 cent per CV |
| **Google Maps Platform** | campo "Dove abiti?": precompilazione dal CV, suggerimenti e coordinate dell'indirizzo | suggerimenti solo per comune ("Comune (PROV)", dati ISTAT), coordinate al centro del comune; l'upload funziona | probabilmente €0 entro l'uso gratuito mensile |
| **Vercel** | hosting, variabili d'ambiente, cron notturno di pulizia | — | già in uso |
| **WhatsApp (numero Kubri)** | pulsante "Fai il colloquio su WhatsApp" | il pulsante WhatsApp non compare (l'upload funziona) | — |

Segreti generati da voi (nessun servizio esterno): `LANDING_COOKIE_SECRET`,
`LANDING_IP_SALT`.

---

## 1. Supabase Postgres — migrazioni

**Cosa serve.** Tre migrazioni additive, da applicare **nell'ordine**:

| Migrazione | Branch / PR | Contenuto |
|---|---|---|
| `20261023120000_add_candidate_imports` | `feat/create-candidate-ui` (PR base) | `CandidateImport`, `CandidateDocument`, 3 enum |
| `20261029120000_add_candidate_landing_page` | landing | `CandidateLandingPage` |
| `20261030120000_add_candidate_import_sha256` | landing | colonna `CandidateImport.contentSha256` |

**Stato attuale.** Dev: tutte e tre applicate. Prod: nessuna.

**Passi (prod)** — da `apps/dashboard`, **prima** del merge di ciascuna PR:

```bash
cd apps/dashboard && set -a && source .env.prod && set +a && pnpm exec prisma migrate status
```

```bash
cd apps/dashboard && set -a && source .env.prod && set +a && pnpm exec prisma migrate deploy
```

- Prima di lanciare `deploy`, controlla che `.env.prod` punti a `xdeglipibwlvauzykztu`.
- Non usare `migrate dev`, `db push` o `migrate reset` su prod.
- Sono tutte migrazioni additive (nessuna `DROP`): il backup `pg_dump` è facoltativo ma consigliato.

**Verifica.** `prisma migrate status` → `Database schema is up to date!`

---

## 2. Supabase Storage — bucket `candidate-documents`

**Cosa serve.** Un bucket **privato** con questo nome esatto, in **entrambi** i progetti
(dev e prod). Il server lo usa con la service role key; il browser carica i file solo
tramite URL firmati emessi dal server (validi per un singolo percorso).

**Passi** (Supabase Dashboard → Storage → New bucket):

1. Name: `candidate-documents`
2. **Public bucket: OFF** (privato). Non creare policy RLS per `anon`/`authenticated`:
   non servono, l'accesso passa solo dal server.
3. **Restrict file upload size: ON → 10 MB.** È il limite degli operatori; per la landing
   il server applica già 5 MB (controllo sulla dimensione reale dopo l'upload).
4. **Allowed MIME types: lasciare vuoto (consigliato).** Il server riconosce il tipo dai
   primi byte del file e ricarica sempre il file con il tipo corretto. Se volete
   comunque restringerli, inserite esattamente:
   `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
   `image/jpeg`, `image/png` — e provate un upload DOCX da Windows, perché alcuni
   browser inviano un tipo vuoto.
5. CORS: nessuna configurazione richiesta (l'API Storage di Supabase accetta richieste
   cross-origin). Lo verificate con il test qui sotto.

**Variabili** (già esistenti, servono anche qui): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (usate dal browser per l'upload firmato),
`SUPABASE_SERVICE_ROLE_KEY` (solo server).

**Verifica.** Dalla dashboard, come operatore: *Nuovo candidato → Carica CV* con un PDF.
Se l'upload termina e compare la pagina di revisione, bucket e chiavi sono a posto.

---

## 3. Cloudflare Turnstile — anti-bot

**Cosa serve.** Un widget Turnstile per l'hostname della dashboard. Il widget è
invisibile per quasi tutti; mostra una verifica solo se il traffico è sospetto.

**Cosa succede se manca.** In **produzione** senza `TURNSTILE_SECRET_KEY` gli upload
vengono rifiutati ("Troppi tentativi in questo momento. Riprova più tardi."). In **sviluppo** senza chiavi
il controllo viene saltato.

**Passi** (Cloudflare Dashboard → Turnstile → Add widget; serve un account Cloudflare,
non serve che il dominio sia gestito da Cloudflare):

1. Widget name: `Kubri landing candidati`
2. Hostnames: il dominio di produzione della dashboard (quello in `NEXT_PUBLIC_APP_URL`,
   senza `https://`). **Non** aggiungere `localhost` alla chiave di produzione.
3. Widget mode: **Managed** (il codice lo rende "interaction-only": invisibile salvo
   necessità).
4. Copia **Site Key** e **Secret Key**.

**Variabili per ambiente:**

| Ambiente | `TURNSTILE_SITE_KEY` | `TURNSTILE_SECRET_KEY` |
|---|---|---|
| Production (Vercel) | Site key reale | Secret key reale |
| Preview (Vercel) | `1x00000000000000000000AA` (test, passa sempre) | `1x0000000000000000000000000000000AA` |
| Locale (`.env.local`) | vuota, oppure le chiavi di test sopra | vuota, oppure la chiave di test sopra |

Usare le chiavi di test sulle preview evita di dover autorizzare ogni dominio
`*.vercel.app` sul widget reale. Le chiavi di test funzionano da qualsiasi dominio.

**Verifica.** Su prod, apri `/candidati/<slug>` → *Carica il tuo CV*: il pulsante
"Scegli file" passa da "Verifica in corso…" ad attivo in pochi secondi. Se resta
bloccato e dopo 15 s compare "Troppi tentativi in questo momento…", l'hostname non è autorizzato o la
site key è sbagliata (vedi console del browser).

---

## 4. Upstash Redis — rate limit e budget

**Cosa serve.** Un database Redis Upstash raggiungibile via REST. Probabilmente
**esiste già**: il reranker dei match JD usa le stesse variabili. Verificate prima di
crearne uno nuovo.

**Cosa succede se manca.** In **produzione** la landing è *fail-closed*: senza Redis
(o se Redis non risponde) ogni upload viene rifiutato con "Troppi tentativi, riprova
più tardi". Il pulsante WhatsApp resta disponibile. In sviluppo si usa un contatore in
memoria.

**Passi:**

1. Vercel → Project → Settings → Environment Variables: controlla se esistono
   `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` per **Production**.
2. Se mancano: console.upstash.com → Create Database → tipo Redis, regione **EU**
   (es. `eu-west-1`), poi copia *REST URL* e *REST Token*.
   In alternativa si può usare l'integrazione Upstash del Marketplace Vercel.
3. **Attenzione ai nomi.** Il codice legge **solo** `UPSTASH_REDIS_REST_URL` e
   `UPSTASH_REDIS_REST_TOKEN`. Alcune versioni dell'integrazione Vercel creano invece
   `KV_REST_API_URL` / `KV_REST_API_TOKEN`: in quel caso aggiungete a mano le due
   variabili `UPSTASH_*` con gli stessi valori.

**Limiti (facoltativi).** I default sono pensati per uso reale; si cambiano senza
deploy di codice impostando queste variabili (interi; vuoto o non valido = default):

| Variabile | Default | Significato |
|---|---|---|
| `LANDING_LIMIT_IP_HOUR` | 5 | upload per IP all'ora |
| `LANDING_LIMIT_IP_DAY` | 20 | upload per IP al giorno |
| `LANDING_LIMIT_PAGE_DAY` | 100 | upload per landing al giorno |
| `LANDING_LIMIT_PAGE_EXTRACTIONS_DAY` | 100 | estrazioni (a pagamento) per landing al giorno |
| `LANDING_LIMIT_EXTRACTIONS_DAY` | 300 | estrazioni totali al giorno, tutte le landing — è il tetto di spesa |
| `LANDING_LIMIT_IMPORT_DAY` | 2 | tentativi di estrazione per singolo CV |
| `LANDING_LIMIT_PLACE_SEARCH_IMPORT` | 40 | ricerche indirizzo per singolo CV al giorno |
| `LANDING_LIMIT_PLACE_SEARCH_IP_HOUR` | 120 | ricerche indirizzo per IP all'ora |
| `LANDING_LIMIT_PLACE_RESOLVE_IMPORT` | 10 | risoluzioni dell'indirizzo scelto (Place Details) per singolo CV al giorno, cioè tentativi di conferma |

Per eventi con molti candidati dietro lo stesso Wi-Fi (fiere, sportelli) alzate
`LANDING_LIMIT_IP_HOUR` / `LANDING_LIMIT_IP_DAY` per la durata dell'evento.

**Verifica.** Upstash Console → Data Browser: dopo un upload compaiono chiavi
`rl:landing:…`.

---

## 5. Mistral — OCR ed estrazione dati

**Cosa serve.** `MISTRAL_API_KEY` (già usata per reranker e report). La landing usa:

- `mistral-ocr-latest` (endpoint `/v1/ocr`) per foto e PDF scansionati, max 3 pagine
  per i CV pubblici;
- `mistral-small-latest` (`/v1/chat/completions`) per estrarre i campi dal testo.

**Punti da verificare (GDPR).** I CV sono dati personali di terzi:

1. **Piano:** in produzione usate il piano a pagamento (**Scale**). Secondo l'help center
   di Mistral, sul piano Scale input e output non vengono usati per l'addestramento
   (opt-out di default). Sul piano gratuito (Experiment) il comportamento predefinito
   non è chiaramente documentato: non usatelo con CV reali.
2. **Opt-out:** console.mistral.ai → Admin → controllate che l'addestramento sui dati
   sia disattivato per l'organizzazione.
3. **DPA:** il Data Processing Addendum di Mistral deve risultare accettato e citato
   nel registro dei trattamenti di Kubri come responsabile.
4. Secondo l'help center, l'endpoint OCR è escluso dall'addestramento e non conserva
   i dati.

**Verifica.** Upload di una foto di un CV dalla landing: arriva al passo "Controlla i
tuoi dati" con nome e telefono precompilati.

---

## 5b. Google Maps Platform — indirizzo del candidato

**Cosa serve.** `GOOGLE_MAPS_API_KEY` (solo lato server, mai `NEXT_PUBLIC_`). La
landing la usa per il campo obbligatorio "Dove abiti?":

- **Geocoding API**: una chiamata a fine estrazione per precompilare il campo con
  l'indirizzo del CV;
- **Places API (New)**: Autocomplete mentre il candidato scrive, poi Place Details
  alla conferma per ricavare indirizzo e coordinate dal luogo scelto.

Tutte le chiamate passano dal nostro server, sempre in italiano e limitate all'Italia.
A Google arriva solo il testo dell'indirizzo, mai nome, telefono, email o CV.

**Cosa succede se manca.** La landing non si blocca: i suggerimenti diventano solo
comuni ISTAT ("Comune (PROV)") e il candidato viene salvato con le coordinate del
centro del comune. Lo stesso fallback scatta se Google non risponde, va in timeout,
restituisce una risposta malformata o la quota è esaurita.

**Passi:**

1. console.cloud.google.com: create o scegliete un progetto con la **fatturazione
   attiva** (senza billing le API rispondono con errore).
2. APIs & Services → Library: abilitate **Geocoding API** e **Places API (New)**.
3. APIs & Services → Credentials → Create credentials → API key. In *API
   restrictions* consentite **solo** quelle due API. Le restrizioni per IP non sono
   possibili su Vercel (IP di uscita dinamici): per questo la chiave resta solo lato
   server.
4. Quote e budget: impostate una quota giornaliera per ciascuna API (es. 1.000
   richieste/giorno) e un **avviso di budget** sul progetto (Billing → Budgets &
   alerts).
5. Vercel: inserite la chiave in **Production** come `GOOGLE_MAPS_API_KEY`. In
   **Preview** lasciatela vuota per provare il fallback ISTAT, oppure usate una chiave
   separata.
6. Controllate nella console l'uso gratuito mensile attuale per **Place Details
   Essentials** e **Geocoding**: le soglie riportate dalle varie fonti non coincidono.
7. **Privacy:** l'informativa di ogni landing deve citare Google tra i destinatari
   dell'indirizzo (per i candidati del chatbot lo è già, tramite Make).
8. **Decisione nota:** i termini di Google consentono di conservare lat/lng ottenuti
   dal geocoding per 30 giorni; Kubri li conserva in modo permanente per scelta, come
   già avviene con Make.

**Limiti.** Ricerche e conferme hanno rate limit dedicati (`LANDING_LIMIT_PLACE_*`,
§4); la ricerca è possibile solo con un CV già caricato ed estratto nella stessa
sessione del browser.

**Verifica.** Caricate un CV con un indirizzo: al passo "Controlla i tuoi dati" il
campo "Dove abiti?" mostra l'indirizzo formattato da Google (non "Comune (PROV)").

---

## 6. Segreti generati da voi

| Variabile | Requisito | Come generarla | Se manca in prod |
|---|---|---|---|
| `LANDING_COOKIE_SECRET` | ≥ 32 caratteri | comando sotto | ogni upload → "Troppi tentativi in questo momento…", nessun costo |
| `LANDING_IP_SALT` | ≥ 16 caratteri | comando sotto | ogni upload → "Troppi tentativi in questo momento…", nessun costo |

```bash
openssl rand -base64 48
```

```bash
openssl rand -hex 24
```

- Valori **diversi** per prod, preview e locale.
- Cambiare `LANDING_COOKIE_SECRET` fa solo scadere gli upload in corso (30 minuti).
- Cambiare `LANDING_IP_SALT` azzera di fatto i contatori per IP: nessun danno.

---

## 7. Vercel — variabili, durata funzioni, cron

**Variabili da impostare** (Settings → Environment Variables):

| Variabile | Production | Preview | Note |
|---|---|---|---|
| `TURNSTILE_SITE_KEY` | reale | test | §3 |
| `TURNSTILE_SECRET_KEY` | reale | test | §3 |
| `LANDING_COOKIE_SECRET` | ✅ | ✅ (diverso) | §6 |
| `LANDING_IP_SALT` | ✅ | ✅ (diverso) | §6 |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | ✅ | ✅ (può essere lo stesso DB) | §4 |
| `MISTRAL_API_KEY` | ✅ | ✅ | §5, probabilmente già presente |
| `GOOGLE_MAPS_API_KEY` | ✅ | facoltativa (vuota = fallback ISTAT, o chiave separata) | §5b, solo lato server |
| `NEXT_PUBLIC_APP_URL` | dominio prod, es. `https://app.kubri.it` | facoltativo | usato per link e **QR stampabili**: se manca, il QR prende il dominio da cui l'admin apre la pagina (anche un dominio di preview) |
| `KUBRI_WHATSAPP_NUMBER` | es. `393331234567` (senza `+`) | idem | già usata per i QR dei pool |
| `KUBRI_WHATSAPP_MESSAGE_TEMPLATE` | testo del messaggio | idem | già usata |
| `LANDING_LIMIT_*` | facoltative | facoltative | §4 |
| `CRON_SECRET` | ✅ | — | già presente |

`NEXT_PUBLIC_APP_URL` è letta anche lato client: dopo averla cambiata serve un
redeploy.

**Durata funzioni.** La pagina della landing dichiara `maxDuration = 60` (OCR +
estrazione stanno in circa 50 s nel caso peggiore). 60 s rientrano nei limiti sia di
Hobby sia di Pro.

**Cron.** `vercel.json` esegue `/api/cron/regenerate-embeddings` ogni notte alle 03:00
UTC. Oltre agli embedding, il cron:

- scarta gli import non completati (24 h per quelli pubblici, 7 giorni per quelli degli
  operatori) e ne cancella il file;
- rimuove i file caricati ma mai registrati (max 500 cartelle o 30 s per esecuzione).

Un CV non confermato può quindi restare fino a circa 48 h: tenetene conto nel testo
dell'informativa privacy.

**Dipendenze npm native.** `sharp` (ricodifica immagini) viene installato da pnpm per
Linux durante la build Vercel. Se la prima build di preview segnala errori su `sharp`,
è questo il punto da controllare.

---

## 8. Configurazione applicativa (dopo il deploy)

1. **Pool**: l'azienda deve avere un pool **non globale** agganciato
   (Admin → Organizzazioni → *azienda* → Pool accessibili).
2. **Landing** (stessa pagina, card "Landing candidati", solo `ADMIN_KUBRI`):
   - Indirizzo (slug): minuscole, numeri e trattini, 3–60 caratteri.
   - Pool di destinazione.
   - **URL informativa privacy (https)** — obbligatorio. Titolare del trattamento è
     l'azienda; l'informativa deve citare Kubri come responsabile e Mistral come
     sub-responsabile.
   - Pagina attiva.
3. **Distribuzione**: link e QR compaiono nella card admin e nella pagina "QR code"
   dell'azienda. Cambiare lo slug rende inutilizzabili i QR già stampati.

---

## 9. Sequenza di go-live

1. PR base `feat/create-candidate-ui`: migrazione `20261023120000` su prod → bucket
   `candidate-documents` su prod → merge.
2. Cloudflare: widget Turnstile per il dominio prod.
3. Vercel: variabili del §7 (Production e Preview).
4. PR landing: migrazioni `20261029120000` e `20261030120000` su prod → merge.
5. Verifica `prisma migrate status` su prod.
6. Admin: crea una landing **disattivata** di prova, poi attivala e fai i test del §10.
7. Solo dopo: comunica link e QR all'azienda.

---

## 10. Test di accettazione (prod o preview)

- [ ] `/candidati/<slug>` si apre senza login; `?lang=en` passa all'inglese.
- [ ] Pulsante WhatsApp: apre WhatsApp con il prefisso del pool nel messaggio.
- [ ] PDF testuale → contatti precompilati → conferma → "Grazie!". In dashboard il
      candidato è nel pool giusto, badge "Da landing page (CV)", CV in "Documenti" con
      la dicitura "Caricato dal candidato tramite landing page".
- [ ] Stesso telefono, nuovo CV, stessa landing → nessun nuovo candidato, il CV si
      aggiunge a quello esistente.
- [ ] Foto di un CV → OCR → contatti precompilati.
- [ ] File non valido (es. `.txt` rinominato `.pdf`) → "Possiamo leggere solo PDF,
      Word o foto fino a 5 MB".
- [ ] Documento che non è un CV → "Non riusciamo a leggere un curriculum in questo
      file".
- [ ] Landing disattivata → pagina "Pagina non disponibile".
- [ ] CV con un indirizzo → "Dove abiti?" precompilato con l'indirizzo di Google.
- [ ] CV senza indirizzo → campo vuoto; scelta di una città dai suggerimenti →
      candidato salvato con le coordinate.
- [ ] Dettaglio del candidato in dashboard → l'indirizzo è visibile.

---

## 11. Troubleshooting

| Sintomo | Causa probabile | Dove guardare |
|---|---|---|
| `The table … CandidateLandingPage does not exist` | migrazione non applicata a quel DB | §1, `prisma migrate status` |
| Ogni upload → "Troppi tentativi in questo momento. Riprova più tardi." (anche il primo) | in prod manca una tra: `TURNSTILE_SECRET_KEY`, `UPSTASH_*`, `LANDING_COOKIE_SECRET`, `LANDING_IP_SALT` (≥ 16) | log Vercel: `[landing] … unavailable` / `LANDING_COOKIE_SECRET missing` |
| "Verifica in corso…" non finisce mai | hostname non autorizzato sul widget, site key errata, ad blocker | console browser, Cloudflare → Turnstile → Analytics |
| Upload fallisce subito ("Qualcosa è andato storto") | bucket mancante o service role key errata | log Vercel `STORAGE_ERROR`; §2 |
| Estrazione sempre in errore | `MISTRAL_API_KEY` mancante o credito esaurito | log Vercel `LLM_ERROR`; console Mistral |
| Molti "Troppi tentativi" durante un evento | limiti per IP troppo bassi per un Wi-Fi condiviso | §4, alzare `LANDING_LIMIT_IP_*` |
| QR punta a un dominio `*.vercel.app` | `NEXT_PUBLIC_APP_URL` non impostata | §7 |
| Pulsante WhatsApp assente | `KUBRI_WHATSAPP_NUMBER` o `_MESSAGE_TEMPLATE` vuote | §7 |
| Suggerimenti di "Dove abiti?" solo nel formato "Comune (PROV)" | `GOOGLE_MAPS_API_KEY` mancante o non valida, oppure quota esaurita: il codice è passato al fallback ISTAT | log Vercel: `[landing] place search fell back` (anche `prefill` / `resolve`); §5b |
| La landing restituisce 404 | landing disattivata, pool sganciato dall'azienda o pool globale | Admin → card "Landing candidati" |

---

Riferimenti esterni:
[Turnstile – chiavi di test](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) ·
[Upstash su Vercel Marketplace](https://vercel.com/marketplace/upstash/upstash-kv) ·
[Mistral – uso dei dati per l'addestramento](https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models) ·
[Mistral – Data Processing Addendum](https://legal.mistral.ai/terms/data-processing-addendum) ·
[Google Maps Platform – console](https://console.cloud.google.com/google/maps-apis)
