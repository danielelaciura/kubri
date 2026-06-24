import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser, requireOrganization } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { getCandidatesForOrg } from "@/lib/candidates/service";
import { updateOrgSettingsSchema } from "@/lib/validations/organization";
import { logAudit } from "@/lib/audit";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OrgNameForm } from "@/components/settings/org-name-form";

export default async function SettingsPage() {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    redirect("/login");
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: user.organizationId },
    select: { id: true, name: true, slug: true },
  });

  const isAdmin =
    user.role === Role.ADMIN_KUBRI || user.role === Role.ORG_ADMIN;

  // Check Make.com connection status
  let makeConnected = false;
  try {
    await getCandidatesForOrg(user.organizationId);
    makeConnected = true;
  } catch {
    makeConnected = false;
  }

  const locale = await getServerLocale();
  const t = getDictionary(locale);

  async function updateOrgName(formData: FormData) {
    "use server";
    const s = await getCurrentUser();
    const locale = await getServerLocale();
    const dict = getDictionary(locale);
    if (!s.organizationId) throw new Error(dict.common.notAuthenticated);

    if (s.role !== Role.ADMIN_KUBRI && s.role !== Role.ORG_ADMIN) {
      throw new Error(dict.common.insufficientPermissions);
    }

    const parsed = updateOrgSettingsSchema.safeParse({
      name: formData.get("name"),
    });

    if (!parsed.success) {
      throw new Error(dict.common.invalidData);
    }

    if (parsed.data.name) {
      await prisma.organization.update({
        where: { id: s.organizationId },
        data: { name: parsed.data.name },
      });

      await logAudit({
        userId: s.id,
        organizationId: s.organizationId,
        action: "update_organization",
        resourceType: "Organization",
        resourceId: s.organizationId,
        metadata: { name: parsed.data.name },
      });
    }

    revalidatePath("/dashboard/settings");
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl tracking-tight">
        {t.pages.settings}
      </h1>
      <p className="text-muted-foreground">
        {t.settings.orgIntro}
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.settings.orgName}</CardTitle>
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
            <CardTitle>{t.settings.orgSlug}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-mono">{org.slug}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t.settings.readOnly}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.settings.makeConnection}</CardTitle>
          </CardHeader>
          <CardContent>
            {makeConnected ? (
              <Badge variant="default">{t.settings.connectionOk}</Badge>
            ) : (
              <Badge variant="destructive">
                {t.settings.connectionError}
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
