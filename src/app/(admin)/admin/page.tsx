import { redirect } from "next/navigation";
import { Building2, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { strings } from "@/lib/i18n/strings";
import { StatCard } from "@/components/stats/stat-card";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function AdminPage() {
  const session = await auth();

  if (!session?.user?.role || session.user.role !== "ADMIN_KUBRI") {
    redirect("/login");
  }

  const organizations = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      _count: {
        select: { users: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const totalUsers = organizations.reduce(
    (sum, org) => sum + org._count.users,
    0,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">
        {strings.pages.admin}
      </h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Organizzazioni"
          value={organizations.length}
          icon={Building2}
        />
        <StatCard
          title="Utenti totali"
          value={totalUsers}
          icon={Users}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Riepilogo organizzazioni</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{strings.common.name}</TableHead>
                <TableHead>{strings.organizations.slug}</TableHead>
                <TableHead>{strings.organizations.memberCount}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.map((org) => (
                <TableRow key={org.id}>
                  <TableCell className="font-medium">{org.name}</TableCell>
                  <TableCell>{org.slug}</TableCell>
                  <TableCell>{org._count.users}</TableCell>
                </TableRow>
              ))}
              {organizations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    Nessuna organizzazione presente.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
