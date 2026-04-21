import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/password";
import { logAudit } from "@/lib/audit";
import {
  inviteMemberSchema,
  removeMemberSchema,
  changeRoleSchema,
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

export default async function MembersPage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");

  const userRole = session.user.role as Role;
  const isAdmin = userRole === Role.ADMIN_KUBRI || userRole === Role.ORG_ADMIN;

  const members = await prisma.user.findMany({
    where: { organizationId: session.user.organizationId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  async function inviteMember(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user?.organizationId) throw new Error("Non autenticato");

    const role = s.user.role as Role;
    if (role !== Role.ADMIN_KUBRI && role !== Role.ORG_ADMIN) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = inviteMemberSchema.safeParse({
      email: formData.get("email"),
      name: formData.get("name"),
      role: formData.get("role"),
      temporaryPassword: formData.get("temporaryPassword"),
    });

    if (!parsed.success) {
      throw new Error("Dati non validi");
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (existing) {
      throw new Error(strings.members.emailExists);
    }

    const passwordHash = await hashPassword(parsed.data.temporaryPassword);

    const newUser = await prisma.user.create({
      data: {
        email: parsed.data.email,
        name: parsed.data.name,
        role: parsed.data.role as Role,
        passwordHash,
        organizationId: s.user.organizationId,
      },
    });

    await logAudit({
      userId: s.user.id,
      organizationId: s.user.organizationId,
      action: "invite_member",
      resourceType: "User",
      resourceId: newUser.id,
      metadata: {
        email: parsed.data.email,
        role: parsed.data.role,
      },
    });

    revalidatePath("/dashboard/settings/members");
  }

  async function removeMember(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user?.organizationId) throw new Error("Non autenticato");

    const role = s.user.role as Role;
    if (role !== Role.ADMIN_KUBRI && role !== Role.ORG_ADMIN) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = removeMemberSchema.safeParse({
      userId: formData.get("userId"),
    });

    if (!parsed.success) {
      throw new Error("Dati non validi");
    }

    if (parsed.data.userId === s.user.id) {
      throw new Error(strings.members.cannotRemoveSelf);
    }

    // Verify user belongs to same org
    const target = await prisma.user.findFirst({
      where: {
        id: parsed.data.userId,
        organizationId: s.user.organizationId,
      },
    });

    if (!target) {
      throw new Error("Utente non trovato");
    }

    await prisma.user.delete({
      where: { id: parsed.data.userId },
    });

    await logAudit({
      userId: s.user.id,
      organizationId: s.user.organizationId,
      action: "remove_member",
      resourceType: "User",
      resourceId: parsed.data.userId,
      metadata: { email: target.email },
    });

    revalidatePath("/dashboard/settings/members");
  }

  async function changeRole(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user?.organizationId) throw new Error("Non autenticato");

    const role = s.user.role as Role;
    if (role !== Role.ADMIN_KUBRI && role !== Role.ORG_ADMIN) {
      throw new Error("Permessi insufficienti");
    }

    const parsed = changeRoleSchema.safeParse({
      userId: formData.get("userId"),
      role: formData.get("role"),
    });

    if (!parsed.success) {
      throw new Error("Dati non validi");
    }

    // Verify user belongs to same org
    const target = await prisma.user.findFirst({
      where: {
        id: parsed.data.userId,
        organizationId: s.user.organizationId,
      },
    });

    if (!target) {
      throw new Error("Utente non trovato");
    }

    await prisma.user.update({
      where: { id: parsed.data.userId },
      data: { role: parsed.data.role as Role },
    });

    await logAudit({
      userId: s.user.id,
      organizationId: s.user.organizationId,
      action: "change_role",
      resourceType: "User",
      resourceId: parsed.data.userId,
      metadata: {
        email: target.email,
        oldRole: target.role,
        newRole: parsed.data.role,
      },
    });

    revalidatePath("/dashboard/settings/members");
  }

  const roleLabel = (role: Role): string => {
    return strings.roles[role] ?? role;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl tracking-tight">
            {strings.members.title}
          </h1>
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
            currentUserId={session.user.id}
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
            {isAdmin && (
              <TableHead className="text-right">
                {strings.common.actions}
              </TableHead>
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
              {isAdmin && (
                <TableCell className="text-right">
                  {member.id !== session.user.id && (
                    <MemberRowActions
                      memberId={member.id}
                      memberRole={member.role}
                      removeAction={removeMember}
                      changeRoleAction={changeRole}
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

function MemberRowActions({
  memberId,
  memberRole,
  removeAction,
  changeRoleAction,
}: {
  memberId: string;
  memberRole: Role;
  removeAction: (formData: FormData) => Promise<void>;
  changeRoleAction: (formData: FormData) => Promise<void>;
}) {
  const newRole = memberRole === Role.ORG_ADMIN ? "ORG_MEMBER" : "ORG_ADMIN";
  const newRoleLabel =
    memberRole === Role.ORG_ADMIN
      ? strings.roles.ORG_MEMBER
      : strings.roles.ORG_ADMIN;

  return (
    <div className="flex items-center justify-end gap-1">
      {memberRole !== Role.ADMIN_KUBRI && (
        <form action={changeRoleAction}>
          <input type="hidden" name="userId" value={memberId} />
          <input type="hidden" name="role" value={newRole} />
          <button
            type="submit"
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {newRoleLabel}
          </button>
        </form>
      )}
      <form action={removeAction}>
        <input type="hidden" name="userId" value={memberId} />
        <button
          type="submit"
          className="rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
        >
          {strings.members.remove}
        </button>
      </form>
    </div>
  );
}
