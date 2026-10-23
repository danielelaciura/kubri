"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { usePendingProgress } from "@/components/layout/route-progress";
import { useT } from "@/lib/i18n/provider";
import { runCandidateImportExtractionAction } from "@/app/(dashboard)/dashboard/candidates/new/actions";

const POLL_MS = 4000;

/**
 * Kicks off extraction for an UPLOADED/EXTRACTING import and refreshes the
 * page when it settles. This is a mutation trigger, not data fetching: the
 * page itself reads the result server-side after router.refresh().
 * The server claims the import atomically, so StrictMode's double effect or a
 * second tab cannot run two extractions.
 */
export function ExtractionRunner({ importId }: { importId: string }) {
  const t = useT();
  const tc = t.candidateCreate;
  const router = useRouter();
  const started = useRef(false);
  usePendingProgress(true);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runCandidateImportExtractionAction(importId)
      .catch(() => {})
      .finally(() => router.refresh());
  }, [importId, router]);

  // The action may no-op (another request holds the claim), so keep polling
  // until the page re-renders with a settled status and this unmounts.
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Skeleton className="h-[480px] w-full" />
      <div className="space-y-4">
        <div className="flex items-center gap-2 font-medium">
          <Spinner aria-hidden="true" />
          {tc.extractingTitle}
        </div>
        <ol className="space-y-1 text-sm text-muted-foreground">
          <li>1. {tc.extractingStepRead}</li>
          <li>2. {tc.extractingStepExtract}</li>
        </ol>
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    </div>
  );
}
