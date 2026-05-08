"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { acceptTermsAction, logoutAction } from "@/lib/auth-actions";
import { TERMS_URL, PRIVACY_URL } from "@/lib/terms/text";
import { ExternalLink } from "lucide-react";

type DocumentCardProps = {
  title: string;
  description: string;
  href: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
};

function DocumentCard({
  title,
  description,
  href,
  checked,
  onCheckedChange,
}: DocumentCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{title}</div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          Apri
          <ExternalLink className="size-3.5" />
        </a>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="size-4 rounded border-input accent-primary"
        />
        Ho letto e accetto
      </label>
    </div>
  );
}

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
          <DialogTitle>Termini e Condizioni / Privacy Policy</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Per accedere alla piattaforma è necessario leggere e accettare
          entrambi i documenti.
        </p>
        <div className="space-y-3 py-2">
          <DocumentCard
            title="Termini e Condizioni"
            description="Le regole d'uso della piattaforma Kubri."
            href={TERMS_URL}
            checked={termsAccepted}
            onCheckedChange={setTermsAccepted}
          />
          <DocumentCard
            title="Privacy Policy"
            description="Come trattiamo i tuoi dati personali."
            href={PRIVACY_URL}
            checked={privacyAccepted}
            onCheckedChange={setPrivacyAccepted}
          />
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
