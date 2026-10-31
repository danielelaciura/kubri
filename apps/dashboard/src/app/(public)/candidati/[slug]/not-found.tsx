import { getDictionary, DEFAULT_LOCALE } from "@/lib/i18n";

export default function LandingNotFound() {
  // Outside <I18nProvider> (public not-found boundary): use the default locale.
  const t = getDictionary(DEFAULT_LOCALE).landing;
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-xl font-semibold">{t.notFoundTitle}</h1>
      <p className="text-sm text-muted-foreground">{t.notFoundBody}</p>
    </main>
  );
}
