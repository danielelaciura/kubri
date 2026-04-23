import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { getAppOrigin } from "@/lib/origin";
import {
  inviteMemberSchema,
  removeMemberSchema,
  changeRoleSchema,
  resendInviteSchema,
} from "@/lib/validations/organization";
import { strings } from "@/lib/i18n/strings";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MembersActions } from "@/components/settings/members-actions";
import { MemberRowActions } from "@/components/settings/member-row-actions";

type MemberWithStatusRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  isPending: boolean;
};

export default async function MembersPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { id: true, role: true, organizationId: true },
  });
  if (!currentUser?.organizationId) redirect("/login");

  const isAdmin =
    currentUser.role === Role.ADMIN_KUBRI || currentUser.role === Role.ORG_ADMIN;

  // members_with_status is a Postgres view (see migration 20260423101743_supabase_auth_trigger)
  // — not a Prisma model, so we query it via $queryRaw.
  const members = await prisma.$queryRaw<MemberWithStatusRow[]>`
    SELECT id, email, name, role, "organizationId", "createdAt", "lastLoginAt", "isPending"
    FROM public.members_with_status
    WHERE "organizationId" = ${currentUser.organizationId}::uuid
    ORDER BY "createdAt" ASC
  `;

  async function inviteMember(formData: FormData) {
    "use server";
    const sbRead = await createSupabaseServerClient();
    const {
      data: { user: aUser },
    } = await sbRead.auth.getUser();
    if (!aUser) throw new Error("Non autenticato");

    const me = await prisma.user.findUnique({
      where: { id: aUser.id },
      select: { id: true, role: true, organizationId: true },
    });
    if (!me?.organizationId) throw new Error("Non autenticato");
    if (me.role !== Role.ADMIN_KUBRI && me.role !== Role.ORG_ADMIN) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = inviteMemberSchema.safeParse({
      email: formData.get("email"),
      name: formData.get("name"),
      role: formData.get("role"),
    });
    if (!parsed.success) throw new Error("Dati non validi");

    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) throw new Error(strings.members.emailExists);

    const admin = createSupabaseAdminClient();
    const origin = await getAppOrigin();
    const { error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
      data: {
        name: parsed.data.name,
        role: parsed.data.role,
        organization_id: me.organizationId,
      },
      redirectTo: `${origin}/auth/callback?next=/auth/set-password`,
    });
    if (error) throw new Error(error.message);

    await logAudit({
      userId: me.id,
      organizationId: me.organizationId,
      action: "invite_member",
      resourceType: "User",
      resourceId: parsed.data.email,
      metadata: { email: parsed.data.email, role: parsed.data.role },
    });

    revalidatePath("/dashboard/settings/members");
  }

  async function resendInvite(formData: FormData) {
    "use server";
    const sbRead = await createSupabaseServerClient();
    const {
      data: { user: aUser },
    } = await sbRead.auth.getUser();
    if (!aUser) throw new Error("Non autenticato");

    const me = await prisma.user.findUnique({
      where: { id: aUser.id },
      select: { id: true, role: true, organizationId: true },
    });
    if (!me?.organizationId) throw new Error("Non autenticato");
    if (me.role !== Role.ADMIN_KUBRI && me.role !== Role.ORG_ADMIN) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = resendInviteSchema.safeParse({ userId: formData.get("userId") });
    if (!parsed.success) throw new Error("Dati non validi");

    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organizationId: me.organizationId },
    });
    if (!target) throw new Error("Utente non trovato");

    const admin = createSupabaseAdminClient();
    const origin = await getAppOrigin();
    const { error } = await admin.auth.admin.inviteUserByEmail(target.email, {
      data: {
        name: target.name,
        role: target.role,
        organization_id: me.organizationId,
      },
      redirectTo: `${origin}/auth/callback?next=/auth/set-password`,
    });
    if (error) throw new Error(error.message);

    await logAudit({
      userId: me.id,
      organizationId: me.organizationId,
      action: "resend_invite",
      resourceType: "User",
      resourceId: target.id,
      metadata: { email: target.email },
    });

    revalidatePath("/dashboard/settings/members");
  }

  async function removeMember(formData: FormData) {
    "use server";
    const sbRead = await createSupabaseServerClient();
    const {
      data: { user: aUser },
    } = await sbRead.auth.getUser();
    if (!aUser) throw new Error("Non autenticato");

    const me = await prisma.user.findUnique({
      where: { id: aUser.id },
      select: { id: true, role: true, organizationId: true },
    });
    if (!me?.organizationId) throw new Error("Non autenticato");
    if (me.role !== Role.ADMIN_KUBRI && me.role !== Role.ORG_ADMIN) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = removeMemberSchema.safeParse({ userId: formData.get("userId") });
    if (!parsed.success) throw new Error("Dati non validi");
    if (parsed.data.userId === me.id) {
      throw new Error(strings.members.cannotRemoveSelf);
    }

    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organizationId: me.organizationId },
      select: { id: true, email: true },
    });
    if (!target) throw new Error("Utente non trovato");

    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.deleteUser(target.id);
    if (error) throw new Error(error.message);

    await logAudit({
      userId: me.id,
      organizationId: me.organizationId,
      action: "remove_member",
      resourceType: "User",
      resourceId: target.id,
      metadata: { email: target.email },
    });

    revalidatePath("/dashboard/settings/members");
  }

  async function changeRole(formData: FormData) {
    "use server";
    const sbRead = await createSupabaseServerClient();
    const {
      data: { user: aUser },
    } = await sbRead.auth.getUser();
    if (!aUser) throw new Error("Non autenticato");

    const me = await prisma.user.findUnique({
      where: { id: aUser.id },
      select: { id: true, role: true, organizationId: true },
    });
    if (!me?.organizationId) throw new Error("Non autenticato");
    if (me.role !== Role.ADMIN_KUBRI && me.role !== Role.ORG_ADMIN) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = changeRoleSchema.safeParse({
      userId: formData.get("userId"),
      role: formData.get("role"),
    });
    if (!parsed.success) throw new Error("Dati non validi");

    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organizationId: me.organizationId },
      select: { id: true, email: true, role: true, name: true },
    });
    if (!target) throw new Error("Utente non trovato");

    // Update Supabase user_metadata first so that if it fails, we haven't
    // diverged public.User from auth.users. The trigger only reads metadata
    // on insert (authz is read from public.User), so keeping metadata in
    // sync matters only for future invite resends and admin listings.
    const admin = createSupabaseAdminClient();
    const { error: metaError } = await admin.auth.admin.updateUserById(
      target.id,
      {
        user_metadata: {
          name: target.name,
          role: parsed.data.role,
          organization_id: me.organizationId,
        },
      },
    );
    if (metaError) throw new Error(metaError.message);

    await prisma.user.update({
      where: { id: target.id },
      data: { role: parsed.data.role as Role },
    });

    await logAudit({
      userId: me.id,
      organizationId: me.organizationId,
      action: "change_role",
      resourceType: "User",
      resourceId: target.id,
      metadata: { email: target.email, oldRole: target.role, newRole: parsed.data.role },
    });

    revalidatePath("/dashboard/settings/members");
  }

  const roleLabel = (role: Role): string => strings.roles[role] ?? role;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl tracking-tight">{strings.members.title}</h1>
          <p className="mt-1 text-muted-foreground">
            Gestisci i membri della tua organizzazione.
          </p>
        </div>
        {isAdmin && (
          <MembersActions
            inviteAction={inviteMember}
            removeAction={removeMember}
            changeRoleAction={changeRole}
            members={members.map((m) => ({
              id: m.id,
              name: m.name,
              email: m.email,
              role: m.role,
            }))}
            currentUserId={currentUser.id}
          />
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{strings.common.name}</TableHead>
            <TableHead>{strings.common.email}</TableHead>
            <TableHead>{strings.common.role}</TableHead>
            <TableHead>{strings.members.joinedAt}</TableHead>
            <TableHead>{strings.members.status}</TableHead>
            {isAdmin && (
              <TableHead className="text-right">{strings.common.actions}</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.id}>
              <TableCell className="font-medium">{member.name}</TableCell>
              <TableCell>{member.email}</TableCell>
              <TableCell>
                <Badge variant="secondary">{roleLabel(member.role)}</Badge>
              </TableCell>
              <TableCell>
                {member.createdAt.toLocaleDateString("it-IT")}
              </TableCell>
              <TableCell>
                {member.isPending ? (
                  <Badge variant="outline">{strings.members.pending}</Badge>
                ) : (
                  <Badge>{strings.members.active}</Badge>
                )}
              </TableCell>
              {isAdmin && (
                <TableCell className="text-right">
                  {member.id !== currentUser.id && (
                    <MemberRowActions
                      memberId={member.id}
                      memberRole={member.role}
                      isPending={member.isPending}
                      removeAction={removeMember}
                      changeRoleAction={changeRole}
                      resendInviteAction={resendInvite}
                    />
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
