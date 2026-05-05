# Pool WhatsApp QR code — Design

**Date:** 2026-05-05
**Status:** Approved (brainstorming)

## Goal

Permettere agli `ADMIN_KUBRI` di generare un QR code per ogni pool che, se inquadrato, apra automaticamente WhatsApp con un messaggio precompilato verso il numero Kubri. Se il pool non è globale, il messaggio inizia con un identificatore del pool, così che il chatbot lato Make sappia da quale pool proviene il candidato.

Nello scope di questa iterazione la feature è visibile **solo agli `ADMIN_KUBRI`**. La visibilità per altri ruoli è esplicitamente fuori scope e verrà valutata in seguito.

## User-facing behavior

- Pagina `/admin/pools` (lista pool): aggiunta una colonna "Azioni" con un bottone **"QR WhatsApp"** per ciascuna riga.
- Click sul bottone → si apre un dialog (shadcn `Dialog`) che mostra:
  - QR code in SVG, dimensione fissa adatta a essere inquadrato dal cellulare.
  - Il link `https://wa.me/...` in chiaro, cliccabile.
  - Bottone "Copia link".
  - Indicazione testuale del messaggio precompilato che verrà inviato.
- Chiusura via `Esc` / overlay / bottone close standard.

## Message construction

Componenti del link `wa.me`:

- **Numero**: env var `KUBRI_WHATSAPP_NUMBER` (formato internazionale senza `+`, es. `393331234567` — formato richiesto da `wa.me`).
- **Template messaggio**: env var `KUBRI_WHATSAPP_MESSAGE_TEMPLATE` (testo base, senza prefisso pool).
- **Prefisso pool**: presente solo se il pool **non** è globale (`pool.isGlobal === false`). Valore = `pool.externalKey ?? pool.slug`. Format: `"[<id>] "` (parentesi quadre + spazio).

Pseudo-codice:

```ts
function buildWaLink(pool: { isGlobal: boolean; externalKey: string | null; slug: string }, number: string, template: string): string {
  const poolId = pool.externalKey ?? pool.slug;
  const prefix = pool.isGlobal ? "" : `[${poolId}] `;
  const text = `${prefix}${template}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
```

Esempi:
- Pool globale, template `Ciao, vorrei candidarmi tramite Kubri.` → `https://wa.me/393331234567?text=Ciao%2C%20vorrei%20candidarmi%20tramite%20Kubri.`
- Pool non globale con `externalKey=MENSA01` → testo `[MENSA01] Ciao, vorrei candidarmi tramite Kubri.`
- Pool non globale con `externalKey=null` e `slug=mensa-milano` → testo `[mensa-milano] Ciao, vorrei candidarmi tramite Kubri.`

## Environment variables

Aggiunte a `.env.example`:

```env
# WhatsApp QR (admin pools)
KUBRI_WHATSAPP_NUMBER=
KUBRI_WHATSAPP_MESSAGE_TEMPLATE=
```

Note:
- Nessuno dei due è segreto (il numero finisce nel QR pubblico). Sono in env solo per facilità di modifica senza redeploy del codice.
- Configurati su Vercel (dev + prod) dall'utente. La feature è inutilizzabile finché entrambe non sono valorizzate.
- Letti **server-side** (`process.env`) nella Server Component della lista pool e passati come prop al Client Component del dialog. Non si usano `NEXT_PUBLIC_*`.

## Components & files

### Nuovi

- `src/lib/whatsapp/build-link.ts`
  - Export `buildWaLink(pool, number, template): string` — funzione pura, niente I/O.
  - Tipo `pool` minimale: `{ isGlobal: boolean; externalKey: string | null; slug: string }`.
- `src/lib/whatsapp/__tests__/build-link.test.ts` (o equivalente in `src/__tests__/...` seguendo la convenzione del progetto)
  - Casi: pool globale, pool non globale con externalKey, pool non globale con solo slug, encoding di caratteri speciali (spazi, accenti, virgole, newline), template vuoto.
- `src/components/pools/pool-qr-dialog.tsx` (`"use client"`)
  - Dialog shadcn. Props: `pool`, `waLink: string`, `messageText: string`.
  - Renderizza QR via `qrcode.react` (SVG, ~5KB gzip, zero deps native).
  - Bottone "Copia link" → `navigator.clipboard.writeText(waLink)`.
  - Bottone trigger "QR WhatsApp" può essere lo stesso componente o un export separato.

### Modificati

- `src/app/(admin)/admin/pools/page.tsx`
  - Aggiungere colonna `<TableHead>Azioni</TableHead>`.
  - In ciascuna riga: render `<PoolQrDialog pool={pool} waLink={...} messageText={...} />`.
  - Costruire `waLink` e `messageText` server-side via `buildWaLink` usando `process.env.KUBRI_WHATSAPP_NUMBER` e `process.env.KUBRI_WHATSAPP_MESSAGE_TEMPLATE`.
  - Se una delle due env è mancante: il bottone non viene renderizzato (oppure è disabilitato con tooltip "Configurare KUBRI_WHATSAPP_NUMBER e KUBRI_WHATSAPP_MESSAGE_TEMPLATE"). Scelta: **disabilitato con tooltip**, così l'admin capisce che manca la config.
- `.env.example` — aggiungere le due nuove variabili.

### Dipendenze

- `qrcode.react` (oppure `react-qr-code` se già preferito altrove nel progetto — verificare durante l'implementazione). Aggiunta come `dependencies`.

## Security & access control

- La route `/admin/pools` è già gated a `ADMIN_KUBRI` (redirect a `/dashboard` altrimenti). Nessun cambio.
- Il numero passa server → client component come prop. Nessuna nuova route API.
- Nessun dato sensibile: il QR contiene solo numero pubblico + testo precompilato. Nessun rischio GDPR.

## Testing

- **Unit** su `buildWaLink`: vedi sopra. Sufficiente per la logica.
- **Manuale**: aprire la lista pool come `ADMIN_KUBRI`, verificare che il dialog mostri il QR, scansionarlo da telefono e verificare apertura WhatsApp con messaggio corretto su pool globale e non globale.
- Nessun test E2E previsto in questa iterazione.

## Out of scope

- Visibilità per `ORG_ADMIN` / `ORG_MEMBER`.
- QR per organization, candidato, o altri entity.
- Configurazione per-pool del numero o del template (futuro: vedi sezione successiva).
- Tracking analitico delle scansioni / link unici (UTM-style).
- Download del QR come PNG/SVG file.

## Future considerations

- Possibile evoluzione: campo `whatsappTemplate` opzionale sul Pool per override per-pool. La firma di `buildWaLink` resta retrocompatibile (template è già un input).
- Estensione a `ORG_ADMIN` richiederà di valutare se il numero resta unico Kubri o per organization.
