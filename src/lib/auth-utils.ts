import { auth } from "@/lib/auth";
import type { Role } from "@/generated/prisma/client";

const ROLE_HIERARCHY: Record<Role, number> = {
  ADMIN_KUBRI: 3,
  ORG_ADMIN: 2,
  ORG_MEMBER: 1,
};

export async function getCurrentUser() {
  const session = await auth();

  if (!session?.user) {
    throw new Error("Non autenticato");
  }

  return session.user;
}

export async function requireRole(minimumRole: Role) {
  const user = await getCurrentUser();
  const userLevel = ROLE_HIERARCHY[user.role as Role] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[minimumRole];

  if (userLevel < requiredLevel) {
    throw new Error("Permessi insufficienti");
  }

  return user;
}

export async function requireOrganization() {
  const user = await getCurrentUser();

  if (!user.organizationId) {
    throw new Error("Nessuna organizzazione associata");
  }

  return user;
}
