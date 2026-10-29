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
  inviteMemberSchema,
  resendInviteSchema,
  removeMemberSchema,
} from "@/lib/validations/organization";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n";
import { attachOrgToPool, detachOrgFromPool } from "@/lib/pools/actions";
import { getLandingForOrg, saveLandingPage } from "@/lib/landing/service";
import { landingPageInputSchema } from "@/lib/validations/landing-page";
import { LandingQrDialog } from "@/components/landing/landing-qr-dialog";
import { InviteOrgMemberDialog } from "@/components/admin/invite-org-member-dialog";
import { DeleteMemberButton } from "@/components/settings/delete-member-button";
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
import { SubmitButton } from "@/components/shared/loading-button";
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

  const t = getDictionary(await getServerLocale());
  const { id } = await params;

  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      settings: true,
      pools: {
        select: {
          pool: {
            select: { id: true, name: true, slug: true, isGlobal: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!org) notFound();

  const allPools = await prisma.pool.findMany({
    select: { id: true, name: true, slug: true, isGlobal: true },
    orderBy: [{ isGlobal: "desc" }, { name: "asc" }],
  });
  const attachedPoolIds = new Set(org.pools.map((op) => op.pool.id));
  const attachablePools = allPools.filter((p) => !attachedPoolIds.has(p.id));

  const landing = await getLandingForOrg(id);
  const eligiblePools = org.pools.map((op) => op.pool).filter((p) => !p.isGlobal);
  const landingUrl = landing ? `${await getAppOrigin()}/candidati/${landing.slug}` : null;

  type MemberRow = {
    id: string;
    email: string;
    name: string;
    role: Role;
    createdAt: Date;
    lastLoginAt: Date | null;
    isPending: boolean;
  };

  // members_with_status is a Postgres view (see migration 20260423101743_supabase_auth_trigger).
  const members = await prisma.$queryRaw<MemberRow[]>`
    SELECT id, email, name, role, "createdAt", "lastLoginAt", "isPending"
    FROM public.members_with_status
    WHERE "organizationId" = ${id}::uuid
    ORDER BY "createdAt" ASC
  `;

  async function updateOrgName(formData: FormData) {
    "use server";
    const s = await getCurrentUser();
    if (s.role !== Role.ADMIN_KUBRI) {
      throw new Error(t.common.insufficientPermissions);
    }

    const parsed = updateOrgSettingsSchema.safeParse({
      name: formData.get("name"),
    });

    if (!parsed.success || !parsed.data.name) {
      throw new Error(t.common.invalidData);
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

  async function attachPoolAction(formData: FormData) {
    "use server";
    const poolId = String(formData.get("poolId") ?? "");
    if (!poolId) throw new Error(t.admin.invalidPool);
    await attachOrgToPool(poolId, id);
  }

  async function detachPoolAction(formData: FormData) {
    "use server";
    const poolId = String(formData.get("poolId") ?? "");
    if (!poolId) throw new Error(t.admin.invalidPool);
    await detachOrgFromPool(poolId, id);
  }

  async function saveLandingAction(formData: FormData) {
    "use server";
    const s = await getCurrentUser();
    if (s.role !== Role.ADMIN_KUBRI) {
      throw new Error(t.common.insufficientPermissions);
    }

    const parsed = landingPageInputSchema.safeParse({
      slug: formData.get("slug"),
      poolId: formData.get("poolId"),
      privacyPolicyUrl: formData.get("privacyPolicyUrl"),
      enabled: formData.get("enabled") === "on",
    });
    if (!parsed.success) throw new Error(t.landingAdmin.errors.VALIDATION);

    const result = await saveLandingPage(id, parsed.data);
    if (!result.ok) throw new Error(t.landingAdmin.errors[result.error]);

    await logAudit({
      userId: s.id,
      organizationId: id,
      action: "landing_page.save",
      resourceType: "CandidateLandingPage",
      resourceId: result.id,
      metadata: { slug: parsed.data.slug, poolId: parsed.data.poolId, enabled: parsed.data.enabled },
    });

    revalidatePath(`/admin/organizations/${id}`);
  }

async function resendInvite(formData: FormData) {
    "use server";
    const s = await getCurrentUser();
    if (s.role !== Role.ADMIN_KUBRI) {
      throw new Error(t.common.insufficientPermissions);
    }

    const parsed = resendInviteSchema.safeParse({
      userId: formData.get("userId"),
    });
    if (!parsed.success) throw new Error(t.common.invalidData);

    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organizationId: id },
    });
    if (!target) throw new Error(t.common.userNotFound);

    const admin = createSupabaseAdminClient();
    const origin = await getAppOrigin();
    const { error } = await admin.auth.admin.inviteUserByEmail(target.email, {
      data: {
        name: target.name,
        role: target.role,
        organization_id: id,
      },
      redirectTo: `${origin}/auth/accept-invite`,
    });
    if (error) throw new Error(error.message);

    await logAudit({
      userId: s.id,
      organizationId: id,
      action: "resend_invite",
      resourceType: "User",
      resourceId: target.id,
      metadata: { email: target.email },
    });

    revalidatePath(`/admin/organizations/${id}`);
  }

  async function inviteOrgMember(formData: FormData) {
    "use server";
    const s = await getCurrentUser();
    if (s.role !== Role.ADMIN_KUBRI) {
      throw new Error(t.common.insufficientPermissions);
    }

    const parsed = inviteMemberSchema.safeParse({
      email: formData.get("email"),
      name: formData.get("name"),
      role: formData.get("role"),
    });
    if (!parsed.success) throw new Error(t.common.invalidData);

    const existing = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (existing) throw new Error(t.members.emailExists);

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
        redirectTo: `${origin}/auth/accept-invite`,
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

  async function removeOrgMember(formData: FormData) {
    "use server";
    const s = await getCurrentUser();
    if (s.role !== Role.ADMIN_KUBRI) {
      throw new Error(t.common.insufficientPermissions);
    }

    const parsed = removeMemberSchema.safeParse({
      userId: formData.get("userId"),
    });
    if (!parsed.success) throw new Error(t.common.invalidData);
    if (parsed.data.userId === s.id) {
      throw new Error(t.members.cannotRemoveSelf);
    }

    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organizationId: id },
      select: { id: true, email: true },
    });
    if (!target) throw new Error(t.common.userNotFound);

    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.deleteUser(target.id);
    if (error) throw new Error(error.message);

    await logAudit({
      userId: s.id,
      organizationId: id,
      action: "remove_member",
      resourceType: "User",
      resourceId: target.id,
      metadata: { email: target.email },
    });

    revalidatePath(`/admin/organizations/${id}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <a href="/admin/organizations">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t.pages.organizations}
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
            <CardTitle>{t.common.info}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">{t.common.createdAt}</p>
              <p className="text-sm">{org.createdAt.toLocaleDateString("it-IT")}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.settings.editName}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateOrgName} className="flex gap-2">
              <Input name="name" defaultValue={org.name} required />
              <SubmitButton>{t.common.save}</SubmitButton>
            </form>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{t.admin.accessiblePools} ({org.pools.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {org.pools.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t.admin.noPoolsAttached}
              </p>
            ) : (
              <ul className="space-y-2">
                {org.pools.map((op) => (
                  <li
                    key={op.pool.id}
                    className="flex items-center justify-between rounded border p-2"
                  >
                    <div className="flex items-center gap-2">
                      <a
                        href={`/admin/pools/${op.pool.id}`}
                        className="font-medium hover:underline"
                      >
                        {op.pool.name}
                      </a>
                      <span className="font-mono text-xs text-muted-foreground">
                        {op.pool.slug}
                      </span>
                      {op.pool.isGlobal && (
                        <Badge variant="secondary">Global</Badge>
                      )}
                    </div>
                    <form action={detachPoolAction}>
                      <input type="hidden" name="poolId" value={op.pool.id} />
                      <SubmitButton variant="ghost" size="sm">
                        {t.common.remove}
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            {attachablePools.length > 0 && (
              <form action={attachPoolAction} className="flex gap-2">
                <select
                  name="poolId"
                  required
                  className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  {attachablePools.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isGlobal ? " (Global)" : ""}
                    </option>
                  ))}
                </select>
                <SubmitButton>{t.admin.attach}</SubmitButton>
              </form>
            )}

            <p className="text-xs text-muted-foreground">
              {t.admin.poolsDescription}{" "}
              <a className="underline" href="/admin/pools">
                /admin/pools
              </a>
              .
            </p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{t.landingAdmin.cardTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t.landingAdmin.cardDescription}</p>

            {landing && landingUrl && (
              <div className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm">
                <span className="text-muted-foreground">{t.landingAdmin.publicLink}:</span>
                <a href={landingUrl} target="_blank" rel="noreferrer" className="font-mono hover:underline">
                  {landingUrl}
                </a>
                {!landing.enabled && <Badge variant="secondary">{t.landingAdmin.disabled}</Badge>}
                <LandingQrDialog name={org.name} url={landingUrl} />
              </div>
            )}

            {eligiblePools.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.landingAdmin.noEligiblePools}</p>
            ) : (
              <form action={saveLandingAction} className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span>{t.landingAdmin.slug}</span>
                  <Input name="slug" defaultValue={landing?.slug ?? org.slug} required />
                  <span className="text-xs text-muted-foreground">{t.landingAdmin.slugHint}</span>
                </label>
                <label className="space-y-1 text-sm">
                  <span>{t.landingAdmin.pool}</span>
                  <select
                    name="poolId"
                    required
                    defaultValue={landing?.poolId ?? eligiblePools[0]!.id}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  >
                    {eligiblePools.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm md:col-span-2">
                  <span>{t.landingAdmin.privacyPolicyUrl}</span>
                  <Input
                    name="privacyPolicyUrl"
                    type="url"
                    required
                    placeholder="https://"
                    defaultValue={landing?.privacyPolicyUrl ?? ""}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="enabled" defaultChecked={landing?.enabled ?? true} className="h-4 w-4" />
                  {t.landingAdmin.enabled}
                </label>
                <div className="md:col-span-2">
                  <SubmitButton>{t.landingAdmin.save}</SubmitButton>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg">{t.admin.membersCount} ({members.length})</h2>
          <InviteOrgMemberDialog action={inviteOrgMember} />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.common.name}</TableHead>
              <TableHead>{t.common.email}</TableHead>
              <TableHead>{t.common.role}</TableHead>
              <TableHead>{t.members.status}</TableHead>
              <TableHead>{t.members.subscription}</TableHead>
              <TableHead>{t.members.lastLogin}</TableHead>
              <TableHead className="text-right">{t.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {t.roles[user.role] ?? user.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  {user.isPending ? (
                    <Badge variant="outline">{t.members.pending}</Badge>
                  ) : (
                    <Badge>{t.members.active}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {user.createdAt.toLocaleDateString("it-IT")}
                </TableCell>
                <TableCell>
                  {user.lastLoginAt
                    ? user.lastLoginAt.toLocaleDateString("it-IT")
                    : t.common.never}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {user.isPending && (
                      <form action={resendInvite} className="inline">
                        <input type="hidden" name="userId" value={user.id} />
                        <SubmitButton
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                        >
                          {t.members.resendInvite}
                        </SubmitButton>
                      </form>
                    )}
                    {user.role !== Role.ADMIN_KUBRI && (
                      <DeleteMemberButton
                        memberId={user.id}
                        memberName={user.name}
                        memberEmail={user.email}
                        removeAction={removeOrgMember}
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
