import { Briefcase, Target, UserX } from "lucide-react";
import type { Dictionary, Locale } from "@/lib/i18n/types";
import { getJobsDashboardMetrics } from "@/lib/jobs/dashboard-metrics";
import { TARGET_MATCH_SCORE } from "@/lib/jobs/constants";
import { StatCard } from "@/components/stats/stat-card";
import { Skeleton } from "@/components/ui/skeleton";

interface JobsDashboardProps {
  organizationId: string;
  t: Dictionary;
  locale: Locale;
}

/** KPI cards above the analyses table. Rendered inside a Suspense boundary. */
export async function JobsDashboard({ organizationId, t, locale }: JobsDashboardProps) {
  let metrics;
  try {
    metrics = await getJobsDashboardMetrics(organizationId);
  } catch (e) {
    console.error("[jobs] dashboard metrics failed", e);
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {t.jobs.dashboard.loadError}
      </div>
    );
  }

  const fmt = new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-GB");
  const d = t.jobs.dashboard;
  // Right after release no JD has been recalculated yet: every candidate is
  // "never matched". Explain it instead of showing a bare zero.
  const notPopulated =
    metrics.activeJobs > 0 && metrics.neverMatchedCandidates === metrics.totalCandidates;

  return (
    <div className="space-y-2">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title={d.activeJobs}
          value={fmt.format(metrics.activeJobs)}
          description={d.activeJobsHint.replace("{count}", fmt.format(metrics.jobsLast30Days))}
          icon={Briefcase}
        />
        <StatCard
          title={d.targetCandidates}
          value={fmt.format(metrics.targetCandidates)}
          description={d.targetCandidatesHint.replace("{score}", String(TARGET_MATCH_SCORE))}
          icon={Target}
          iconClassName="bg-emerald-100 text-emerald-800"
        />
        <StatCard
          title={d.neverMatched}
          value={fmt.format(metrics.neverMatchedCandidates)}
          description={d.neverMatchedHint.replace("{total}", fmt.format(metrics.totalCandidates))}
          icon={UserX}
          iconClassName="bg-muted text-muted-foreground"
        />
      </div>
      {notPopulated && <p className="text-xs text-muted-foreground">{d.notPopulated}</p>}
    </div>
  );
}

/** Suspense fallback matching the three-card layout. */
export function JobsDashboardSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[118px] rounded-xl" />
      ))}
    </div>
  );
}
