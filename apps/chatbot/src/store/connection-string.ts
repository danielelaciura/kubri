// Prisma's `schema` query parameter is meaningless (and potentially rejected) for node-postgres.
export function toPgConnectionString(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete("schema");
  return url.toString();
}

// The database is shared with the Kubri dashboard: only the `bot` schema is ours.
export function targetsBotSchema(url: string): boolean {
  try {
    return new URL(url).searchParams.get("schema") === "bot";
  } catch {
    return false;
  }
}
