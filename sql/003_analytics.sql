-- First-party analytics, signup attribution and the admin dashboard API.
-- Apply after 001_waitlist.sql. Written for Supabase Postgres (auth.jwt(), roles
-- anon/authenticated) and runs on plain PostgreSQL 15+ when those are stubbed.
--
-- Tables live in the private `analytics` schema, which PostgREST does not expose.
-- The website server writes through the database owner connection (DATABASE_URL).
-- The admin dashboard reads only through the public.admin_* functions below,
-- each of which rejects callers whose Supabase email is not in analytics.admin_users.

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;
REVOKE ALL ON SCHEMA analytics FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Waitlist additions: SMS consent record, abuse signal, reporting index
-- ---------------------------------------------------------------------------

ALTER TABLE public.waitlist_signups
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consented_at timestamptz,
  ADD COLUMN IF NOT EXISTS network_hash text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_consent_version_format') THEN
    ALTER TABLE public.waitlist_signups ADD CONSTRAINT waitlist_consent_version_format
      CHECK (consent_version IS NULL OR consent_version ~ '^[a-z0-9-]{1,32}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_network_hash_format') THEN
    ALTER TABLE public.waitlist_signups ADD CONSTRAINT waitlist_network_hash_format
      CHECK (network_hash IS NULL OR network_hash ~ '^[A-Za-z0-9_-]{16,64}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS waitlist_created_at_idx ON public.waitlist_signups (created_at);

-- Supabase grants new public tables to the API roles by default. RLS already blocks
-- them; revoking as well keeps phone numbers unreachable if a policy is ever added.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.waitlist_signups FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.waitlist_signups FROM authenticated;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics.visitors (
  id uuid PRIMARY KEY,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  sessions integer NOT NULL DEFAULT 0,
  first_channel text,
  first_source text,
  first_campaign text,
  first_referrer_domain text,
  first_landing_path text,
  country text,
  is_internal boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS analytics.sessions (
  id uuid PRIMARY KEY,
  visitor_id uuid NOT NULL REFERENCES analytics.visitors (id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  active_ms bigint NOT NULL DEFAULT 0,
  pageviews integer NOT NULL DEFAULT 0,
  events integer NOT NULL DEFAULT 0,
  max_scroll smallint NOT NULL DEFAULT 0,
  entry_path text NOT NULL,
  exit_path text,
  referrer text,
  referrer_domain text,
  channel text NOT NULL,
  source text NOT NULL,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  click_id text,
  has_invite boolean NOT NULL DEFAULT false,
  country text,
  region text,
  city text,
  browser text,
  browser_version text,
  os text,
  os_version text,
  device_type text,
  screen text,
  viewport text,
  language text,
  timezone text,
  is_new_visitor boolean NOT NULL DEFAULT true,
  is_internal boolean NOT NULL DEFAULT false,
  is_bot boolean NOT NULL DEFAULT false,
  engaged boolean NOT NULL DEFAULT false,
  converted boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS sessions_started_at_idx ON analytics.sessions (started_at);
CREATE INDEX IF NOT EXISTS sessions_visitor_idx ON analytics.sessions (visitor_id);
CREATE INDEX IF NOT EXISTS sessions_last_seen_idx ON analytics.sessions (last_seen_at);

CREATE TABLE IF NOT EXISTS analytics.events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES analytics.sessions (id) ON DELETE CASCADE,
  visitor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  name text NOT NULL,
  path text,
  props jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS events_occurred_at_idx ON analytics.events (occurred_at);
CREATE INDEX IF NOT EXISTS events_session_idx ON analytics.events (session_id);
CREATE INDEX IF NOT EXISTS events_name_time_idx ON analytics.events (name, occurred_at);

-- One row per signup, copied from the session that produced it. Sessions may be
-- pruned by retention; attribution stays with the signup until the signup is deleted.
CREATE TABLE IF NOT EXISTS analytics.signup_attribution (
  phone text PRIMARY KEY REFERENCES public.waitlist_signups (phone) ON DELETE CASCADE ON UPDATE CASCADE,
  visitor_id uuid,
  session_id uuid,
  channel text,
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  referrer_domain text,
  landing_path text,
  country text,
  region text,
  city text,
  device_type text,
  browser text,
  os text,
  seconds_to_signup integer,
  sessions_before integer
);

CREATE INDEX IF NOT EXISTS signup_attribution_session_idx ON analytics.signup_attribution (session_id);
CREATE INDEX IF NOT EXISTS signup_attribution_visitor_idx ON analytics.signup_attribution (visitor_id);

CREATE TABLE IF NOT EXISTS analytics.rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE IF NOT EXISTS analytics.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- The hero previously hard-coded 6,327 people. The displayed count is this baseline
-- plus real signups; admins can change it from the dashboard.
INSERT INTO analytics.settings (key, value) VALUES
  ('waitlist_count_baseline', '6327'::jsonb),
  ('include_internal', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS analytics.admin_users (
  email text PRIMARY KEY CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by text
);

INSERT INTO analytics.admin_users (email, added_by) VALUES
  ('kai@openswarm.com', 'migration'),
  ('haik@openswarm.com', 'migration'),
  ('alex@openswarm.com', 'migration'),
  ('eric@openswarm.com', 'migration')
ON CONFLICT (email) DO NOTHING;

CREATE TABLE IF NOT EXISTS analytics.admin_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE analytics.visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.signup_attribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Server write path (called by the website API through DATABASE_URL)
-- ---------------------------------------------------------------------------

-- Fixed-window counter. Returns true while the key is within its limit.
CREATE OR REPLACE FUNCTION analytics.hit(p_key text, p_window_seconds integer, p_limit integer)
RETURNS boolean LANGUAGE sql SET search_path = '' AS $$
  INSERT INTO analytics.rate_limits AS r (key, window_start, count)
  VALUES (p_key, to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds), 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = r.count + 1
  RETURNING count <= p_limit
$$;

-- One batch from the browser tracker, already validated and enriched by the server.
CREATE OR REPLACE FUNCTION analytics.ingest(p jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_visitor uuid := (p->>'visitor_id')::uuid;
  v_session uuid := (p->>'session_id')::uuid;
  v_now timestamptz := coalesce((p->>'now')::timestamptz, now());
  v_internal boolean := coalesce((p->>'internal')::boolean, false);
  m jsonb := coalesce(p->'meta', '{}'::jsonb);
  ev jsonb := coalesce(p->'events', '[]'::jsonb);
  v_first timestamptz;
  v_last timestamptz;
  v_owner uuid;
  v_new_visitor boolean;
BEGIN
  SELECT min((e->>'at')::timestamptz), max((e->>'at')::timestamptz)
    INTO v_first, v_last FROM jsonb_array_elements(ev) e;
  v_first := coalesce(v_first, v_now);
  v_last := coalesce(v_last, v_now);

  INSERT INTO analytics.visitors AS v (id, first_seen_at, last_seen_at, first_channel, first_source,
    first_campaign, first_referrer_domain, first_landing_path, country, is_internal)
  VALUES (v_visitor, v_first, v_last, m->>'channel', m->>'source', m->>'utm_campaign',
    m->>'referrer_domain', m->>'entry_path', m->>'country', v_internal)
  ON CONFLICT (id) DO UPDATE SET
    last_seen_at = greatest(v.last_seen_at, excluded.last_seen_at),
    country = coalesce(excluded.country, v.country),
    is_internal = v.is_internal OR excluded.is_internal;

  SELECT visitor_id INTO v_owner FROM analytics.sessions WHERE id = v_session FOR UPDATE;
  IF v_owner IS NULL THEN
    SELECT sessions = 0 INTO v_new_visitor FROM analytics.visitors WHERE id = v_visitor FOR UPDATE;
    INSERT INTO analytics.sessions (id, visitor_id, started_at, last_seen_at, entry_path, referrer,
      referrer_domain, channel, source, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      click_id, has_invite, country, region, city, browser, browser_version, os, os_version,
      device_type, screen, viewport, language, timezone, is_new_visitor, is_internal)
    VALUES (v_session, v_visitor, v_first, v_last, coalesce(m->>'entry_path', '/'), m->>'referrer',
      m->>'referrer_domain', coalesce(m->>'channel', 'Direct'), coalesce(m->>'source', '(direct)'),
      m->>'utm_source', m->>'utm_medium', m->>'utm_campaign', m->>'utm_term', m->>'utm_content',
      m->>'click_id', coalesce((m->>'has_invite')::boolean, false), m->>'country', m->>'region',
      m->>'city', m->>'browser', m->>'browser_version', m->>'os', m->>'os_version',
      m->>'device_type', m->>'screen', m->>'viewport', m->>'language', m->>'timezone',
      coalesce(v_new_visitor, true), v_internal)
    ON CONFLICT (id) DO NOTHING;
    IF FOUND THEN
      UPDATE analytics.visitors SET sessions = sessions + 1 WHERE id = v_visitor;
    END IF;
  ELSIF v_owner <> v_visitor THEN
    -- A session id reused by another visitor is ignored rather than merged.
    RETURN;
  END IF;

  INSERT INTO analytics.events (session_id, visitor_id, occurred_at, name, path, props)
  SELECT v_session, v_visitor, (e->>'at')::timestamptz, e->>'name', e->>'path', coalesce(e->'props', '{}'::jsonb)
  FROM jsonb_array_elements(ev) e;

  UPDATE analytics.sessions s SET
    last_seen_at = greatest(s.last_seen_at, v_last),
    pageviews = s.pageviews + agg.pageviews,
    events = s.events + agg.n,
    active_ms = s.active_ms + agg.active_ms,
    max_scroll = greatest(s.max_scroll, agg.max_scroll),
    exit_path = coalesce(agg.exit_path, s.exit_path),
    is_internal = s.is_internal OR v_internal,
    converted = s.converted OR agg.converted,
    engaged = s.engaged OR agg.interacted OR agg.converted
      OR s.pageviews + agg.pageviews >= 2
      OR s.active_ms + agg.active_ms >= 10000
      OR greatest(s.max_scroll, agg.max_scroll) >= 50
  FROM (
    SELECT
      count(*)::integer AS n,
      (count(*) FILTER (WHERE e->>'name' = 'pageview'))::integer AS pageviews,
      coalesce(sum(least((e->'props'->>'ms')::bigint, 1800000)) FILTER (WHERE e->>'name' = 'engagement'), 0) AS active_ms,
      coalesce(max((e->'props'->>'depth')::smallint) FILTER (WHERE e->>'name' = 'scroll'), 0) AS max_scroll,
      (array_agg(e->>'path' ORDER BY (e->>'at')::timestamptz DESC) FILTER (WHERE e->>'name' = 'pageview'))[1] AS exit_path,
      coalesce(bool_or(e->>'name' = 'waitlist_success' AND coalesce((e->'props'->>'added')::boolean, false)), false) AS converted,
      coalesce(bool_or(e->>'name' IN ('click', 'outbound', 'tab', 'waitlist_start', 'referral_open', 'referral_copy', 'referral_share')), false) AS interacted
    FROM jsonb_array_elements(ev) e
  ) agg
  WHERE s.id = v_session;
END $$;

-- Called by the waitlist API inside the signup transaction.
CREATE OR REPLACE FUNCTION analytics.attribute_signup(p_phone text, p_visitor uuid, p_session uuid, p_fallback jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO analytics.signup_attribution (phone, visitor_id, session_id, channel, source, utm_source,
    utm_medium, utm_campaign, utm_term, utm_content, referrer_domain, landing_path, country, region,
    city, device_type, browser, os, seconds_to_signup, sessions_before)
  SELECT p_phone, p_visitor, CASE WHEN s.id IS NULL THEN NULL ELSE p_session END,
    s.channel, s.source, s.utm_source, s.utm_medium, s.utm_campaign, s.utm_term, s.utm_content,
    s.referrer_domain, s.entry_path,
    coalesce(s.country, p_fallback->>'country'), coalesce(s.region, p_fallback->>'region'),
    coalesce(s.city, p_fallback->>'city'), coalesce(s.device_type, p_fallback->>'device_type'),
    coalesce(s.browser, p_fallback->>'browser'), coalesce(s.os, p_fallback->>'os'),
    CASE WHEN v.id IS NULL THEN NULL ELSE greatest(0, extract(epoch FROM now() - v.first_seen_at))::integer END,
    v.sessions
  FROM (SELECT 1) one
  LEFT JOIN analytics.sessions s ON s.id = p_session AND s.visitor_id = p_visitor
  LEFT JOIN analytics.visitors v ON v.id = p_visitor
  ON CONFLICT (phone) DO NOTHING;

  UPDATE analytics.sessions SET converted = true, engaged = true
  WHERE id = p_session AND visitor_id = p_visitor;
END $$;

CREATE OR REPLACE FUNCTION analytics.waitlist_display_count()
RETURNS bigint LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce((SELECT (value #>> '{}')::bigint FROM analytics.settings WHERE key = 'waitlist_count_baseline'), 0)
    + (SELECT count(*) FROM public.waitlist_signups)
$$;

-- Raw events and sessions are kept for 13 months; signups and attribution are kept.
CREATE OR REPLACE FUNCTION analytics.prune(p_retain interval DEFAULT interval '13 months')
RETURNS void LANGUAGE sql SET search_path = '' AS $$
  DELETE FROM analytics.events WHERE occurred_at < now() - p_retain;
  DELETE FROM analytics.sessions WHERE last_seen_at < now() - p_retain;
  DELETE FROM analytics.visitors v WHERE v.last_seen_at < now() - p_retain
    AND NOT EXISTS (SELECT 1 FROM analytics.sessions s WHERE s.visitor_id = v.id);
  DELETE FROM analytics.rate_limits WHERE window_start < now() - interval '2 days';
$$;

-- ---------------------------------------------------------------------------
-- Admin access
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics.current_email()
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT lower(nullif(auth.jwt()->>'email', ''))
$$;

CREATE OR REPLACE FUNCTION analytics.require_admin()
RETURNS text LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_email text := analytics.current_email();
BEGIN
  IF v_email IS NULL OR NOT EXISTS (SELECT 1 FROM analytics.admin_users WHERE email = v_email) THEN
    RAISE EXCEPTION 'Admin access required.' USING ERRCODE = '42501';
  END IF;
  RETURN v_email;
END $$;

CREATE OR REPLACE FUNCTION analytics.audit(p_actor text, p_action text, p_detail jsonb)
RETURNS void LANGUAGE sql SET search_path = '' AS $$
  INSERT INTO analytics.admin_audit_log (actor, action, detail) VALUES (p_actor, p_action, coalesce(p_detail, '{}'::jsonb))
$$;

CREATE OR REPLACE FUNCTION analytics.mask_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  -- Country-code lengths vary, so only the last four digits are shown; location is reported separately.
  SELECT CASE WHEN p_phone IS NULL THEN NULL ELSE '••• ••• ' || right(p_phone, 4) END
$$;

CREATE OR REPLACE FUNCTION analytics.dimensions()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY['channel', 'source', 'referrer_domain', 'utm_source', 'utm_medium', 'utm_campaign',
    'utm_term', 'utm_content', 'click_id', 'country', 'region', 'city', 'device_type', 'browser', 'os',
    'language', 'timezone', 'screen', 'entry_path', 'exit_path', 'is_new_visitor', 'has_invite']
$$;

-- Sessions in [from, to), excluding bots and (unless enabled) internal traffic, with
-- optional equality filters such as {"country": "US", "channel": "Organic Social"}.
-- Missing values match "(none)", the label the breakdowns use for them.
CREATE OR REPLACE FUNCTION analytics.filtered_sessions(p_from timestamptz, p_to timestamptz, p_filters jsonb)
RETURNS SETOF analytics.sessions LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  q text := 'SELECT * FROM analytics.sessions WHERE started_at >= $1 AND started_at < $2 AND NOT is_bot';
  k text;
  val text;
BEGIN
  IF NOT coalesce((SELECT (value #>> '{}')::boolean FROM analytics.settings WHERE key = 'include_internal'), false) THEN
    q := q || ' AND NOT is_internal';
  END IF;
  FOR k, val IN SELECT key, value FROM jsonb_each_text(coalesce(p_filters, '{}'::jsonb)) LOOP
    IF NOT k = ANY (analytics.dimensions()) THEN
      RAISE EXCEPTION 'Unsupported filter: %', k USING ERRCODE = '22023';
    END IF;
    q := q || format(' AND coalesce(%I::text, %L) = %L', k, '(none)', val);
  END LOOP;
  RETURN QUERY EXECUTE q USING p_from, p_to;
END $$;

CREATE OR REPLACE FUNCTION analytics.kpis(p_from timestamptz, p_to timestamptz, p_filters jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH s AS (SELECT * FROM analytics.filtered_sessions(p_from, p_to, p_filters)),
  sig AS (
    SELECT count(*) AS n, count(*) FILTER (WHERE w.referred_by IS NOT NULL) AS referred
    FROM public.waitlist_signups w
    LEFT JOIN analytics.signup_attribution a ON a.phone = w.phone
    WHERE w.created_at >= p_from AND w.created_at < p_to
      AND (coalesce(p_filters, '{}'::jsonb) = '{}'::jsonb OR a.session_id IN (SELECT id FROM s))
  ),
  agg AS (
    SELECT count(DISTINCT visitor_id) AS visitors,
      count(DISTINCT visitor_id) FILTER (WHERE is_new_visitor) AS new_visitors,
      count(*) AS sessions,
      coalesce(sum(pageviews), 0) AS pageviews,
      count(*) FILTER (WHERE engaged) AS engaged,
      coalesce(avg(active_ms), 0) AS avg_ms,
      count(DISTINCT visitor_id) FILTER (WHERE converted) AS converting_visitors
    FROM s
  )
  SELECT jsonb_build_object(
    'visitors', agg.visitors,
    'new_visitors', agg.new_visitors,
    'returning_visitors', agg.visitors - agg.new_visitors,
    'sessions', agg.sessions,
    'pageviews', agg.pageviews,
    'engaged_sessions', agg.engaged,
    'bounce_rate', CASE WHEN agg.sessions = 0 THEN 0 ELSE round(1 - agg.engaged::numeric / agg.sessions, 4) END,
    'avg_engagement_seconds', round(agg.avg_ms / 1000.0, 1),
    'pages_per_session', CASE WHEN agg.sessions = 0 THEN 0 ELSE round(agg.pageviews::numeric / agg.sessions, 2) END,
    'signups', sig.n,
    'referred_signups', sig.referred,
    'converting_visitors', agg.converting_visitors,
    'conversion_rate', CASE WHEN agg.visitors = 0 THEN 0 ELSE round(agg.converting_visitors::numeric / agg.visitors, 4) END
  )
  FROM agg, sig
$$;

-- ---------------------------------------------------------------------------
-- Admin dashboard API (Supabase RPC). Every function checks require_admin().
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_whoami()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email text := analytics.current_email();
BEGIN
  RETURN jsonb_build_object('email', v_email,
    'is_admin', v_email IS NOT NULL AND EXISTS (SELECT 1 FROM analytics.admin_users WHERE email = v_email));
END $$;

CREATE OR REPLACE FUNCTION public.admin_overview(p_from timestamptz, p_to timestamptz, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM analytics.require_admin();
  RETURN jsonb_build_object(
    'current', analytics.kpis(p_from, p_to, p_filters),
    'previous', analytics.kpis(p_from - (p_to - p_from), p_from, p_filters),
    'all_time_signups', (SELECT count(*) FROM public.waitlist_signups),
    'display_count', analytics.waitlist_display_count()
  );
END $$;

CREATE OR REPLACE FUNCTION public.admin_timeseries(p_from timestamptz, p_to timestamptz, p_filters jsonb DEFAULT '{}'::jsonb,
  p_bucket text DEFAULT 'day', p_tz text DEFAULT 'UTC')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM analytics.require_admin();
  IF p_bucket NOT IN ('hour', 'day', 'week', 'month') THEN
    RAISE EXCEPTION 'Unsupported bucket: %', p_bucket USING ERRCODE = '22023';
  END IF;
  -- Browsers may report zones this server does not know; fall back to UTC rather than fail.
  BEGIN
    PERFORM now() AT TIME ZONE p_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    p_tz := 'UTC';
  END;
  WITH buckets AS (
    SELECT generate_series(
      date_trunc(p_bucket, p_from AT TIME ZONE p_tz),
      date_trunc(p_bucket, (p_to - interval '1 microsecond') AT TIME ZONE p_tz),
      ('1 ' || p_bucket)::interval) AS b
  ),
  s AS (
    SELECT date_trunc(p_bucket, started_at AT TIME ZONE p_tz) AS b, visitor_id, pageviews, engaged, converted, id
    FROM analytics.filtered_sessions(p_from, p_to, p_filters)
  ),
  sa AS (
    SELECT b, count(DISTINCT visitor_id) AS visitors, count(*) AS sessions, sum(pageviews) AS pageviews,
      count(*) FILTER (WHERE engaged) AS engaged
    FROM s GROUP BY b
  ),
  sig AS (
    SELECT date_trunc(p_bucket, w.created_at AT TIME ZONE p_tz) AS b, count(*) AS signups
    FROM public.waitlist_signups w
    LEFT JOIN analytics.signup_attribution a ON a.phone = w.phone
    WHERE w.created_at >= p_from AND w.created_at < p_to
      AND (coalesce(p_filters, '{}'::jsonb) = '{}'::jsonb OR a.session_id IN (SELECT id FROM s))
    GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      't', to_char(buckets.b, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'visitors', coalesce(sa.visitors, 0),
      'sessions', coalesce(sa.sessions, 0),
      'pageviews', coalesce(sa.pageviews, 0),
      'engaged', coalesce(sa.engaged, 0),
      'signups', coalesce(sig.signups, 0)
    ) ORDER BY buckets.b), '[]'::jsonb)
  INTO v_result
  FROM buckets LEFT JOIN sa ON sa.b = buckets.b LEFT JOIN sig ON sig.b = buckets.b;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.admin_breakdown(p_from timestamptz, p_to timestamptz, p_filters jsonb DEFAULT '{}'::jsonb,
  p_dimension text DEFAULT 'channel', p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM analytics.require_admin();
  IF NOT p_dimension = ANY (analytics.dimensions()) THEN
    RAISE EXCEPTION 'Unsupported dimension: %', p_dimension USING ERRCODE = '22023';
  END IF;
  EXECUTE format($q$
    SELECT coalesce(jsonb_agg(r ORDER BY r.sessions DESC, r.value), '[]'::jsonb) FROM (
      SELECT coalesce(%I::text, '(none)') AS value,
        count(DISTINCT visitor_id) AS visitors,
        count(*) AS sessions,
        coalesce(sum(pageviews), 0) AS pageviews,
        round(count(*) FILTER (WHERE engaged)::numeric / count(*), 4) AS engaged_rate,
        round(avg(active_ms) / 1000.0, 1) AS avg_engagement_seconds,
        count(*) FILTER (WHERE converted) AS signups,
        round(count(DISTINCT visitor_id) FILTER (WHERE converted)::numeric / count(DISTINCT visitor_id), 4) AS conversion_rate
      FROM analytics.filtered_sessions($1, $2, $3)
      GROUP BY 1
      ORDER BY count(*) DESC, 1
      LIMIT $4
    ) r
  $q$, p_dimension)
  INTO v_rows USING p_from, p_to, p_filters, least(greatest(coalesce(p_limit, 50), 1), 500);
  RETURN v_rows;
END $$;

CREATE OR REPLACE FUNCTION public.admin_funnel(p_from timestamptz, p_to timestamptz, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM analytics.require_admin();
  WITH s AS (SELECT id, converted FROM analytics.filtered_sessions(p_from, p_to, p_filters)),
  e AS (
    SELECT e.session_id, e.name, e.props FROM analytics.events e
    WHERE e.occurred_at >= p_from AND e.occurred_at < p_to + interval '1 day'
      AND e.name IN ('waitlist_view', 'waitlist_start', 'waitlist_submit', 'waitlist_success', 'waitlist_error',
        'waitlist_fail', 'referral_open', 'referral_copy', 'referral_share')
      AND e.session_id IN (SELECT id FROM s)
  )
  SELECT jsonb_build_object(
    'steps', jsonb_build_array(
      jsonb_build_object('key', 'visited', 'label', 'Visited', 'sessions', (SELECT count(*) FROM s)),
      jsonb_build_object('key', 'saw_form', 'label', 'Saw the signup form', 'sessions', (SELECT count(DISTINCT session_id) FROM e WHERE name = 'waitlist_view')),
      jsonb_build_object('key', 'started', 'label', 'Started entering a number', 'sessions', (SELECT count(DISTINCT session_id) FROM e WHERE name = 'waitlist_start')),
      jsonb_build_object('key', 'submitted', 'label', 'Submitted', 'sessions', (SELECT count(DISTINCT session_id) FROM e WHERE name = 'waitlist_submit')),
      jsonb_build_object('key', 'joined', 'label', 'Joined (new signup)', 'sessions', (SELECT count(*) FROM s WHERE converted)),
      jsonb_build_object('key', 'shared', 'label', 'Shared an invite', 'sessions', (SELECT count(DISTINCT session_id) FROM e WHERE name IN ('referral_copy', 'referral_share')))
    ),
    'errors', (SELECT coalesce(jsonb_agg(x ORDER BY x.count DESC), '[]'::jsonb) FROM (
      SELECT coalesce(props->>'code', props->>'status', name) AS reason, count(*) AS count
      FROM e WHERE name IN ('waitlist_error', 'waitlist_fail') GROUP BY 1) x),
    'by_source', (SELECT coalesce(jsonb_agg(x ORDER BY x.submitted DESC), '[]'::jsonb) FROM (
      SELECT coalesce(props->>'source', props->>'placement', '(none)') AS source,
        count(*) FILTER (WHERE name = 'waitlist_submit') AS submitted,
        count(*) FILTER (WHERE name = 'waitlist_success' AND props->>'added' = 'true') AS joined
      FROM e WHERE name IN ('waitlist_submit', 'waitlist_success') GROUP BY 1) x)
  ) INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.admin_engagement(p_from timestamptz, p_to timestamptz, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM analytics.require_admin();
  WITH s AS (SELECT id, max_scroll FROM analytics.filtered_sessions(p_from, p_to, p_filters)),
  total AS (SELECT greatest(count(*), 1) AS n FROM s),
  e AS (
    SELECT e.session_id, e.name, e.props FROM analytics.events e
    WHERE e.occurred_at >= p_from AND e.occurred_at < p_to + interval '1 day'
      AND e.session_id IN (SELECT id FROM s)
  )
  SELECT jsonb_build_object(
    'total_sessions', (SELECT count(*) FROM s),
    'sections', (SELECT coalesce(jsonb_agg(x ORDER BY x.ord), '[]'::jsonb) FROM (
      SELECT sec.name AS section, sec.ord, count(DISTINCT e.session_id) AS sessions,
        round(count(DISTINCT e.session_id)::numeric / (SELECT n FROM total), 4) AS rate
      FROM (VALUES ('top', 1), ('intro', 2), ('capabilities', 3), ('use-cases', 4), ('marketplace', 5), ('closing', 6)) AS sec(name, ord)
      LEFT JOIN e ON e.name = 'section_view' AND e.props->>'section' = sec.name
      GROUP BY sec.name, sec.ord) x),
    'scroll', (SELECT coalesce(jsonb_agg(x ORDER BY x.depth), '[]'::jsonb) FROM (
      SELECT d.depth, count(s.id) AS sessions, round(count(s.id)::numeric / (SELECT n FROM total), 4) AS rate
      FROM (VALUES (25), (50), (75), (90), (100)) AS d(depth)
      LEFT JOIN s ON s.max_scroll >= d.depth
      GROUP BY d.depth) x),
    'tabs', (SELECT coalesce(jsonb_agg(x ORDER BY x.count DESC), '[]'::jsonb) FROM (
      SELECT coalesce(props->>'group', '') || ': ' || coalesce(props->>'tab', '') AS tab, count(*) AS count,
        count(DISTINCT session_id) AS sessions
      FROM e WHERE name = 'tab' GROUP BY 1 ORDER BY 2 DESC LIMIT 50) x),
    'clicks', (SELECT coalesce(jsonb_agg(x ORDER BY x.count DESC), '[]'::jsonb) FROM (
      SELECT props->>'target' AS target, count(*) AS count, count(DISTINCT session_id) AS sessions
      FROM e WHERE name = 'click' AND props ? 'target' GROUP BY 1 ORDER BY 2 DESC LIMIT 50) x),
    'outbound', (SELECT coalesce(jsonb_agg(x ORDER BY x.count DESC), '[]'::jsonb) FROM (
      SELECT props->>'href' AS href, count(*) AS count, count(DISTINCT session_id) AS sessions
      FROM e WHERE name = 'outbound' GROUP BY 1 ORDER BY 2 DESC LIMIT 50) x),
    'events', (SELECT coalesce(jsonb_agg(x ORDER BY x.count DESC), '[]'::jsonb) FROM (
      SELECT name, count(*) AS count, count(DISTINCT session_id) AS sessions FROM e GROUP BY 1) x)
  ) INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.admin_realtime()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_internal boolean := coalesce((SELECT (value #>> '{}')::boolean FROM analytics.settings WHERE key = 'include_internal'), false);
BEGIN
  PERFORM analytics.require_admin();
  WITH recent AS (
    SELECT e.*, s.country, s.city, s.device_type, s.browser, s.channel, s.source
    FROM analytics.events e JOIN analytics.sessions s ON s.id = e.session_id
    WHERE e.occurred_at >= now() - interval '30 minutes' AND NOT s.is_bot AND (v_internal OR NOT s.is_internal)
  ),
  active AS (SELECT * FROM recent WHERE occurred_at >= now() - interval '5 minutes')
  SELECT jsonb_build_object(
    'active_visitors', (SELECT count(DISTINCT visitor_id) FROM active),
    'active_sessions', (SELECT count(DISTINCT session_id) FROM active),
    'per_minute', (SELECT coalesce(jsonb_agg(jsonb_build_object('t', m.t, 'visitors', coalesce(x.visitors, 0)) ORDER BY m.t), '[]'::jsonb)
      FROM generate_series(date_trunc('minute', now()) - interval '29 minutes', date_trunc('minute', now()), interval '1 minute') AS m(t)
      LEFT JOIN (SELECT date_trunc('minute', occurred_at) AS t, count(DISTINCT visitor_id) AS visitors FROM recent GROUP BY 1) x ON x.t = m.t),
    'countries', (SELECT coalesce(jsonb_agg(x ORDER BY x.visitors DESC), '[]'::jsonb) FROM (
      SELECT coalesce(country, '(none)') AS country, count(DISTINCT visitor_id) AS visitors FROM active GROUP BY 1) x),
    'sources', (SELECT coalesce(jsonb_agg(x ORDER BY x.visitors DESC), '[]'::jsonb) FROM (
      SELECT source, count(DISTINCT visitor_id) AS visitors FROM active GROUP BY 1) x),
    'devices', (SELECT coalesce(jsonb_agg(x ORDER BY x.visitors DESC), '[]'::jsonb) FROM (
      SELECT coalesce(device_type, '(none)') AS device_type, count(DISTINCT visitor_id) AS visitors FROM active GROUP BY 1) x),
    'recent', (SELECT coalesce(jsonb_agg(x ORDER BY x.occurred_at DESC), '[]'::jsonb) FROM (
      SELECT occurred_at, name, path, props, country, city, device_type, browser, source
      FROM recent WHERE name NOT IN ('engagement', 'vital') ORDER BY occurred_at DESC LIMIT 40) x)
  ) INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.admin_signups(p_from timestamptz, p_to timestamptz, p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
  v_result jsonb;
BEGIN
  PERFORM analytics.require_admin();
  WITH base AS (
    SELECT w.*, a.channel, a.source AS traffic_source, a.utm_source, a.utm_medium, a.utm_campaign,
      a.referrer_domain, a.country, a.region, a.city, a.device_type, a.browser, a.os,
      a.seconds_to_signup, a.sessions_before
    FROM public.waitlist_signups w
    LEFT JOIN analytics.signup_attribution a ON a.phone = w.phone
    WHERE w.created_at >= p_from AND w.created_at < p_to
      AND (v_search IS NULL
        OR (v_digits IS NOT NULL AND length(v_digits) >= 3 AND w.phone LIKE '%' || v_digits || '%')
        OR w.source ILIKE '%' || v_search || '%'
        OR a.utm_campaign ILIKE '%' || v_search || '%'
        OR a.utm_source ILIKE '%' || v_search || '%'
        OR a.country ILIKE v_search
        OR w.referral_code = v_search)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'rows', (SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
      SELECT b.referral_code AS code, analytics.mask_phone(b.phone) AS phone_masked, b.created_at, b.source AS placement,
        b.referred_by IS NOT NULL AS was_invited,
        (SELECT count(*) FROM public.waitlist_signups i WHERE i.referred_by = b.referral_code AND i.phone <> b.phone) AS invites,
        b.channel, b.traffic_source, b.utm_source, b.utm_medium, b.utm_campaign, b.referrer_domain,
        b.country, b.region, b.city, b.device_type, b.browser, b.os, b.seconds_to_signup, b.sessions_before,
        b.consent_version, b.consented_at
      FROM base b ORDER BY b.created_at DESC
      LIMIT least(greatest(coalesce(p_limit, 50), 1), 500) OFFSET greatest(coalesce(p_offset, 0), 0)) x)
  ) INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.admin_reveal_phone(p_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := analytics.require_admin();
  v_phone text;
BEGIN
  SELECT phone INTO v_phone FROM public.waitlist_signups WHERE referral_code = p_code;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Signup not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM analytics.audit(v_actor, 'reveal_phone', jsonb_build_object('code', p_code));
  RETURN v_phone;
END $$;

CREATE OR REPLACE FUNCTION public.admin_export_signups(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := analytics.require_admin();
  v_rows jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(x ORDER BY x.created_at), '[]'::jsonb) INTO v_rows FROM (
    SELECT w.phone, w.created_at, w.source AS placement, w.referral_code, w.referred_by, w.consent_version, w.consented_at,
      (SELECT count(*) FROM public.waitlist_signups i WHERE i.referred_by = w.referral_code AND i.phone <> w.phone) AS invites,
      a.channel, a.source AS traffic_source, a.utm_source, a.utm_medium, a.utm_campaign, a.utm_term, a.utm_content,
      a.referrer_domain, a.landing_path, a.country, a.region, a.city, a.device_type, a.browser, a.os,
      a.seconds_to_signup, a.sessions_before
    FROM public.waitlist_signups w
    LEFT JOIN analytics.signup_attribution a ON a.phone = w.phone
    WHERE w.created_at >= p_from AND w.created_at < p_to
  ) x;
  PERFORM analytics.audit(v_actor, 'export_signups', jsonb_build_object('from', p_from, 'to', p_to, 'rows', jsonb_array_length(v_rows)));
  RETURN v_rows;
END $$;

-- Erases a person: their signup, its attribution, and the visitor history linked to it.
CREATE OR REPLACE FUNCTION public.admin_delete_signup(p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := analytics.require_admin();
  v_phone text;
  v_visitor uuid;
BEGIN
  SELECT w.phone, a.visitor_id INTO v_phone, v_visitor
  FROM public.waitlist_signups w LEFT JOIN analytics.signup_attribution a ON a.phone = w.phone
  WHERE w.referral_code = p_code;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Signup not found.' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM public.waitlist_signups WHERE phone = v_phone;
  IF v_visitor IS NOT NULL THEN
    DELETE FROM analytics.events WHERE visitor_id = v_visitor;
    DELETE FROM analytics.visitors WHERE id = v_visitor;
  END IF;
  PERFORM analytics.audit(v_actor, 'delete_signup', jsonb_build_object('code', p_code, 'masked', analytics.mask_phone(v_phone)));
END $$;

CREATE OR REPLACE FUNCTION public.admin_referrals(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM analytics.require_admin();
  WITH invites AS (
    SELECT o.referral_code AS code, o.phone, o.created_at, o.network_hash,
      count(i.phone) AS invites,
      count(i.phone) FILTER (WHERE i.created_at >= p_from AND i.created_at < p_to) AS invites_in_range
    FROM public.waitlist_signups o
    LEFT JOIN public.waitlist_signups i ON i.referred_by = o.referral_code AND i.phone <> o.phone
    GROUP BY o.referral_code, o.phone, o.created_at, o.network_hash
  ),
  period AS (SELECT * FROM public.waitlist_signups WHERE created_at >= p_from AND created_at < p_to)
  SELECT jsonb_build_object(
    'signups', (SELECT count(*) FROM period),
    'referred_signups', (SELECT count(*) FROM period WHERE referred_by IS NOT NULL),
    'k_factor', (SELECT CASE WHEN count(*) = 0 THEN 0 ELSE round(count(*) FILTER (WHERE referred_by IS NOT NULL)::numeric / count(*), 4) END FROM period),
    'active_referrers', (SELECT count(DISTINCT referred_by) FROM period WHERE referred_by IS NOT NULL),
    'priority_unlocked', (SELECT count(*) FROM invites WHERE invites >= 3),
    'distribution', (SELECT jsonb_agg(jsonb_build_object('bucket', b.label, 'people', coalesce(x.n, 0)) ORDER BY b.ord) FROM
      (VALUES ('0', 0), ('1', 1), ('2', 2), ('3+', 3)) AS b(label, ord)
      LEFT JOIN (SELECT least(invites, 3) AS ord, count(*) AS n FROM invites GROUP BY 1) x ON x.ord = b.ord),
    'leaderboard', (SELECT coalesce(jsonb_agg(x ORDER BY x.invites DESC, x.joined_at), '[]'::jsonb) FROM (
      SELECT inv.code, analytics.mask_phone(inv.phone) AS phone_masked, inv.created_at AS joined_at, inv.invites,
        inv.invites_in_range, inv.invites >= 3 AS priority, a.channel, a.country
      FROM invites inv LEFT JOIN analytics.signup_attribution a ON a.phone = inv.phone
      WHERE inv.invites > 0 ORDER BY inv.invites DESC, inv.created_at LIMIT 25) x),
    -- Invitees who share a network with their inviter or with each other often indicate self-referral.
    'suspicious', (SELECT coalesce(jsonb_agg(x ORDER BY x.shared DESC), '[]'::jsonb) FROM (
      SELECT o.referral_code AS code, analytics.mask_phone(o.phone) AS phone_masked,
        count(i.phone) AS invites,
        count(i.phone) FILTER (WHERE i.network_hash IS NOT NULL AND (i.network_hash = o.network_hash
          OR EXISTS (SELECT 1 FROM public.waitlist_signups j WHERE j.referred_by = o.referral_code AND j.phone <> i.phone AND j.network_hash = i.network_hash))) AS shared
      FROM public.waitlist_signups o JOIN public.waitlist_signups i ON i.referred_by = o.referral_code AND i.phone <> o.phone
      GROUP BY o.referral_code, o.phone
      HAVING count(i.phone) FILTER (WHERE i.network_hash IS NOT NULL AND (i.network_hash = o.network_hash
          OR EXISTS (SELECT 1 FROM public.waitlist_signups j WHERE j.referred_by = o.referral_code AND j.phone <> i.phone AND j.network_hash = i.network_hash))) >= 2
      LIMIT 25) x)
  ) INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.admin_performance(p_from timestamptz, p_to timestamptz, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM analytics.require_admin();
  WITH s AS (SELECT id, device_type FROM analytics.filtered_sessions(p_from, p_to, p_filters)),
  e AS (
    SELECT e.name, e.props, e.path, e.occurred_at, e.session_id, s.device_type FROM analytics.events e JOIN s ON s.id = e.session_id
    WHERE e.occurred_at >= p_from AND e.occurred_at < p_to + interval '1 day' AND e.name IN ('vital', 'error')
  )
  SELECT jsonb_build_object(
    'vitals', (SELECT coalesce(jsonb_agg(x ORDER BY x.metric, x.device_type), '[]'::jsonb) FROM (
      SELECT props->>'name' AS metric, coalesce(device_type, '(none)') AS device_type, count(*) AS samples,
        round(percentile_cont(0.75) WITHIN GROUP (ORDER BY (props->>'value')::float8)::numeric, 3) AS p75,
        round(count(*) FILTER (WHERE props->>'rating' = 'good')::numeric / count(*), 4) AS good,
        round(count(*) FILTER (WHERE props->>'rating' = 'needs-improvement')::numeric / count(*), 4) AS needs_improvement,
        round(count(*) FILTER (WHERE props->>'rating' = 'poor')::numeric / count(*), 4) AS poor
      FROM e WHERE name = 'vital' GROUP BY GROUPING SETS ((props->>'name'), (props->>'name', coalesce(device_type, '(none)')))) x),
    'errors', (SELECT coalesce(jsonb_agg(x ORDER BY x.count DESC), '[]'::jsonb) FROM (
      SELECT props->>'message' AS message, props->>'source' AS source, count(*) AS count,
        count(DISTINCT session_id) AS sessions, max(occurred_at) AS last_seen
      FROM e WHERE name = 'error' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 50) x)
  ) INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.admin_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := analytics.require_admin();
BEGIN
  RETURN jsonb_build_object(
    'me', v_actor,
    'admins', (SELECT coalesce(jsonb_agg(x ORDER BY x.email), '[]'::jsonb) FROM (SELECT email, added_at, added_by FROM analytics.admin_users) x),
    'settings', (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM analytics.settings),
    'display_count', analytics.waitlist_display_count(),
    'audit', (SELECT coalesce(jsonb_agg(x ORDER BY x.at DESC), '[]'::jsonb) FROM (
      SELECT at, actor, action, detail FROM analytics.admin_audit_log ORDER BY at DESC LIMIT 50) x)
  );
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_setting(p_key text, p_value jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := analytics.require_admin();
BEGIN
  IF p_key = 'waitlist_count_baseline' THEN
    IF jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}')::numeric < 0 OR (p_value #>> '{}')::numeric <> trunc((p_value #>> '{}')::numeric) THEN
      RAISE EXCEPTION 'The baseline must be a whole number of 0 or more.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_key = 'include_internal' THEN
    IF jsonb_typeof(p_value) <> 'boolean' THEN
      RAISE EXCEPTION 'include_internal must be true or false.' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown setting: %', p_key USING ERRCODE = '22023';
  END IF;
  INSERT INTO analytics.settings (key, value, updated_at, updated_by) VALUES (p_key, p_value, now(), v_actor)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  PERFORM analytics.audit(v_actor, 'update_setting', jsonb_build_object('key', p_key, 'value', p_value));
END $$;

CREATE OR REPLACE FUNCTION public.admin_add_admin(p_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := analytics.require_admin();
  v_email text := lower(btrim(p_email));
BEGIN
  INSERT INTO analytics.admin_users (email, added_by) VALUES (v_email, v_actor) ON CONFLICT (email) DO NOTHING;
  PERFORM analytics.audit(v_actor, 'add_admin', jsonb_build_object('email', v_email));
END $$;

CREATE OR REPLACE FUNCTION public.admin_remove_admin(p_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := analytics.require_admin();
  v_email text := lower(btrim(p_email));
BEGIN
  IF v_email = v_actor THEN
    RAISE EXCEPTION 'You cannot remove your own access.' USING ERRCODE = '22023';
  END IF;
  DELETE FROM analytics.admin_users WHERE email = v_email;
  PERFORM analytics.audit(v_actor, 'remove_admin', jsonb_build_object('email', v_email));
END $$;

-- ---------------------------------------------------------------------------
-- Privileges: the API roles may call admin_* functions (which check admin access
-- themselves) and nothing else in this migration.
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA analytics FROM PUBLIC;

DO $$
DECLARE
  f regprocedure;
  has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  IF has_anon THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM anon';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA analytics FROM anon';
  END IF;
  IF has_auth THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA analytics FROM authenticated';
  END IF;
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE 'admin\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF has_anon THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    IF has_auth THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f); END IF;
  END LOOP;
END $$;

-- Daily retention when pg_cron is available (it is on Supabase).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('analytics-prune', '17 9 * * *', 'SELECT analytics.prune()');
  END IF;
END $$;

COMMIT;
