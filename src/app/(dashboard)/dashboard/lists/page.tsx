import { requireOrganization } from "@/lib/auth-utils";
import { redirect } from "next/navigation";
import { getListsForOrg } from "@/lib/lists/service";
import { ListsManager } from "@/components/lists/lists-manager";
import { strings } from "@/lib/i18n/strings";

export default async function ListsPage() {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    redirect("/login");
  }

  const lists = user.organizationId
    ? await getListsForOrg(user.organizationId)
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl tracking-tight">{strings.pages.lists}</h1>
      <ListsManager lists={lists} />
    </div>
  );
}
