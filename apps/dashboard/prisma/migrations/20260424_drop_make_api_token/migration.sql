-- Drop the per-org Make.com API token. The token is now a global env var
-- (MAKE_API_TOKEN) shared across all organizations.
ALTER TABLE "Organization" DROP COLUMN "makeApiToken";
