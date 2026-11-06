import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Prisma 7 emits unqualified SQL for a single schema. Every object must be written as
// "bot"."Name" so a migration can never land in the dashboard's public schema.
const OBJECT_PATTERNS: RegExp[] = [
  /\b(?:CREATE|ALTER|DROP) TABLE (?:IF (?:NOT )?EXISTS )?(\S+)/gi,
  /\bCREATE (?:UNIQUE )?INDEX .*? ON (\S+)/gi,
  /\b(?:CREATE|ALTER|DROP) TYPE (\S+)/gi,
  /\bREFERENCES (\S+)/gi,
];

export function findUnqualifiedObjects(sql: string): string[] {
  const found: string[] = [];
  for (const pattern of OBJECT_PATTERNS) {
    for (const match of sql.matchAll(pattern)) {
      const name = match[1] ?? "";
      if (!name.startsWith('"bot".')) found.push(name);
    }
  }
  return found;
}

describe("findUnqualifiedObjects", () => {
  it("flags unqualified statements", () => {
    const sql = `
      CREATE TABLE "Organization" (id uuid);
      CREATE UNIQUE INDEX "o_key" ON "Organization"("slug");
      ALTER TABLE "bot"."A" ADD CONSTRAINT "fk" FOREIGN KEY ("b") REFERENCES "B"("id");
      CREATE TYPE "Kind" AS ENUM ('a');
    `;
    expect(findUnqualifiedObjects(sql)).toEqual(
      expect.arrayContaining(['"Organization"', '"Organization"("slug");', '"B"("id");', '"Kind"']),
    );
  });

  it("accepts qualified statements", () => {
    const sql = `
      CREATE SCHEMA IF NOT EXISTS "bot";
      CREATE TABLE "bot"."Organization" (id uuid);
      CREATE UNIQUE INDEX "o_key" ON "bot"."Organization"("slug");
      ALTER TABLE "bot"."A" ADD CONSTRAINT "fk" FOREIGN KEY ("b") REFERENCES "bot"."B"("id");
    `;
    expect(findUnqualifiedObjects(sql)).toEqual([]);
  });
});

describe("committed migrations", () => {
  const root = join(__dirname, "../../../prisma/migrations");
  const dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());

  it("has at least one migration", () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  it.each(dirs.map((d) => d.name))('%s targets only "bot" objects', (name) => {
    const sql = readFileSync(join(root, name, "migration.sql"), "utf8");
    expect(findUnqualifiedObjects(sql)).toEqual([]);
  });
});
