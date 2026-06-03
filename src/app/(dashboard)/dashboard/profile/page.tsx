import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { Role, NotifyFrequency } from "@/generated/prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NotificationForm } from "@/components/settings/notification-form";
import { notificationPrefsSchema } from "@/lib/validations/notification";
import { strings } from "@/lib/i18n/strings";

const ROLE_LABEL: Record<Role, string> = {
  ADMIN_KUBRI: "Admin Kubri",
  ORG_ADMIN: "Admin organizzazione",
  ORG_MEMBER: "Membro",
};

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: {
      name: true,
      email: true,
      role: true,
      createdAt: true,
      lastLoginAt: true,
      notifyEnabled: true,
      notifyFrequency: true,
      organization: { select: { name: true } },
    },
  });
  if (!user) redirect("/login");

  async function updateNotificationPrefs(formData: FormData) {
    "use server";
    const s = await getCurrentUser();

    const parsed = notificationPrefsSchema.safeParse({
      notifyEnabled: formData.get("notifyEnabled") === "on",
      notifyFrequency: formData.get("notifyFrequency"),
    });
    if (!parsed.success) {
      throw new Error("Dati non validi");
    }

    const current = await prisma.user.findUnique({
      where: { id: s.id },
      select: { notifyEnabled: true },
    });
    const enabling = parsed.data.notifyEnabled && !current?.notifyEnabled;

    await prisma.user.update({
      where: { id: s.id },
      data: {
        notifyEnabled: parsed.data.notifyEnabled,
        notifyFrequency: parsed.data.notifyFrequency as NotifyFrequency,
        ...(enabling ? { lastNotifiedAt: new Date() } : {}),
      },
    });

    revalidatePath("/dashboard/profile");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl tracking-tight">{strings.common.profile}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          I tuoi dati personali e l&apos;organizzazione di appartenenza.
        </p>
      </div>

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>Dati account</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nome" value={user.name} />
            <Field label="Email" value={user.email} />
            <Field
              label="Ruolo"
              value={<Badge variant="secondary">{ROLE_LABEL[user.role]}</Badge>}
            />
            <Field
              label="Organizzazione"
              value={user.organization?.name ?? "—"}
            />
            <Field
              label="Account creato il"
              value={user.createdAt.toLocaleDateString("it-IT", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            />
            <Field
              label="Ultimo accesso"
              value={
                user.lastLoginAt
                  ? user.lastLoginAt.toLocaleDateString("it-IT", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"
              }
            />
          </dl>
        </CardContent>
      </Card>

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>{strings.settings.notifications}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            {strings.settings.notificationsDescription}
          </p>
          <NotificationForm
            defaultEnabled={user.notifyEnabled}
            defaultFrequency={user.notifyFrequency}
            action={updateNotificationPrefs}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{value}</dd>
    </div>
  );
}
