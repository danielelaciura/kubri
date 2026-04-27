-- Lock down all business tables behind RLS so they are not reachable via
-- Supabase PostgREST with the public anon/authenticated keys.
--
-- Why: tables created via Prisma migrate inherit the Postgres default
-- (RLS off). Supabase exposes every table in the public schema via
-- /rest/v1/<table>; without RLS, anyone with the anon key (which ships in
-- the browser bundle) could read/write Candidate, CandidateNote, etc.
--
-- How this works: enabling RLS without any policy means PostgREST denies
-- everything for the `anon` and `authenticated` roles. Our app is unaffected
-- because Prisma connects as the `postgres` role (BYPASSRLS), and we never
-- query business tables via the Supabase JS client (only `auth.*`).
--
-- Auth schema (`auth.users` etc.) and the `members_with_status` view are
-- intentionally NOT touched — Supabase manages those.

ALTER TABLE "Organization"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Candidate"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CandidateNote"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CandidateTag"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobDescription" ENABLE ROW LEVEL SECURITY;

-- Belt & suspenders: explicitly revoke privileges from PostgREST roles.
-- (RLS already blocks them, but this also hides the tables from
-- /rest/v1/ schema introspection so they don't appear at all.)
REVOKE ALL ON TABLE
  "Organization", "User", "Candidate", "CandidateNote",
  "CandidateTag", "AuditLog", "JobDescription"
FROM anon, authenticated;
