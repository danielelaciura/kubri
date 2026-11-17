# Kubri x APL — demo (`apps/apl-demo`)

Prototipo **statico** per vendere Kubri alle Agenzie per il Lavoro (APL): l'agenzia pubblica
un'offerta, Kubri trova le associazioni della rete con candidati compatibili, l'associazione
sceglie chi inviare, l'agenzia riceve profili completi e contatti.

Tutto è finto: nessun backend, nessun login, nessun dato reale, nessuna dipendenza dalla
dashboard. Lo stato vive nel browser (sessionStorage); "Ricomincia la demo" in basso a
sinistra riporta ai dati iniziali.

## Sviluppo

```bash
pnpm dev:apl-demo                              # dalla root: http://localhost:3003
pnpm --filter @kubri/apl-demo build            # build Vercel (Next normale)
pnpm --filter @kubri/apl-demo build:static     # sito statico in out/ (zip da usare offline)
```

## Pubblicazione: `app.kubri.it/<percorso-segreto>`

La demo ha un suo progetto Vercel. La dashboard la **inoltra** (rewrite in
`apps/dashboard/next.config.ts`) sotto un percorso segreto del proprio dominio, e il
middleware della dashboard lascia passare quel percorso senza login.

Il percorso segreto è l'unica protezione e **questo repo è pubblico**: il valore vive solo
nelle variabili d'ambiente Vercel, mai nel codice, nelle PR o nei commit.

1. Scegli un percorso difficile da indovinare, es. `demo-apl-` + 16 caratteri casuali
   (`openssl rand -hex 8`).
2. **Nuovo progetto Vercel** dal repo `kubri`, Root Directory `apps/apl-demo`, framework
   Next.js. Variabile d'ambiente (Production): `APL_DEMO_PATH=<percorso>`. Deploy.
   Annota l'URL di produzione del progetto (es. `https://kubri-apl-demo.vercel.app`).
3. **Progetto della dashboard** su Vercel, variabili (Production):
   `APL_DEMO_PATH=<stesso percorso>` e `APL_DEMO_ORIGIN=<URL del punto 2>`. Redeploy.
4. Apri `https://app.kubri.it/<percorso>`.

Senza una delle due variabili nella dashboard l'inoltro non esiste e il percorso resta
dietro login: la demo si spegne svuotando `APL_DEMO_PATH`. Per cambiare il link basta
cambiare il percorso in entrambi i progetti e rifare il deploy.

Le pagine hanno `X-Robots-Tag: noindex` e `robots: noindex`, quindi i motori di ricerca non
le indicizzano. Chi ha il link entra: va condiviso solo con chi deve vederlo.

## Dove sono le cose

- `src/lib/data.ts` — agenzia, 6 associazioni, ~68 candidati generati, offerte di partenza,
  offerta d'esempio (LogiNord, 3 addetti di magazzino a Settimo Torinese)
- `src/lib/matching.ts` — punteggio di compatibilità a regole (competenze, ruolo, comune,
  disponibilità, italiano), con le motivazioni
- `src/lib/store.tsx` — stato in memoria e azioni (pubblica, invia candidati, cambia stato)
- `src/components/tour-bar.tsx` — testi e passi del tour guidato
- `src/app/agenzia/*`, `src/app/associazione/*` — le schermate

Regole confermate dal titolare: si vende alle APL; l'agenzia vede nome e contatti solo dopo
l'invio; l'associazione approva chi inviare.
