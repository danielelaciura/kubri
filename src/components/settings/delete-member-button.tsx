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
