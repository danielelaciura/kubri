import { requireOrganization } from "@/lib/auth-utils";
import { getCandidatesForOrg } from "@/lib/candidates/service";
import { filterCandidates, sortCandidates } from "@/lib/candidates/filter";
import { candidateFiltersSchema, toFiltersAndSort } from "@/lib/validations/candidate-filters";
import { candidatesToCsv } from "@/lib/export/csv";
import {
  getListNamesByCandidateForOrg,
  getMemberCandidateIdSet,
} from "@/lib/lists/service";
import { logAudit } from "@/lib/audit";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";

export async function GET(request: Request) {
  let session;
  try {
    session = await requireOrganization();
  } catch {
    return new Response("Non autorizzato", { status: 401 });
  }

  const locale = await getServerLocale();
  const dictionary = getDictionary(locale);
  const { organizationId } = session;
  const url = new URL(request.url);

  // Parse filter params from URL search params
  const rawParams: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    rawParams[key] = value;
  }

  const parsed = candidateFiltersSchema.safeParse(rawParams);
  const { filters, sort } = parsed.success
    ? toFiltersAndSort(parsed.data)
    : toFiltersAndSort({ page: 1, pageSize: 25 });

  try {
    let candidates = await getCandidatesForOrg(organizationId);
    if (filters.listId) {
      const memberSet = await getMemberCandidateIdSet(
        organizationId,
        filters.listId,
      );
      candidates = memberSet
        ? candidates.filter((c) => memberSet.has(c.id))
        : [];
    }
    const filtered = filterCandidates(candidates, filters);
    const sorted = sortCandidates(filtered, sort);

    const listNames = await getListNamesByCandidateForOrg(organizationId);
    const csv = candidatesToCsv(sorted, listNames, dictionary, locale);

    const today = new Date().toISOString().slice(0, 10);

    await logAudit({
      userId: session.id,
      organizationId,
      action: "export.csv",
      resourceType: "candidates",
      resourceId: organizationId,
      metadata: {
        count: sorted.length,
        filters: rawParams,
      },
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="candidati-${today}.csv"`,
      },
    });
  } catch {
    return new Response("Errore durante l'esportazione", { status: 500 });
  }
}
