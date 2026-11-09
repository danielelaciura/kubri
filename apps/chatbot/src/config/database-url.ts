// The database is shared with the Kubri dashboard: only the `bot` schema is ours.
export function targetsBotSchema(url: string): boolean {
  try {
    return new URL(url).searchParams.get("schema") === "bot";
  } catch {
    return false;
  }
}
