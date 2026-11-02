import { normalizeText } from "../engine/normalize-text";

/** "anno - anno Luogo (Paese): Ruolo" (spec §6). */
const ENTRY = /^(\d{4})(?:\s*-\s*(\d{4}|oggi|presente))?\s+(.+?)(?:\s*\(([^)]+)\))?\s*:\s*(.+)$/iu;

export interface Entry {
  readonly from: string;
  readonly to: string | null;
  readonly place: string;
  readonly country: string | null;
  readonly role: string;
}

export function parseEntry(text: string): Entry | null {
  const match = ENTRY.exec(text.trim());
  if (!match) return null;
  const [, from = "", to, place = "", country, role = ""] = match;
  return { from, to: to ?? null, place, country: country ?? null, role };
}

const same = (a: string, b: string): boolean => normalizeText(a) === normalizeText(b);

function sameEnd(a: string | null, b: string | null): boolean {
  const open = (end: string | null): string | null =>
    end !== null && ["oggi", "presente"].includes(end.toLowerCase()) ? "open" : end;
  return open(a) === open(b);
}

/** D94: by parts. The country counts only when both sides state it. */
export function entriesMatch(expected: string, actual: string): boolean {
  const want = parseEntry(expected);
  if (!want) return same(expected, actual);
  const got = parseEntry(actual);
  if (!got) return false;
  return (
    want.from === got.from &&
    sameEnd(want.to, got.to) &&
    same(want.place, got.place) &&
    same(want.role, got.role) &&
    (want.country === null || got.country === null || same(want.country, got.country))
  );
}

/** One to one, in any order: matching is an equivalence, so a greedy pass is exact. */
export function structuredListsMatch(
  expected: readonly string[],
  actual: readonly string[],
): boolean {
  if (expected.length !== actual.length) return false;
  const remaining = [...actual];
  for (const want of expected) {
    const index = remaining.findIndex((got) => entriesMatch(want, got));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return true;
}
