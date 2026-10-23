import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrganization } from "@/lib/auth-utils";
import { getOrgWritablePools } from "@/lib/pools/access";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";
import { Button } from "@/components/ui/button";
import { NewCandidateModes } from "@/components/candidates/create/new-candidate-modes";

interface NewCandidatePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewCandidatePage({ searchParams }: NewCandidatePageProps) {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    redirect("/login");
  }
  const t = getDictionary(await getServerLocale());
  const mode = (await searchParams)["mode"] === "manual" ? "manual" : "upload";
  const pools = (await getOrgWritablePools(user.organizationId)).map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/dashboard/candidates">
        <Button variant="ghost" size="sm" className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          {t.candidates.backToList}
        </Button>
      </Link>
      <div>
        <h1 className="text-2xl tracking-tight">{t.candidateCreate.newCandidate}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.candidateCreate.pageDescription}</p>
      </div>
      {pools.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t.candidateCreate.noWritablePools}
        </p>
      ) : (
        <NewCandidateModes mode={mode} pools={pools} />
      )}
    </div>
  );
}
