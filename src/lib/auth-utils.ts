import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import type { Role } from "@/generated/prisma/client";

const ROLE_HIERARCHY: Record<Role, number> = {
  ADMIN_KUBRI: 3,
  ORG_ADMIN: 2,
  ORG_MEMBER: 1,
};

export function hasMinimumRole(userRole: Role, minimumRole: Role): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= ROLE_HIERARCHY[minimumRole];
}

export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    throw new Error("Non autenticato");
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      organizationId: true,
    },
  });

  if (!dbUser) {
    throw new Error("Utente non trovato");
  }

  return dbUser;
}

export async function requireRole(minimumRole: Role) {
  const user = await getCurrentUser();

  if (!hasMinimumRole(user.role, minimumRole)) {
    throw new Error("Permessi insufficienti");
  }

  return user;
}

export async function requireOrganization() {
  const user = await getCurrentUser();

  if (!user.organizationId) {
    throw new Error("Nessuna organizzazione associata");
  }

  return user as typeof user & { organizationId: string };
}
