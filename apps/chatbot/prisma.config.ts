import { config } from "dotenv";
import { defineConfig } from "prisma/config";
import { targetsBotSchema } from "./src/config/database-url";

// Already-set variables win (dotenv does not override): integration tests and CI pass
// their own DATABASE_URL explicitly.
config({ path: ".env" });

// Prisma 7 emits unqualified SQL for a single schema, so tables land in "bot" only thanks to
// the URL's ?schema=bot (search_path). Without it, migrations would hit the dashboard's
// public schema: refuse any Prisma command in that case. (Unset or empty is fine: `prisma generate`
// runs in postinstall without a database.)
const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl && !targetsBotSchema(databaseUrl)) {
  throw new Error(
    "DATABASE_URL must target the bot schema (add ?schema=bot): refusing to run Prisma.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // ?schema=bot also places Prisma's own _prisma_migrations table in the bot schema,
    // away from the dashboard's one in public.
    url: process.env["DATABASE_URL"] ?? "",
  },
});
