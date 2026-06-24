import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { NotifyFrequency } from "@/generated/prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NotificationForm } from "@/components/settings/notification-form";
import { notificationPrefsSchema } from "@/lib/validations/notification";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n";
import { setLanguage } from "@/lib/i18n/actions";
import { LanguageForm } from "@/components/settings/language-form";

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
      language: true,
      organization: { select: { name: true } },
    },
  });
  if (!user) redirect("/login");

  const locale = await getServerLocale();
  const t = getDictionary(locale);
  const dateLocale = locale === "it" ? "it-IT" : "en-GB";

  async function updateNotificationPrefs(formData: FormData) {
    "use server";
    const s = await getCurrentUser();

    const parsed = notificationPrefsSchema.safeParse({
      notifyEnabled: formData.get("notifyEnabled") === "on",
      notifyFrequency: formData.get("notifyFrequency"),
    });
    if (!parsed.success) {
      const dict = getDictionary(await getServerLocale());
      throw new Error(dict.common.invalidData);
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
        <h1 className="text-2xl tracking-tight">{t.common.profile}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.profile.accountIntro}
        </p>
      </div>

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>{t.profile.accountData}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t.profile.fieldName} value={user.name} />
            <Field label={t.profile.fieldEmail} value={user.email} />
            <Field
              label={t.profile.fieldRole}
              value={<Badge variant="secondary">{t.roles[user.role]}</Badge>}
            />
            <Field
              label={t.profile.fieldOrganization}
              value={user.organization?.name ?? "—"}
            />
            <Field
              label={t.profile.fieldCreatedAt}
              value={user.createdAt.toLocaleDateString(dateLocale, {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            />
            <Field
              label={t.profile.fieldLastLogin}
              value={
                user.lastLoginAt
                  ? user.lastLoginAt.toLocaleDateString(dateLocale, {
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
          <CardTitle>{t.settings.notifications}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            {t.settings.notificationsDescription}
          </p>
          <NotificationForm
            defaultEnabled={user.notifyEnabled}
            defaultFrequency={user.notifyFrequency}
            action={updateNotificationPrefs}
          />
        </CardContent>
      </Card>

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>{t.profile.language}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            {t.profile.languageDescription}
          </p>
          <LanguageForm defaultLanguage={locale} action={setLanguage} />
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
