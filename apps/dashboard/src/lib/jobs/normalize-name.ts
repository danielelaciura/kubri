const LETTER = /\p{L}/u;
const LOWERCASE_LETTER = /\p{Ll}/u;

function letterCount(s: string): number {
  let n = 0;
  for (const ch of s) if (LETTER.test(ch)) n++;
  return n;
}

/** True when `s` has at least `minLetters` letters and none of them is lowercase. */
function isUppercase(s: string, minLetters: number): boolean {
  return letterCount(s) >= minLetters && !LOWERCASE_LETTER.test(s);
}

function capitalizeFirstLetter(s: string): string {
  const chars = [...s];
  const i = chars.findIndex((ch) => LETTER.test(ch));
  if (i < 0) return s;
  chars[i] = chars[i]!.toLocaleUpperCase("it");
  return chars.join("");
}

/**
 * Sentence-case a JD name.
 *
 * - Whitespace is trimmed and collapsed.
 * - A fully uppercase title is lowercased entirely (acronyms included: we
 *   cannot tell them apart).
 * - Otherwise tokens with >= 2 letters, all uppercase, are kept as acronyms
 *   (OSS, HACCP, B2B, OSS/ASA); every other token is lowercased.
 * - The first letter is then uppercased.
 *
 * Idempotent.
 */
export function normalizeJobName(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  const lowered = isUppercase(collapsed, 1)
    ? collapsed.toLocaleLowerCase("it")
    : collapsed
        .split(" ")
        .map((token) => (isUppercase(token, 2) ? token : token.toLocaleLowerCase("it")))
        .join(" ");
  return capitalizeFirstLetter(lowered);
}

export interface JobNameRow {
  id: string;
  organizationId: string;
  name: string;
}

export interface JobNameChange {
  id: string;
  organizationId: string;
  from: string;
  to: string;
}

export interface JobNameRenamePlan {
  renames: JobNameChange[];
  /** Rows whose normalized name would clash with another JD of the same org. */
  collisions: JobNameChange[];
  unchanged: number;
}

/**
 * Plan the backfill: group JDs by (org, normalized name). A group of one is a
 * plain rename (or unchanged); in a larger group every row that would have to
 * change is a collision and is skipped, since `(organizationId, name)` is unique.
 */
export function planJobNameRenames(rows: JobNameRow[]): JobNameRenamePlan {
  const groups = new Map<string, JobNameChange[]>();
  for (const r of rows) {
    const change: JobNameChange = {
      id: r.id,
      organizationId: r.organizationId,
      from: r.name,
      to: normalizeJobName(r.name),
    };
    const key = `${r.organizationId}\u0000${change.to}`;
    const group = groups.get(key);
    if (group) group.push(change);
    else groups.set(key, [change]);
  }

  const plan: JobNameRenamePlan = { renames: [], collisions: [], unchanged: 0 };
  for (const group of groups.values()) {
    for (const change of group) {
      if (change.from === change.to) plan.unchanged++;
      else if (group.length === 1) plan.renames.push(change);
      else plan.collisions.push(change);
    }
  }
  return plan;
}
