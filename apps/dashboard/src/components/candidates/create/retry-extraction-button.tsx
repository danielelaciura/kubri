"use client";

import { useRouter } from "next/navigation";
import { LoadingButton } from "@/components/shared/loading-button";
import { useProgressTransition } from "@/components/layout/route-progress";
import { useT } from "@/lib/i18n/provider";
import { runCandidateImportExtractionAction } from "@/app/(dashboard)/dashboard/candidates/new/actions";

export function RetryExtractionButton({ importId }: { importId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useProgressTransition();
  return (
    <LoadingButton
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          await runCandidateImportExtractionAction(importId);
          router.refresh();
        })
      }
    >
      {t.candidateCreate.retry}
    </LoadingButton>
  );
}
