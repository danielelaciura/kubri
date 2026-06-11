import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import { Role } from "@/generated/prisma/client";
import { createPool } from "@/lib/pools/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n";

export default async function NewPoolPage() {
  let me;
  try {
    me = await getCurrentUser();
  } catch {
    redirect("/login");
  }
  if (me.role !== Role.ADMIN_KUBRI) redirect("/dashboard");

  const t = getDictionary(await getServerLocale());

  async function createAction(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim();
    const externalKeyRaw = String(formData.get("externalKey") ?? "").trim();
    const externalKey = externalKeyRaw === "" ? null : externalKeyRaw;

    const pool = await createPool({ name, slug, externalKey });
    redirect(`/admin/pools/${pool.id}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <a href="/admin/pools">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t.nav.pools}
          </Button>
        </a>
      </div>

      <div>
        <h1 className="text-2xl tracking-tight">{t.pools.newPool}</h1>
        <p className="mt-1 text-muted-foreground">
          {t.pools.newPoolDescription}
        </p>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{t.pools.details}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t.common.name}</Label>
              <Input id="name" name="name" required maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">{t.organizations.slug}</Label>
              <Input
                id="slug"
                name="slug"
                required
                maxLength={100}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="es. nord-ovest"
              />
              <p className="text-xs text-muted-foreground">
                {t.pools.slugHint}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="externalKey">{t.pools.externalKeyOptional}</Label>
              <Input id="externalKey" name="externalKey" maxLength={255} />
              <p className="text-xs text-muted-foreground">
                {t.pools.externalKeyHint}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="submit">{t.common.save}</Button>
              <a href="/admin/pools">
                <Button type="button" variant="ghost">
                  {t.common.cancel}
                </Button>
              </a>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
