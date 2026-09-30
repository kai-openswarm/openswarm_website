-- Email engagement: opens and clicks measured by the site, and delivery events from Resend
-- webhooks. Apply after 007_email_admin.sql. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS analytics.email_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The queued email this belongs to; NULL for dashboard test sends.
  job_id uuid REFERENCES public.waitlist_email_outbox (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('welcome', 'priority', 'test')),
  type text NOT NULL CHECK (type IN ('open', 'click', 'delivered', 'delivery_delayed', 'bounced', 'complained')),
  -- For clicks: which button or link.
  link text CHECK (link IS NULL OR link ~ '^[a-z_]{1,32}$'),
  source text NOT NULL CHECK (source IN ('site', 'resend')),
  -- Opens and clicks from crawlers, security scanners and prefetchers.
  automated boolean NOT NULL DEFAULT false,
  -- Provider event id for de-duplicating webhook retries.
  provider_event_id text,
  detail text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_events_provider_unique UNIQUE (source, provider_event_id)
);

CREATE INDEX IF NOT EXISTS email_events_time_idx ON analytics.email_events (occurred_at);
CREATE INDEX IF NOT EXISTS email_events_job_idx ON analytics.email_events (job_id);
ALTER TABLE analytics.email_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON analytics.email_events FROM PUBLIC;

