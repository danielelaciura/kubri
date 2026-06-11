import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { requireOrganization } from "@/lib/auth-utils";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";
import { getCandidatesForOrg } from "@/lib/candidates/service";
import { computeStats } from "@/lib/stats/compute";
import { StatCard } from "@/components/stats/stat-card";
import { WeeklyChart } from "@/components/stats/weekly-chart";

export default async function StatsPage() {
  let organizationId: string;
  try {
    const user = await requireOrganization();
    organizationId = user.organizationId;
  } catch {
    redirect("/login");
  }

  const t = getDictionary(await getServerLocale());

  let stats;
  let error = false;

  try {
    const candidates = await getCandidatesForOrg(organizationId);
    stats = computeStats(candidates);
  } catch {
    error = true;
  }

  if (error || !stats) {
    return (
      <div>
        <h1 className="text-2xl tracking-tight">
          {t.pages.stats}
        </h1>
        <p className="mt-2 text-destructive">
          {t.stats.loadError}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl tracking-tight">
        {t.pages.stats}
      </h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t.stats.totalCandidates}
          value={stats.total}
          icon={Users}
          iconClassName="bg-kubri-100 text-kubri-800"
        />
      </div>

      <WeeklyChart data={stats.weeklyTrend} />
    </div>
  );
}
