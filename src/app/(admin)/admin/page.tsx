import { strings } from "@/lib/i18n/strings";

export default function AdminPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        {strings.pages.admin}
      </h1>
      <p className="mt-2 text-muted-foreground">
        Gestisci le organizzazioni e gli utenti della piattaforma.
      </p>
    </div>
  );
}
