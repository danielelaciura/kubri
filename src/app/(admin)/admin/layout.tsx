import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    redirect("/login");
  }

  if (user.role !== Role.ADMIN_KUBRI) {
    redirect("/dashboard");
  }

  const organization = user.organizationId
    ? await prisma.organization.findFirst({
        where: { id: user.organizationId },
        select: { name: true },
      })
    : null;

  return (
    <DashboardShell
      userName={user.name ?? "Utente"}
      organizationName={organization?.name ?? "Kubri"}
      isAdmin={true}
      isOrgAdmin={true}
    >
      {children}
    </DashboardShell>
  );
}
