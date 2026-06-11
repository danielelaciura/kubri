import { requireOrganization } from "@/lib/auth-utils";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Download } from "lucide-react";
import { getCandidatesForOrg } from "@/lib/candidates/service";
import {
  getListWithMemberIds,
  getListOptionsForOrg,
  getListIdsByCandidateForOrg,
} from "@/lib/lists/service";
import { sortCandidates, paginateCandidates } from "@/lib/candidates/filter";
import { CandidatesTable } from "@/components/candidates/candidates-table";
import { Button } from "@/components/ui/button";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n";

export default async function ListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    redirect("/login");
  }
  const t = getDictionary(await getServerLocale());
  const { id } = await params;
  if (!user.organizationId) redirect("/login");

  const list = await getListWithMemberIds(user.organizationId, id);
  if (!list) notFound();

  const memberSet = new Set(list.candidateIds);
  const all = await getCandidatesForOrg(user.organizationId);
  const members = all.filter((c) => memberSet.has(c.id));

  const sort = { field: "createdAt" as const, direction: "desc" as const };
  const result = paginateCandidates(sortCandidates(members, sort), 1, 50);

  const lists = await getListOptionsForOrg(user.organizationId);
  const membershipByCandidate = await getListIdsByCandidateForOrg(
    user.organizationId,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/dashboard/lists"
            className="text-sm text-muted-foreground hover:underline"
          >
            {t.lists.backToLists}
          </Link>
          <h1 className="text-2xl tracking-tight">{list.name}</h1>
        </div>
        <a
          href={`/api/candidates/lists/${list.id}/export/csv`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            {t.candidates.exportCsv}
          </Button>
        </a>
      </div>

      {result.total === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t.lists.emptyDetail}
        </p>
      ) : (
        <CandidatesTable
          result={result}
          sort={sort}
          lists={lists}
          membershipByCandidate={membershipByCandidate}
        />
      )}
    </div>
  );
}
