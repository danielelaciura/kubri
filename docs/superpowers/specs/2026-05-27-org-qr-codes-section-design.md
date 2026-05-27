# Sezione "QR code" per utenti organization

## Contesto

Il QR code WhatsApp dei pool oggi è accessibile solo da `/admin/pools`, riservata ad `ADMIN_KUBRI`. Vogliamo esporlo a tutti gli utenti dell'organization tramite una nuova sezione del dashboard, mostrando solo i pool effettivamente agganciati all'organization dell'utente (esclusi i pool `isGlobal`).

## Scope

- Nuova voce di menu "QR code" in `/dashboard/qr-codes`, visibile a tutti gli utenti loggati con organization
- Lista dei pool dell'organization, esclusi i pool global
- Per ogni pool: nome, numero candidati, CTA che apre la modale QR esistente (`PoolQrDialog`)

Out of scope: filtri, ricerca, paginazione, export, modifica pool, modale separata per il solo link.

## Architettura

### Nav

`src/components/layout/app-sidebar.tsx`
- Aggiungere voce `{ label: strings.nav.qrCodes, href: "/dashboard/qr-codes", icon: QrCode }` in `mainItems`, prima di "Stats"
- Import `QrCode` da `lucide-react`

`src/lib/i18n/strings.ts`
- Aggiungere `nav.qrCodes: "QR code"`

### Query

`src/lib/pools/queries.ts`
- Nuova funzione:
  ```ts
  export async function listOrgPoolsWithCandidateCount(organizationId: string) {
    return prisma.pool.findMany({
      where: {
        isGlobal: false,
        organizations: { some: { organizationId } },
      },
      orderBy: { name: "asc" },
      include: { _count: { select: { candidates: true } } },
    });
  }
  ```
- Sicurezza: la `where` filtra esplicitamente per `organizationId` dell'utente corrente, rispettando la regola di scoping multi-tenant.

### Pagina

`src/app/(dashboard)/dashboard/qr-codes/page.tsx` (Server Component)

Flow:
1. `getCurrentUser()` → se manca, redirect `/login` (già gestito dal layout)
2. Se `user.organizationId` è null → `pools = []`
3. Altrimenti `pools = await listOrgPoolsWithCandidateCount(user.organizationId)`
4. Legge `KUBRI_WHATSAPP_NUMBER` / `KUBRI_WHATSAPP_MESSAGE_TEMPLATE` lato server, calcola `waConfigured`
5. Renderizza tabella

Tabella (riusa `Table` di shadcn come `/admin/pools`):
- Colonne: **Nome pool**, **Candidati**, colonna azione a destra
- Cella azione: `<PoolQrDialog poolName={...} waLink={...} messageText={...} />` (riuso diretto del componente esistente — gestisce già lo stato disabled quando WhatsApp non è configurato, oltre a QR, copia link e download PNG)
- Stato vuoto: messaggio "Nessun pool disponibile" (nessuna org agganciata o nessun pool agganciato)

### Componenti

Nessun nuovo componente. Si riusa interamente `src/components/pools/pool-qr-dialog.tsx`.

### Build link WhatsApp

Si riusano `buildWaLink` e `buildWaMessage` da `src/lib/whatsapp/build-link.ts`, esattamente come fa la pagina admin pools.

## Sicurezza

- Query scopata per `organizationId` dell'utente loggato (regola non-negotiable CLAUDE.md)
- Esclusione `isGlobal: true` come da requisito
- Nessun nuovo write path, solo lettura
- Nessuna esposizione di pool di altre organization

## Test plan

- Utente di Organization A vede solo i suoi pool non-global, non quelli di B
- Pool `isGlobal: true` agganciati all'org non compaiono
- Pool non agganciato all'org dell'utente non compare anche se l'utente conosce l'id
- Count candidati corretto
- Bottone QR apre la modale esistente con link/messaggio precompilati
- Con `KUBRI_WHATSAPP_NUMBER` o template mancanti, il bottone risulta disabled con tooltip (comportamento già coperto da `PoolQrDialog`)
- Utente senza `organizationId`: tabella vuota, nessun errore
- Voce sidebar visibile per tutti i ruoli (VIEWER, MEMBER, ORG_ADMIN, ADMIN_KUBRI)
