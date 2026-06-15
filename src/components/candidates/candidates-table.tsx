"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { Candidate, PaginatedResult, SortConfig } from "@/types";
import type { Locale } from "@/lib/i18n/types";
import { displayCountry } from "@/lib/candidates/country";
import { AddToListMenu } from "@/components/lists/add-to-list-menu";

interface CandidatesTableProps {
  result: PaginatedResult<Candidate>;
  sort: SortConfig;
  lists: { id: string; name: string }[];
  membershipByCandidate: Record<string, string[]>;
  locale: Locale;
}

export function CandidatesTable({ result, sort, lists, membershipByCandidate, locale }: CandidatesTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: candidates, page, totalPages, total } = result;

  const handleSort = (field: SortConfig["field"]) => {
    const params = new URLSearchParams(searchParams.toString());
    if (sort.field === field) {
      params.set("sortDir", sort.direction === "asc" ? "desc" : "asc");
    } else {
      params.set("sortField", field);
      params.set("sortDir", "asc");
    }
    params.delete("page");
    router.push(`/dashboard/candidates?${params.toString()}`);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(newPage));
    router.push(`/dashboard/candidates?${params.toString()}`);
  };

  const handlePageSizeChange = (newSize: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pageSize", String(newSize));
    params.delete("page");
    router.push(`/dashboard/candidates?${params.toString()}`);
  };

  const handleRowClick = (id: string) => {
    const params = searchParams.toString();
    const returnUrl = params ? `?${params}` : "";
    router.push(`/dashboard/candidates/${id}?returnParams=${encodeURIComponent(returnUrl)}`);
  };

  const SortButton = ({ field, label }: { field: SortConfig["field"]; label: string }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 hover:text-foreground uppercase"
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );

  const formatDate = (date: Date) =>
    date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });

  const renderTags = (items: string[], max: number = 2) => {
    const visible = items.slice(0, max);
    const overflow = items.length - max;
    return (
      <div className="flex flex-wrap gap-1">
        {visible.map((item) => (
          <Badge
            key={item}
            variant="outline"
            className="text-xs font-normal border-border/70 text-muted-foreground bg-transparent"
          >
            {item}
          </Badge>
        ))}
        {overflow > 0 && (
          <Badge
            variant="outline"
            className="text-xs font-normal border-border/70 text-muted-foreground bg-transparent"
          >
            +{overflow}
          </Badge>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="rounded-lg border border-border/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">
                <SortButton field="lastName" label="Cognome" />
              </TableHead>
              <TableHead className="w-40">Nome</TableHead>
              <TableHead>Zona di lavoro</TableHead>
              <TableHead>Paese di origine</TableHead>
              {/* <TableHead>Lingue</TableHead> */}
              <TableHead>Competenze</TableHead>
              {/* <TableHead>Indirizzo</TableHead> */}
              {/* <TableHead>
                <SortButton field="createdAt" label="Data" />
              </TableHead> */}
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((candidate) => (
              <TableRow
                key={candidate.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => handleRowClick(candidate.id)}
              >
                <TableCell>
                 {candidate.lastName}
                </TableCell>
                <TableCell>
                  {candidate.firstName} 
                </TableCell>
                <TableCell>
                  {candidate.jobPreferences.preferredLocation}
                </TableCell>
                <TableCell>{displayCountry(candidate.countryOfOrigin, locale)}</TableCell>
                {/* <TableCell>
                  {candidate.languages.language && (
                    <Badge variant="secondary" className="text-xs capitalize">
                      {candidate.languages.language}
                    </Badge>
                  )}
                </TableCell> */}
                <TableCell>{renderTags(candidate.skillsAndCompetences, 3)}</TableCell>
                {/* <TableCell className="max-w-[140px] truncate">{candidate.address}</TableCell> */}
                {/* <TableCell>{formatDate(candidate.createdAt)}</TableCell> */}
                <TableCell className="w-12" onClick={(e) => e.stopPropagation()}>
                  <AddToListMenu
                    candidateId={candidate.id}
                    lists={lists}
                    memberOf={membershipByCandidate[candidate.id] ?? []}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {total} candidati totali
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm">Righe per pagina:</span>
            <select
              value={result.pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {[10, 25, 50].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => handlePageChange(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              Pagina {page} di {totalPages || 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => handlePageChange(page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
