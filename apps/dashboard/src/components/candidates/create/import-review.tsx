"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Sparkles } from "lucide-react";
import type { CandidateDraft } from "@kubri/contracts";
import { emptyCandidateDraftFields } from "@kubri/contracts";
import { LoadingButton } from "@/components/shared/loading-button";
import { useProgressTransition } from "@/components/layout/route-progress";
import { useT } from "@/lib/i18n/provider";
import {
  confirmCandidateImportAction,
  discardCandidateImportAction,
} from "@/app/(dashboard)/dashboard/candidates/new/actions";
import { CandidateForm } from "./candidate-form";

interface ImportReviewProps {
  importId: string;
  poolId: string;
  mimeType: string;
  fileName: string;
  extractedText: string | null;
  /** null when the extraction failed and the operator fills in by hand. */
  draft: CandidateDraft | null;
  duplicates: { id: string; firstName: string | null; lastName: string | null }[];
}

export function ImportReview({
  importId, poolId, mimeType, fileName, extractedText, draft, duplicates,
}: ImportReviewProps) {
  const t = useT();
  const tc = t.candidateCreate;
  const router = useRouter();
  const [discarding, startDiscard] = useProgressTransition();
  const fileUrl = `/api/candidate-imports/${importId}/file`;

  const discard = () =>
    startDiscard(async () => {
      const res = await discardCandidateImportAction(importId);
      if (res.ok) router.push("/dashboard/candidates/new");
      else router.refresh();
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-2 lg:sticky lg:top-4 lg:self-start">
        <p className="truncate text-sm text-muted-foreground">{fileName}</p>
        {mimeType === "application/pdf" ? (
          <iframe src={fileUrl} title={fileName} className="h-[75vh] w-full rounded-md border" />
        ) : mimeType.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL behind a redirect
          <img src={fileUrl} alt={fileName} className="w-full rounded-md border" />
        ) : (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            {extractedText ? (
              <>
                <p className="text-xs text-muted-foreground">{tc.previewUnavailable}</p>
                <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-xs">{extractedText}</pre>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{tc.previewUnavailableNoText}</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {draft && (
          <div className="flex items-start gap-2 rounded-md bg-sky-50 p-3 text-sm text-sky-800">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {tc.extractedBanner}
          </div>
        )}
        {draft && !draft.isCv && (
          <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {tc.notCvWarning}
          </div>
        )}
        {duplicates.length > 0 && (
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            <p className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {tc.duplicateWarning}
            </p>
            <ul className="mt-1 list-disc pl-6">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <Link href={`/dashboard/candidates/${d.id}`} className="underline" target="_blank">
                    {[d.firstName, d.lastName].filter(Boolean).join(" ") || d.id}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <CandidateForm
          initialValues={draft?.fields ?? emptyCandidateDraftFields()}
          uncertain={draft?.uncertain ?? []}
          // The pool is fixed at upload time, so the selector stays hidden (one entry).
          pools={[{ id: poolId, name: "" }]}
          onSubmit={(_poolId, values) => confirmCandidateImportAction(importId, values)}
          onSuccess={(id) => router.push(`/dashboard/candidates/${id}`)}
          secondaryActions={
            <LoadingButton type="button" variant="outline" loading={discarding} onClick={discard}>
              {tc.discard}
            </LoadingButton>
          }
        />
      </div>
    </div>
  );
}
