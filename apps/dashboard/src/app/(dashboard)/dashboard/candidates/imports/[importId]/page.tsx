import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { candidateDraftSchema } from "@kubri/contracts";
import { requireOrganization } from "@/lib/auth-utils";
import { getImportForOrg } from "@/lib/candidate-imports/service";
import { isImportErrorCode, RETRYABLE_IMPORT_ERRORS } from "@/lib/candidate-imports/errors";
import type { ImportErrorCode } from "@/lib/candidate-imports/errors";
import { findPossibleDuplicates } from "@/lib/candidates/duplicates";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";
import { Button } from "@/components/ui/button";
import { ExtractionRunner } from "@/components/candidates/create/extraction-runner";
import { ImportReview } from "@/components/candidates/create/import-review";
import { RetryExtractionButton } from "@/components/candidates/create/retry-extraction-button";

// Server actions invoked from this page (extraction: OCR + LLM) get 60 s.
export const maxDuration = 60;

// An import EXTRACTING for longer than this is treated as stuck (matches the
// re-claim threshold in runExtraction), so the operator can retry.
const STUCK_EXTRACTION_MS = 2 * 60 * 1000;

function isStuckExtraction(imp: { status: string; updatedAt: Date }): boolean {
  return imp.status === "EXTRACTING" && Date.now() - imp.updatedAt.getTime() > STUCK_EXTRACTION_MS;
}

interface ImportPageProps {
  params: Promise<{ importId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CandidateImportPage({ params, searchParams }: ImportPageProps) {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    redirect("/login");
  }
  const t = getDictionary(await getServerLocale());
  const tc = t.candidateCreate;
  const { importId } = await params;
  const manual = (await searchParams)["manual"] === "1";

  const imp = await getImportForOrg(importId, user.organizationId);
  if (!imp || imp.status === "DISCARDED") notFound();
  if (imp.status === "COMPLETED" && imp.candidateId) redirect(`/dashboard/candidates/${imp.candidateId}`);

  const header = (
    <div className="space-y-2">
      <Link href="/dashboard/candidates/new">
        <Button variant="ghost" size="sm" className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          {tc.newCandidate}
        </Button>
      </Link>
      <h1 className="text-2xl tracking-tight">{tc.reviewTitle}</h1>
    </div>
  );

  const stuck = isStuckExtraction(imp);

  if ((imp.status === "UPLOADED" || imp.status === "EXTRACTING") && !stuck) {
    return <div className="space-y-6">{header}<ExtractionRunner importId={imp.id} /></div>;
  }

  if ((imp.status === "FAILED" || stuck) && !manual) {
    const code: ImportErrorCode =
      !stuck && isImportErrorCode(imp.errorCode) ? imp.errorCode : "INTERNAL_ERROR";
    const retryable = RETRYABLE_IMPORT_ERRORS.includes(code);
    return (
      <div className="space-y-6">
        {header}
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-destructive/50 p-12 text-center">
          <AlertCircle className="h-10 w-10 text-destructive/60" aria-hidden="true" />
          <h2 className="text-lg font-medium">{tc.failedTitle}</h2>
          <p className="text-sm text-muted-foreground">{tc.errors[code]}</p>
          <div className="flex gap-2">
            {retryable && <RetryExtractionButton importId={imp.id} />}
            <Link href={`/dashboard/candidates/imports/${imp.id}?manual=1`}>
              <Button variant="outline">{tc.fillManually}</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // READY, or FAILED / stuck filled in by hand.
  const parsedDraft = imp.status === "READY" ? candidateDraftSchema.safeParse(imp.draft) : null;
  const draft = parsedDraft?.success ? parsedDraft.data : null;
  const duplicates = draft
    ? await findPossibleDuplicates(imp.poolId, { phone: draft.fields.phone, email: draft.fields.email })
    : [];

  return (
    <div className="space-y-6">
      {header}
      <ImportReview
        importId={imp.id}
        poolId={imp.poolId}
        mimeType={imp.mimeType}
        fileName={imp.fileName}
        extractedText={imp.extractedText}
        draft={draft}
        duplicates={duplicates}
      />
    </div>
  );
}
