import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getCandidatesForOrg, invalidateOrgCache } from "@/lib/make/service";
import { filterCandidates, sortCandidates, paginateCandidates } from "@/lib/candidates/filter";
import { candidateFiltersSchema, toFiltersAndSort } from "@/lib/validations/candidate-filters";
import { CandidatesTable } from "@/components/candidates/candidates-table";
import { CandidateFilters } from "@/components/candidates/candidate-filters";
import { Button } from "@/components/ui/button";
import { strings } from "@/lib/i18n/strings";
import { RefreshCw, Users, AlertCircle } from "lucide-react";
import { revalidatePath } from "next/cache";

interface CandidatesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CandidatesPage({ searchParams }: CandidatesPageProps) {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");

  const rawParams = await searchParams;
  // Flatten array values to strings for Zod parsing
  const flatParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === "string") flatParams[key] = value;
    else if (Array.isArray(value) && value[0]) flatParams[key] = value[0];
  }

  const parsed = candidateFiltersSchema.safeParse(flatParams);
  const { filters, sort, page, pageSize } = parsed.success
    ? toFiltersAndSort(parsed.data)
    : toFiltersAndSort({ page: 1, pageSize: 25 });

  let errorMessage: string | null = null;
  let candidates: Awaited<ReturnType<typeof getCandidatesForOrg>> = [];

  try {
    candidates = await getCandidatesForOrg(session.user.organizationId);
  } catch {
    errorMessage = "Errore nel caricamento dei dati. Riprova più tardi.";
  }

  const filtered = filterCandidates(candidates, filters);
  const sorted = sortCandidates(filtered, sort);
  const result = paginateCandidates(sorted, page, pageSize);

  async function refreshCandidates() {
    "use server";
    const s = await auth();
    if (s?.user?.organizationId) {
      await invalidateOrgCache(s.user.organizationId);
    }
    revalidatePath("/dashboard/candidates");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {strings.pages.candidates}
        </h1>
        <form action={refreshCandidates}>
          <Button variant="outline" size="sm" className="gap-2" type="submit">
            <RefreshCw className="h-4 w-4" />
            {strings.common.refresh}
          </Button>
        </form>
      </div>

      <CandidateFilters initialFilters={flatParams} />

      {errorMessage ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-destructive/50 p-12 text-center">
          <AlertCircle className="h-12 w-12 text-destructive/50" />
          <h2 className="mt-4 text-lg font-medium text-destructive">
            {errorMessage}
          </h2>
          <form action={refreshCandidates} className="mt-4">
            <Button variant="outline" type="submit">Riprova</Button>
          </form>
        </div>
      ) : result.total === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center">
          <Users className="h-12 w-12 text-muted-foreground/50" />
          <h2 className="mt-4 text-lg font-medium text-muted-foreground">
            Nessun candidato trovato
          </h2>
          <p className="mt-1 text-sm text-muted-foreground/75">
            {Object.keys(filters).length > 0
              ? "Prova a modificare i filtri di ricerca."
              : "I candidati appariranno qui quando il chatbot raccoglierà i profili."}
          </p>
        </div>
      ) : (
        <CandidatesTable result={result} sort={sort} />
      )}
    </div>
  );
}
