import type { Candidate, CandidateFilters, SortConfig, PaginatedResult } from "@/types";

const STATUS_ORDER: Record<string, number> = {
  completed: 0,
  in_progress: 1,
  abandoned: 2,
  incomplete: 3,
};

export function filterCandidates(
  candidates: Candidate[],
  filters: CandidateFilters
): Candidate[] {
  return candidates.filter((c) => {
    if (filters.status && filters.status.length > 0) {
      if (!filters.status.includes(c.interviewStatus)) return false;
    }

    if (filters.languages && filters.languages.length > 0) {
      const has = filters.languages.some((lang) =>
        c.languages.some((cl) => cl.toLowerCase() === lang.toLowerCase())
      );
      if (!has) return false;
    }

    if (filters.nationality) {
      if (!c.nationality.toLowerCase().includes(filters.nationality.toLowerCase())) {
        return false;
      }
    }

    if (filters.city) {
      if (!c.city.toLowerCase().includes(filters.city.toLowerCase())) {
        return false;
      }
    }

    if (filters.availability) {
      if (c.availability !== filters.availability) return false;
    }

    if (filters.dateFrom) {
      if (c.createdAt < filters.dateFrom) return false;
    }

    if (filters.dateTo) {
      if (c.createdAt > filters.dateTo) return false;
    }

    if (filters.search) {
      const query = filters.search.toLowerCase();
      const searchable = [
        c.name,
        ...c.skills,
        ...c.workExperiences.map((w) => `${w.role} ${w.description}`),
      ]
        .join(" ")
        .toLowerCase();
      if (!searchable.includes(query)) return false;
    }

    return true;
  });
}

export function sortCandidates(
  candidates: Candidate[],
  sort: SortConfig
): Candidate[] {
  const sorted = [...candidates];
  const dir = sort.direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    switch (sort.field) {
      case "name":
        return a.name.localeCompare(b.name) * dir;
      case "createdAt":
        return (a.createdAt.getTime() - b.createdAt.getTime()) * dir;
      case "interviewStatus": {
        const aOrder = STATUS_ORDER[a.interviewStatus] ?? 99;
        const bOrder = STATUS_ORDER[b.interviewStatus] ?? 99;
        return (aOrder - bOrder) * dir;
      }
      default:
        return 0;
    }
  });

  return sorted;
}

export function paginateCandidates<T>(
  items: T[],
  page: number,
  pageSize: number
): PaginatedResult<T> {
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const data = items.slice(start, start + pageSize);

  return { data, total, page, pageSize, totalPages };
}
