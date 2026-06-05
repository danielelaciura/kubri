# Liste di candidati — Design

**Data:** 2026-06-05
**Stato:** Approvato, pronto per il piano di implementazione

## Obiettivo

Permettere alle organizzazioni di raggruppare i candidati in **liste** con nome
(es. "Preferiti", "Lista camerieri", "Lavoratori Palermo"), create dagli utenti
e condivise nell'organizzazione. Dalla tabella candidati, dai risultati del job
matching e dalla scheda candidato si può agganciare/sganciare un candidato a una
o più liste. Una sezione dedicata "Liste" permette di gestirle e di visualizzare
il sottoinsieme di candidati di ciascuna; la pagina candidati esistente resta la
baseline, con in più un filtro "lista".

Questa feature **sostituisce** il sistema dei tag (`CandidateTag`), oggi non
utilizzato e concettualmente sovrapposto. Rimpiazzo pulito, senza migrazione dati.

## Decisioni di design

- **Visibilità:** liste **org-scoped e condivise** tra tutti i membri dell'org
  (coerente con note/audit). Niente liste private per utente.
- **Permessi:** **ogni membro dell'org** (`ORG_MEMBER` incluso) può creare,
  rinominare, eliminare liste e gestirne i membri. Stesso criterio delle note.
- **Cross-pool:** una lista org-scoped può contenere candidati di qualsiasi pool
  accessibile all'org. La sicurezza è applicata **a query time** filtrando sui
  pool accessibili (`getOrgAccessiblePoolIds`), non sulla riga di membership.
- **Aggiunta a lista:** azione per singolo candidato (no selezione multipla),
  tramite un dropdown a checkbox riusabile ("add to playlist" pattern) con
  creazione lista al volo. Presente in 3 punti: tabella candidati, match table
  del job, scheda candidato.
- **Export:** colonna "Liste" aggiunta all'export esistente; nuovo export CSV
  per singola lista (solo CSV, no PDF di lista).

## 1. Modello dati

Rimuovere il modello `CandidateTag` (e relazioni `Candidate.tags`,
`Organization.candidateTags`). Aggiungere:

```prisma
model CandidateList {
  id              String   @id @default(uuid()) @db.Uuid
  organizationId  String   @db.Uuid
  name            String
  createdByUserId String?  @db.Uuid
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  organization Organization              @relation(fields: [organizationId], references: [id])
  createdBy    User?                     @relation(fields: [createdByUserId], references: [id], onDelete: SetNull)
  members      CandidateListMembership[]

  @@unique([organizationId, name])
  @@index([organizationId])
}

model CandidateListMembership {
  listId        String   @db.Uuid
  candidateId   String   @db.Uuid
  addedByUserId String?  @db.Uuid
  createdAt     DateTime @default(now())

  list      CandidateList @relation(fields: [listId], references: [id], onDelete: Cascade)
  candidate Candidate     @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  addedBy   User?         @relation(fields: [addedByUserId], references: [id], onDelete: SetNull)

  @@id([listId, candidateId])
  @@index([candidateId])
}
```

Aggiungere su `Candidate` la relazione `listMemberships CandidateListMembership[]`
e su `Organization`/`User` le relazioni inverse corrispondenti.

Note:
- `@@unique([organizationId, name])` impedisce liste omonime nella stessa org.
- Membership N-a-N con PK composta `[listId, candidateId]`.
- `onDelete: Cascade` su entrambe le FK: eliminare lista o candidato pulisce le
  membership. `addedByUserId` / `createdByUserId` con `SetNull` (l'utente può
  essere rimosso senza perdere la lista).

## 2. Migrazione DB & rimozione tag

Migrazione `add_candidate_lists_drop_tags`:
- Crea `CandidateList` + `CandidateListMembership`.
- Droppa la tabella `CandidateTag`.
- **Rimuovere i `DROP INDEX` spuri sugli indici HNSW pgvector** che `migrate dev`
  inietta sempre, prima di committare il file di migrazione (vedi nota progetto
  sul drift pgvector).

Codice da rimuovere/aggiornare (rimpiazzo pulito):
- `prisma/schema.prisma`: modello `CandidateTag` e relazioni collegate.
- `src/components/candidates/candidate-tags.tsx` → eliminato.
- `addTag` / `removeTag` in `src/app/(dashboard)/dashboard/candidates/[id]/actions.ts` → rimossi.
- Riferimenti ai tag in `candidate-profile.tsx`, export CSV/PDF, tipi/filtri → rimossi o sostituiti con le liste.

