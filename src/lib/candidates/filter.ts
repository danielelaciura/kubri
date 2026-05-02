import type { Candidate, CandidateFilters, SortConfig, PaginatedResult } from "@/types";
import { resolvePlaceCoords, haversineKm } from "@/lib/geo/proximity";

export function filterCandidates(
  candidates: Candidate[],
  filters: CandidateFilters
): Candidate[] {
  const center = filters.nearPlace ? resolvePlaceCoords(filters.nearPlace) : null;
  const radius = filters.radiusKm;

  return candidates.filter((c) => {
    if (center && radius != null) {
      if (c.latitude == null || c.longitude == null) return false;
      const d = haversineKm(
        { latitude: c.latitude, longitude: c.longitude },
        center,
      );
      if (d > radius) return false;
    }

    if (filters.languages && filters.languages.length > 0) {
      const allLangs = [
        c.languages.language,
        c.languages.additionalLanguages,
      ]
        .join(" ")
        .toLowerCase();
      const has = filters.languages.some((lang) =>
        allLangs.includes(lang.toLowerCase())
      );
      if (!has) return false;
    }

    if (filters.countryOfOrigin) {
      if (!c.countryOfOrigin.toLowerCase().includes(filters.countryOfOrigin.toLowerCase())) {
        return false;
      }
    }

    if (filters.city) {
      if (!c.address.toLowerCase().includes(filters.city.toLowerCase())) {
        return false;
      }
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
        c.firstName,
        c.lastName,
        ...c.skillsAndCompetences,
        ...c.workExperience,
        c.countryOfOrigin,
        c.address,
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
      case "firstName":
        return a.firstName.localeCompare(b.firstName) * dir;
      case "lastName":
        return a.lastName.localeCompare(b.lastName) * dir;
      case "createdAt":
        return (a.createdAt.getTime() - b.createdAt.getTime()) * dir;
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
