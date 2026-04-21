"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { strings } from "@/lib/i18n/strings";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl">{strings.common.error}</h1>
      <p className="text-muted-foreground">
        Si è verificato un errore. Riprova.
      </p>
      <Button onClick={reset}>Riprova</Button>
    </div>
  );
}
