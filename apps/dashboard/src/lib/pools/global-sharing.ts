import type { GlobalSharingMode } from "@/generated/prisma/client";

export const GLOBAL_SHARING_MODES = [
  "WEBHOOK",
  "ALWAYS",
  "NEVER",
] as const satisfies readonly GlobalSharingMode[];

/**
 * Value of `Candidate.sharedWithGlobal` for a candidate ingested into `pool`.
 * `consentFromPayload` is the webhook's privacy flag. The pool's mode can force
 * it either way; the Global pool has no override (its candidates are visible to
 * every Global-attached org regardless), so the payload always wins there.
 *
 * Applied at ingestion only. Kept free of the Prisma client so it is
 * unit-testable without a database connection.
 */
export function resolveSharedWithGlobal(
  pool: { isGlobal: boolean; globalSharing: GlobalSharingMode },
  consentFromPayload: boolean,
): boolean {
  if (pool.isGlobal) return consentFromPayload;
  switch (pool.globalSharing) {
    case "ALWAYS":
      return true;
    case "NEVER":
      return false;
    case "WEBHOOK":
      return consentFromPayload;
  }
}
