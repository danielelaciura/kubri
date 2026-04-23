"use client";

import Link from "next/link";
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
              <TableHead>Competenze</TableHead>
              <TableHead>{strings.jobs.score}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranked.map((r) => (
              <TableRow key={r.candidate.id} className="hover:bg-muted/50">
                <TableCell className="font-medium">
                  <Link
                    href={`/dashboard/candidates/${r.candidate.id}`}
                    className="block hover:underline"
                  >
                    {r.candidate.firstName} {r.candidate.lastName}
                  </Link>
                </TableCell>
                <TableCell>{r.candidate.jobPreferences.preferredLocation || "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {r.candidate.skillsAndCompetences.slice(0, 3).map((s) => (
                      <Badge key={s} variant="secondary" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ScoreBadge value={r.match.final} />
                    {r.isFallback && (
                      <span className="text-xs text-muted-foreground">
                        {strings.jobs.lowMatchTag}
                      </span>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
