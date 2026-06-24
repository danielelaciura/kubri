import { requireOrganization } from "@/lib/auth-utils";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  getCandidateForOrg,
  getCandidateByIdUnscoped,
} from "@/lib/candidates/service";
import { getListOptionsForOrg, getListIdsByCandidateForOrg } from "@/lib/lists/service";
import { CandidateProfile } from "@/components/candidates/candidate-profile";
import { CandidateNotes } from "@/components/candidates/candidate-notes";
import { AddToListMenu } from "@/components/lists/add-to-list-menu";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertCircle, FileDown } from "lucide-react";
import Link from "next/link";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n";

interface CandidateDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CandidateDetailPage({
  params,
  searchParams,
}: CandidateDetailPageProps) {
  let organizationId: string;
  let isKubriAdmin = false;
  try {
    const user = await requireOrganization();
    organizationId = user.organizationId;
    isKubriAdmin = user.role === "ADMIN_KUBRI";
  } catch {
    redirect("/login");
  }

  const t = getDictionary(await getServerLocale());

  const { id } = await params;
  const rawSearchParams = await searchParams;
  const returnParams =
    typeof rawSearchParams["returnParams"] === "string"
      ? rawSearchParams["returnParams"]
      : "";

  // `id` is the Candidate UUID. Notes FK directly to it.
  // ADMIN_KUBRI bypasses the pool scoping and sees notes across orgs;
  // other roles are limited to candidates whose pool is attached to their org.
  const notesWhere = isKubriAdmin
    ? { candidateId: id }
    : { candidateId: id, organizationId };

  const [candidate, notes, lists, membershipByCandidate] = await Promise.all([
    (isKubriAdmin
      ? getCandidateByIdUnscoped(id)
      : getCandidateForOrg(organizationId, id)
    ).catch(() => null),
    prisma.candidateNote.findMany({
      where: notesWhere,
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    getListOptionsForOrg(organizationId),
    getListIdsByCandidateForOrg(organizationId),
  ]);

  const memberOf = membershipByCandidate[id] ?? [];

  const backUrl = `/dashboard/candidates${returnParams}`;

  if (!candidate) {
    return (
      <div className="space-y-6">
        <Link href={backUrl}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            {t.candidates.backToList}
          </Button>
        </Link>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-destructive/50 p-12 text-center">
          <AlertCircle className="h-12 w-12 text-destructive/50" />
          <h2 className="mt-4 text-lg font-medium text-destructive">
            {t.candidates.notFoundTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.candidates.notFoundDescription}
          </p>
        </div>
      </div>
    );
  }

  const formattedNotes = notes.map((n) => ({
    id: n.id,
    content: n.content,
    userName: n.user?.name ?? t.candidates.deletedUser,
    createdAt: n.createdAt,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href={backUrl}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            {t.candidates.backToList}
          </Button>
        </Link>
        <a
          href={`/api/candidates/${id}/export/pdf`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline" size="sm" className="gap-2" type="button">
            <FileDown className="h-4 w-4" />
            {t.candidates.exportPdf}
          </Button>
        </a>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content: profile + transcript */}
        <div className="space-y-6 lg:col-span-2">
          <CandidateProfile candidate={candidate} />
        </div>

        {/* Sidebar: lists + notes */}
        <div className="space-y-6">
          <div className="rounded-lg border border-border/60 bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium">{t.candidates.listsSection}</span>
              <AddToListMenu
                candidateId={id}
                lists={lists}
                memberOf={memberOf}
                variant="button"
              />
            </div>
            {memberOf.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.candidates.notInAnyList}</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {lists
                  .filter((l) => memberOf.includes(l.id))
                  .map((l) => (
                    <span key={l.id} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {l.name}
                    </span>
                  ))}
              </div>
            )}
          </div>
          <CandidateNotes notes={formattedNotes} candidateId={id} />
        </div>
      </div>
    </div>
  );
}
