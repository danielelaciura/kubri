import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const organization = await prisma.organization.findFirst({
    where: { id: session.user.organizationId },
    select: { name: true },
  });

  return (
    <DashboardShell
      userName={session.user.name ?? "Utente"}
      organizationName={organization?.name ?? "Organizzazione"}
      isAdmin={session.user.role === Role.ADMIN_KUBRI}
      isOrgAdmin={
        session.user.role === Role.ORG_ADMIN ||
        session.user.role === Role.ADMIN_KUBRI
      }
    >
      {children}
    </DashboardShell>
  );
}
