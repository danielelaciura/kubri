import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, MapPin, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
    <div className="space-y-3">
      {fallback && (
        <p className="text-sm text-muted-foreground">{strings.jobs.matchFallback}</p>
      )}
      <ul className="space-y-3">
        {ranked.map((r) => (
          <li key={r.candidate.id}>
            <CandidateCard ranked={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CandidateCard({ ranked }: { ranked: RankedCandidate }) {
  const { candidate, llm, isFallback } = ranked;
  const score = llm?.score ?? ranked.match.final;
  const desiredJob = candidate.jobPreferences.desiredJob?.trim() || null;
  const preferred = candidate.jobPreferences.preferredLocation?.trim() || null;
  const hasLLM = !!llm;
  const hasMatched = (llm?.matchedSkills.length ?? 0) > 0;
  const hasMissing = (llm?.missingSkills.length ?? 0) > 0;
  const hasRedFlags = (llm?.redFlags.length ?? 0) > 0;

  return (
    <article className="rounded-lg border border-border/60 bg-card shadow-sm transition-colors hover:border-border">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:gap-5">
        {/* LEFT — score + identity */}
        <div className="flex shrink-0 items-start gap-4 sm:flex-col sm:items-center sm:gap-3 sm:w-24">
          <ScoreBadge value={score} size="lg" />
          {isFallback && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-center">
              {strings.jobs.lowMatchTag}
            </span>
          )}
        </div>

        {/* MIDDLE — main content */}
        <div className="min-w-0 flex-1 space-y-3">
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link
              href={`/dashboard/candidates/${candidate.id}`}
              className="text-base font-semibold text-foreground hover:underline"
            >
              {candidate.firstName} {candidate.lastName}
            </Link>
            {desiredJob && (
              <span className="text-sm text-muted-foreground">· {desiredJob}</span>
            )}
          </header>

          {preferred && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              <span>
                <span className="font-medium">{strings.jobs.preferredLocationLabel}:</span>{" "}
                {preferred}
              </span>
            </p>
          )}

          {hasLLM && llm.summary && (
            <Section title={strings.jobs.matchSummaryHeading}>
              <p className="text-sm text-foreground/90">{llm.summary}</p>
            </Section>
          )}

          {hasMatched && (
            <Section
              title={strings.jobs.matchedSkillsHeading}
              icon={<Check className="h-3.5 w-3.5 text-emerald-600" />}
            >
              <BadgeList items={llm!.matchedSkills} tone="success" />
            </Section>
          )}

          {hasMissing && (
            <Section
              title={strings.jobs.missingSkillsHeading}
              icon={<X className="h-3.5 w-3.5 text-destructive" />}
            >
              <BadgeList items={llm!.missingSkills} tone="muted" />
            </Section>
          )}

          {hasRedFlags && (
            <Section
              title={strings.jobs.redFlagsHeading}
              icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
            >
              <BadgeList items={llm!.redFlags} tone="warning" />
            </Section>
          )}

          {!hasLLM && (
            <Section title="Competenze">
              <BadgeList
                items={candidate.skillsAndCompetences.slice(0, 5)}
                tone="muted"
              />
            </Section>
          )}
        </div>

        {/* RIGHT — quick action */}
        <div className="shrink-0 sm:self-center">
          <Link
            href={`/dashboard/candidates/${candidate.id}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {strings.jobs.viewCandidateAction}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </article>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function BadgeList({
  items,
  tone,
}: {
  items: string[];
  tone: "success" | "warning" | "muted";
}) {
  const classes =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "warning"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-border bg-muted/40 text-foreground";
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <Badge key={s} variant="outline" className={`text-xs ${classes}`}>
          {s}
        </Badge>
      ))}
    </div>
  );
}
