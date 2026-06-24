import { redirect } from "next/navigation";
import { Building2, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth-utils";
import { Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n";
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
  try {
    const user = await getCurrentUser();
    if (user.role !== Role.ADMIN_KUBRI) {
      redirect("/login");
    }
  } catch {
    redirect("/login");
  }

  const t = getDictionary(await getServerLocale());

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
      <h1 className="text-2xl tracking-tight">
        {t.pages.admin}
      </h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t.organizations.title}
          value={organizations.length}
          icon={Building2}
        />
        <StatCard
          title={t.admin.totalUsers}
          value={totalUsers}
          icon={Users}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.admin.orgSummary}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.common.name}</TableHead>
                <TableHead>{t.organizations.slug}</TableHead>
                <TableHead>{t.organizations.memberCount}</TableHead>
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
                    {t.admin.noOrganizations}
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
