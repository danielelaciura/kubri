import { auth } from "@/lib/auth";
import type { Role } from "@/generated/prisma/client";

export async function getCurrentUser() {
  const session = await auth();

  if (!session?.user) {
    throw new Error("Non autenticato");
  }

  return session.user;
}

export async function requireRole(role: Role) {
  const user = await getCurrentUser();

  if (user.role !== role) {
    throw new Error("Permessi insufficienti");
  }

  return user;
}

export async function requireOrganization() {
  const user = await getCurrentUser();

  if (!user.organizationId) {
    throw new Error("Nessuna organizzazione associata");
  }

  return user.organizationId;
}
