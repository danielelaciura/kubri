// Prisma's `schema` query parameter is meaningless (and potentially rejected) for node-postgres.
export function toPgConnectionString(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete("schema");
  return url.toString();
}
