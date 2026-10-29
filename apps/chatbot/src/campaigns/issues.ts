export interface CampaignIssue {
  /** JSON path inside the campaign file, e.g. "flow[3].questions[1].field". */
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export function issue(path: string, code: string, message: string): CampaignIssue {
  return { path, code, message };
}

/** Yields the second and later occurrences of each value. */
export function duplicates<T>(items: readonly T[], keyOf: (item: T) => string): [T, number][] {
  const seen = new Set<string>();
  const result: [T, number][] = [];
  items.forEach((item, index) => {
    const key = keyOf(item);
    if (seen.has(key)) result.push([item, index]);
    seen.add(key);
  });
  return result;
}
