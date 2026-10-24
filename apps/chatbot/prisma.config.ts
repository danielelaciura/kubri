import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Already-set variables win (dotenv does not override): integration tests and CI pass
// their own DATABASE_URL explicitly.
config({ path: ".env" });

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
