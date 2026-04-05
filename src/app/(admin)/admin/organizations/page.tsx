import { strings } from "@/lib/i18n/strings";

export default function OrganizationsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        {strings.pages.organizations}
      </h1>
      <p className="mt-2 text-muted-foreground">
        Elenco delle organizzazioni registrate sulla piattaforma.
      </p>
    </div>
  );
}
