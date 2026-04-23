-- Supabase manages the `auth` schema on real DBs.
-- Prisma's shadow DB does not, so we stub the minimum surface here.
-- On real Supabase DBs, auth.users already exists and the migration role lacks
-- permission to CREATE in the auth schema, so we guard the stub with a check.
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users'
  ) THEN
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users (
      id                 uuid PRIMARY KEY,
      email              text,
      raw_user_meta_data jsonb,
      email_confirmed_at timestamptz
    );
  END IF;
END
$mig$;

-- 1) Insert trigger: when a new auth.users row appears, upsert public.User.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta_name text;
  meta_role text;
  meta_org_id uuid;
BEGIN
  meta_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));
  meta_role := COALESCE(NEW.raw_user_meta_data->>'role', 'ORG_MEMBER');
  meta_org_id := NULLIF(NEW.raw_user_meta_data->>'organization_id', '')::uuid;

  INSERT INTO public."User" (id, email, name, role, "organizationId", "createdAt")
  VALUES (NEW.id, NEW.email, meta_name, meta_role::"Role", meta_org_id, now())
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 2) Delete trigger
CREATE OR REPLACE FUNCTION public.handle_delete_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public."User" WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_delete_auth_user();

-- 3) Update trigger
CREATE OR REPLACE FUNCTION public.handle_update_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public."User" SET email = NEW.email WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_update_auth_user();

-- 4) View
DROP VIEW IF EXISTS public.members_with_status;
CREATE VIEW public.members_with_status AS
SELECT
  u.id,
  u.email,
  u.name,
  u.role,
  u."organizationId",
  u."createdAt",
  u."lastLoginAt",
  (a.email_confirmed_at IS NULL) AS "isPending"
FROM public."User" u
JOIN auth.users a ON a.id = u.id;

-- Grant to service_role only when it exists (Supabase-specific role).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT ON public.members_with_status TO service_role';
  END IF;
END $$;
