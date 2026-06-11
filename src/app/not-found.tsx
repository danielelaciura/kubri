import Link from "next/link";
// This component renders for unknown or unauthenticated routes, outside the
// user-scoped I18nProvider, so we use the default locale dictionary directly.
import { getDictionary, DEFAULT_LOCALE } from "@/lib/i18n";

export default function NotFound() {
  const t = getDictionary(DEFAULT_LOCALE);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-lg text-muted-foreground">{t.common.notFound}</p>
      <Link
        href="/dashboard"
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
      >
        {t.common.goBack}
      </Link>
    </div>
  );
}
