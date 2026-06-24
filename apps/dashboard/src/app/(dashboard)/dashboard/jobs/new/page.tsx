import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";
import { JobForm } from "@/components/jobs/job-form";
import { createJobAction } from "../actions";

export default async function NewJobPage() {
  const t = getDictionary(await getServerLocale());
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const currentUser = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { role: true, organizationId: true },
  });
  if (!currentUser?.organizationId) redirect("/login");
  if (currentUser.role !== "ORG_ADMIN" && currentUser.role !== "ADMIN_KUBRI") {
    redirect("/dashboard/jobs");
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl tracking-tight">{t.pages.jobNew}</h1>
      <JobForm mode="create" action={createJobAction} />
    </div>
  );
}
