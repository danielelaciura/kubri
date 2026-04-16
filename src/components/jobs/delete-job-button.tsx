"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { strings } from "@/lib/i18n/strings";
import { deleteJobAction } from "@/app/(dashboard)/dashboard/jobs/[id]/actions";

export function DeleteJobButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onConfirm = () => {
    startTransition(async () => {
      await deleteJobAction(id);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
            <Trash2 className="mr-1 h-4 w-4" />
            {strings.jobs.deleteButton}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.jobs.deleteConfirmTitle}</DialogTitle>
          <DialogDescription>{strings.jobs.deleteConfirmBody}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {strings.common.cancel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {strings.jobs.deleteButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
