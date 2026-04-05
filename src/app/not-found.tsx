import Link from "next/link";
import { strings } from "@/lib/i18n/strings";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-lg text-muted-foreground">{strings.common.notFound}</p>
      <Link
        href="/dashboard"
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
      >
        {strings.common.goBack}
      </Link>
    </div>
  );
}
