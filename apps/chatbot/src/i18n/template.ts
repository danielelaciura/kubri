/** `{name}` placeholders (D71): a letter, then letters, digits, `_` and `.`. */
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_.]*)\}/g;

/** The distinct placeholder names of a template, sorted. */
export function placeholdersOf(template: string): string[] {
  const names = [...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
  return [...new Set(names)].sort();
}

/** True when both templates use exactly the same set of placeholders. */
export function samePlaceholders(a: string, b: string): boolean {
  const left = placeholdersOf(a);
  const right = placeholdersOf(b);
  return left.length === right.length && left.every((name, i) => name === right[i]);
}

export interface Interpolated {
  readonly text: string;
  /** Placeholders with no value: left visible, so runtime can log them. */
  readonly missing: readonly string[];
}

/** One pass: inserted values are never scanned again (a candidate may type "{value}"). */
export function interpolate(
  template: string,
  values: Readonly<Record<string, string>>,
): Interpolated {
  const missing = new Set<string>();
  const text = template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value !== undefined) return value;
    missing.add(name);
    return whole;
  });
  return { text, missing: [...missing].sort() };
}
