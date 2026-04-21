import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { getCandidatesForOrg } from "@/lib/make/service";
import { updateOrgSettingsSchema } from "@/lib/validations/organization";
import { logAudit } from "@/lib/audit";
import { strings } from "@/lib/i18n/strings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OrgNameForm } from "@/components/settings/org-name-form";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: session.user.organizationId },
    select: { id: true, name: true, slug: true },
  });

  const isAdmin =
    session.user.role === Role.ADMIN_KUBRI ||
    session.user.role === Role.ORG_ADMIN;

  // Check Make.com connection status
  let makeConnected = false;
  try {
    await getCandidatesForOrg(session.user.organizationId);
    makeConnected = true;
  } catch {
    makeConnected = false;
  }

  async function updateOrgName(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user?.organizationId) throw new Error("Non autenticato");

    const userRole = s.user.role as Role;
    if (userRole !== Role.ADMIN_KUBRI && userRole !== Role.ORG_ADMIN) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = updateOrgSettingsSchema.safeParse({
      name: formData.get("name"),
    });

    if (!parsed.success) {
      throw new Error("Dati non validi");
    }

    if (parsed.data.name) {
      await prisma.organization.update({
        where: { id: s.user.organizationId },
        data: { name: parsed.data.name },
      });

      await logAudit({
        userId: s.user.id,
        organizationId: s.user.organizationId,
        action: "update_organization",
        resourceType: "Organization",
        resourceId: s.user.organizationId,
        metadata: { name: parsed.data.name },
      });
    }

    revalidatePath("/dashboard/settings");
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl tracking-tight">
        {strings.pages.settings}
      </h1>
      <p className="text-muted-foreground">
        Gestisci le impostazioni della tua organizzazione.
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{strings.settings.orgName}</CardTitle>
          </CardHeader>
          <CardContent>
            {isAdmin ? (
              <OrgNameForm currentName={org.name} action={updateOrgName} />
            ) : (
              <p className="text-sm">{org.name}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{strings.settings.orgSlug}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-mono">{org.slug}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {strings.settings.readOnly}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{strings.settings.makeConnection}</CardTitle>
          </CardHeader>
          <CardContent>
            {makeConnected ? (
              <Badge variant="default">{strings.settings.connectionOk}</Badge>
            ) : (
              <Badge variant="destructive">
                {strings.settings.connectionError}
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
