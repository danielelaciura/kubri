import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
const prisma = new PrismaClient({ adapter });

async function main() {
  // No user seeding: users are created via Supabase Auth invite flow.
  // See docs/superpowers/specs/2026-04-22-supabase-auth-migration-design.md.
  console.log("Seed skipped: use Supabase Auth invite flow to bootstrap users.");
}

main().finally(() => prisma.$disconnect());
