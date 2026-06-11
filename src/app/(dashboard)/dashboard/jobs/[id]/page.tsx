import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { RefreshCw, Pencil } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";
import type { Dictionary } from "@/lib/i18n/types";
import { getJobDescription } from "@/lib/jobs/service";
import { getCandidatesForOrg } from "@/lib/candidates/service";
import { rankCandidates, type RankedCandidate } from "@/lib/jobs/matcher";
import { rerankCandidates } from "@/lib/llm/rerank";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MatchTable } from "@/components/jobs/match-table";
import { getListOptionsForOrg, getListIdsByCandidateForOrg } from "@/lib/lists/service";
import { DeleteJobButton } from "@/components/jobs/delete-job-button";
import { refreshCandidatesForJob } from "./actions";

interface JdForMatchingLocal {
  id: string;
  name: string;
  description: string;
  skills: string[];
  locationMunicipality: string | null;
  locationProvince: string | null;
  locationRegion: string | null;
  searchRadiusKm: number;
  embedding: number[] | null;
}

const LLM_RERANK_MIN_EMBEDDING_SCORE = 80;
const LLM_RERANK_MAX_CANDIDATES = 30;

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = getDictionary(await getServerLocale());
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
                {t.common.edit}
              </Button>
            </Link>
            <DeleteJobButton id={jd.id} />
          </div>
        )}
      </div>

      <Card className="shadow-sm border-border/60">
        <CardHeader>
          <CardTitle>{t.jobs.fieldDescription}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{jd.description}</p>
        </CardContent>
      </Card>

      {jd.skills.length > 0 && (
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>{t.jobs.fieldSkills}</CardTitle>
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
        <h2 className="text-lg ">{t.jobs.matchHeading}</h2>
        <form action={refreshCandidatesForJob}>
          <Button variant="outline" size="sm" type="submit" className="gap-1">
            <RefreshCw className="h-4 w-4" />
            {t.jobs.refreshMatches}
          </Button>
        </form>
      </div>

      <Suspense fallback={<MatchesLoading t={t} />}>
        <Matches jd={jd} orgId={me.organizationId} t={t} />
      </Suspense>
    </div>
  );
}

async function Matches({ jd, orgId, t }: { jd: JdForMatchingLocal; orgId: string; t: Dictionary }) {
  const [lists, membershipByCandidate] = await Promise.all([
    getListOptionsForOrg(orgId),
    getListIdsByCandidateForOrg(orgId),
  ]);

  let ranked: RankedCandidate[];
  try {
    const candidates = await getCandidatesForOrg(orgId);
    ranked = await rankCandidates(jd, candidates);
  } catch (e) {
    const isUnavailable =
      e instanceof Error && e.name === "MatchingUnavailableError";
    if (!isUnavailable) {
      console.error("[jobs/[id]] rankCandidates failed", e);
    }
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {isUnavailable ? t.jobs.matchUnavailable : t.jobs.matchLoadError}
      </div>
    );
  }

  // LLM rerank: only candidates with embedding score >= threshold are sent to
  // Mistral, capped to LLM_RERANK_MAX_CANDIDATES. The final UI shows ONLY
  // candidates that received an LLM evaluation — anything below the embedding
  // threshold is intentionally hidden.
  const toRerank = ranked
    .filter((r) => r.match.final >= LLM_RERANK_MIN_EMBEDDING_SCORE)
    .slice(0, LLM_RERANK_MAX_CANDIDATES);

  if (toRerank.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {t.jobs.matchNoAffinity}
      </div>
    );
  }

  let enriched: RankedCandidate[];
  try {
    const enrichments = await rerankCandidates(jd.id, {
      jd: {
        name: jd.name,
        description: jd.description,
        skills: jd.skills,
        locationMunicipality: jd.locationMunicipality,
      },
      candidates: toRerank.map((r) => r.candidate),
    });
    const byId = new Map(enrichments.map((e) => [e.candidateId, e]));
    enriched = toRerank.flatMap((r) => {
      const enrichment = byId.get(r.candidate.id);
      return enrichment ? [{ ...r, llm: enrichment }] : [];
    });
    enriched.sort((a, b) => (b.llm?.score ?? -1) - (a.llm?.score ?? -1));
  } catch (e) {
    console.error("[jobs/[id]] rerankCandidates failed", e);
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {t.jobs.aiRerankError}
      </div>
    );
  }

  return <MatchTable ranked={enriched} lists={lists} membershipByCandidate={membershipByCandidate} t={t} />;
}

function MatchesLoading({ t }: { t: Dictionary }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-8 text-center text-sm text-muted-foreground">
      {t.jobs.matchCalculating}
    </div>
  );
}
