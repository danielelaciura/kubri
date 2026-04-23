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
import { strings } from "@/lib/i18n/strings";
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
            {strings.members.invite}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.members.invite}</DialogTitle>
          <DialogDescription>
            {strings.members.inviteDescription}
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
              defaultValue="ORG_MEMBER"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="ORG_MEMBER">{strings.roles.ORG_MEMBER}</option>
              <option value="ORG_ADMIN">{strings.roles.ORG_ADMIN}</option>
            </select>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              {strings.common.cancel}
            </DialogClose>
            <Button type="submit">{strings.members.invite}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
