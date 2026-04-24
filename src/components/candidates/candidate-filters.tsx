"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Search, Filter, X } from "lucide-react";
import { strings } from "@/lib/i18n/strings";

interface CandidateFiltersProps {
  initialFilters: {
    search?: string;
    languages?: string;
    countryOfOrigin?: string;
    city?: string;
    dateFrom?: string;
    dateTo?: string;
  };
}

export function CandidateFilters({ initialFilters }: CandidateFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(initialFilters.search ?? "");
  const [languages, setLanguages] = useState(initialFilters.languages ?? "");
  const [countryOfOrigin, setCountryOfOrigin] = useState(initialFilters.countryOfOrigin ?? "");
  const [city, setCity] = useState(initialFilters.city ?? "");
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
    setOrDelete("languages", languages.trim());
    setOrDelete("countryOfOrigin", countryOfOrigin.trim());
    setOrDelete("city", city.trim());
    setOrDelete("dateFrom", dateFrom);
    setOrDelete("dateTo", dateTo);

    router.push(`/dashboard/candidates?${params.toString()}`);
  }, [router, searchParams, search, languages, countryOfOrigin, city, dateFrom, dateTo]);

  const resetFilters = useCallback(() => {
    setSearch("");
    setLanguages("");
    setCountryOfOrigin("");
    setCity("");
    setDateFrom("");
    setDateTo("");
    router.push("/dashboard/candidates");
  }, [router]);

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={`${strings.common.search} per nome, competenze, esperienze...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            className="pl-10 bg-white border-1 border-kubri-800"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => setShowFilters(!showFilters)}
          className="gap-2"
        >
          <Filter className="h-5 w-5" />
          {strings.common.filter}
        </Button>
        <Button onClick={applyFilters}>{strings.common.search}</Button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <Card className="p-4 shadow-sm border-border/60">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Language */}
            <div>
              <label className="mb-2 block text-sm font-medium">Lingue</label>
              <Input
                placeholder="es. Arabo, Francese"
                value={languages}
                onChange={(e) => setLanguages(e.target.value)}
              />
            </div>

            {/* Country of origin */}
            <div>
              <label className="mb-2 block text-sm font-medium">Paese di origine</label>
              <Input
                placeholder="es. Marocco"
                value={countryOfOrigin}
                onChange={(e) => setCountryOfOrigin(e.target.value)}
              />
            </div>

            {/* City */}
            <div>
              <label className="mb-2 block text-sm font-medium">Città</label>
              <Input
                placeholder="es. Torino"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>

            {/* Date range */}
            {/* <div>
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
            </div> */}
          </div>

          {/* Filter actions */}
          <div className="mt-4 flex gap-2">
            <Button onClick={applyFilters}>Applica</Button>
            <Button variant="outline" onClick={resetFilters} className="gap-1">
              <X className="h-5 w-5" />
              {strings.common.reset}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