-- Records one event. Site events identify the job by id (from a signed token); Resend events
-- identify it by the provider id the queue stored when Resend accepted the message.
CREATE OR REPLACE FUNCTION analytics.record_email_event(p jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_job uuid;
  v_kind text := p->>'kind';
  v_inserted integer;
BEGIN
  IF p ? 'job_id' AND p->>'job_id' IS NOT NULL THEN
    SELECT id, kind INTO v_job, v_kind FROM public.waitlist_email_outbox WHERE id = (p->>'job_id')::uuid;
    IF v_job IS NULL THEN
      RETURN false;
    END IF;
  ELSIF p ? 'provider_id' THEN
    SELECT id, kind INTO v_job, v_kind FROM public.waitlist_email_outbox WHERE provider_id = p->>'provider_id';
    IF v_job IS NULL THEN
      -- Test sends are not queued; they are logged with the same provider id.
      IF NOT EXISTS (SELECT 1 FROM analytics.email_log WHERE kind = 'test' AND provider_id = p->>'provider_id') THEN
        RETURN false;
      END IF;
      v_kind := 'test';
    END IF;
  END IF;
  IF v_kind IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO analytics.email_events (job_id, kind, type, link, source, automated, provider_event_id, detail, occurred_at)
  VALUES (v_job, v_kind, p->>'type', nullif(p->>'link', ''), p->>'source', coalesce((p->>'automated')::boolean, false),
    p->>'provider_event_id', left(p->>'detail', 300), coalesce((p->>'occurred_at')::timestamptz, now()))
  ON CONFLICT (source, provider_event_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted > 0;
END $$;

REVOKE ALL ON FUNCTION analytics.record_email_event(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openswarm_api') THEN
    GRANT EXECUTE ON FUNCTION analytics.record_email_event(jsonb) TO openswarm_api;
  END IF;
END $$;

-- Engagement per email kind for emails queued in the range. Rates use sent emails as the base;
-- opens are approximate because many mail apps block or pre-load images.
CREATE OR REPLACE FUNCTION public.admin_email_engagement(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM analytics.require_admin();
  WITH jobs AS (
    SELECT j.id, j.kind, j.status, j.sent_at, s.email_opted_out_at
    FROM public.waitlist_email_outbox j JOIN public.waitlist_signups s ON s.referral_code = j.referral_code
    WHERE j.created_at >= p_from AND j.created_at < p_to
  ),
  ev AS (SELECT e.* FROM analytics.email_events e JOIN jobs ON jobs.id = e.job_id),
  per_kind AS (
    SELECT k.kind,
      (SELECT count(*) FROM jobs WHERE jobs.kind = k.kind AND status = 'sent') AS sent,
      (SELECT count(DISTINCT job_id) FROM ev WHERE ev.kind = k.kind AND type = 'delivered') AS delivered,
      (SELECT count(DISTINCT job_id) FROM ev WHERE ev.kind = k.kind AND type = 'bounced') AS bounced,
      (SELECT count(DISTINCT job_id) FROM ev WHERE ev.kind = k.kind AND type = 'complained') AS complained,
      (SELECT count(DISTINCT job_id) FROM ev WHERE ev.kind = k.kind AND type = 'open' AND NOT automated) AS opened,
      (SELECT count(DISTINCT job_id) FROM ev WHERE ev.kind = k.kind AND type = 'click' AND NOT automated) AS clicked,
      (SELECT count(*) FROM ev WHERE ev.kind = k.kind AND type = 'click' AND NOT automated) AS clicks,
      (SELECT count(*) FROM ev WHERE ev.kind = k.kind AND type IN ('open', 'click') AND automated) AS automated,
      (SELECT count(*) FROM jobs WHERE jobs.kind = k.kind AND status = 'sent' AND email_opted_out_at > sent_at) AS unsubscribed
    FROM (VALUES ('welcome'), ('priority')) AS k(kind)
  )
  SELECT jsonb_build_object(
    'kinds', (SELECT jsonb_agg(jsonb_build_object(
        'kind', kind, 'sent', sent, 'delivered', delivered, 'bounced', bounced, 'complained', complained,
        'opened', opened, 'clicked', clicked, 'clicks', clicks, 'automated', automated, 'unsubscribed', unsubscribed,
        'open_rate', CASE WHEN sent = 0 THEN 0 ELSE round(opened::numeric / sent, 4) END,
        'click_rate', CASE WHEN sent = 0 THEN 0 ELSE round(clicked::numeric / sent, 4) END,
        'click_to_open', CASE WHEN opened = 0 THEN 0 ELSE round(clicked::numeric / opened, 4) END,
        'unsubscribe_rate', CASE WHEN sent = 0 THEN 0 ELSE round(unsubscribed::numeric / sent, 4) END,
        'bounce_rate', CASE WHEN sent = 0 THEN 0 ELSE round(bounced::numeric / sent, 4) END
      ) ORDER BY kind DESC) FROM per_kind),
    'links', (SELECT coalesce(jsonb_agg(x ORDER BY x.clicks DESC), '[]'::jsonb) FROM (
      SELECT kind, link, count(*) AS clicks, count(DISTINCT job_id) AS people
      FROM ev WHERE type = 'click' AND NOT automated GROUP BY kind, link) x),
    'daily', (SELECT coalesce(jsonb_agg(x ORDER BY x.day), '[]'::jsonb) FROM (
      SELECT d.day,
        (SELECT count(*) FROM jobs WHERE status = 'sent' AND sent_at::date = d.day) AS sent,
        (SELECT count(DISTINCT job_id) FROM ev WHERE type = 'open' AND NOT automated AND occurred_at::date = d.day) AS opened,
        (SELECT count(DISTINCT job_id) FROM ev WHERE type = 'click' AND NOT automated AND occurred_at::date = d.day) AS clicked
      FROM generate_series(p_from::date, (p_to - interval '1 microsecond')::date, interval '1 day') AS d(day)) x),
    'resend_events', (SELECT count(*) FROM ev WHERE source = 'resend'),
    'tests', (SELECT jsonb_build_object(
        'opens', count(*) FILTER (WHERE type = 'open'), 'clicks', count(*) FILTER (WHERE type = 'click'))
      FROM analytics.email_events WHERE kind = 'test' AND occurred_at >= p_from AND occurred_at < p_to)
  ) INTO v_result;
  RETURN v_result;
END $$;

DO $$
DECLARE
  has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  REVOKE ALL ON FUNCTION public.admin_email_engagement(timestamptz, timestamptz) FROM PUBLIC;
  IF has_anon THEN
    REVOKE ALL ON FUNCTION public.admin_email_engagement(timestamptz, timestamptz) FROM anon;
    REVOKE ALL ON analytics.email_events FROM anon;
  END IF;
  IF has_auth THEN
    GRANT EXECUTE ON FUNCTION public.admin_email_engagement(timestamptz, timestamptz) TO authenticated;
    REVOKE ALL ON analytics.email_events FROM authenticated;
  END IF;
END $$;

COMMIT;
