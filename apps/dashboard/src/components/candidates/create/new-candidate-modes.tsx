"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { emptyCandidateDraftFields } from "@kubri/contracts";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/provider";
import { createCandidateManuallyAction } from "@/app/(dashboard)/dashboard/candidates/new/actions";
import { CandidateForm, type PoolOption } from "./candidate-form";
import { CvUpload } from "./cv-upload";

export function NewCandidateModes({ mode, pools }: { mode: "upload" | "manual"; pools: PoolOption[] }) {
  const t = useT();
  const tc = t.candidateCreate;
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-md border border-border p-1" role="tablist">
        <Link href="/dashboard/candidates/new" role="tab" aria-selected={mode === "upload"}>
          <Button type="button" size="sm" variant={mode === "upload" ? "default" : "ghost"}>{tc.modeUpload}</Button>
        </Link>
        <Link href="/dashboard/candidates/new?mode=manual" role="tab" aria-selected={mode === "manual"}>
          <Button type="button" size="sm" variant={mode === "manual" ? "default" : "ghost"}>{tc.modeManual}</Button>
        </Link>
      </div>

      {mode === "upload" ? (
        <CvUpload pools={pools} />
      ) : (
        <CandidateForm
          initialValues={emptyCandidateDraftFields()}
          pools={pools}
          onSubmit={(poolId, values) => createCandidateManuallyAction(poolId, values)}
          onSuccess={(id) => router.push(`/dashboard/candidates/${id}`)}
        />
      )}
    </div>
  );
}
