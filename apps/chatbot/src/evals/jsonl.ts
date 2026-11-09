import type { z } from "zod";

/** A dataset file that cannot be used: the message names the file and the line. */
export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetError";
  }
}

/**
 * One JSON object per line, blank lines ignored. `check` adds meaning checks the schema
 * cannot express and returns a problem, if any. Ids must be unique.
 */
export function parseJsonl<T extends { id: string }>(
  text: string,
  source: string,
  schema: z.ZodType<T>,
  check?: (item: T) => string | undefined,
): T[] {
  const items: T[] = [];
  const ids = new Set<string>();
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    const where = `${source}:${index + 1}`;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new DatasetError(`${where}: not valid JSON`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.map(String).join(".") || "(root)";
      throw new DatasetError(`${where}: ${path}: ${issue?.message ?? "invalid"}`);
    }
    const problem = check?.(parsed.data);
    if (problem !== undefined) throw new DatasetError(`${where}: ${problem}`);
    if (ids.has(parsed.data.id)) {
      throw new DatasetError(`${where}: duplicate id "${parsed.data.id}"`);
    }
    ids.add(parsed.data.id);
    items.push(parsed.data);
  });
  return items;
}
