"use client";

import Link from "next/link";
import { AlertTriangle, Check, X } from "lucide-react";
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
              <TableHead>Candidato</TableHead>
              <TableHead>Località preferita</TableHead>
              <TableHead className="min-w-[280px]">Valutazione AI</TableHead>
              <TableHead>{strings.jobs.score}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranked.map((r) => {
              const score = r.llm?.score ?? r.match.final;
              return (
                <TableRow key={r.candidate.id} className="hover:bg-muted/50 align-top">
                  <TableCell className="font-medium">
                    <Link
                      href={`/dashboard/candidates/${r.candidate.id}`}
                      className="block hover:underline"
                    >
                      {r.candidate.firstName} {r.candidate.lastName}
                    </Link>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {r.candidate.jobPreferences.desiredJob || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.candidate.jobPreferences.preferredLocation || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.llm ? (
                      <div className="space-y-1.5">
                        <p className="text-foreground">{r.llm.summary}</p>
                        {r.llm.matchedSkills.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {r.llm.matchedSkills.slice(0, 4).map((s) => (
                              <Badge key={s} variant="secondary" className="gap-1 text-xs">
                                <Check className="h-3 w-3 text-green-600" />
                                {s}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {r.llm.missingSkills.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {r.llm.missingSkills.slice(0, 3).map((s) => (
                              <Badge key={s} variant="outline" className="gap-1 text-xs text-muted-foreground">
                                <X className="h-3 w-3 text-destructive" />
                                {s}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {r.llm.redFlags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {r.llm.redFlags.map((s) => (
                              <Badge key={s} variant="outline" className="gap-1 text-xs border-amber-400 text-amber-800">
                                <AlertTriangle className="h-3 w-3 text-amber-600" />
                                {s}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {r.candidate.skillsAndCompetences.slice(0, 3).map((s) => (
                          <Badge key={s} variant="secondary" className="text-xs">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ScoreBadge value={score} />
                      {r.isFallback && (
                        <span className="text-xs text-muted-foreground">
                          {strings.jobs.lowMatchTag}
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
