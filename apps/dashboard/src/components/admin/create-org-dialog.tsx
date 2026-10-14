"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/shared/loading-button";
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

interface CreateOrgDialogProps {
  action: (formData: FormData) => Promise<void>;
}

export function CreateOrgDialog({ action }: CreateOrgDialogProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    try {
      await action(formData);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.organizations.createError);
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
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            {t.organizations.newOrg}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.organizations.newOrg}</DialogTitle>
          <DialogDescription>
            {t.organizations.createDialogDescription}
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="org-name" className="text-sm font-medium">
                {t.common.name}
              </label>
              <Input
                id="org-name"
                name="name"
                required
                placeholder={t.organizations.namePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="org-slug" className="text-sm font-medium">
                {t.organizations.slug}
              </label>
              <Input
                id="org-slug"
                name="slug"
                required
                placeholder="nome-org"
                pattern="[a-z0-9-]+"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  {t.common.cancel}
                </Button>
              }
            />
            <SubmitButton loadingText={t.organizations.creating}>
              {t.organizations.createOrg}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
