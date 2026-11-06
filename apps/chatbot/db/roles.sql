-- Kubri Chatbot database roles (spec §10.5).
-- Apply manually, once per Supabase project, connected as "postgres" on the DIRECT url (5432):
--   psql "$SUPABASE_DIRECT_URL" \
--     -v bot_migrator_password="'…'" -v bot_app_password="'…'" -f db/roles.sql
-- Never commit the passwords.

\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS bot;
CREATE SCHEMA IF NOT EXISTS bot_queue;

-- Owns the bot schema and runs Prisma migrations.
CREATE ROLE bot_migrator LOGIN PASSWORD :bot_migrator_password;
-- Runtime role used by web and worker.
CREATE ROLE bot_app LOGIN PASSWORD :bot_app_password;

-- On Supabase "postgres" is not a superuser: it must be a member of the new roles to
-- change schema ownership, set default privileges FOR ROLE and SET ROLE for checks.
GRANT bot_migrator, bot_app TO postgres;

-- Prisma's first migration runs CREATE SCHEMA IF NOT EXISTS "bot"; Postgres checks the
-- database-level CREATE privilege before noticing the schema exists.
GRANT CREATE ON DATABASE postgres TO bot_migrator;

ALTER SCHEMA bot OWNER TO bot_migrator;
-- pg-boss creates and maintains its own tables inside bot_queue.
ALTER SCHEMA bot_queue OWNER TO bot_app;

GRANT USAGE ON SCHEMA bot TO bot_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bot_migrator IN SCHEMA bot
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bot_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bot_migrator IN SCHEMA bot
  GRANT USAGE, SELECT ON SEQUENCES TO bot_app;

-- No direct grants on the dashboard's schema. Isolation in practice comes from Postgres 15+
-- defaults (no CREATE on public for PUBLIC) and Supabase's per-table grants, which never
-- include these roles: this REVOKE only guarantees nothing was granted to them directly.
-- Note: like every role, they still inherit PUBLIC's USAGE on public and EXECUTE on its
-- functions; do not create SECURITY DEFINER functions in public that bypass this.
REVOKE ALL ON SCHEMA public FROM bot_app, bot_migrator;
