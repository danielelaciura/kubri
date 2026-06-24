import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import { Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getPoolDetail } from "@/lib/pools/queries";
import {
  updatePool,
  deletePool,
  attachOrgToPool,
  detachOrgFromPool,
} from "@/lib/pools/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n";

interface PoolDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PoolDetailPage({ params }: PoolDetailPageProps) {
  let me;
  try {
    me = await getCurrentUser();
  } catch {
    redirect("/login");
  }
  if (me.role !== Role.ADMIN_KUBRI) redirect("/dashboard");

  const t = getDictionary(await getServerLocale());
  const { id } = await params;
  const pool = await getPoolDetail(id);
  if (!pool) notFound();

  const allOrgs = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const attachedOrgIds = new Set(pool.organizations.map((op) => op.organizationId));
  const detachableOrgs = allOrgs.filter((o) => !attachedOrgIds.has(o.id));

  const canDelete =
    !pool.isGlobal &&
    pool._count.candidates === 0 &&
    pool.organizations.length === 0;

  async function updateAction(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim();
    const externalKeyRaw = String(formData.get("externalKey") ?? "").trim();
    const externalKey = externalKeyRaw === "" ? null : externalKeyRaw;

    await updatePool(id, { name, slug, externalKey });
  }

  async function deleteAction() {
    "use server";
    await deletePool(id);
    redirect("/admin/pools");
  }

  async function attachAction(formData: FormData) {
    "use server";
    const organizationId = String(formData.get("organizationId") ?? "");
    if (!organizationId) throw new Error(t.admin.invalidOrg);
    await attachOrgToPool(id, organizationId);
  }

  async function detachAction(formData: FormData) {
    "use server";
    const organizationId = String(formData.get("organizationId") ?? "");
    if (!organizationId) throw new Error(t.admin.invalidOrg);
    await detachOrgFromPool(id, organizationId);
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

      <div className="flex items-center gap-3">
        <h1 className="text-2xl tracking-tight">{pool.name}</h1>
        {pool.isGlobal && <Badge variant="secondary">Global</Badge>}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.pools.details}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t.common.name}</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={pool.name}
                  required
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">{t.organizations.slug}</Label>
                <Input
                  id="slug"
                  name="slug"
                  defaultValue={pool.slug}
                  required
                  maxLength={100}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="externalKey">{t.pools.externalKey}</Label>
                <Input
                  id="externalKey"
                  name="externalKey"
                  defaultValue={pool.externalKey ?? ""}
                  maxLength={255}
                />
              </div>
              <Button type="submit">{t.common.save}</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.pools.candidates}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              <span className="text-2xl font-semibold">
                {pool._count.candidates}
              </span>{" "}
              {t.pools.candidatesInPool}
            </p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>
              {t.admin.attachedOrgs} ({pool.organizations.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {pool.organizations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t.admin.noOrgsAttached}
              </p>
            ) : (
              <ul className="space-y-2">
                {pool.organizations.map((op) => (
                  <li
                    key={op.organizationId}
                    className="flex items-center justify-between rounded border p-2"
                  >
                    <span className="font-medium">{op.organization.name}</span>
                    <form action={detachAction}>
                      <input
                        type="hidden"
                        name="organizationId"
                        value={op.organizationId}
                      />
                      <Button type="submit" variant="ghost" size="sm">
                        {t.common.remove}
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            {detachableOrgs.length > 0 && (
              <form action={attachAction} className="flex gap-2">
                <select
                  name="organizationId"
                  required
                  className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  {detachableOrgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
                <Button type="submit">{t.admin.attach}</Button>
              </form>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{t.pools.deleteSection}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <form action={deleteAction}>
              <Button
                type="submit"
                variant="destructive"
                disabled={!canDelete}
              >
                {t.pools.deletePool}
              </Button>
            </form>
            {!canDelete && (
              <p className="text-xs text-muted-foreground">
                {pool.isGlobal
                  ? t.pools.cannotDeleteGlobal
                  : pool._count.candidates > 0
                    ? t.pools.cannotDeleteHasCandidates.replace("{count}", String(pool._count.candidates))
                    : t.pools.cannotDeleteHasOrgs.replace("{count}", String(pool.organizations.length))}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
