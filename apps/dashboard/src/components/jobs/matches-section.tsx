"use client";

import { useTransition, type ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { MatchesLoading } from "@/components/jobs/matches-loading";
import { refreshCandidatesForJob } from "@/app/(dashboard)/dashboard/jobs/[id]/actions";

interface MatchesSectionProps {
  /** JD whose matches are recalculated by the refresh button. */
  jdId: string;
  /** Server-rendered matches (inside their own Suspense boundary). */
  children: ReactNode;
}

/**
 * Header + results of the matching. While a recalculation is running the
 * (stale) results are replaced by the loading state, since a server action
 * re-render does not show the Suspense fallback again.
 */
export function MatchesSection({ jdId, children }: MatchesSectionProps) {
  const t = useT();
  const [isPending, startTransition] = useTransition();

  const refresh = () => {
    startTransition(async () => {
      await refreshCandidatesForJob(jdId);
    });
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg ">{t.jobs.matchHeading}</h2>
        <Button
          variant="outline"
          size="sm"
          type="button"
          className="gap-1"
          disabled={isPending}
          onClick={refresh}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {isPending ? t.jobs.refreshingMatches : t.jobs.refreshMatches}
        </Button>
      </div>

      {isPending ? (
        <MatchesLoading
          title={t.jobs.matchCalculating}
          hint={t.jobs.matchCalculatingHint}
        />
      ) : (
        children
      )}
    </>
  );
}
