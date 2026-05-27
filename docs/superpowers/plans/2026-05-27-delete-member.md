# Delete Member Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere una dialog di conferma prima della rimozione di un utente e abilitare la cancellazione anche nel pannello admin.

**Architecture:** Nuovo Client Component `DeleteMemberButton` che avvolge il `Dialog` esistente (Base UI). Sostituisce il form nudo in `MemberRowActions`. Aggiunta di server action `removeOrgMember` e relativa UI nel pannello admin.

**Tech Stack:** Next.js App Router, Server Actions, Prisma, Supabase Auth Admin, Base UI Dialog, TypeScript strict

---

## File Map

| File | Operazione |
|---|---|
| `src/components/settings/delete-member-button.tsx` | **Crea** — dialog di conferma riusabile |
| `src/components/settings/member-row-actions.tsx` | **Modifica** — aggiunge props name/email, usa DeleteMemberButton |
| `src/app/(dashboard)/dashboard/users/page.tsx` | **Modifica** — passa memberName e memberEmail a MemberRowActions |
| `src/app/(admin)/admin/organizations/[id]/page.tsx` | **Modifica** — server action removeOrgMember + DeleteMemberButton in tabella |

---

## Task 1: Creare `DeleteMemberButton`

**Files:**
- Create: `src/components/settings/delete-member-button.tsx`

- [ ] **Step 1: Creare il file con il componente**

```tsx
// src/components/settings/delete-member-button.tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";

interface Props {
  memberId: string;
  memberName: string;
  memberEmail: string;
  removeAction: (formData: FormData) => Promise<void>;
}

export function DeleteMemberButton({
  memberId,
  memberName,
  memberEmail,
  removeAction,
}: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    const fd = new FormData();
    fd.append("userId", memberId);
    startTransition(async () => {
      await removeAction(fd);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button className="rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10">
            Rimuovi
          </button>
        }
      />
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Rimuovere il membro?</DialogTitle>
          <DialogDescription>
            Stai per rimuovere <strong>{memberName}</strong> ({memberEmail})
            dall&apos;organizzazione. Questa azione è irreversibile: l&apos;utente
            dovrà essere reinvitato per riacquisire l&apos;accesso.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" disabled={isPending} />}
          >
            Annulla
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? "Rimozione..." : "Rimuovi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verificare che TypeScript compili senza errori**

```bash
pnpm tsc --noEmit 2>&1 | grep "delete-member-button"
```

Expected: nessun output (nessun errore su questo file).

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/delete-member-button.tsx
git commit -m "feat: add DeleteMemberButton with confirmation dialog"
```

---

## Task 2: Aggiornare `MemberRowActions`

**Files:**
- Modify: `src/components/settings/member-row-actions.tsx`

- [ ] **Step 1: Aggiungere le props `memberName` e `memberEmail` e usare `DeleteMemberButton`**

Sostituire l'intero contenuto del file con:

```tsx
// src/components/settings/member-row-actions.tsx
"use client";

import { useTransition } from "react";
import type { Role } from "@/generated/prisma/client";
import { strings } from "@/lib/i18n/strings";
import { DeleteMemberButton } from "@/components/settings/delete-member-button";

interface Props {
  memberId: string;
  memberName: string;
  memberEmail: string;
  memberRole: Role;
  isPending: boolean;
  removeAction: (formData: FormData) => Promise<void>;
  changeRoleAction: (formData: FormData) => Promise<void>;
  resendInviteAction: (formData: FormData) => Promise<void>;
}

export function MemberRowActions({
  memberId,
  memberName,
  memberEmail,
  memberRole,
  isPending,
  removeAction,
  changeRoleAction,
  resendInviteAction,
}: Props) {
  const [transitionPending, startTransition] = useTransition();
  const newRole = memberRole === ("ORG_ADMIN" as Role) ? "ORG_MEMBER" : "ORG_ADMIN";
  const newRoleLabel =
    memberRole === ("ORG_ADMIN" as Role)
      ? strings.roles.ORG_MEMBER
      : strings.roles.ORG_ADMIN;

  return (
    <div className="flex items-center justify-end gap-1">
      {isPending && (
        <form action={resendInviteAction}>
          <input type="hidden" name="userId" value={memberId} />
          <button
            type="submit"
            disabled={transitionPending}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {strings.members.resendInvite}
          </button>
        </form>
      )}
      {memberRole !== ("ADMIN_KUBRI" as Role) && (
        <form action={(fd) => startTransition(() => changeRoleAction(fd))}>
          <input type="hidden" name="userId" value={memberId} />
          <input type="hidden" name="role" value={newRole} />
          <button
            type="submit"
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {newRoleLabel}
          </button>
        </form>
      )}
      <DeleteMemberButton
        memberId={memberId}
        memberName={memberName}
        memberEmail={memberEmail}
        removeAction={removeAction}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verificare TypeScript**

```bash
pnpm tsc --noEmit 2>&1 | grep "member-row-actions"
```

Expected: errori su `users/page.tsx` per le props mancanti (normale, si risolve al task successivo). Nessun errore su `member-row-actions.tsx` stesso.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/member-row-actions.tsx
git commit -m "feat: wire DeleteMemberButton into MemberRowActions"
```

---

## Task 3: Aggiornare `/dashboard/users/page.tsx`

**Files:**
- Modify: `src/app/(dashboard)/dashboard/users/page.tsx`

Il chiamante di `MemberRowActions` nel JSX non passa `memberName` e `memberEmail`. Va aggiornato.

