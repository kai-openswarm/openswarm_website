-- Email signup settings, welcome email log and unsubscribes, annotations, filter
-- operators, comparison ranges, heartbeat, referral loop metrics.
-- Apply after 004_api_role.sql. Safe to re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- Waitlist: unsubscribe state
-- ---------------------------------------------------------------------------

ALTER TABLE public.waitlist_signups ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Email signup settings (stored in analytics.settings)
-- ---------------------------------------------------------------------------

INSERT INTO analytics.settings (key, value) VALUES
  ('signups_open', 'true'::jsonb),
  ('signups_closed_message', '"The waitlist is paused right now. Please check back soon."'::jsonb),
  ('blocked_email_domains', '[]'::jsonb),
  ('block_disposable_email', 'true'::jsonb),
  ('signup_limit_per_hour', '10'::jsonb),
  ('signup_limit_per_day', '40'::jsonb),
  ('welcome_email', jsonb_build_object(
    'enabled', false,
    'from_name', 'Open Swarm',
    'from_email', '',
    'reply_to', '',
    'subject', 'You''re on the Open Swarm waitlist',
    'body', E'Thanks for joining the Open Swarm waitlist. We''ll email you when early access opens.\n\nWant to move up? Invite 3 friends with your personal link and unlock priority access:\n{{invite_link}}\n\nThe Open Swarm team',
    'postal_address', ''
  ))
ON CONFLICT (key) DO NOTHING;

-- What the website API needs at signup time. Owner-defined so the API role never reads tables.
CREATE OR REPLACE FUNCTION analytics.signup_config()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM analytics.settings
  WHERE key IN ('signups_open', 'signups_closed_message', 'blocked_email_domains', 'block_disposable_email',
    'signup_limit_per_hour', 'signup_limit_per_day', 'welcome_email')
$$;

