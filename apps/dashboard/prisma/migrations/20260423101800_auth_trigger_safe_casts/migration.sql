-- Harden handle_new_auth_user against malformed raw_user_meta_data:
-- an invalid Role enum value or malformed organization_id UUID would
-- otherwise raise inside the trigger and abort the auth.users INSERT,
-- breaking Supabase signup entirely. Default both to safe values.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  meta_name   text;
  meta_role   "Role";
  meta_org_id uuid;
  raw_role    text;
  raw_org_id  text;
BEGIN
  meta_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));

  raw_role := COALESCE(NEW.raw_user_meta_data->>'role', 'ORG_MEMBER');
  BEGIN
    meta_role := raw_role::"Role";
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE NOTICE 'handle_new_auth_user: invalid role %, defaulting to ORG_MEMBER', raw_role;
    meta_role := 'ORG_MEMBER'::"Role";
  END;

  raw_org_id := NULLIF(NEW.raw_user_meta_data->>'organization_id', '');
  IF raw_org_id IS NULL THEN
    meta_org_id := NULL;
  ELSE
    BEGIN
      meta_org_id := raw_org_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE NOTICE 'handle_new_auth_user: invalid organization_id %, defaulting to NULL', raw_org_id;
      meta_org_id := NULL;
    END;
  END IF;

  INSERT INTO public."User" (id, email, name, role, "organizationId", "createdAt")
  VALUES (NEW.id, NEW.email, meta_name, meta_role, meta_org_id, now())
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$fn$;
