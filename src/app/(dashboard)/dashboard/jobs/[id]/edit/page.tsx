import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { strings } from "@/lib/i18n/strings";
import { getJobDescription } from "@/lib/jobs/service";
import { JobForm } from "@/components/jobs/job-form";
import { updateJobAction } from "../actions";

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const me = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { role: true, organizationId: true },
  });
  if (!me?.organizationId) redirect("/login");
  if (me.role !== "ORG_ADMIN" && me.role !== "ADMIN_KUBRI") {
    redirect(`/dashboard/jobs/${id}`);
  }

  const jd = await getJobDescription({ id, organizationId: me.organizationId });
  if (!jd) notFound();

  const boundAction = async (formData: FormData) => {
    "use server";
    return updateJobAction(id, formData);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl tracking-tight">{strings.pages.jobEdit}</h1>
      <JobForm
        mode="edit"
        initial={{
          name: jd.name,
          locationRaw: jd.locationRaw,
          description: jd.description,
          skills: jd.skills,
          searchRadiusKm: jd.searchRadiusKm,
        }}
        action={boundAction}
      />
    </div>
  );
}
