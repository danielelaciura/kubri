"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { LocationCombobox } from "@/components/shared/location-combobox";
import { Search, Filter, X } from "lucide-react";
import { strings } from "@/lib/i18n/strings";
import {
  DEFAULT_SEARCH_RADIUS_KM,
  MIN_RADIUS_KM,
  MAX_RADIUS_KM,
  RADIUS_STEP_KM,
} from "@/lib/geo/constants";

interface CandidateFiltersProps {
  initialFilters: {
    search?: string;
    languages?: string;
    countryOfOrigin?: string;
    city?: string;
    dateFrom?: string;
    dateTo?: string;
    nearPlace?: string;
    radiusKm?: string;
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
  const [nearPlace, setNearPlace] = useState(initialFilters.nearPlace ?? "");
  const [radiusKm, setRadiusKm] = useState<number>(
    initialFilters.radiusKm ? Number(initialFilters.radiusKm) : DEFAULT_SEARCH_RADIUS_KM,
  );
  const [showFilters, setShowFilters] = useState(false);

  const applyFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
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
    setOrDelete("nearPlace", nearPlace.trim());
    if (nearPlace.trim()) params.set("radiusKm", String(radiusKm));
    else params.delete("radiusKm");

    router.push(`/dashboard/candidates?${params.toString()}`);
  }, [
    router,
    searchParams,
    search,
    languages,
    countryOfOrigin,
    city,
    dateFrom,
    dateTo,
    nearPlace,
    radiusKm,
  ]);

  const resetFilters = useCallback(() => {
    setSearch("");
    setLanguages("");
    setCountryOfOrigin("");
    setCity("");
    setDateFrom("");
    setDateTo("");
    setNearPlace("");
    setRadiusKm(DEFAULT_SEARCH_RADIUS_KM);
    router.push("/dashboard/candidates");
  }, [router]);

  return (
    <div className="space-y-4">
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
        <Button variant="outline" onClick={() => setShowFilters(!showFilters)} className="gap-2">
          <Filter className="h-5 w-5" />
          {strings.common.filter}
        </Button>
        <Button onClick={applyFilters}>{strings.common.search}</Button>
      </div>

      {showFilters && (
        <Card className="p-4 shadow-sm border-border/60">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium">Lingue</label>
              <Input
                placeholder="es. Arabo, Francese"
                value={languages}
                onChange={(e) => setLanguages(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Paese di origine</label>
              <Input
                placeholder="es. Marocco"
                value={countryOfOrigin}
                onChange={(e) => setCountryOfOrigin(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Città</label>
              <Input
                placeholder="es. Torino"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>

            <div className="md:col-span-2 lg:col-span-3">
              <label className="mb-2 block text-sm font-medium">Vicino a...</label>
              <LocationCombobox
                name="nearPlace"
                value={nearPlace}
                onChange={setNearPlace}
                placeholder="es. Milano, Lombardia"
              />
              {nearPlace.trim() && (
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Raggio</span>
                    <span className="text-sm text-muted-foreground">{radiusKm} km</span>
                  </div>
                  <Slider
                    min={MIN_RADIUS_KM}
                    max={MAX_RADIUS_KM}
                    step={RADIUS_STEP_KM}
                    value={[radiusKm]}
                    onValueChange={(v) => setRadiusKm(v[0] ?? DEFAULT_SEARCH_RADIUS_KM)}
                  />
                </div>
              )}
            </div>
          </div>

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
