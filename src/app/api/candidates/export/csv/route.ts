import { requireOrganization } from "@/lib/auth-utils";
import { getCandidatesForOrg } from "@/lib/make/service";
import { filterCandidates, sortCandidates } from "@/lib/candidates/filter";
import { candidateFiltersSchema, toFiltersAndSort } from "@/lib/validations/candidate-filters";
import { candidatesToCsv } from "@/lib/export/csv";
import { logAudit } from "@/lib/audit";

export async function GET(request: Request) {
  let session;
  try {
    session = await requireOrganization();
  } catch {
    return new Response("Non autorizzato", { status: 401 });
  }

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
    const candidates = await getCandidatesForOrg(organizationId);
    const filtered = filterCandidates(candidates, filters);
    const sorted = sortCandidates(filtered, sort);

    const csv = candidatesToCsv(sorted);

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
