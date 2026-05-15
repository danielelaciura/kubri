/**
 * Backfill latitude/longitude for Candidate rows that are missing them.
 *
 * Strategy: extract the comune from the address field (pattern
 * "Via X NN, <Comune>") and resolve to lat/lng via the ITALY_ADMIN
 * dataset. No external geocoding API used.
 *
 * Run: set -a && source .env.local && set +a && pnpm tsx scripts/backfill-candidate-coords.ts
 *   --dry-run    print what would be updated without writing
 *
 * Idempotent. Re-runs only touch rows still missing coords.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { geocodeFromAddress } from "@/lib/geo/proximity";

interface Args {
  dryRun: boolean;
}

function parseArgs(): Args {
  return { dryRun: process.argv.includes("--dry-run") };
}

interface Row {
  id: string;
  firstName: string | null;
  address: string | null;
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs();
  const total = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count
    FROM "Candidate"
    WHERE latitude IS NULL OR longitude IS NULL
  `;
  const n = Number(total[0].count);
  console.log(`[coords] ${n} candidates missing lat/lng`);
  if (n === 0) {
    await prisma.$disconnect();
    return;
  }

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id::text AS id, "firstName", address
    FROM "Candidate"
    WHERE latitude IS NULL OR longitude IS NULL
    ORDER BY "createdAt" ASC
  `;

  let resolved = 0;
  let skipped = 0;
  for (const r of rows) {
    const coords = geocodeFromAddress(r.address);
    if (!coords) {
      skipped++;
      console.log(`[skip] ${r.id} ${r.firstName ?? ""} → address="${r.address ?? "-"}"`);
      continue;
    }
    if (dryRun) {
      console.log(
        `[dry] ${r.id} ${r.firstName ?? ""} → (${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)})`,
      );
    } else {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "Candidate"
        SET latitude = ${coords.latitude}, longitude = ${coords.longitude}
        WHERE id = ${r.id}::uuid
      `);
      console.log(
        `[ok]  ${r.id} ${r.firstName ?? ""} → (${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)})`,
      );
    }
    resolved++;
  }
  console.log(`---`);
  console.log(`Resolved: ${resolved}/${n}, skipped: ${skipped}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
