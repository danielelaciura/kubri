import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { getAppOrigin } from "@/lib/origin";
import { createOrgSchema } from "@/lib/validations/organization";
import { strings } from "@/lib/i18n/strings";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateOrgDialog } from "@/components/admin/create-org-dialog";

export default async function OrganizationsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const currentAdmin = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { id: true, role: true },
  });
  if (!currentAdmin || currentAdmin.role !== Role.ADMIN_KUBRI) {
    redirect("/dashboard");
  }

  const organizations = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      _count: { select: { users: true } },
      pools: {
        select: {
          pool: { select: { id: true, name: true, slug: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  async function createOrg(formData: FormData) {
    "use server";
    const sbRead = await createSupabaseServerClient();
    const {
      data: { user: aUser },
    } = await sbRead.auth.getUser();
    if (!aUser) throw new Error("Non autenticato");

    const me = await prisma.user.findUnique({
      where: { id: aUser.id },
      select: { id: true, role: true },
    });
    if (!me || me.role !== Role.ADMIN_KUBRI) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = createOrgSchema.safeParse({
      name: formData.get("name"),
      slug: formData.get("slug"),
      adminEmail: formData.get("adminEmail"),
      adminName: formData.get("adminName"),
    });
    if (!parsed.success) {
      throw new Error("Dati non validi");
    }

    // Create the org and auto-attach the Global pool (Q2 = B: rimovibile dall'admin
    // Kubri in seguito, ma di default ogni nuova org vede il pool condiviso).
    const organization = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: parsed.data.name, slug: parsed.data.slug },
      });
      const global = await tx.pool.findFirst({
        where: { isGlobal: true },
        select: { id: true },
      });
      if (global) {
        await tx.organizationPool.create({
          data: { organizationId: org.id, poolId: global.id },
        });
      }
      return org;
    });

    const admin = createSupabaseAdminClient();
    const origin = await getAppOrigin();

    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      parsed.data.adminEmail,
      {
        data: {
          name: parsed.data.adminName,
          role: "ORG_ADMIN",
          organization_id: organization.id,
        },
        redirectTo: `${origin}/auth/callback?next=/auth/set-password`,
      },
    );
    if (inviteError) {
      // Roll back org creation so admin can retry without a unique-slug conflict.
      await prisma.organization.delete({ where: { id: organization.id } });
      throw new Error(inviteError.message);
    }

    await logAudit({
      userId: me.id,
      organizationId: organization.id,
      action: "create_organization",
      resourceType: "Organization",
      resourceId: organization.id,
      metadata: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        adminEmail: parsed.data.adminEmail,
      },
    });

    revalidatePath("/admin/organizations");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl tracking-tight">
            {strings.pages.organizations}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Gestisci le organizzazioni sulla piattaforma.
          </p>
        </div>
        <CreateOrgDialog action={createOrg} />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Membri</TableHead>
            <TableHead>Data creazione</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {organizations.map((org) => (
            <TableRow key={org.id}>
              <TableCell className="font-medium">
                <a
                  href={`/admin/organizations/${org.id}`}
                  className="hover:underline"
                >
                  {org.name}
                </a>
              </TableCell>
              <TableCell className="font-mono text-sm">{org.slug}</TableCell>
              <TableCell>{org._count.users}</TableCell>
              <TableCell>
                {org.createdAt.toLocaleDateString("it-IT")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
