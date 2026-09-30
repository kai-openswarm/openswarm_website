-- A least-privilege database role for the website API (DATABASE_URL), so the hosted
-- functions never hold the database owner's password. Apply after 003_analytics.sql.
--
-- This migration creates the role without a password. Enable login separately, with a
-- generated secret that is stored only in the hosting provider's environment:
--   ALTER ROLE openswarm_api LOGIN PASSWORD '<generated>';
-- On Supabase, connect through the pooler as user `openswarm_api.<project-ref>`.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openswarm_api') THEN
    CREATE ROLE openswarm_api NOLOGIN NOINHERIT;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  -- Roles are cluster-wide; another database on the same server created it first.
  NULL;
END $$;

GRANT USAGE ON SCHEMA public TO openswarm_api;
GRANT USAGE ON SCHEMA analytics TO openswarm_api;

-- Signups: read and insert only. No update or delete from the public API.
GRANT SELECT, INSERT ON public.waitlist_signups TO openswarm_api;
DROP POLICY IF EXISTS waitlist_api_read ON public.waitlist_signups;
DROP POLICY IF EXISTS waitlist_api_insert ON public.waitlist_signups;
CREATE POLICY waitlist_api_read ON public.waitlist_signups FOR SELECT TO openswarm_api USING (true);
CREATE POLICY waitlist_api_insert ON public.waitlist_signups FOR INSERT TO openswarm_api WITH CHECK (true);

-- Analytics writes go through owner-defined functions; the role has no table access there.
CREATE OR REPLACE FUNCTION analytics.is_admin_email(p_email text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM analytics.admin_users WHERE email = lower(btrim(p_email)))
$$;

CREATE OR REPLACE FUNCTION analytics.add_admin(p_actor text, p_email text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT analytics.is_admin_email(p_actor) THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO analytics.admin_users (email, added_by) VALUES (lower(btrim(p_email)), lower(p_actor)) ON CONFLICT (email) DO NOTHING;
  PERFORM analytics.audit(lower(p_actor), 'add_admin', jsonb_build_object('email', lower(btrim(p_email))));
END $$;

ALTER FUNCTION analytics.ingest(jsonb) SECURITY DEFINER;
ALTER FUNCTION analytics.hit(text, integer, integer) SECURITY DEFINER;
ALTER FUNCTION analytics.attribute_signup(text, uuid, uuid, jsonb) SECURITY DEFINER;
ALTER FUNCTION analytics.waitlist_display_count() SECURITY DEFINER;
ALTER FUNCTION analytics.is_admin_email(text) SECURITY DEFINER;
ALTER FUNCTION analytics.add_admin(text, text) SECURITY DEFINER;

REVOKE ALL ON FUNCTION analytics.is_admin_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.add_admin(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  analytics.ingest(jsonb),
  analytics.hit(text, integer, integer),
  analytics.attribute_signup(text, uuid, uuid, jsonb),
  analytics.waitlist_display_count(),
  analytics.is_admin_email(text),
  analytics.add_admin(text, text)
TO openswarm_api;

COMMIT;
