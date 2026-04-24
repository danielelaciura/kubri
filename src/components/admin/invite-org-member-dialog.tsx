"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { strings } from "@/lib/i18n/strings";

interface InviteOrgMemberDialogProps {
  action: (formData: FormData) => Promise<void>;
}

export function InviteOrgMemberDialog({ action }: InviteOrgMemberDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      await action(formData);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore nell'invito");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" className="gap-2">
            <UserPlus className="h-4 w-4" />
            {strings.members.invite}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.members.invite}</DialogTitle>
          <DialogDescription>
            Invita un nuovo membro a questa organizzazione.
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="invite-name" className="text-sm font-medium">
              {strings.common.name}
            </label>
            <Input
              id="invite-name"
              name="name"
              required
              placeholder="Mario Rossi"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="invite-email" className="text-sm font-medium">
              {strings.common.email}
            </label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              required
              placeholder="mario@esempio.it"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="invite-role" className="text-sm font-medium">
              {strings.common.role}
            </label>
            <select
              id="invite-role"
              name="role"
              required
              defaultValue="ORG_MEMBER"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="ORG_MEMBER">{strings.roles.ORG_MEMBER}</option>
              <option value="ORG_ADMIN">{strings.roles.ORG_ADMIN}</option>
            </select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  {strings.common.cancel}
                </Button>
              }
            />
            <Button type="submit" disabled={pending}>
              {pending ? "Invio..." : strings.members.invite}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
