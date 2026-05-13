import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { RefreshCw, Pencil } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { strings } from "@/lib/i18n/strings";
import { getJobDescription } from "@/lib/jobs/service";
import { getCandidatesForOrg } from "@/lib/make/service";
import { rankCandidates } from "@/lib/jobs/matcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MatchTable } from "@/components/jobs/match-table";
import { DeleteJobButton } from "@/components/jobs/delete-job-button";
import { refreshCandidatesForJob } from "./actions";

interface JdForMatchingLocal {
  description: string;
  skills: string[];
  locationMunicipality: string | null;
  locationProvince: string | null;
  locationRegion: string | null;
  embedding: number[] | null;
}

export default async function JobDetailPage({
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

  const jd = await getJobDescription({ id, organizationId: me.organizationId });
  if (!jd) notFound();
  const isAdmin = me.role === "ORG_ADMIN";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl tracking-tight">{jd.name}</h1>
          <span className="font-medium mt-md">
            {jd.locationRaw}
            {jd.locationRegion && jd.locationRaw !== jd.locationRegion && (
              <> · {jd.locationRegion}</>
            )}
            {" · "}
            {jd.searchRadiusKm} km
          </span>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Link href={`/dashboard/jobs/${jd.id}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="mr-1 h-4 w-4" />
                {strings.common.edit}
              </Button>
            </Link>
            <DeleteJobButton id={jd.id} />
          </div>
        )}
      </div>

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>{strings.jobs.fieldDescription}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{jd.description}</p>
        </CardContent>
      </Card>

      {jd.skills.length > 0 && (
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>{strings.jobs.fieldSkills}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {jd.skills.map((s) => (
                <Badge key={s} variant="outline">
                  {s}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg ">{strings.jobs.matchHeading}</h2>
        <form action={refreshCandidatesForJob}>
          <Button variant="outline" size="sm" type="submit" className="gap-1">
            <RefreshCw className="h-4 w-4" />
            {strings.jobs.refreshMatches}
          </Button>
        </form>
      </div>

      <Suspense fallback={<MatchesLoading />}>
        <Matches jd={jd} orgId={me.organizationId} />
      </Suspense>
    </div>
  );
}

async function Matches({ jd, orgId }: { jd: JdForMatchingLocal; orgId: string }) {
  try {
    const candidates = await getCandidatesForOrg(orgId);
    const ranked = await rankCandidates(jd, candidates);
    return <MatchTable ranked={ranked} />;
  } catch (e) {
    const isUnavailable =
      e instanceof Error && e.name === "MatchingUnavailableError";
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {isUnavailable
          ? "Matching non ancora disponibile: l'embedding di questa offerta è in elaborazione."
          : "Impossibile caricare i candidati. Riprova più tardi."}
      </div>
    );
  }
}

function MatchesLoading() {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-8 text-center text-sm text-muted-foreground">
      Calcolo delle corrispondenze…
    </div>
  );
}
