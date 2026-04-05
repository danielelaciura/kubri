import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== Role.ADMIN_KUBRI) {
    redirect("/dashboard");
  }

  const organization = await prisma.organization.findFirst({
    where: { id: session.user.organizationId },
    select: { name: true },
  });

  return (
    <DashboardShell
      userName={session.user.name ?? "Utente"}
      organizationName={organization?.name ?? "Kubri"}
      isAdmin={true}
    >
      {children}
    </DashboardShell>
  );
}
