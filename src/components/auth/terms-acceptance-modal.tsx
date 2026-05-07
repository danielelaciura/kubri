"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { acceptTermsAction, logoutAction } from "@/lib/auth-actions";
import { TERMS_TEXT } from "@/lib/terms/text";

export function TermsAcceptanceModal() {
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, startAccept] = useTransition();
  const [isLoggingOut, startLogout] = useTransition();

  function onConfirm() {
    setError(null);
    startAccept(async () => {
      try {
        await acceptTermsAction();
      } catch {
        setError("Impossibile salvare l'accettazione. Riprova.");
      }
    });
  }

  function onLogout() {
    startLogout(async () => {
      await logoutAction();
    });
  }

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Termini e Condizioni</DialogTitle>
          <DialogDescription>
            Per accedere alla piattaforma è necessario accettare i Termini e
            Condizioni.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 overflow-y-auto rounded border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
          {TERMS_TEXT}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="size-4 rounded border-input accent-primary"
          />
          Ho letto e accetto i Termini e Condizioni
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onLogout}
            disabled={isLoggingOut || isAccepting}
          >
            {isLoggingOut ? "Esco..." : "Esci"}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={!accepted || isAccepting || isLoggingOut}
          >
            {isAccepting ? "Salvataggio..." : "Conferma"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
