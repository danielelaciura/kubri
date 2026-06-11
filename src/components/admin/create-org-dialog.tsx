"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
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

interface CreateOrgDialogProps {
  action: (formData: FormData) => Promise<void>;
}

export function CreateOrgDialog({ action }: CreateOrgDialogProps) {
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
      setError(e instanceof Error ? e.message : "Errore nella creazione");
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
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Nuova organizzazione
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuova organizzazione</DialogTitle>
          <DialogDescription>
            Crea un&apos;organizzazione. Potrai invitare gli utenti in un secondo
            momento dalla pagina dell&apos;organizzazione.
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="org-name" className="text-sm font-medium">
                Nome
              </label>
              <Input
                id="org-name"
                name="name"
                required
                placeholder="Nome organizzazione"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="org-slug" className="text-sm font-medium">
                Slug
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
                  Annulla
                </Button>
              }
            />
            <Button type="submit" disabled={pending}>
              {pending ? "Creazione..." : "Crea organizzazione"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
