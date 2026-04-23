import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { SessionTracker } from "@/components/auth/session-tracker";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    redirect("/login");
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { name: true, role: true, organizationId: true },
  });

  if (!dbUser) {
    redirect("/login");
  }

  const organization = dbUser.organizationId
    ? await prisma.organization.findUnique({
        where: { id: dbUser.organizationId },
        select: { name: true },
      })
    : null;

  return (
    <>
      <SessionTracker />
      <DashboardShell
        userName={dbUser.name ?? "Utente"}
        organizationName={organization?.name ?? "Organizzazione"}
        isAdmin={dbUser.role === Role.ADMIN_KUBRI}
      >
        {children}
      </DashboardShell>
    </>
  );
}
