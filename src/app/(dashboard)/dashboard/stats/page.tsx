import { strings } from "@/lib/i18n/strings";

export default function StatsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        {strings.pages.stats}
      </h1>
      <p className="mt-2 text-muted-foreground">
        Le statistiche saranno disponibili a breve.
      </p>
    </div>
  );
}
