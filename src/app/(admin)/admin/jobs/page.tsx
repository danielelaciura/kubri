import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n";
import { listAllJobDescriptionsForAdmin } from "@/lib/jobs/service";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default async function AdminJobsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { role: true },
  });
  if (!currentUser || currentUser.role !== Role.ADMIN_KUBRI) redirect("/dashboard");

  const t = getDictionary(await getServerLocale());
  const jobs = await listAllJobDescriptionsForAdmin();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl tracking-tight">{t.pages.jobs}</h1>

      <div className="rounded-lg border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.common.organization}</TableHead>
              <TableHead>{t.common.name}</TableHead>
              <TableHead>{t.common.location}</TableHead>
              <TableHead>{t.common.skills}</TableHead>
              <TableHead>{t.jobs.createdAt}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((j) => (
              <TableRow key={j.id}>
                <TableCell className="font-medium">{j.organization.name}</TableCell>
                <TableCell>
                  <Link
                    href={`/dashboard/jobs/${j.id}`}
                    className="text-kubri-600 hover:underline"
                  >
                    {j.name}
                  </Link>
                </TableCell>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
