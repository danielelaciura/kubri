"use client";
import { useEffect, useRef, useState } from "react";
import { loadComuni, searchComuni, comuneLabel, type Comune } from "@/lib/comuni";

type Props = {
  /** Currently selected comune label ("Comune (PROV)"), or "" if none. */
  value: string;
  onSelect: (c: Comune) => void;
  onClear: () => void;
  error?: boolean;
};

export function ComuneSelect({ value, onSelect, onClear, error }: Props) {
  const [all, setAll] = useState<Comune[]>([]);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadComuni().then(setAll).catch(() => setAll([]));
  }, []);

  // Keep the input text in sync when the parent resets the value.
  useEffect(() => setQuery(value), [value]);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const results = open && query.trim() ? searchComuni(query, all) : [];

  function pick(c: Comune) {
    onSelect(c);
    setQuery(comuneLabel(c));
    setOpen(false);
  }

  function onChange(next: string) {
    setQuery(next);
    setOpen(true);
    setActive(0);
    // Editing invalidates a previous selection so stale coordinates aren't kept.
    if (value) onClear();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[active]) pick(results[active]!); }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className="relative" ref={boxRef}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls="comune-listbox"
        aria-label="Comune di residenza"
        aria-invalid={!!error}
        aria-activedescendant={
          open && results[active] ? `comune-opt-${active}` : undefined
        }
        value={query}
        placeholder="Inizia a scrivere il tuo comune…"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#534AB7]/20 ${
          error ? "border-red-400 focus:border-red-500" : "border-neutral-300 focus:border-[#534AB7]"
        }`}
      />
      {open && results.length > 0 && (
        <ul
          id="comune-listbox"
          role="listbox"
          className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
        >
          {results.map((c, i) => (
            <li
              key={`${c.nome}-${c.sigla}`}
              id={`comune-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === active ? "bg-[#EEEDFE] text-[#3C3489]" : "text-neutral-700"
              }`}
            >
              {c.nome} <span className="text-neutral-400">({c.sigla})</span>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim() && results.length === 0 && all.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-500 shadow-lg">
          Nessun comune trovato.
        </div>
      )}
    </div>
  );
}
