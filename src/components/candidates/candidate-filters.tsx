"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Search, Filter, X } from "lucide-react";
import { strings } from "@/lib/i18n/strings";
import type { InterviewStatus, Availability } from "@/types";

const STATUS_OPTIONS: { value: InterviewStatus; label: string }[] = [
  { value: "completed", label: "Completata" },
  { value: "in_progress", label: "In corso" },
  { value: "abandoned", label: "Abbandonata" },
  { value: "incomplete", label: "Incompleta" },
];

const AVAILABILITY_OPTIONS: { value: Availability | ""; label: string }[] = [
  { value: "", label: "Tutte" },
  { value: "immediate", label: "Immediata" },
  { value: "within_1_month", label: "Entro 1 mese" },
  { value: "other", label: "Altro" },
];

interface CandidateFiltersProps {
  initialFilters: {
    search?: string;
    status?: string;
    languages?: string;
    nationality?: string;
    city?: string;
    availability?: string;
    dateFrom?: string;
    dateTo?: string;
  };
}

export function CandidateFilters({ initialFilters }: CandidateFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(initialFilters.search ?? "");
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(
    new Set(initialFilters.status?.split(",").filter(Boolean) ?? [])
  );
  const [languages, setLanguages] = useState(initialFilters.languages ?? "");
  const [nationality, setNationality] = useState(initialFilters.nationality ?? "");
  const [city, setCity] = useState(initialFilters.city ?? "");
  const [availability, setAvailability] = useState(initialFilters.availability ?? "");
  const [dateFrom, setDateFrom] = useState(initialFilters.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(initialFilters.dateTo ?? "");
  const [showFilters, setShowFilters] = useState(false);

  const applyFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());

    // Reset to page 1 when filters change
    params.delete("page");

    const setOrDelete = (key: string, value: string) => {
      if (value) params.set(key, value);
      else params.delete(key);
    };

    setOrDelete("search", search.trim());
    setOrDelete("status", Array.from(selectedStatuses).join(","));
    setOrDelete("languages", languages.trim());
    setOrDelete("nationality", nationality.trim());
    setOrDelete("city", city.trim());
    setOrDelete("availability", availability);
    setOrDelete("dateFrom", dateFrom);
    setOrDelete("dateTo", dateTo);

    router.push(`/dashboard/candidates?${params.toString()}`);
  }, [router, searchParams, search, selectedStatuses, languages, nationality, city, availability, dateFrom, dateTo]);

  const resetFilters = useCallback(() => {
    setSearch("");
    setSelectedStatuses(new Set());
    setLanguages("");
    setNationality("");
    setCity("");
    setAvailability("");
    setDateFrom("");
    setDateTo("");
    router.push("/dashboard/candidates");
  }, [router]);

  const toggleStatus = (status: string) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={`${strings.common.search} per nome, competenze, esperienze...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            className="pl-10"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => setShowFilters(!showFilters)}
          className="gap-2"
        >
          <Filter className="h-4 w-4" />
          {strings.common.filter}
        </Button>
        <Button onClick={applyFilters}>{strings.common.search}</Button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <Card className="p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Status checkboxes */}
            <div>
              <label className="mb-2 block text-sm font-medium">Stato intervista</label>
              <div className="space-y-2">
                {STATUS_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedStatuses.has(opt.value)}
                      onChange={() => toggleStatus(opt.value)}
                      className="rounded"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Language */}
            <div>
              <label className="mb-2 block text-sm font-medium">Lingue</label>
              <Input
                placeholder="es. Italiano, Inglese"
                value={languages}
                onChange={(e) => setLanguages(e.target.value)}
              />
            </div>

            {/* Nationality */}
            <div>
              <label className="mb-2 block text-sm font-medium">Nazionalità</label>
              <Input
                placeholder="es. Italiana"
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
              />
            </div>

            {/* City */}
            <div>
              <label className="mb-2 block text-sm font-medium">Città</label>
              <Input
                placeholder="es. Milano"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>

            {/* Availability */}
            <div>
              <label className="mb-2 block text-sm font-medium">Disponibilità</label>
              <select
                value={availability}
                onChange={(e) => setAvailability(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {AVAILABILITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Date range */}
            <div>
              <label className="mb-2 block text-sm font-medium">Periodo</label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  placeholder="Da"
                />
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  placeholder="A"
                />
              </div>
            </div>
          </div>

          {/* Filter actions */}
          <div className="mt-4 flex gap-2">
            <Button onClick={applyFilters}>Applica</Button>
            <Button variant="outline" onClick={resetFilters} className="gap-1">
              <X className="h-4 w-4" />
              {strings.common.reset}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
