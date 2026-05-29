import { requireOrganization } from "@/lib/auth-utils";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  getCandidateForOrg,
  getCandidateByIdUnscoped,
} from "@/lib/candidates/service";
import { CandidateProfile } from "@/components/candidates/candidate-profile";
import { CandidateNotes } from "@/components/candidates/candidate-notes";
import { CandidateTags } from "@/components/candidates/candidate-tags";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertCircle, FileDown } from "lucide-react";
import Link from "next/link";

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

  const { id } = await params;
  const rawSearchParams = await searchParams;
  const returnParams =
    typeof rawSearchParams["returnParams"] === "string"
      ? rawSearchParams["returnParams"]
      : "";

  // `id` is the Candidate UUID. Notes/tags FK directly to it.
  // ADMIN_KUBRI bypasses the pool scoping and sees notes/tags across orgs;
  // other roles are limited to candidates whose pool is attached to their org.
  const notesWhere = isKubriAdmin
    ? { candidateId: id }
    : { candidateId: id, organizationId };
  const tagsWhere = isKubriAdmin
    ? { candidateId: id }
    : { candidateId: id, organizationId };

  const [candidate, notes, tags] = await Promise.all([
    (isKubriAdmin
      ? getCandidateByIdUnscoped(id)
      : getCandidateForOrg(organizationId, id)
    ).catch(() => null),
    prisma.candidateNote.findMany({
      where: notesWhere,
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.candidateTag.findMany({
      where: tagsWhere,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const backUrl = `/dashboard/candidates${returnParams}`;

  if (!candidate) {
    return (
      <div className="space-y-6">
        <Link href={backUrl}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Torna alla lista
          </Button>
        </Link>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-destructive/50 p-12 text-center">
          <AlertCircle className="h-12 w-12 text-destructive/50" />
          <h2 className="mt-4 text-lg font-medium text-destructive">
            Candidato non trovato
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Il profilo richiesto non esiste o non è accessibile.
          </p>
        </div>
      </div>
    );
  }

  const formattedNotes = notes.map((n) => ({
    id: n.id,
    content: n.content,
    userName: n.user?.name ?? "Utente eliminato",
    createdAt: n.createdAt,
  }));

  const formattedTags = tags.map((t) => ({
    id: t.id,
    tag: t.tag,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href={backUrl}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Torna alla lista
          </Button>
        </Link>
        <a
          href={`/api/candidates/${id}/export/pdf`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline" size="sm" className="gap-2" type="button">
            <FileDown className="h-4 w-4" />
            Esporta PDF
          </Button>
        </a>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content: profile + transcript */}
        <div className="space-y-6 lg:col-span-2">
          <CandidateProfile candidate={candidate} />
        </div>

        {/* Sidebar: tags + notes */}
        <div className="space-y-6">
          <CandidateTags tags={formattedTags} candidateId={id} />
          <CandidateNotes notes={formattedNotes} candidateId={id} />
        </div>
      </div>
    </div>
  );
}
