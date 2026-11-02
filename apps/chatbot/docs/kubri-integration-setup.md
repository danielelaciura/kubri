# Integrazione con Kubri: configurazione e prova su dev

Il worker manda i candidati alla dashboard Kubri e consegna il CV in chat. Piano 10 (revisione
del 2026-11-02, R10). Questa guida è l'unica prova con servizi reali: i test automatici non
chiamano mai Kubri, Google né Meta.

Cosa succede, in breve:

- a ogni evento significativo (`consents.accepted`, `block.completed`, `interview.completed`,
  `profile.updated`) il job `kubri-webhook` legge il profilo **com'è in quel momento** e lo invia a
  `POST {KUBRI_BASE_URL}/api/webhooks/chatbot/candidate` con
  `Authorization: Bearer <CHATBOT_WEBHOOK_SECRET>`; la dashboard lo valida con lo schema di
  `@kubri/contracts`, lo geocodifica (Google, ripiego ISTAT) e lo scrive;
- se il candidato risponde "sì" alla domanda sul CV (o lo chiede di nuovo dopo la fine), il job
  `cv` genera il PDF in memoria, lo carica su Meta e lo manda come **documento WhatsApp**. Il CV
  non va in dashboard e non si salva da nessuna parte: niente bucket da creare.

## 0. Prima del deploy (dev e prod)

- **Ordine:** prima la dashboard con la route `/api/webhooks/chatbot/candidate` e il segreto
  `CHATBOT_WEBHOOK_SECRET` nelle variabili di Vercel, poi il worker del chatbot. Al contrario i job
  `kubri-webhook` vengono ritentati per tutta la finestra (`KUBRI_WEBHOOK_RETRY_LIMIT` = 10
  ritentativi, almeno ~2 h 50 min) e poi finiscono negli scarti con il flag
  `kubri_webhook_failed`.
- **Vecchi job `cv`:** quelli creati prima del piano 10 hanno solo `{sessionId}` (manca `turnId`)
  e non passano più la validazione: vanno eliminati dalle code di dev e prod prima di avviare il
  nuovo worker, altrimenti falliscono a ogni ritentativo e finiscono in `cv-dead`:

  ```sql
  delete from bot_queue.job
  where name = 'cv' and state in ('created', 'retry') and not (data ? 'turnId');
  ```

## 1. Prerequisiti

- La dashboard con l'endpoint del chatbot (Parte A del piano 10) in esecuzione: in locale
  (`pnpm --filter kubri-dashboard exec next dev -p 3001`: la porta 3000 è quella del processo web del
  chatbot) o il deploy di dev.
- Nella dashboard, un pool con chiave esterna uguale all'`externalKey` della campagna
  (`global` per `campaigns/kubri-standard.json`).
- Il numero WhatsApp di prova configurato come in `docs/whatsapp-dev-setup.md` (piano 09).

## 2. Il segreto condiviso

Scegliere un valore lungo e casuale (per esempio `openssl rand -hex 32`) e metterlo **uguale**
nelle due app:

| App | Variabile | Dove |
|---|---|---|
| dashboard | `CHATBOT_WEBHOOK_SECRET` | `apps/dashboard/.env.local` (o le variabili del deploy di dev) |
| chatbot | `CHATBOT_WEBHOOK_SECRET` | `apps/chatbot/.env` (gitignored) |

Mai in un file versionato. La dashboard senza il segreto rifiuta ogni richiesta (401).

## 3. Variabili del worker

In `apps/chatbot/.env`, oltre a quelle dei piani 08 e 09:

| Variabile | Valore |
|---|---|
| `KUBRI_BASE_URL` | indirizzo della dashboard raggiungibile dal worker, senza barra finale (es. `http://localhost:3001`) |
| `CHATBOT_WEBHOOK_SECRET` | il segreto del §2 |

Regole all'avvio di `worker start`:

- tutte e due o nessuna: con una sola il worker non parte e dice quale manca;
- con `NODE_ENV=production` sono obbligatorie;
- in sviluppo, senza nessuna delle due, il worker parte con un avviso e i job `kubri-webhook`
  finiscono nella coda degli scarti con motivo `not_configured`.

## 4. Un'intervista

```bash
cd apps/chatbot
pnpm cli web start                                                  # terminale 1
pnpm cli worker start --channel meta --nlu llm --translator llm     # terminale 2
```

Dal telefono autorizzato, scrivere al numero di prova e fare l'intervista della campagna standard,
rispondendo **"sì"** alla domanda sul CV.

## 5. Cosa guardare

1. **Dopo i consensi obbligatori** il candidato compare in dashboard (anche con pochi campi),
   canale WhatsApp, sorgente `kubri-chatbot`.
2. **Durante e alla fine** il profilo si aggiorna; a intervista finita lo stato è `completed`.
3. **Coordinate:** il candidato ha latitudine e longitudine (dall'indirizzo e dal comune che ha
   dato). Senza `GOOGLE_MAPS_API_KEY` nella dashboard arrivano quelle del comune ISTAT.
4. **CV:** in chat arriva un documento `CV.pdf` con la didascalia "Ecco il tuo CV…"; si apre ed
   è leggibile. In dashboard **non** c'è nessun CV.
5. **CV con "no":** rifacendo l'intervista con un altro numero autorizzato e rispondendo "no",
   non arriva nessun documento.
6. **Code degli scarti vuote** (da `psql` sul database del chatbot):

   ```sql
   select name, data->>'reason' as reason, count(*)
   from bot_queue.job where name like '%-dead' group by 1, 2;
   ```

   Atteso: nessuna riga.
7. **Log:** solo id e codici (`sessionId`, `event`, `turnId`), mai nomi, telefoni o testi.

## 6. Prove di guasto (facoltative ma consigliate)

- **Segreto sbagliato** nel chatbot: il job finisce in `kubri-webhook-dead` con motivo
  `unauthorized`, la sessione ha un flag `kubri_webhook_failed` (senza `needs_attention`), il
  worker continua. Rimettere il segreto giusto: gli eventi successivi arrivano di nuovo.
- **Dashboard spenta:** il job viene ritentato con attesa crescente (10 ritentativi, almeno
  ~2 h 50 min in tutto); riaccendendola in quella finestra il candidato arriva. All'ultimo
  tentativo fallito il job va negli scarti con il codice (es. `http_503`) e la sessione ha il
  flag `kubri_webhook_failed`.
- **Pool sconosciuto** (campagna con un `externalKey` che la dashboard non ha): scarto con motivo
  `unknown_pool`.
- **CV non generabile** (per esempio token Meta revocato tra l'intervista e il job): dopo i
  ritentativi il candidato riceve "Mi dispiace, non sono riuscito a preparare il tuo CV." una sola
  volta e la sessione ha il flag `cv_failed`.
