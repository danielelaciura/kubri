import { strings } from "@/lib/i18n/strings";

export default function MembersPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        {strings.pages.members}
      </h1>
      <p className="mt-2 text-muted-foreground">
        Gestisci i membri della tua organizzazione.
      </p>
    </div>
  );
}
