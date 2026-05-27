# Delete Member — Design Spec

**Date:** 2026-05-27  
**Status:** Approved

---

## Problema

La funzione di rimozione utenti è parzialmente implementata:

- `/dashboard/users`: server action `removeMember` e bottone "Rimuovi" già esistono, ma il click cancella l'utente **immediatamente senza conferma**. Azione irreversibile senza avviso.
- `/admin/organizations/[id]`: nessuna possibilità di rimuovere un utente.

---

## Scope

1. Componente `DeleteMemberButton` — dialog di conferma riusabile
2. Update `MemberRowActions` — integrare `DeleteMemberButton` al posto del form nudo
3. Admin panel — server action `removeOrgMember` + `DeleteMemberButton` in tabella

---

## Componenti

### `src/components/settings/delete-member-button.tsx`

Client Component. Props:

```ts
interface Props {
  memberId: string;
  memberName: string;
  memberEmail: string;
  removeAction: (formData: FormData) => Promise<void>;
}
```

Comportamento:
- Bottone "Rimuovi" (variante destructive/ghost) apre un `AlertDialog` shadcn/ui
- Il dialog mostra nome e email dell'utente da rimuovere e un avviso di irreversibilità
- "Annulla" chiude il dialog senza azioni
- "Rimuovi" sottomette un `FormData` con `userId = memberId` alla `removeAction`
- Mentre l'azione è in esecuzione (`useTransition`), i pulsanti sono disabilitati

### `src/components/settings/member-row-actions.tsx` (update)

Aggiungere props `memberName: string` e `memberEmail: string`.  
Sostituire il blocco `<form action={removeAction}>…</form>` con `<DeleteMemberButton>`.

Tutti i caller esistenti (`/dashboard/users/page.tsx`) passano già l'oggetto `member` — aggiungere `memberName={member.name}` e `memberEmail={member.email}`.

### `/admin/organizations/[id]/page.tsx` (update)

**Server action `removeOrgMember`:**
- Verifica che il chiamante sia `ADMIN_KUBRI`
- Valida `userId` con `removeMemberSchema`
- `prisma.user.findFirst({ where: { id, organizationId: id } })` — scoped all'org
- `admin.auth.admin.deleteUser(target.id)`
- `logAudit` con `action: "remove_member"`
- `revalidatePath`

**UI:** Aggiungere `<DeleteMemberButton>` nella colonna "Azioni" della tabella membri, affianco all'eventuale "Reinvia invito".

---

## Sicurezza

- La server action in dashboard verifica che il target appartenga all'`organizationId` dell'utente autenticato (già presente).
- La server action in admin verifica `role === ADMIN_KUBRI` (già pattern esistente).
- Non è possibile rimuovere se stessi (check `parsed.data.userId === me.id` già presente in dashboard; da aggiungere in admin).
- Nessun endpoint lato client — tutto passa da Server Actions.

---

## Cosa NON cambia

- Schema Prisma: invariato. Il trigger Supabase che sincronizza `auth.users` → `public.User` gestisce la cancellazione in cascade.
- Nessuna migration DB.
- `/auth/callback` e il flusso di invito: invariati.

---

## File coinvolti

| File | Tipo |
|---|---|
| `src/components/settings/delete-member-button.tsx` | Nuovo |
| `src/components/settings/member-row-actions.tsx` | Update |
| `src/app/(dashboard)/dashboard/users/page.tsx` | Update (props a MemberRowActions) |
| `src/app/(admin)/admin/organizations/[id]/page.tsx` | Update (action + UI) |
