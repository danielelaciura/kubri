-- Simulates the Kubri dashboard, which owns the public schema of the shared database.
-- The bot must never touch these tables (see tests/integration/db-isolation.test.ts).
CREATE TABLE IF NOT EXISTS public.dashboard_sentinel (
  id integer PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS public."_prisma_migrations" (
  id                  varchar(36)  PRIMARY KEY,
  checksum            varchar(64)  NOT NULL,
  finished_at         timestamptz,
  migration_name      varchar(255) NOT NULL,
  logs                text,
  rolled_back_at      timestamptz,
  started_at          timestamptz  NOT NULL DEFAULT now(),
  applied_steps_count integer      NOT NULL DEFAULT 0
);