-- ---------------------------------------------------------------------------
-- Welcome email log and unsubscribes (written by the API role through functions)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics.email_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referral_code text REFERENCES public.waitlist_signups (referral_code) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('welcome', 'test')),
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  provider_id text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_log_created_idx ON analytics.email_log (created_at);
ALTER TABLE analytics.email_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION analytics.log_email(p_code text, p_kind text, p_status text, p_provider_id text, p_detail text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO analytics.email_log (referral_code, kind, status, provider_id, detail)
  VALUES (p_code, p_kind, p_status, left(p_provider_id, 200), left(p_detail, 500))
$$;

-- Returns true when the code exists. Idempotent: the first unsubscribe time is kept.
CREATE OR REPLACE FUNCTION analytics.unsubscribe(p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.waitlist_signups SET unsubscribed_at = coalesce(unsubscribed_at, now()) WHERE referral_code = p_code;
  RETURN FOUND;
END $$;

-- ---------------------------------------------------------------------------
-- Annotations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics.annotations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  starts_on date NOT NULL,
  ends_on date,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 60),
  color text NOT NULL DEFAULT 'blue' CHECK (color IN ('blue', 'green', 'orange', 'red', 'purple', 'gray')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
ALTER TABLE analytics.annotations ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Filters: {"country": "US"} (is), or {"country": {"op": "is"|"is_not"|"contains"|"not_contains",
-- "values": ["US", "CA"]}}. Several values are OR'd; dimensions are AND'd.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics.filtered_sessions(p_from timestamptz, p_to timestamptz, p_filters jsonb)
RETURNS SETOF analytics.sessions LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  q text := 'SELECT * FROM analytics.sessions WHERE started_at >= $1 AND started_at < $2 AND NOT is_bot';
  k text;
  v jsonb;
  op text;
  vals text[];
  col text;
  patterns text[];
BEGIN
  IF NOT coalesce((SELECT (value #>> '{}')::boolean FROM analytics.settings WHERE key = 'include_internal'), false) THEN
    q := q || ' AND NOT is_internal';
  END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(coalesce(p_filters, '{}'::jsonb)) LOOP
    IF NOT k = ANY (analytics.dimensions()) THEN
      RAISE EXCEPTION 'Unsupported filter: %', k USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v) = 'string' THEN
      op := 'is';
      vals := ARRAY[v #>> '{}'];
    ELSIF jsonb_typeof(v) = 'object' THEN
      op := coalesce(v->>'op', 'is');
      IF jsonb_typeof(v->'values') <> 'array' THEN
        RAISE EXCEPTION 'Filter % needs a values array.', k USING ERRCODE = '22023';
      END IF;
      SELECT array_agg(x) INTO vals FROM jsonb_array_elements_text(v->'values') x;
    ELSE
      RAISE EXCEPTION 'Unsupported filter value for %', k USING ERRCODE = '22023';
    END IF;
    IF vals IS NULL OR cardinality(vals) = 0 OR cardinality(vals) > 50 OR EXISTS (SELECT 1 FROM unnest(vals) x WHERE length(x) > 200) THEN
      RAISE EXCEPTION 'Filter % needs 1 to 50 values of up to 200 characters.', k USING ERRCODE = '22023';
    END IF;
    col := format('coalesce(%I::text, %L)', k, '(none)');
    IF op IN ('contains', 'not_contains') THEN
      SELECT array_agg('%' || replace(replace(replace(x, '\', '\\'), '%', '\%'), '_', '\_') || '%') INTO patterns FROM unnest(vals) x;
    END IF;
    q := q || CASE op
      WHEN 'is' THEN format(' AND %s = ANY (%L::text[])', col, vals)
      WHEN 'is_not' THEN format(' AND %s <> ALL (%L::text[])', col, vals)
      WHEN 'contains' THEN format(' AND %s ILIKE ANY (%L::text[])', col, patterns)
      WHEN 'not_contains' THEN format(' AND NOT (%s ILIKE ANY (%L::text[]))', col, patterns)
      ELSE NULL
    END;
    IF q IS NULL THEN
      RAISE EXCEPTION 'Unsupported filter operator: %', op USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN QUERY EXECUTE q USING p_from, p_to;
END $$;

-- ---------------------------------------------------------------------------
-- Overview: explicit comparison range and heartbeat
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_overview(timestamptz, timestamptz, jsonb);
CREATE OR REPLACE FUNCTION public.admin_overview(p_from timestamptz, p_to timestamptz, p_filters jsonb DEFAULT '{}'::jsonb,
  p_compare_from timestamptz DEFAULT NULL, p_compare_to timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM analytics.require_admin();
  RETURN jsonb_build_object(
    'current', analytics.kpis(p_from, p_to, p_filters),
    'previous', analytics.kpis(coalesce(p_compare_from, p_from - (p_to - p_from)), coalesce(p_compare_to, p_from), p_filters),
    'compare_from', coalesce(p_compare_from, p_from - (p_to - p_from)),
    'compare_to', coalesce(p_compare_to, p_from),
    'all_time_signups', (SELECT count(*) FROM public.waitlist_signups),
    'display_count', analytics.waitlist_display_count(),
    'last_signup_at', (SELECT max(created_at) FROM public.waitlist_signups),
    'last_referral_at', (SELECT max(created_at) FROM public.waitlist_signups WHERE referred_by IS NOT NULL)
  );
END $$;

-- ---------------------------------------------------------------------------
-- Realtime: today counters (in the viewer's time zone) and sections in view
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_realtime();
CREATE OR REPLACE FUNCTION public.admin_realtime(p_tz text DEFAULT 'UTC')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_internal boolean := coalesce((SELECT (value #>> '{}')::boolean FROM analytics.settings WHERE key = 'include_internal'), false);
  v_midnight timestamptz;
BEGIN
  PERFORM analytics.require_admin();
  BEGIN
    v_midnight := date_trunc('day', now() AT TIME ZONE p_tz) AT TIME ZONE p_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_midnight := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  END;
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
    'sections', (SELECT coalesce(jsonb_agg(x ORDER BY x.visitors DESC), '[]'::jsonb) FROM (
      SELECT props->>'section' AS section, count(DISTINCT visitor_id) AS visitors
      FROM active WHERE name = 'section_view' GROUP BY 1) x),
    'today', jsonb_build_object(
      'since', v_midnight,
      'signups', (SELECT count(*) FROM public.waitlist_signups WHERE created_at >= v_midnight),
      'referred_signups', (SELECT count(*) FROM public.waitlist_signups WHERE created_at >= v_midnight AND referred_by IS NOT NULL),
      'visitors', (SELECT count(DISTINCT visitor_id) FROM analytics.sessions
        WHERE last_seen_at >= v_midnight AND NOT is_bot AND (v_internal OR NOT is_internal))),
    'recent', (SELECT coalesce(jsonb_agg(x ORDER BY x.occurred_at DESC), '[]'::jsonb) FROM (
      SELECT occurred_at, name, path, props - 'code' AS props, country, city, device_type, browser, source
      FROM recent WHERE name NOT IN ('engagement', 'vital') ORDER BY occurred_at DESC LIMIT 40) x)
  ) INTO v_result;
  RETURN v_result;
END $$;

-- ---------------------------------------------------------------------------
-- Referrals: cohort K-factor with components, share channels, loop funnel
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_referrals(timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION public.admin_referrals(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM analytics.require_admin();
  WITH invites AS (
    SELECT o.referral_code AS code, analytics.mask_contact(o.email, o.phone) AS contact_masked, o.created_at, o.network_hash,
      count(i.referral_code) AS invites,
      count(i.referral_code) FILTER (WHERE i.created_at >= p_from AND i.created_at < p_to) AS invites_in_range
    FROM public.waitlist_signups o
    LEFT JOIN public.waitlist_signups i ON i.referred_by = o.referral_code AND i.referral_code <> o.referral_code
    GROUP BY o.referral_code, o.email, o.phone, o.created_at, o.network_hash
  ),
  period AS (SELECT * FROM public.waitlist_signups WHERE created_at >= p_from AND created_at < p_to),
  -- The cohort: people who joined in the range, and everyone they have brought in since.
  cohort AS (
    SELECT p.referral_code, a.visitor_id,
      (SELECT count(*) FROM public.waitlist_signups i WHERE i.referred_by = p.referral_code AND i.referral_code <> p.referral_code) AS invitees
    FROM period p LEFT JOIN analytics.signup_attribution a ON a.referral_code = p.referral_code
  ),
  -- Visits that arrived on a cohort member's invite link (tracked as invite_visit with the code).
  invite_visits AS (
    SELECT e.props->>'code' AS code, count(DISTINCT e.visitor_id) AS visitors
    FROM analytics.events e
    WHERE e.name = 'invite_visit' AND e.props->>'code' IN (SELECT referral_code FROM cohort)
    GROUP BY 1
  ),
  cohort_events AS (
    SELECT c.referral_code, e.name
    FROM cohort c JOIN analytics.events e ON e.visitor_id = c.visitor_id
    WHERE e.name IN ('referral_open', 'referral_copy', 'referral_share')
  ),
  shares AS (
    SELECT e.occurred_at, e.name, coalesce(e.props->>'channel', CASE WHEN e.name = 'referral_copy' THEN 'copy' ELSE 'native' END) AS channel
    FROM analytics.events e
    WHERE e.name IN ('referral_copy', 'referral_share') AND e.occurred_at >= p_from AND e.occurred_at < p_to
  ),
  k AS (
    SELECT count(*) AS cohort_size,
      coalesce(sum(invitees), 0) AS cohort_invitees,
      count(*) FILTER (WHERE invitees > 0) AS cohort_referrers,
      (SELECT coalesce(sum(visitors), 0) FROM invite_visits) AS cohort_invite_visitors
    FROM cohort
  )
  SELECT jsonb_build_object(
    'signups', (SELECT count(*) FROM period),
    'referred_signups', (SELECT count(*) FROM period WHERE referred_by IS NOT NULL),
    'referred_share', (SELECT CASE WHEN count(*) = 0 THEN 0 ELSE round(count(*) FILTER (WHERE referred_by IS NOT NULL)::numeric / count(*), 4) END FROM period),
    -- Kept for older dashboards: the same value as referred_share.
    'k_factor', (SELECT CASE WHEN count(*) = 0 THEN 0 ELSE round(count(*) FILTER (WHERE referred_by IS NOT NULL)::numeric / count(*), 4) END FROM period),
    'classic_k', (SELECT CASE WHEN cohort_size = 0 THEN 0 ELSE round(cohort_invitees::numeric / cohort_size, 4) END FROM k),
    'invite_visits_per_signup', (SELECT CASE WHEN cohort_size = 0 THEN 0 ELSE round(cohort_invite_visitors::numeric / cohort_size, 4) END FROM k),
    'invite_conversion', (SELECT CASE WHEN cohort_invite_visitors = 0 THEN 0 ELSE round(least(cohort_invitees::numeric / cohort_invite_visitors, 1), 4) END FROM k),
    'referral_rate', (SELECT CASE WHEN cohort_size = 0 THEN 0 ELSE round(cohort_referrers::numeric / cohort_size, 4) END FROM k),
    'invites_per_active_referrer', (SELECT CASE WHEN cohort_referrers = 0 THEN 0 ELSE round(cohort_invitees::numeric / cohort_referrers, 2) END FROM k),
    'active_referrers', (SELECT count(DISTINCT referred_by) FROM period WHERE referred_by IS NOT NULL),
    'priority_unlocked', (SELECT count(*) FROM invites WHERE invites >= 3),
    'loop_funnel', jsonb_build_array(
      jsonb_build_object('key', 'joined', 'label', 'Joined in this range', 'people', (SELECT cohort_size FROM k)),
      jsonb_build_object('key', 'opened', 'label', 'Opened their invite card', 'people', (SELECT count(DISTINCT referral_code) FROM cohort_events WHERE name = 'referral_open')),
      jsonb_build_object('key', 'shared', 'label', 'Shared or copied their link', 'people', (SELECT count(DISTINCT referral_code) FROM cohort_events WHERE name IN ('referral_copy', 'referral_share'))),
      jsonb_build_object('key', 'visited', 'label', 'Link brought a visitor', 'people', (SELECT count(*) FROM invite_visits)),
      jsonb_build_object('key', 'converted', 'label', 'Brought at least one signup', 'people', (SELECT cohort_referrers FROM k)),
      jsonb_build_object('key', 'priority', 'label', 'Unlocked priority (3+)', 'people', (SELECT count(*) FROM cohort WHERE invitees >= 3))
    ),
    'shares_by_channel', (SELECT coalesce(jsonb_agg(x ORDER BY x.shares DESC), '[]'::jsonb) FROM (
      SELECT channel, count(*) AS shares FROM shares GROUP BY 1) x),
    'shares_by_day', (SELECT coalesce(jsonb_agg(x ORDER BY x.day, x.channel), '[]'::jsonb) FROM (
      SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day, channel, count(*) AS shares FROM shares GROUP BY 1, 2) x),
    'distribution', (SELECT jsonb_agg(jsonb_build_object('bucket', b.label, 'people', coalesce(x.n, 0)) ORDER BY b.ord) FROM
      (VALUES ('0', 0), ('1', 1), ('2', 2), ('3+', 3)) AS b(label, ord)
      LEFT JOIN (SELECT least(invites, 3) AS ord, count(*) AS n FROM invites GROUP BY 1) x ON x.ord = b.ord),
    'leaderboard', (SELECT coalesce(jsonb_agg(x ORDER BY x.invites DESC, x.joined_at), '[]'::jsonb) FROM (
      SELECT inv.code, inv.contact_masked, inv.created_at AS joined_at, inv.invites,
        inv.invites_in_range, inv.invites >= 3 AS priority, a.channel, a.country
      FROM invites inv LEFT JOIN analytics.signup_attribution a ON a.referral_code = inv.code
      WHERE inv.invites > 0 ORDER BY inv.invites DESC, inv.created_at LIMIT 25) x),
    'suspicious', (SELECT coalesce(jsonb_agg(x ORDER BY x.shared DESC), '[]'::jsonb) FROM (
      SELECT o.referral_code AS code, analytics.mask_contact(o.email, o.phone) AS contact_masked,
        count(i.referral_code) AS invites,
        count(i.referral_code) FILTER (WHERE i.network_hash IS NOT NULL AND (i.network_hash = o.network_hash
          OR EXISTS (SELECT 1 FROM public.waitlist_signups j WHERE j.referred_by = o.referral_code AND j.referral_code <> i.referral_code AND j.network_hash = i.network_hash))) AS shared
      FROM public.waitlist_signups o JOIN public.waitlist_signups i ON i.referred_by = o.referral_code AND i.referral_code <> o.referral_code
      GROUP BY o.referral_code, o.email, o.phone
      HAVING count(i.referral_code) FILTER (WHERE i.network_hash IS NOT NULL AND (i.network_hash = o.network_hash
          OR EXISTS (SELECT 1 FROM public.waitlist_signups j WHERE j.referred_by = o.referral_code AND j.referral_code <> i.referral_code AND j.network_hash = i.network_hash))) >= 2
      LIMIT 25) x)
  ) INTO v_result;
  RETURN v_result;
END $$;

-- ---------------------------------------------------------------------------
-- Annotations API
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_annotations(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM analytics.require_admin();
  SELECT coalesce(jsonb_agg(x ORDER BY x.starts_on), '[]'::jsonb) INTO v_rows FROM (
    SELECT id, starts_on, ends_on, title, color, created_by, created_at FROM analytics.annotations
    WHERE starts_on < p_to::date + 1 AND coalesce(ends_on, starts_on) >= p_from::date
  ) x;
  RETURN v_rows;
END $$;

CREATE OR REPLACE FUNCTION public.admin_add_annotation(p_starts_on date, p_ends_on date, p_title text, p_color text DEFAULT 'blue')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := analytics.require_admin();
  v_id bigint;
BEGIN
  INSERT INTO analytics.annotations (starts_on, ends_on, title, color, created_by)
  VALUES (p_starts_on, p_ends_on, btrim(p_title), coalesce(p_color, 'blue'), v_actor) RETURNING id INTO v_id;
  PERFORM analytics.audit(v_actor, 'add_annotation', jsonb_build_object('id', v_id, 'title', btrim(p_title)));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_delete_annotation(p_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := analytics.require_admin();
BEGIN
  DELETE FROM analytics.annotations WHERE id = p_id;
  PERFORM analytics.audit(v_actor, 'delete_annotation', jsonb_build_object('id', p_id));
END $$;

-- ---------------------------------------------------------------------------
-- Email signup report: welcome email delivery, unsubscribes, top domains
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_email_report(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM analytics.require_admin();
  SELECT jsonb_build_object(
    'welcome', (SELECT jsonb_build_object(
        'sent', count(*) FILTER (WHERE status = 'sent'),
        'failed', count(*) FILTER (WHERE status = 'failed'),
        'skipped', count(*) FILTER (WHERE status = 'skipped'))
      FROM analytics.email_log WHERE kind = 'welcome' AND created_at >= p_from AND created_at < p_to),
    'recent_failures', (SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
      SELECT created_at, kind, detail FROM analytics.email_log
      WHERE status = 'failed' AND created_at >= p_from AND created_at < p_to ORDER BY created_at DESC LIMIT 20) x),
    'unsubscribed', (SELECT count(*) FROM public.waitlist_signups WHERE unsubscribed_at >= p_from AND unsubscribed_at < p_to),
    'unsubscribed_all_time', (SELECT count(*) FROM public.waitlist_signups WHERE unsubscribed_at IS NOT NULL),
    'domains', (SELECT coalesce(jsonb_agg(x ORDER BY x.signups DESC, x.domain), '[]'::jsonb) FROM (
      SELECT split_part(email, '@', 2) AS domain, count(*) AS signups
      FROM public.waitlist_signups WHERE email IS NOT NULL AND created_at >= p_from AND created_at < p_to
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 200) x)
  ) INTO v_result;
  RETURN v_result;
END $$;

-- ---------------------------------------------------------------------------
-- Settings: validate the new keys
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_update_setting(p_key text, p_value jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := analytics.require_admin();
  v_num numeric;
BEGIN
  IF p_key IN ('waitlist_count_baseline', 'signup_limit_per_hour', 'signup_limit_per_day') THEN
    IF jsonb_typeof(p_value) <> 'number' THEN
      RAISE EXCEPTION '% must be a whole number.', p_key USING ERRCODE = '22023';
    END IF;
    v_num := (p_value #>> '{}')::numeric;
    IF v_num <> trunc(v_num) OR v_num < 0 THEN
      RAISE EXCEPTION '% must be a whole number of 0 or more.', p_key USING ERRCODE = '22023';
    END IF;
    IF p_key <> 'waitlist_count_baseline' AND (v_num < 1 OR v_num > 10000) THEN
      RAISE EXCEPTION 'Signup limits must be between 1 and 10000.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_key IN ('include_internal', 'signups_open', 'block_disposable_email') THEN
    IF jsonb_typeof(p_value) <> 'boolean' THEN
      RAISE EXCEPTION '% must be true or false.', p_key USING ERRCODE = '22023';
    END IF;
  ELSIF p_key = 'signups_closed_message' THEN
    IF jsonb_typeof(p_value) <> 'string' OR length(btrim(p_value #>> '{}')) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'The closed message must be 1 to 200 characters.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_key = 'blocked_email_domains' THEN
    IF jsonb_typeof(p_value) <> 'array' OR jsonb_array_length(p_value) > 500 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_value) d
      WHERE jsonb_typeof(d) <> 'string' OR (d #>> '{}') !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    ) THEN
      RAISE EXCEPTION 'Blocked domains must be up to 500 lowercase domain names, such as example.com.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_key = 'welcome_email' THEN
    IF jsonb_typeof(p_value) <> 'object'
      OR jsonb_typeof(p_value->'enabled') <> 'boolean'
      OR coalesce(jsonb_typeof(p_value->'from_name'), '') <> 'string' OR length(p_value->>'from_name') > 80
      OR coalesce(jsonb_typeof(p_value->'from_email'), '') <> 'string'
      OR (p_value->>'from_email' <> '' AND p_value->>'from_email' !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$')
      OR coalesce(jsonb_typeof(p_value->'reply_to'), '') <> 'string'
      OR (p_value->>'reply_to' <> '' AND p_value->>'reply_to' !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$')
      OR coalesce(jsonb_typeof(p_value->'subject'), '') <> 'string' OR length(btrim(p_value->>'subject')) NOT BETWEEN 1 AND 150
      OR coalesce(jsonb_typeof(p_value->'body'), '') <> 'string' OR length(btrim(p_value->>'body')) NOT BETWEEN 1 AND 5000
      OR coalesce(jsonb_typeof(p_value->'postal_address'), '') <> 'string' OR length(p_value->>'postal_address') > 300
    THEN
      RAISE EXCEPTION 'The welcome email needs enabled, from_name, from_email, reply_to, subject (1-150), body (1-5000) and postal_address (up to 300).' USING ERRCODE = '22023';
    END IF;
    IF (p_value->>'enabled')::boolean AND (p_value->>'from_email' = '' OR btrim(p_value->>'postal_address') = '') THEN
      RAISE EXCEPTION 'Set a from address and a postal address before turning the welcome email on.' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown setting: %', p_key USING ERRCODE = '22023';
  END IF;
  INSERT INTO analytics.settings (key, value, updated_at, updated_by) VALUES (p_key, p_value, now(), v_actor)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  PERFORM analytics.audit(v_actor, 'update_setting', jsonb_build_object('key', p_key, 'value', p_value));
END $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.signup_config(), analytics.log_email(text, text, text, text, text), analytics.unsubscribe(text) FROM PUBLIC;
DO $$
DECLARE
  f regprocedure;
  has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  IF has_anon THEN EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM anon'; END IF;
  IF has_auth THEN EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM authenticated'; END IF;
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE 'admin\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF has_anon THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    IF has_auth THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openswarm_api') THEN
    GRANT EXECUTE ON FUNCTION analytics.signup_config(), analytics.log_email(text, text, text, text, text), analytics.unsubscribe(text) TO openswarm_api;
  END IF;
END $$;

COMMIT;
