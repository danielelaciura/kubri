import Link from "next/link";
import { AlertTriangle, Check, MapPin, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScoreBadge } from "./score-badge";
import { strings } from "@/lib/i18n/strings";
import type { RankedCandidate } from "@/lib/jobs/matcher";

interface MatchTableProps {
  ranked: RankedCandidate[];
}

export function MatchTable({ ranked }: MatchTableProps) {
  if (ranked.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        {strings.jobs.matchEmpty}
      </div>
    );
  }

  const fallback = ranked.some((r) => r.isFallback);

  return (
    <div className="space-y-2">
      {fallback && (
        <p className="text-sm text-muted-foreground">{strings.jobs.matchFallback}</p>
      )}
      <div className="rounded-lg border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[5.5rem]">{strings.jobs.score}</TableHead>
              <TableHead className="min-w-[12rem]">Candidato</TableHead>
              <TableHead className="hidden md:table-cell w-[12rem]">
                Preferenza
              </TableHead>
              <TableHead>{strings.jobs.matchSummaryHeading}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranked.map((r) => (
              <CandidateRow key={r.candidate.id} ranked={r} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CandidateRow({ ranked }: { ranked: RankedCandidate }) {
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
    <TableRow className="align-top">
      <TableCell className="py-3">
        <div className="flex flex-col items-start gap-1">
          <ScoreBadge value={score} />
          {isFallback && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {strings.jobs.lowMatchTag}
            </span>
          )}
        </div>
      </TableCell>

      <TableCell className="py-3">
        <Link
          href={`/dashboard/candidates/${candidate.id}`}
          className="font-medium text-foreground hover:underline"
        >
          {candidate.firstName} {candidate.lastName}
        </Link>
        {desiredJob && (
          <p className="text-xs text-muted-foreground mt-0.5">{desiredJob}</p>
        )}
        {/* Preferenza mobile: visibile sotto il nome quando la colonna dedicata è nascosta */}
        {preferred && (
          <p className="md:hidden text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {preferred}
          </p>
        )}
      </TableCell>

      <TableCell className="hidden md:table-cell py-3 text-sm text-muted-foreground">
        {preferred ? (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {preferred}
          </span>
        ) : (
          "—"
        )}
      </TableCell>

      <TableCell className="py-3">
        {hasLLM ? (
          <div className="space-y-2">
            {llm.summary && (
              <p className="text-sm leading-snug text-foreground/90">
                {llm.summary}
              </p>
            )}
            {hasAnyBadges && (
              <div className="flex flex-wrap gap-1.5">
                {llm!.matchedSkills.map((s) => (
                  <Badge
                    key={`m-${s}`}
                    variant="outline"
                    className="border-emerald-200 bg-emerald-50 text-emerald-900 text-xs gap-1"
                  >
                    <Check className="h-3 w-3 text-emerald-600" />
                    {s}
                  </Badge>
                ))}
                {llm!.missingSkills.map((s) => (
                  <Badge
                    key={`x-${s}`}
                    variant="outline"
                    className="text-xs gap-1 text-muted-foreground"
                  >
                    <X className="h-3 w-3 text-destructive" />
                    {s}
                  </Badge>
                ))}
                {llm!.redFlags.map((s) => (
                  <Badge
                    key={`r-${s}`}
                    variant="outline"
                    className="border-amber-300 bg-amber-50 text-amber-900 text-xs gap-1"
                  >
                    <AlertTriangle className="h-3 w-3 text-amber-600" />
                    {s}
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
      </TableCell>
    </TableRow>
  );
}
