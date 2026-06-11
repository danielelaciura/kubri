"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
// This component is a global error boundary and renders outside the user-scoped
// I18nProvider, so we use the default locale dictionary directly.
import { getDictionary, DEFAULT_LOCALE } from "@/lib/i18n";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = getDictionary(DEFAULT_LOCALE);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl">{t.common.error}</h1>
      <p className="text-muted-foreground">{t.common.errorMessage}</p>
      <Button onClick={reset}>{t.common.retry}</Button>
    </div>
  );
}
