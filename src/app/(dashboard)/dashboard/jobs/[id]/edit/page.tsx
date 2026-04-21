import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
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
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");
  if (session.user.role !== "ORG_ADMIN" && session.user.role !== "ADMIN_KUBRI") {
    redirect(`/dashboard/jobs/${id}`);
  }

  const jd = await getJobDescription({ id, organizationId: session.user.organizationId });
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
        }}
        action={boundAction}
      />
    </div>
  );
}
