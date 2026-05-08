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
import { TERMS_URL, PRIVACY_URL } from "@/lib/terms/text";

export function TermsAcceptanceModal() {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, startAccept] = useTransition();
  const [isLoggingOut, startLogout] = useTransition();

  const bothAccepted = termsAccepted && privacyAccepted;

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
            Condizioni e la Privacy Policy.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 size-4 rounded border-input accent-primary"
            />
            <span>
              Ho letto e accetto i{" "}
              <a
                href={TERMS_URL}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                Termini e Condizioni
              </a>
              .
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={privacyAccepted}
              onChange={(e) => setPrivacyAccepted(e.target.checked)}
              className="mt-0.5 size-4 rounded border-input accent-primary"
            />
            <span>
              Ho letto e accetto la{" "}
              <a
                href={PRIVACY_URL}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                Privacy Policy
              </a>
              .
            </span>
          </label>
        </div>
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
            disabled={!bothAccepted || isAccepting || isLoggingOut}
          >
            {isAccepting ? "Salvataggio..." : "Conferma"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
