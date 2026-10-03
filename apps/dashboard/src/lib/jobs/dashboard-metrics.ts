import { prisma } from "@/lib/db";
import { getOrgAccessiblePoolIds } from "@/lib/pools/access";
import { candidateVisibilityWhere } from "@/lib/pools/candidate-visibility";
import { TARGET_MATCH_SCORE } from "@/lib/jobs/constants";

const RECENT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface JobsDashboardMetrics {
  activeJobs: number;
  jobsLast30Days: number;
  /** Unique visible candidates scoring >= TARGET_MATCH_SCORE in at least one JD. */
  targetCandidates: number;
  /** Visible candidates never evaluated by the AI in any JD of the org. */
  neverMatchedCandidates: number;
  totalCandidates: number;
}

/**
 * KPIs for the jobs dashboard, read from the `JobMatch` snapshots. Candidate
 * counts go through the org's visibility filter, so a candidate the org can no
 * longer see drops out even if snapshot rows remain.
 */
export async function getJobsDashboardMetrics(
  organizationId: string,
  now: Date = new Date(),
): Promise<JobsDashboardMetrics> {
  const visibility = candidateVisibilityWhere(await getOrgAccessiblePoolIds(organizationId));
  const since = new Date(now.getTime() - RECENT_WINDOW_DAYS * DAY_MS);

  const [activeJobs, jobsLast30Days, targetCandidates, neverMatchedCandidates, totalCandidates] =
    await Promise.all([
      prisma.jobDescription.count({ where: { organizationId } }),
      prisma.jobDescription.count({ where: { organizationId, createdAt: { gte: since } } }),
      prisma.candidate.count({
        where: {
          ...visibility,
          jobMatches: { some: { organizationId, llmScore: { gte: TARGET_MATCH_SCORE } } },
        },
      }),
      prisma.candidate.count({
        where: { ...visibility, jobMatches: { none: { organizationId } } },
      }),
      prisma.candidate.count({ where: visibility }),
    ]);

  return { activeJobs, jobsLast30Days, targetCandidates, neverMatchedCandidates, totalCandidates };
}

/**
 * Per-JD number of visible candidates scoring >= TARGET_MATCH_SCORE in the
 * JD's snapshot, keyed by JD id. JDs without target matches are absent (0).
 */
export async function getTargetCountsByJob(organizationId: string): Promise<Map<string, number>> {
  const visibility = candidateVisibilityWhere(await getOrgAccessiblePoolIds(organizationId));
  const rows = await prisma.jobMatch.groupBy({
    by: ["jobDescriptionId"],
    where: {
      organizationId,
      llmScore: { gte: TARGET_MATCH_SCORE },
      candidate: visibility,
    },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.jobDescriptionId, r._count._all]));
}
