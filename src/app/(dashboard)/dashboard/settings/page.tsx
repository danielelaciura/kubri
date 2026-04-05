import { strings } from "@/lib/i18n/strings";

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        {strings.pages.settings}
      </h1>
      <p className="mt-2 text-muted-foreground">
        Gestisci le impostazioni della tua organizzazione.
      </p>
    </div>
  );
}
