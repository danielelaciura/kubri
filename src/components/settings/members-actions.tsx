"use client";

import { useState } from "react";
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
import { useT } from "@/lib/i18n/provider";
import { UserPlus } from "lucide-react";

interface MembersActionsProps {
  inviteAction: (formData: FormData) => Promise<void>;
  removeAction: (formData: FormData) => Promise<void>;
  changeRoleAction: (formData: FormData) => Promise<void>;
  members: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
  }>;
  currentUserId: string;
}

export function MembersActions({ inviteAction }: MembersActionsProps) {
  const t = useT();
  const [open, setOpen] = useState(false);

  async function handleSubmit(formData: FormData) {
    await inviteAction(formData);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" className="gap-2">
            <UserPlus className="h-4 w-4" />
            {t.members.invite}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.members.invite}</DialogTitle>
          <DialogDescription>
            {t.members.inviteDescription}
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="invite-name" className="text-sm font-medium">
              {t.common.name}
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
              {t.common.email}
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
              {t.common.role}
            </label>
            <select
              id="invite-role"
              name="role"
              defaultValue="ORG_MEMBER"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="ORG_MEMBER">{t.roles.ORG_MEMBER}</option>
              <option value="ORG_ADMIN">{t.roles.ORG_ADMIN}</option>
            </select>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              {t.common.cancel}
            </DialogClose>
            <Button type="submit">{t.members.invite}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
