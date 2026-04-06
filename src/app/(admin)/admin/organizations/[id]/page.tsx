import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { updateOrgSettingsSchema } from "@/lib/validations/organization";
import { strings } from "@/lib/i18n/strings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft } from "lucide-react";

interface OrgDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function OrgDetailPage({ params }: OrgDetailPageProps) {
  const session = await auth();
  if (!session?.user || session.user.role !== Role.ADMIN_KUBRI) {
    redirect("/dashboard");
  }

  const { id } = await params;

  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      makeDatastoreId: true,
      createdAt: true,
      settings: true,
      users: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          lastLoginAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!org) notFound();

  async function updateOrgName(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user || s.user.role !== Role.ADMIN_KUBRI) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = updateOrgSettingsSchema.safeParse({
      name: formData.get("name"),
    });

    if (!parsed.success || !parsed.data.name) {
      throw new Error("Dati non validi");
    }

    await prisma.organization.update({
      where: { id },
      data: { name: parsed.data.name },
    });

    await logAudit({
      userId: s.user.id,
      organizationId: id,
      action: "update_organization",
      resourceType: "Organization",
      resourceId: id,
      metadata: { name: parsed.data.name },
    });

    revalidatePath(`/admin/organizations/${id}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <a href="/admin/organizations">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Organizzazioni
          </Button>
        </a>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground font-mono">{org.slug}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Informazioni</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">Data Store ID</p>
              <p className="font-mono text-sm">{org.makeDatastoreId}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Data creazione</p>
              <p className="text-sm">{org.createdAt.toLocaleDateString("it-IT")}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Modifica nome</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateOrgName} className="flex gap-2">
              <Input name="name" defaultValue={org.name} required />
              <Button type="submit">{strings.common.save}</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold">
          Membri ({org.users.length})
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Ruolo</TableHead>
              <TableHead>Iscrizione</TableHead>
              <TableHead>Ultimo accesso</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {org.users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {strings.roles[user.role] ?? user.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  {user.createdAt.toLocaleDateString("it-IT")}
                </TableCell>
                <TableCell>
                  {user.lastLoginAt
                    ? user.lastLoginAt.toLocaleDateString("it-IT")
                    : "Mai"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
