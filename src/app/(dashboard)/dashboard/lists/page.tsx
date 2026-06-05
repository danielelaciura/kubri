import { requireOrganization } from "@/lib/auth-utils";
import { redirect } from "next/navigation";
import { getListsForOrg } from "@/lib/lists/service";
import { ListsManager } from "@/components/lists/lists-manager";
import { CreateListMenu } from "@/components/lists/create-list-menu";
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl tracking-tight">{strings.pages.lists}</h1>
        <CreateListMenu />
      </div>
      <ListsManager lists={lists} />
    </div>
  );
}
