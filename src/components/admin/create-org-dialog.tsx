"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, X } from "lucide-react";

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

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="gap-2">
        <Plus className="h-4 w-4" />
        Nuova organizzazione
      </Button>
    );
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Nuova organizzazione</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Nome</label>
              <Input name="name" required placeholder="Nome organizzazione" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Slug</label>
              <Input name="slug" required placeholder="nome-org" pattern="[a-z0-9-]+" />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Make.com Data Store ID</label>
              <Input name="makeDatastoreId" required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Make.com API Token</label>
              <Input name="makeApiToken" type="password" required />
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="mb-3 text-sm font-medium">Amministratore iniziale</p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Nome</label>
                <Input name="adminName" required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Email</label>
                <Input name="adminEmail" type="email" required />
              </div>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Creazione..." : "Crea organizzazione"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annulla
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