- [ ] **Step 1: Trovare il blocco JSX che renderizza `MemberRowActions` nella tabella**

Il blocco è intorno alla riga 338 del file originale:

```tsx
<MemberRowActions
  memberId={member.id}
  memberRole={member.role}
  isPending={member.isPending}
  removeAction={removeMember}
  changeRoleAction={changeRole}
  resendInviteAction={resendInvite}
/>
```

- [ ] **Step 2: Aggiungere le due nuove props**

Sostituire il blocco con:

```tsx
<MemberRowActions
  memberId={member.id}
  memberName={member.name}
  memberEmail={member.email}
  memberRole={member.role}
  isPending={member.isPending}
  removeAction={removeMember}
  changeRoleAction={changeRole}
  resendInviteAction={resendInvite}
/>
```

- [ ] **Step 3: Verificare TypeScript**

```bash
pnpm tsc --noEmit 2>&1 | grep -E "users/page|MemberRowActions"
```

Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/dashboard/users/page.tsx"
git commit -m "fix: pass memberName and memberEmail to MemberRowActions"
```

---

## Task 4: Admin panel — server action `removeOrgMember`

**Files:**
- Modify: `src/app/(admin)/admin/organizations/[id]/page.tsx`

- [ ] **Step 1: Aggiungere `removeMemberSchema` agli import delle validazioni**

Trovare la riga degli import da `@/lib/validations/organization` (circa riga 10):

```ts
import {
  updateOrgSettingsSchema,
  inviteMemberSchema,
  resendInviteSchema,
} from "@/lib/validations/organization";
```

Sostituire con:

```ts
import {
  updateOrgSettingsSchema,
  inviteMemberSchema,
  resendInviteSchema,
  removeMemberSchema,
} from "@/lib/validations/organization";
```

- [ ] **Step 2: Aggiungere la server action `removeOrgMember` dopo `inviteOrgMember`**

Incollare questo blocco subito prima del `return (` finale della funzione `OrgDetailPage`:

```ts
async function removeOrgMember(formData: FormData) {
  "use server";
  const s = await getCurrentUser();
  if (s.role !== Role.ADMIN_KUBRI) {
    throw new Error("Permessi insufficienti");
  }

  const parsed = removeMemberSchema.safeParse({
    userId: formData.get("userId"),
  });
  if (!parsed.success) throw new Error("Dati non validi");
  if (parsed.data.userId === s.id) {
    throw new Error("Non puoi rimuovere te stesso");
  }

  const target = await prisma.user.findFirst({
    where: { id: parsed.data.userId, organizationId: id },
    select: { id: true, email: true },
  });
  if (!target) throw new Error("Utente non trovato");

  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.deleteUser(target.id);
  if (error) throw new Error(error.message);

  await logAudit({
    userId: s.id,
    organizationId: id,
    action: "remove_member",
    resourceType: "User",
    resourceId: target.id,
    metadata: { email: target.email },
  });

  revalidatePath(`/admin/organizations/${id}`);
}
```

- [ ] **Step 3: Verificare TypeScript**

```bash
pnpm tsc --noEmit 2>&1 | grep "organizations/\[id\]"
```

Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/organizations/[id]/page.tsx"
git commit -m "feat: add removeOrgMember server action to admin org page"
```

---

## Task 5: Admin panel — UI per la rimozione

**Files:**
- Modify: `src/app/(admin)/admin/organizations/[id]/page.tsx`

- [ ] **Step 1: Aggiungere l'import di `DeleteMemberButton`**

Trovare il blocco degli import dei componenti (intorno alla riga 16):

```ts
import { InviteOrgMemberDialog } from "@/components/admin/invite-org-member-dialog";
```

Aggiungere dopo:

```ts
import { DeleteMemberButton } from "@/components/settings/delete-member-button";
```

- [ ] **Step 2: Aggiornare la colonna "Azioni" nella tabella membri**

Trovare il blocco della cella Azioni (intorno alla riga 381):

```tsx
<TableCell className="text-right">
  {user.isPending && (
    <form action={resendInvite} className="inline">
      <input type="hidden" name="userId" value={user.id} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="text-xs"
      >
        {strings.members.resendInvite}
      </Button>
    </form>
  )}
</TableCell>
```

Sostituire con:

```tsx
<TableCell className="text-right">
  <div className="flex items-center justify-end gap-1">
    {user.isPending && (
      <form action={resendInvite} className="inline">
        <input type="hidden" name="userId" value={user.id} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="text-xs"
        >
          {strings.members.resendInvite}
        </Button>
      </form>
    )}
    {user.role !== Role.ADMIN_KUBRI && (
      <DeleteMemberButton
        memberId={user.id}
        memberName={user.name}
        memberEmail={user.email}
        removeAction={removeOrgMember}
      />
    )}
  </div>
</TableCell>
```

- [ ] **Step 3: Verificare TypeScript completo**

```bash
pnpm tsc --noEmit 2>&1
```

Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/organizations/[id]/page.tsx"
git commit -m "feat: add remove member UI to admin org page"
```

---

## Task 6: Verifica build finale e PR

- [ ] **Step 1: Build di produzione**

```bash
pnpm build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` (il fallimento per `DATABASE_URL` durante page data collection è atteso nel worktree — l'importante è che TypeScript e Turbopack non riportino errori di compilazione).

- [ ] **Step 2: Creare PR**

```bash
git push origin claude/distracted-joliot-da606e
gh pr create \
  --base main \
  --title "feat: delete member with confirmation dialog (dashboard + admin)" \
  --body "..."
```
