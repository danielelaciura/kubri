import { requireOrganization } from "@/lib/auth-utils";
import { getCandidatesForOrg } from "@/lib/candidates/service";
import {
  getListWithMemberIds,
  getListNamesByCandidateForOrg,
} from "@/lib/lists/service";
import { candidatesToCsv } from "@/lib/export/csv";
import { logAudit } from "@/lib/audit";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  let session;
  try {
    session = await requireOrganization();
  } catch {
    return new Response("Non autorizzato", { status: 401 });
  }
  const locale = await getServerLocale();
  const dictionary = getDictionary(locale);
  const { organizationId } = session;
  const { listId } = await params;

  try {
    const list = await getListWithMemberIds(organizationId, listId);
    if (!list) return new Response("Lista non trovata", { status: 404 });

    const memberSet = new Set(list.candidateIds);
    const all = await getCandidatesForOrg(organizationId);
    const candidates = all.filter((c) => memberSet.has(c.id));

    const listNames = await getListNamesByCandidateForOrg(organizationId);
    const csv = candidatesToCsv(candidates, listNames, dictionary, locale);

    const slug = list.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const today = new Date().toISOString().slice(0, 10);

    await logAudit({
      userId: session.id,
      organizationId,
      action: "export.csv",
      resourceType: "candidate_list",
      resourceId: listId,
      metadata: { count: candidates.length },
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="lista-${slug || "candidati"}-${today}.csv"`,
      },
    });
  } catch {
    return new Response("Errore durante l'esportazione", { status: 500 });
  }
}
