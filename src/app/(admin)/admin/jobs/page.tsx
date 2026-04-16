import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { strings } from "@/lib/i18n/strings";
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
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN_KUBRI") redirect("/dashboard");

  const jobs = await listAllJobDescriptionsForAdmin();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{strings.pages.jobs}</h1>

      <div className="rounded-lg border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organizzazione</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Località</TableHead>
              <TableHead>Competenze</TableHead>
              <TableHead>Creata il</TableHead>
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
