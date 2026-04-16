import Link from "next/link";
import { redirect } from "next/navigation";
import { Briefcase, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { strings } from "@/lib/i18n/strings";
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

export default async function JobsPage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");
  const isAdmin = session.user.role === "ORG_ADMIN";

  const jobs = await listJobDescriptions({ organizationId: session.user.organizationId });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{strings.pages.jobs}</h1>
      </div>

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center">
          <Briefcase className="h-12 w-12 text-muted-foreground/50" />
          <h2 className="mt-4 text-lg font-medium text-muted-foreground">
            {strings.jobs.listEmpty}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground/75">{strings.jobs.listEmptyHint}</p>
          {isAdmin && (
            <Link href="/dashboard/jobs/new" className="mt-4">
              <Button>
                <Plus className="mr-1 h-4 w-4" />
                {strings.jobs.addButton}
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{strings.jobs.fieldName}</TableHead>
                <TableHead>{strings.jobs.fieldLocation}</TableHead>
                <TableHead>{strings.jobs.fieldSkills}</TableHead>
                <TableHead>Creata il</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => (
                <TableRow key={j.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="font-medium">
                    <Link href={`/dashboard/jobs/${j.id}`} className="block">
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
      )}
    </div>
  );
}
