# Numero WhatsApp di prova (sviluppo)

Serve a provare il bot su WhatsApp vero **senza toccare il numero usato da Make**. Usa un'app
Meta di sviluppo separata, con il suo numero di prova. Piano 09, Task 15.

## 1. Cosa serve

- Un account Meta for Developers con un'app di tipo **Business** e il prodotto **WhatsApp**.
- Il **numero di prova** che Meta assegna all'app (o un numero di sviluppo registrato).
- Uno o più telefoni **destinatari autorizzati**: con un numero di prova Meta consente di
  scrivere solo a numeri aggiunti a mano (fino a 5).
- Un indirizzo pubblico per il webhook: un tunnel verso il processo web locale
  (`cloudflared tunnel --url http://localhost:3000` oppure `ngrok http 3000`; la porta è `PORT`,
  3000 se non impostata).

## 2. Dati da annotare dalla console di Meta

| Dato | Dove | Variabile |
|---|---|---|
| App secret | Impostazioni dell'app → Di base | `META_APP_SECRET` |
| Token di accesso | WhatsApp → Configurazione API (quello temporaneo dura 24 ore; per più a lungo un utente di sistema) | una variabile a scelta, ad esempio `META_TOKEN_DEV` |
| ID del numero di telefono | WhatsApp → Configurazione API | `--phone-number-id` |
| ID dell'account WhatsApp Business | idem | `--waba-id` |
| Token di verifica | lo scegli tu | `META_VERIFY_TOKEN` |
| Versione della Graph API | in alto nella pagina Configurazione API | `META_GRAPH_VERSION` (default `v23.0`) |

Il token **non** va nel database: nella configurazione del numero si scrive il **nome** della
variabile (`META_TOKEN_DEV`), mai il valore.

## 3. Preparare il database e le campagne

```bash
cd apps/chatbot
pnpm db:up && pnpm db:deploy
pnpm cli orgs add kubri --name "Kubri S.r.l."
pnpm cli senders add kubri-main --phone +<numero di prova> --name "Kubri (prova)" --org kubri \
  --phone-number-id <ID del numero> --waba-id <ID dell'account> --token-secret META_TOKEN_DEV
NODE_ENV=development pnpm cli campaigns import campaigns/kubri-standard.json --activate
```

## 4. Avviare web e worker

In `apps/chatbot/.env` (non versionato) mettere `NODE_ENV=development`, `META_APP_SECRET`,
`META_VERIFY_TOKEN`, `META_TOKEN_DEV`, un `CONSENT_HASH_SECRET` di sviluppo (almeno 32 caratteri),
`DEBOUNCE_MS=1500` (per provare con calma) e, se si vuole l'NLU vero, `MISTRAL_API_KEY`.

```bash
pnpm cli web start                                                  # terminale 1
pnpm cli worker start --channel meta --nlu naive --translator fake  # terminale 2
```

Con la chiave di Mistral: `--nlu llm --translator llm`. In produzione (`NODE_ENV=production`) il
worker rifiuta `console`, `naive` e `fake`.

## 5. Collegare il webhook

1. Nella console: WhatsApp → Configurazione → Webhook → **Modifica**.
2. URL di callback: `https://<indirizzo del tunnel>/webhooks/whatsapp`; token di verifica:
   il valore di `META_VERIFY_TOKEN`. **Verifica e salva** deve riuscire: è la prima GET.
3. Sottoscrivere il campo **messages**.

## 6. Lista di controllo ("fatto quando")

Dal telefono autorizzato, scrivere al numero di prova.

- [ ] "ciao" → arriva il benvenuto con il pulsante **Lingua / Language**; si apre l'elenco di
      10 lingue e si sceglie una voce.
- [ ] Il consenso arriva con i bottoni **Accetto / Non accetto**; toccando "Accetto" la
      conversazione prosegue, e in `Consent` c'è la riga con il testo mostrato.
- [ ] Le domande sì/no (patente, permesso di lavoro) hanno i bottoni **Sì / No**; il livello di
      italiano ha un elenco; le domande libere (nome, lavori) no.
- [ ] Scrivere una risposta a mano dove ci sono i bottoni funziona lo stesso.
- [ ] Toccare un bottone di un messaggio **vecchio** (per esempio il "Sì" della patente quando la
      domanda è un'altra) non risponde alla domanda attuale: il bot lo legge come testo.
- [ ] Un vocale o un documento riceve "Per ora riesco a leggere solo messaggi di testo…".
- [ ] Si arriva fino all'offerta del CV e alla chiusura; `Session.status = completed`.
- [ ] Si vedono le spunte blu e "sta scrivendo" mentre il bot elabora.
- [ ] Scrivere "stop" chiude la conversazione e registra l'opt-out; riscrivendo parte una
      sessione nuova.
- [ ] `pnpm exec prisma studio`: `Message` ha `type = interactive` per i widget (con
      `interactive`) e per i tocchi (con `replyId`); `Turn` e `NluTrace` sono coerenti;
      `InboundDeadLetter` è vuota.
- [ ] Nei log non compare alcun nome, numero o testo del candidato.

## 7. Raccogliere payload veri per i test

I messaggi veri sono in `Message.payloadRaw` (entrata). Per aggiungerli alle fixture:

```sql
SELECT "providerMessageId", "type", "payloadRaw" FROM bot."Message" WHERE "direction" = 'inbound';
```

Copiare il JSON in `tests/fixtures/meta/real-<tipo>.json`, **sostituendo** numeri, nomi, id e
testi con valori inventati (nessun dato reale nel repository), e aggiungere un caso a
`tests/unit/channels/meta-cloud/parse.test.ts` che lo legga.

## 8. Quando qualcosa non va

- **La verifica del webhook fallisce:** token diverso da `META_VERIFY_TOKEN`, o il tunnel non
  raggiunge il processo web (`curl https://<tunnel>/health`).
- **401 sui POST:** `META_APP_SECRET` sbagliato (si legge in Impostazioni → Di base).
- **Il messaggio arriva ma il bot tace:** guardare `InboundDeadLetter` (motivo `unknown_sender`:
  controllare `senders add --phone-number-id` e che il numero non sia `suspended`), poi i log del
  worker.
- **Errore `not_allowed` (131030) in invio:** il destinatario non è nell'elenco dei numeri
  autorizzati.
- **Errore `auth_failed` (190):** il token è scaduto (quello temporaneo dura 24 ore).
- **Errore `outside_window`:** sono passate più di 24 ore dall'ultimo messaggio del candidato:
  fuori dalla finestra servono i template (non ancora nella v1).