Procedura prod (da CLAUDE.md): `pg_dump` di backup → `prisma migrate deploy` su
prod **prima** del merge → verifica `migrate status` → merge.

## 3. Server actions & controllo accessi

Nuovo file `src/app/(dashboard)/dashboard/lists/actions.ts`. Tutte le azioni:
- recuperano `organizationId` dalla sessione e filtrano sempre per esso;
- validano l'input con Zod;
- scrivono un audit log;
- chiamano `revalidatePath` sui percorsi interessati.

Azioni:
- `createList(name)` — gestisce il vincolo unico con messaggio "Lista già esistente".
- `renameList(listId, name)` — scoped sull'org.
- `deleteList(listId)` — cascade sulle membership.
- `addCandidateToList(listId, candidateId)` — verifica che la lista appartenga
  all'org e che il candidato sia accessibile (riuso del pattern
  `requireCandidateAccess` + `getOrgAccessiblePoolIds`).
- `removeCandidateFromList(listId, candidateId)`.

Audit: `list.create`, `list.rename`, `list.delete`, `list.member.add`,
`list.member.remove`. `ADMIN_KUBRI` segue il ramo accesso-globale già esistente.

## 4. Export

**Colonna "Liste" nell'export esistente:**
- Aggiungere `"Liste"` agli `HEADERS` di `candidatesToCsv` (`src/lib/export/csv.ts`),
  valorizzata coi nomi delle liste del candidato separati da `;`.
- Il set esportato deve portare con sé le membership (estensione del tipo passato
  all'export o join `listId→name` sugli id esportati), coerente coi filtri attivi.
- Nel PDF del singolo candidato (`src/app/api/candidates/[id]/export/pdf/route.ts`)
  sostituire la sezione tag con una sezione "Liste".

**Nuovo export CSV per lista:**
- Route `GET /api/candidates/lists/[listId]/export/csv`: esporta i candidati della
  lista, scoped sull'org e filtrati sui pool accessibili. Riusa `candidatesToCsv`.
- Filename `lista-<nome-slug>-<data>.csv`.
- Audit `export.csv` con `resourceType: "candidate_list"`, `resourceId: listId`.
- **Solo CSV** (nessun PDF di lista).

## 5. UI, navigazione e data flow

**`AddToListMenu`** (`src/components/lists/add-to-list-menu.tsx`, client component):
- Dropdown con elenco liste dell'org + checkbox per toggle membership
  (`addCandidateToList`/`removeCandidateFromList`), e voce "+ Crea nuova lista"
  con input inline (`createList` poi aggancio immediato del candidato).
- Props: `candidateId`, elenco liste dell'org, id delle liste già contenenti il candidato.
- Usato identico in: riga `candidates-table.tsx`, riga `match-table.tsx`,
  scheda `candidate-profile.tsx` (al posto dell'ex riquadro Tag).

**Sezione "Liste":**
- Voce "Liste" in `app-sidebar.tsx` (`mainItems`, icona `ListChecks`).
- `src/app/(dashboard)/dashboard/lists/page.tsx` — elenco liste con conteggio
  candidati + azioni crea/rinomina/elimina.
- `src/app/(dashboard)/dashboard/lists/[id]/page.tsx` — drill-down: riusa
  `CandidatesTable` filtrata sui membri, con bottone "Esporta CSV".

**Filtro "lista" nella pagina candidati:**
- Selettore lista in `candidate-filters.tsx` (param URL `listId`), gestito
  server-side in `candidates/page.tsx` restringendo ai membri della lista.

**Data flow:** Server Components caricano liste/membership via Prisma scoped per
org; mutazioni via server action + `revalidatePath`. Nessun `useEffect` per fetch.

**i18n:** nuove stringhe in `src/lib/i18n/strings.ts` (`nav.lists`, label varie).
UI in italiano.

## Fuori scope (YAGNI)

- Selezione multipla / azioni bulk sulle righe.
- Liste private per utente o flag pubblico/privato.
- PDF di lista (multi-candidato).
- Ordinamento manuale dei candidati dentro una lista.
- Condivisione liste tra organizzazioni diverse.
