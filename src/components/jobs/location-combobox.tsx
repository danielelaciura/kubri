"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { ITALY_ADMIN } from "@/lib/geo/italy-admin";
import { normalizePlace } from "@/lib/geo/resolve";

interface LocationComboboxProps {
  name: string;
  defaultValue?: string;
  placeholder?: string;
}

const ALL_LABELS: string[] = (() => {
  const set = new Set<string>();
  for (const row of ITALY_ADMIN) {
    set.add(row.municipality);
    set.add(row.province);
    set.add(row.region);
  }
  return [...set].sort();
})();

export function LocationCombobox({ name, defaultValue = "", placeholder }: LocationComboboxProps) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = normalizePlace(value);
    if (!q) return [];
    return ALL_LABELS.filter((l) => normalizePlace(l).startsWith(q)).slice(0, 8);
  }, [value]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <Input
        name={name}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className="bg-white"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => {
                  setValue(s);
                  setOpen(false);
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
