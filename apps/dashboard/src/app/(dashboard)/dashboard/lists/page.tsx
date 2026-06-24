import { requireOrganization } from "@/lib/auth-utils";
import { redirect } from "next/navigation";
import { getListsForOrg } from "@/lib/lists/service";
import { ListsManager } from "@/components/lists/lists-manager";
import { CreateListMenu } from "@/components/lists/create-list-menu";
import { getServerLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n";

export default async function ListsPage() {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    redirect("/login");
  }

  const t = getDictionary(await getServerLocale());

  const lists = user.organizationId
    ? await getListsForOrg(user.organizationId)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl tracking-tight">{t.pages.lists}</h1>
          <p className="mt-1 text-muted-foreground">
            {t.lists.pageSubtitle}
          </p>
        </div>
        <CreateListMenu />
      </div>
      <ListsManager lists={lists} />
    </div>
  );
}
