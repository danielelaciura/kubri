"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/provider";
import type { PlaceSuggestion } from "@/lib/geo/place-types";
import { searchLandingPlacesAction } from "@/app/(public)/candidati/[slug]/actions";

const DEBOUNCE_MS = 300;
/** Mirrors MIN_PLACE_QUERY on the server (shorter queries return nothing). */
const MIN_QUERY = 3;
const LISTBOX_ID = "landing-place-listbox";
const optionId = (i: number) => `landing-place-option-${i}`;

/** A chosen place, with the autocomplete session it closes (Google billing). */
export interface PlaceSelection extends PlaceSuggestion {
  sessionToken?: string;
}

type Status = "idle" | "empty" | "error";

/**
 * "Dove abiti?" combobox. Suggestions come from the server (Google, or ISTAT
 * comuni as a fallback); only a suggestion can be selected, never free text.
 */
export function PlaceField({
  slug,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  slug: string;
  value: PlaceSelection | null;
  onChange: (value: PlaceSelection | null) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const t = useT().landing;
  const [text, setText] = useState(value?.label ?? "");
  const [options, setOptions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const session = useRef<string | null>(null);
  const sessionToken = () => (session.current ??= crypto.randomUUID());

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function search(query: string) {
    const mine = ++seq.current;
    searchLandingPlacesAction(slug, { query, sessionToken: sessionToken() })
      .then((r) => {
        if (mine !== seq.current) return;
        const found = r.ok ? r.data : [];
        setOptions(found);
        setActive(-1);
        setStatus(!r.ok ? "error" : found.length ? "idle" : "empty");
        setOpen(true);
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setOptions([]);
        setStatus("error");
        setOpen(true);
      });
  }

  function onInput(next: string) {
    setText(next);
    if (value) onChange(null);
    if (timer.current) clearTimeout(timer.current);
    const query = next.replace(/\s+/g, " ").trim();
    if (query.length < MIN_QUERY) {
      seq.current++;
      setOptions([]);
      setOpen(false);
      setStatus("idle");
      return;
    }
    timer.current = setTimeout(() => search(query), DEBOUNCE_MS);
  }

  function select(option: PlaceSuggestion) {
    onChange({ ...option, sessionToken: session.current ?? undefined });
    // A selection closes the Google session: the next search starts a new one.
    session.current = null;
    setText(option.label);
    setOptions([]);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || options.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      select(options[active]!);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Input
        id="landing-placeId" role="combobox" autoComplete="off" maxLength={100}
        aria-expanded={open} aria-controls={LISTBOX_ID} aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid ? true : undefined} aria-describedby={describedBy}
        placeholder={t.placePlaceholder} value={text}
        onChange={(e) => onInput(e.target.value)} onKeyDown={onKeyDown} onBlur={() => setOpen(false)}
      />
      {open && (
        <ul id={LISTBOX_ID} role="listbox" className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-1 shadow-md">
          {options.map((o, i) => (
            <li
              key={o.placeId} id={optionId(i)} role="option" aria-selected={i === active}
              className={cn("cursor-pointer rounded-sm px-2 py-1.5 text-sm", i === active && "bg-muted")}
              // mousedown + preventDefault: select before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                select(o);
              }}
            >
              {o.label}
            </li>
          ))}
          {status === "empty" && <li className="px-2 py-1.5 text-sm text-muted-foreground">{t.placeNoResults}</li>}
          {status === "error" && <li className="px-2 py-1.5 text-sm text-muted-foreground">{t.errors.busy}</li>}
        </ul>
      )}
    </div>
  );
}
