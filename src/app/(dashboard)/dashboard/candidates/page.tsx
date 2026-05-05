import { getCurrentUser, requireOrganization } from "@/lib/auth-utils";
import { redirect } from "next/navigation";
import {
  getCandidatesForOrg,
  getCandidatesForPool,
  invalidateOrgCache,
} from "@/lib/make/service";
import { prisma } from "@/lib/db";
import { filterCandidates, sortCandidates, paginateCandidates } from "@/lib/candidates/filter";
import { candidateFiltersSchema, toFiltersAndSort } from "@/lib/validations/candidate-filters";
import { CandidatesTable } from "@/components/candidates/candidates-table";
import { CandidateFilters } from "@/components/candidates/candidate-filters";
import { AdminPoolSelector } from "@/components/candidates/admin-pool-selector";
import { Button } from "@/components/ui/button";
import { strings } from "@/lib/i18n/strings";
import { RefreshCw, Users, AlertCircle, Download } from "lucide-react";
import { revalidatePath } from "next/cache";

interface CandidatesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CandidatesPage({ searchParams }: CandidatesPageProps) {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    redirect("/login");
  }

  const rawParams = await searchParams;
  const flatParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === "string") flatParams[key] = value;
    else if (Array.isArray(value) && value[0]) flatParams[key] = value[0];
  }

  const parsed = candidateFiltersSchema.safeParse(flatParams);
  const { filters, sort, page, pageSize } = parsed.success
    ? toFiltersAndSort(parsed.data)
    : toFiltersAndSort({ page: 1, pageSize: 25 });

  // Admin-only pool switching: ADMIN_KUBRI defaults to the global pool but
  // can pick any pool via ?poolId=. Other roles use the org-scoped path.
  const isAdmin = user.role === "ADMIN_KUBRI";
  let adminPools: { id: string; name: string }[] = [];
  let activePoolId: string | undefined;

  if (isAdmin) {
    const allPools = await prisma.pool.findMany({
      orderBy: [{ isGlobal: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isGlobal: true },
    });
    adminPools = allPools.map((p) => ({ id: p.id, name: p.name }));

    const requested = flatParams["poolId"];
    const requestedPool = requested
      ? allPools.find((p) => p.id === requested)
      : undefined;
    const globalPool = allPools.find((p) => p.isGlobal) ?? allPools[0];
    activePoolId = requestedPool?.id ?? globalPool?.id;
  }

  let errorMessage: string | null = null;
  let candidates: Awaited<ReturnType<typeof getCandidatesForOrg>> = [];

  try {
    candidates =
      isAdmin && activePoolId
        ? await getCandidatesForPool(activePoolId)
        : await getCandidatesForOrg(user.organizationId);
  } catch {
    errorMessage = "Errore nel caricamento dei dati. Riprova più tardi.";
  }
  candidates = candidates.filter((c) => c.lastName.trim() !== "");

  const filtered = filterCandidates(candidates, filters);
  const sorted = sortCandidates(filtered, sort);
  const result = paginateCandidates(sorted, page, pageSize);

  async function refreshCandidates() {
    "use server";
    try {
      const s = await getCurrentUser();
      if (s.organizationId) {
        await invalidateOrgCache(s.organizationId);
      }
    } catch {
      // user not authenticated; nothing to invalidate
    }
    revalidatePath("/dashboard/candidates");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl tracking-tight">
          {strings.pages.candidates}
        </h1>
        <div className="flex items-center gap-2">
          {isAdmin && adminPools.length > 0 && (
            <AdminPoolSelector pools={adminPools} activePoolId={activePoolId} />
          )}
          <a
            href={`/api/candidates/export/csv?${new URLSearchParams(flatParams).toString()}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm" className="gap-2" type="button">
              <Download className="h-4 w-4" />
              Esporta CSV
            </Button>
          </a>
          <form action={refreshCandidates}>
            <Button variant="outline" size="sm" className="gap-2" type="submit">
              <RefreshCw className="h-4 w-4" />
              {strings.common.refresh}
            </Button>
          </form>
        </div>
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
