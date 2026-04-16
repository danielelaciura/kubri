import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { strings } from "@/lib/i18n/strings";
import { JobForm } from "@/components/jobs/job-form";
import { createJobAction } from "../actions";

export default async function NewJobPage() {
  const session = await auth();
  if (!session?.user?.organizationId) redirect("/login");
  if (session.user.role !== "ORG_ADMIN") redirect("/dashboard/jobs");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{strings.pages.jobNew}</h1>
      <JobForm mode="create" action={createJobAction} />
    </div>
  );
}
