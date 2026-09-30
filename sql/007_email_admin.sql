-- Connects the waitlist email queue (006) to the admin dashboard: the priority email
-- setting, one unsubscribe path, queue-based reporting, and the API role's access.
-- Apply after 006_waitlist_email_delivery.sql. Safe to re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- Priority email setting (sent when a person's third friend joins)
-- ---------------------------------------------------------------------------

INSERT INTO analytics.settings (key, value) VALUES
  ('priority_email', jsonb_build_object('enabled', false, 'subject', 'You’ve unlocked priority early access'))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION analytics.signup_config()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM analytics.settings
  WHERE key IN ('signups_open', 'signups_closed_message', 'blocked_email_domains', 'block_disposable_email',
    'signup_limit_per_hour', 'signup_limit_per_day', 'welcome_email', 'priority_email')
$$;

-- ---------------------------------------------------------------------------
-- One unsubscribe: record the opt-out and cancel any queued waitlist email.
-- ---------------------------------------------------------------------------

UPDATE public.waitlist_signups SET email_opted_out_at = unsubscribed_at
WHERE unsubscribed_at IS NOT NULL AND email_opted_out_at IS NULL;

CREATE OR REPLACE FUNCTION analytics.unsubscribe(p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.waitlist_signups
  SET email_opted_out_at = coalesce(email_opted_out_at, clock_timestamp()),
      unsubscribed_at = coalesce(unsubscribed_at, clock_timestamp())
  WHERE referral_code = p_code;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE public.waitlist_email_outbox
  SET status = 'cancelled', failure_code = 'unsubscribed', lease_token = NULL, lease_expires_at = NULL
  WHERE referral_code = p_code AND status IN ('pending', 'processing');
  RETURN true;
END $$;

-- ---------------------------------------------------------------------------
-- Settings: validate the priority email and the shared sender
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_update_setting(p_key text, p_value jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := analytics.require_admin();
  v_num numeric;
  v_sender jsonb := (SELECT value FROM analytics.settings WHERE key = 'welcome_email');
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
      OR coalesce(jsonb_typeof(p_value->'body'), 'string') <> 'string' OR length(coalesce(p_value->>'body', '')) > 5000
      OR coalesce(jsonb_typeof(p_value->'postal_address'), '') <> 'string' OR length(p_value->>'postal_address') > 300
    THEN
      RAISE EXCEPTION 'The welcome email needs enabled, from_name, from_email, reply_to, subject (1-150) and postal_address (up to 300).' USING ERRCODE = '22023';
    END IF;
    IF (p_value->>'enabled')::boolean AND (p_value->>'from_email' = '' OR btrim(p_value->>'postal_address') = '') THEN
      RAISE EXCEPTION 'Set a from address and a postal address before turning the welcome email on.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_key = 'priority_email' THEN
    IF jsonb_typeof(p_value) <> 'object'
      OR jsonb_typeof(p_value->'enabled') <> 'boolean'
      OR coalesce(jsonb_typeof(p_value->'subject'), '') <> 'string' OR length(btrim(p_value->>'subject')) NOT BETWEEN 1 AND 150
    THEN
      RAISE EXCEPTION 'The priority email needs enabled and a subject of 1 to 150 characters.' USING ERRCODE = '22023';
    END IF;
    IF (p_value->>'enabled')::boolean AND (coalesce(v_sender->>'from_email', '') = '' OR btrim(coalesce(v_sender->>'postal_address', '')) = '') THEN
      RAISE EXCEPTION 'Set the sender and postal address in the welcome email first.' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown setting: %', p_key USING ERRCODE = '22023';
  END IF;
  INSERT INTO analytics.settings (key, value, updated_at, updated_by) VALUES (p_key, p_value, now(), v_actor)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  PERFORM analytics.audit(v_actor, 'update_setting', jsonb_build_object('key', p_key, 'value', p_value));
END $$;

-- ---------------------------------------------------------------------------
-- Email report from the queue (source of truth for welcome and priority emails)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_email_report(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM analytics.require_admin();
  WITH jobs AS (SELECT * FROM public.waitlist_email_outbox WHERE created_at >= p_from AND created_at < p_to),
  counts AS (
    SELECT kind,
      count(*) FILTER (WHERE status = 'sent') AS sent,
      count(*) FILTER (WHERE status = 'failed') AS failed,
      count(*) FILTER (WHERE status IN ('pending', 'processing')) AS pending,
      count(*) FILTER (WHERE status = 'cancelled') AS cancelled
    FROM jobs GROUP BY kind
  )
  SELECT jsonb_build_object(
    'welcome', (SELECT jsonb_build_object('sent', coalesce(sum(sent), 0), 'failed', coalesce(sum(failed), 0),
        'pending', coalesce(sum(pending), 0), 'cancelled', coalesce(sum(cancelled), 0), 'skipped', 0)
      FROM counts WHERE kind = 'welcome'),
    'priority', (SELECT jsonb_build_object('sent', coalesce(sum(sent), 0), 'failed', coalesce(sum(failed), 0),
        'pending', coalesce(sum(pending), 0), 'cancelled', coalesce(sum(cancelled), 0))
      FROM counts WHERE kind = 'priority'),
    'pending_all_time', (SELECT count(*) FROM public.waitlist_email_outbox WHERE status IN ('pending', 'processing')),
    'oldest_pending_at', (SELECT min(created_at) FROM public.waitlist_email_outbox WHERE status IN ('pending', 'processing')),
    'tests', (SELECT jsonb_build_object('sent', count(*) FILTER (WHERE status = 'sent'), 'failed', count(*) FILTER (WHERE status = 'failed'))
      FROM analytics.email_log WHERE kind = 'test' AND created_at >= p_from AND created_at < p_to),
    'recent_failures', (SELECT coalesce(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
      SELECT coalesce(sent_at, next_attempt_at, created_at) AS created_at, kind, failure_code AS detail FROM jobs
      WHERE status = 'failed' OR (status = 'pending' AND attempt_count > 0)
      UNION ALL
      SELECT created_at, 'test', detail FROM analytics.email_log
      WHERE kind = 'test' AND status = 'failed' AND created_at >= p_from AND created_at < p_to
      ORDER BY 1 DESC LIMIT 20) x),
    'unsubscribed', (SELECT count(*) FROM public.waitlist_signups WHERE email_opted_out_at >= p_from AND email_opted_out_at < p_to),
    'unsubscribed_all_time', (SELECT count(*) FROM public.waitlist_signups WHERE email_opted_out_at IS NOT NULL),
    'domains', (SELECT coalesce(jsonb_agg(x ORDER BY x.signups DESC, x.domain), '[]'::jsonb) FROM (
      SELECT split_part(email, '@', 2) AS domain, count(*) AS signups
      FROM public.waitlist_signups WHERE email IS NOT NULL AND created_at >= p_from AND created_at < p_to
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 200) x)
  ) INTO v_result;
  RETURN v_result;
END $$;

-- ---------------------------------------------------------------------------
-- API role: the queue lives beside the signups it references
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openswarm_api') THEN
    GRANT SELECT, INSERT, UPDATE ON public.waitlist_email_outbox TO openswarm_api;
    -- The priority email locks the inviter row; the queue records opt-outs. Only this column is writable.
    GRANT UPDATE (email_opted_out_at) ON public.waitlist_signups TO openswarm_api;
    DROP POLICY IF EXISTS waitlist_api_update ON public.waitlist_signups;
    CREATE POLICY waitlist_api_update ON public.waitlist_signups FOR UPDATE TO openswarm_api USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS outbox_api ON public.waitlist_email_outbox;
    CREATE POLICY outbox_api ON public.waitlist_email_outbox FOR ALL TO openswarm_api USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.waitlist_email_outbox FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.waitlist_email_outbox FROM authenticated';
  END IF;
END $$;

COMMIT;
