import type { Candidate } from "@/types";

export interface DashboardStats {
  total: number;
  weeklyTrend: { week: string; count: number }[];
}

export function computeStats(candidates: Candidate[]): DashboardStats {
  const total = candidates.length;

  // Group by week for the last 8 weeks
  const now = new Date();
  const weeks: { week: string; count: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - i * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const count = candidates.filter(
      (c) => c.createdAt >= weekStart && c.createdAt < weekEnd,
    ).length;

    // Format as "dd/mm" for the week start
    const label = `${weekStart.getDate().toString().padStart(2, "0")}/${(weekStart.getMonth() + 1).toString().padStart(2, "0")}`;
    weeks.push({ week: label, count });
  }

  return { total, weeklyTrend: weeks };
}
