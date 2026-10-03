import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Briefcase, Plus } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";
import { listJobDescriptions } from "@/lib/jobs/service";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { JobTableRow } from "@/components/jobs/job-table-row";
import { JobsDashboard, JobsDashboardSkeleton } from "@/components/jobs/jobs-dashboard";

export default async function JobsPage() {
  const locale = await getServerLocale();
  const t = getDictionary(locale);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { role: true, organizationId: true },
  });
  if (!currentUser?.organizationId) redirect("/login");
  const isAdmin = currentUser.role === "ORG_ADMIN";

  const jobs = await listJobDescriptions({ organizationId: currentUser.organizationId });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl tracking-tight">{t.pages.jobs}</h1>
      </div>

      {jobs.length > 0 && (
        <Suspense fallback={<JobsDashboardSkeleton />}>
          <JobsDashboard organizationId={currentUser.organizationId} t={t} locale={locale} />
        </Suspense>
      )}

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center">
          <Briefcase className="h-12 w-12 text-muted-foreground/50" />
          <h2 className="mt-4 text-lg font-medium text-muted-foreground">
            {t.jobs.listEmpty}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground/75">{t.jobs.listEmptyHint}</p>
          {isAdmin && (
            <Link href="/dashboard/jobs/new" className="mt-4">
              <Button>
                <Plus className="mr-1 h-4 w-4" />
                {t.jobs.addButton}
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.jobs.fieldName}</TableHead>
                <TableHead>{t.jobs.fieldLocation}</TableHead>
                <TableHead>{t.jobs.fieldSkills}</TableHead>
                <TableHead>{t.jobs.createdAt}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => (
                <JobTableRow key={j.id} href={`/dashboard/jobs/${j.id}`}>
                  <TableCell className="font-medium">{j.name}</TableCell>
                  <TableCell>{j.locationRaw}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {j.skills.slice(0, 3).map((s) => (
                        <Badge key={s} variant="secondary" className="text-xs">
                          {s}
                        </Badge>
                      ))}
                      {j.skills.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{j.skills.length - 3}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {j.createdAt.toLocaleDateString("it-IT", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </TableCell>
                </JobTableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
