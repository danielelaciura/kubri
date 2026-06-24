import Link from "next/link";
import { AlertTriangle, Check, MapPin, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScoreBadge } from "./score-badge";
import type { Dictionary } from "@/lib/i18n/types";
import type { RankedCandidate } from "@/lib/jobs/matcher";
import { AddToListMenu } from "@/components/lists/add-to-list-menu";

interface MatchTableProps {
  ranked: RankedCandidate[];
  lists: { id: string; name: string }[];
  membershipByCandidate: Record<string, string[]>;
  t: Dictionary;
}

export function MatchTable({ ranked, lists, membershipByCandidate, t }: MatchTableProps) {
  if (ranked.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {t.jobs.matchEmpty}
      </div>
    );
  }

  const fallback = ranked.some((r) => r.isFallback);

  return (
    <div className="space-y-2">
      {fallback && (
        <p className="text-sm text-muted-foreground">{t.jobs.matchFallback}</p>
      )}
      <div className="overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
        <div
          role="row"
          className="hidden md:grid grid-cols-[5.5rem_minmax(10rem,1.2fr)_minmax(8rem,1fr)_minmax(0,2.4fr)_auto] gap-4 border-b border-border/60 bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          <span>{t.jobs.score}</span>
          <span>{t.jobs.candidateColumn}</span>
          <span>{t.jobs.preferredLocationLabel}</span>
          <span>{t.jobs.matchSummaryHeading}</span>
          <span />
        </div>
        <ul role="rowgroup" className="divide-y divide-border/60">
          {ranked.map((r) => (
            <li key={r.candidate.id}>
              <CandidateRow ranked={r} lists={lists} membershipByCandidate={membershipByCandidate} t={t} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CandidateRow({
  ranked,
  lists,
  membershipByCandidate,
  t,
}: {
  ranked: RankedCandidate;
  lists: { id: string; name: string }[];
  membershipByCandidate: Record<string, string[]>;
  t: Dictionary;
}) {
  const { candidate, llm, isFallback } = ranked;
  const score = llm?.score ?? ranked.match.final;
  const desiredJob = candidate.jobPreferences.desiredJob?.trim() || null;
  const preferred = candidate.jobPreferences.preferredLocation?.trim() || null;
  const hasLLM = !!llm;
  const hasMatched = (llm?.matchedSkills.length ?? 0) > 0;
  const hasMissing = (llm?.missingSkills.length ?? 0) > 0;
  const hasRedFlags = (llm?.redFlags.length ?? 0) > 0;
  const hasAnyBadges = hasMatched || hasMissing || hasRedFlags;

  return (
    <div
      role="row"
      className="grid grid-cols-1 md:grid-cols-[5.5rem_minmax(10rem,1.2fr)_minmax(8rem,1fr)_minmax(0,2.4fr)_auto] gap-x-4 gap-y-2 px-4 py-3"
    >
      {/* Score */}
      <div className="flex items-start gap-2 md:flex-col md:items-start md:gap-1">
        <ScoreBadge value={score} />
        {isFallback && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t.jobs.lowMatchTag}
          </span>
        )}
      </div>

      {/* Candidate */}
      <div className="min-w-0">
        <Link
          href={`/dashboard/candidates/${candidate.id}`}
          className="block truncate font-medium text-foreground hover:underline"
        >
          {candidate.firstName} {candidate.lastName}
        </Link>
        {desiredJob && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{desiredJob}</p>
        )}
        {/* Mobile: preferred location inline below name */}
        {preferred && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground md:hidden">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{preferred}</span>
          </p>
        )}
      </div>

      {/* Preferred location (desktop column) */}
      <div className="hidden min-w-0 text-sm text-muted-foreground md:block">
        {preferred ? (
          <span className="flex items-start gap-1">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-words">{preferred}</span>
          </span>
        ) : (
          <span>—</span>
        )}
      </div>

      {/* AI evaluation */}
      <div className="min-w-0">
        {hasLLM ? (
          <div className="space-y-2">
            {llm.summary && (
              <p className="text-sm leading-snug text-foreground/90">{llm.summary}</p>
            )}
            {hasAnyBadges && (
              <div className="flex flex-wrap gap-1.5">
                {llm.matchedSkills.map((s) => (
                  <Badge
                    key={`m-${s}`}
                    variant="outline"
                    className="border-emerald-200 bg-emerald-50 text-emerald-900 text-xs gap-1 max-w-full whitespace-normal"
                  >
                    <Check className="h-3 w-3 shrink-0 text-emerald-600" />
                    <span className="truncate">{s}</span>
                  </Badge>
                ))}
                {llm.missingSkills.map((s) => (
                  <Badge
                    key={`x-${s}`}
                    variant="outline"
                    className="text-xs gap-1 text-muted-foreground max-w-full whitespace-normal"
                  >
                    <X className="h-3 w-3 shrink-0 text-destructive" />
                    <span className="truncate">{s}</span>
                  </Badge>
                ))}
                {llm.redFlags.map((s) => (
                  <Badge
                    key={`r-${s}`}
                    variant="outline"
                    className="border-amber-300 bg-amber-50 text-amber-900 text-xs gap-1 max-w-full whitespace-normal"
                  >
                    <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
                    <span className="truncate">{s}</span>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {candidate.skillsAndCompetences.slice(0, 4).map((s) => (
              <Badge key={s} variant="secondary" className="text-xs">
                {s}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* List menu */}
      <div className="flex items-start justify-end">
        <AddToListMenu
          candidateId={candidate.id}
          lists={lists}
          memberOf={membershipByCandidate[candidate.id] ?? []}
        />
      </div>
    </div>
  );
}
