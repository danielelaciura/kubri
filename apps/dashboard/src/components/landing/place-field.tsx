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

/**
 * A random RFC 4122 v4 UUID (the server validates the format).
 * `crypto.randomUUID` is missing on old Android WebViews and outside secure
 * contexts; `crypto.getRandomValues` is available there.
 */
export function newSessionToken(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A chosen place, with the autocomplete session it closes (Google billing). */
export interface PlaceSelection extends PlaceSuggestion {
  sessionToken?: string;
}

type Status = "idle" | "empty" | "error" | "expired";

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
  // Bumped to invalidate a pending timer's or in-flight search's result.
  const seq = useRef(0);
  const session = useRef<string | null>(null);
  const sessionToken = () => (session.current ??= newSessionToken());

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  /** Drops the pending debounce and any in-flight response. */
  function cancelSearch() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    seq.current++;
  }

  function search(query: string) {
    const mine = ++seq.current;
    searchLandingPlacesAction(slug, { query, sessionToken: sessionToken() })
      .then((r) => {
        if (mine !== seq.current) return;
        const found = r.ok ? r.data : [];
        setOptions(found);
        setActive(-1);
        setStatus(!r.ok ? (r.error === "SESSION_EXPIRED" ? "expired" : "error") : found.length ? "idle" : "empty");
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
    cancelSearch();
    const query = next.replace(/\s+/g, " ").trim();
    if (query.length < MIN_QUERY) {
      setOptions([]);
      setOpen(false);
      setStatus("idle");
      return;
    }
    timer.current = setTimeout(() => search(query), DEBOUNCE_MS);
  }

  function select(option: PlaceSuggestion) {
    cancelSearch();
    onChange({ ...option, sessionToken: session.current ?? undefined });
    // A selection closes the Google session: the next search starts a new one.
    session.current = null;
    setText(option.label);
    setOptions([]);
    setOpen(false);
    setActive(-1);
    setStatus("idle");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (open) e.preventDefault();
      setOpen(false);
      return;
    }
    if (options.length === 0) return;
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        setActive(0);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      select(options[active]!);
    }
  }

  const listOpen = open && options.length > 0;
  const statusText = !open ? "" : status === "empty" ? t.placeNoResults : status === "expired" ? t.errors.expired : status === "error" ? t.errors.busy : "";

  return (
    <div className="relative">
      <Input
        id="landing-placeId" role="combobox" autoComplete="off" maxLength={100}
        aria-expanded={listOpen} aria-controls={LISTBOX_ID} aria-autocomplete="list"
        aria-activedescendant={listOpen && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid ? true : undefined} aria-describedby={describedBy}
        placeholder={t.placePlaceholder} value={text}
        onChange={(e) => onInput(e.target.value)} onKeyDown={onKeyDown}
        onBlur={() => {
          // A late response must not reopen the list once the field is left.
          cancelSearch();
          setOpen(false);
        }}
      />
      {listOpen && (
        <ul
          id={LISTBOX_ID} role="listbox"
          className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {options.map((o, i) => (
            <li
              key={o.placeId} id={optionId(i)} role="option" aria-selected={i === active}
              className={cn("cursor-pointer rounded-sm px-2 py-2.5 text-sm", i === active && "bg-muted")}
              // mousedown + preventDefault: select before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                select(o);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
      {/* Always mounted so screen readers announce "no results" / errors. */}
      <p
        role="status" aria-live="polite"
        className={statusText
          ? "absolute z-10 mt-1 w-full rounded-md border bg-popover px-3 py-2.5 text-sm text-muted-foreground shadow-md"
          : "sr-only"}
      >
        {statusText}
      </p>
    </div>
  );
}
