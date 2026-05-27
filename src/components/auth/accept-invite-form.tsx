"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function AcceptInviteForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const code = searchParams.get("code");

  async function handleAccept() {
    if (!code) {
      setError("Link di invito non valido o già utilizzato. Chiedi un nuovo invito.");
      return;
    }

    setIsLoading(true);
    setError("");

    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.exchangeCodeForSession(code);

    if (authError) {
      setError(
        "Il link di invito è scaduto o già utilizzato. Contatta il tuo amministratore per ricevere un nuovo invito."
      );
      setIsLoading(false);
      return;
    }

    router.push("/auth/set-password");
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Benvenuto su Kubri</CardTitle>
        <CardDescription>
          Sei stato invitato ad accedere alla piattaforma. Clicca il pulsante per
          accettare l&apos;invito e impostare la tua password.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <Button
          onClick={handleAccept}
          disabled={isLoading || !code}
          className="w-full"
        >
          {isLoading ? "Verifica in corso..." : "Accetta invito"}
        </Button>
      </CardContent>
    </Card>
  );
}
