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
import { useT } from "@/lib/i18n/provider";

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
  const t = useT();
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
            {t.members.remove}
          </button>
        }
      />
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t.members.removeMemberTitle}</DialogTitle>
          <DialogDescription>
            {t.members.removeMemberDescription
              .replace("{name}", memberName)
              .replace("{email}", memberEmail)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" disabled={isPending} />}
          >
            {t.common.cancel}
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? t.members.removing : t.members.remove}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
