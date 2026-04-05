import { Users } from "lucide-react";
import { strings } from "@/lib/i18n/strings";

export default function CandidatesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        {strings.pages.candidates}
      </h1>
      <div className="mt-8 flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center">
        <Users className="h-12 w-12 text-muted-foreground/50" />
        <h2 className="mt-4 text-lg font-medium text-muted-foreground">
          Nessun candidato ancora
        </h2>
        <p className="mt-1 text-sm text-muted-foreground/75">
          I candidati appariranno qui quando il chatbot raccoglierà i profili.
        </p>
      </div>
    </div>
  );
}
