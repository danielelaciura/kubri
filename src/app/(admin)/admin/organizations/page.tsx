import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { encrypt } from "@/lib/encryption";
import { hashPassword } from "@/lib/password";
import { logAudit } from "@/lib/audit";
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
  const session = await auth();
  if (!session?.user || session.user.role !== Role.ADMIN_KUBRI) {
    redirect("/dashboard");
  }

  const organizations = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      _count: { select: { users: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  async function createOrg(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user || s.user.role !== Role.ADMIN_KUBRI) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = createOrgSchema.safeParse({
      name: formData.get("name"),
      slug: formData.get("slug"),
      makeDatastoreId: formData.get("makeDatastoreId"),
      makeApiToken: formData.get("makeApiToken"),
      adminEmail: formData.get("adminEmail"),
      adminName: formData.get("adminName"),
      adminPassword: formData.get("adminPassword"),
    });

    if (!parsed.success) {
      throw new Error("Dati non validi");
    }

    const encryptedToken = encrypt(parsed.data.makeApiToken);
    const passwordHash = await hashPassword(parsed.data.adminPassword);

    const org = await prisma.organization.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        makeDatastoreId: parsed.data.makeDatastoreId,
        makeApiToken: encryptedToken,
      },
    });

    await prisma.user.create({
      data: {
        email: parsed.data.adminEmail,
        name: parsed.data.adminName,
        passwordHash,
        role: Role.ORG_ADMIN,
        organizationId: org.id,
      },
    });

    await logAudit({
      userId: s.user.id,
      organizationId: org.id,
      action: "create_organization",
      resourceType: "Organization",
      resourceId: org.id,
      metadata: { name: parsed.data.name, slug: parsed.data.slug },
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
