import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { getAppOrigin } from "@/lib/origin";
import {
  updateOrgSettingsSchema,
  updateOrgDatastoreSchema,
  inviteMemberSchema,
} from "@/lib/validations/organization";
import { strings } from "@/lib/i18n/strings";
import { InviteOrgMemberDialog } from "@/components/admin/invite-org-member-dialog";
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
  let currentUser;
  try {
    currentUser = await getCurrentUser();
  } catch {
    redirect("/login");
  }
  if (currentUser.role !== Role.ADMIN_KUBRI) {
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
    const s = await getCurrentUser();
    if (s.role !== Role.ADMIN_KUBRI) {
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
      userId: s.id,
      organizationId: id,
      action: "update_organization",
      resourceType: "Organization",
      resourceId: id,
      metadata: { name: parsed.data.name },
    });

    revalidatePath(`/admin/organizations/${id}`);
  }

  async function updateOrgDatastore(formData: FormData) {
    "use server";
    const s = await getCurrentUser();
    if (s.role !== Role.ADMIN_KUBRI) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = updateOrgDatastoreSchema.safeParse({
      makeDatastoreId: formData.get("makeDatastoreId"),
    });
    if (!parsed.success) throw new Error("Dati non validi");

    await prisma.organization.update({
      where: { id },
      data: { makeDatastoreId: parsed.data.makeDatastoreId },
    });

    await logAudit({
      userId: s.id,
      organizationId: id,
      action: "update_organization_datastore",
      resourceType: "Organization",
      resourceId: id,
      metadata: { makeDatastoreId: parsed.data.makeDatastoreId },
    });

    revalidatePath(`/admin/organizations/${id}`);
  }

  async function inviteOrgMember(formData: FormData) {
    "use server";
    const s = await getCurrentUser();
    if (s.role !== Role.ADMIN_KUBRI) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = inviteMemberSchema.safeParse({
      email: formData.get("email"),
      name: formData.get("name"),
      role: formData.get("role"),
    });
    if (!parsed.success) throw new Error("Dati non validi");

    const existing = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (existing) throw new Error(strings.members.emailExists);

    const admin = createSupabaseAdminClient();
    const origin = await getAppOrigin();
    const { error } = await admin.auth.admin.inviteUserByEmail(
      parsed.data.email,
      {
        data: {
          name: parsed.data.name,
          role: parsed.data.role,
          organization_id: id,
        },
        redirectTo: `${origin}/auth/callback?next=/auth/set-password`,
      },
    );
    if (error) throw new Error(error.message);

    await logAudit({
      userId: s.id,
      organizationId: id,
      action: "invite_member",
      resourceType: "User",
      resourceId: parsed.data.email,
      metadata: { email: parsed.data.email, role: parsed.data.role },
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
        <h1 className="text-2xl tracking-tight">{org.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground font-mono">{org.slug}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Informazioni</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Make.com Data Store</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateOrgDatastore} className="flex gap-2">
              <Input
                name="makeDatastoreId"
                defaultValue={org.makeDatastoreId}
                placeholder="Data Store ID"
                required
                className="font-mono"
              />
              <Button type="submit">{strings.common.save}</Button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              ID del Data Store Make.com per i candidati di questa
              organizzazione. Il token API è condiviso a livello di piattaforma.
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg">Membri ({org.users.length})</h2>
          <InviteOrgMemberDialog action={inviteOrgMember} />
        </div>
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
