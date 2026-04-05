import { z } from "zod/v4";
import type { CandidateFilters, SortConfig } from "@/types";

export const candidateFiltersSchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  languages: z.string().optional(),
  nationality: z.string().optional(),
  city: z.string().optional(),
  availability: z.enum(["immediate", "within_1_month", "other"]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sortField: z.enum(["name", "createdAt", "interviewStatus"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().min(1).optional().default(1),
  pageSize: z.coerce.number().min(10).max(100).optional().default(25),
});

export type ParsedFilterParams = z.infer<typeof candidateFiltersSchema>;

export function toFiltersAndSort(params: ParsedFilterParams): {
  filters: CandidateFilters;
  sort: SortConfig;
  page: number;
  pageSize: number;
} {
  const filters: CandidateFilters = {};

  if (params.search) filters.search = params.search;
  if (params.status) {
    filters.status = params.status.split(",").filter(Boolean) as CandidateFilters["status"];
  }
  if (params.languages) {
    filters.languages = params.languages.split(",").filter(Boolean);
  }
  if (params.nationality) filters.nationality = params.nationality;
  if (params.city) filters.city = params.city;
  if (params.availability) filters.availability = params.availability;
  if (params.dateFrom) filters.dateFrom = new Date(params.dateFrom);
  if (params.dateTo) filters.dateTo = new Date(params.dateTo);

  const sort: SortConfig = {
    field: params.sortField ?? "createdAt",
    direction: params.sortDir ?? "desc",
  };

  return { filters, sort, page: params.page, pageSize: params.pageSize };
}
