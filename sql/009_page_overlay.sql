-- Page overlay and exit sections for the dashboard: where on the landing page visitors
-- stop, how far they scroll, and what they click. Apply after 008_email_analytics.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_page_overlay(p_from timestamptz, p_to timestamptz, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM analytics.require_admin();
  WITH s AS (SELECT id, max_scroll, converted, active_ms FROM analytics.filtered_sessions(p_from, p_to, p_filters)),
  total AS (SELECT greatest(count(*), 1) AS n, count(*) AS sessions FROM s),
  sections(name, ord) AS (VALUES ('top', 1), ('intro', 2), ('capabilities', 3), ('use-cases', 4), ('marketplace', 5), ('closing', 6)),
  e AS (
    SELECT e.session_id, e.name, e.props FROM analytics.events e
    WHERE e.occurred_at >= p_from AND e.occurred_at < p_to + interval '1 day'
      AND e.session_id IN (SELECT id FROM s)
      AND e.name IN ('section_view', 'click', 'outbound')
  ),
  -- The deepest section each session reached; visits that never reported a section stopped at the top.
  deepest AS (
    SELECT s.id, s.converted, coalesce(max(sec.ord), 1) AS ord
    FROM s
    LEFT JOIN e ON e.session_id = s.id AND e.name = 'section_view'
    LEFT JOIN sections sec ON sec.name = e.props->>'section'
    GROUP BY s.id, s.converted
  )
  SELECT jsonb_build_object(
    'sessions', (SELECT sessions FROM total),
    'sections', (SELECT jsonb_agg(x ORDER BY x.ord) FROM (
      SELECT sec.name AS section, sec.ord,
        (SELECT count(*) FROM deepest d WHERE d.ord >= sec.ord) AS reached,
        round((SELECT count(*) FROM deepest d WHERE d.ord >= sec.ord)::numeric / (SELECT n FROM total), 4) AS reach_rate,
        (SELECT count(*) FROM deepest d WHERE d.ord = sec.ord) AS exited,
        (SELECT count(*) FROM deepest d WHERE d.ord = sec.ord AND NOT d.converted) AS exited_without_signup,
        round((SELECT count(*) FROM deepest d WHERE d.ord = sec.ord)::numeric
          / greatest((SELECT count(*) FROM deepest d WHERE d.ord >= sec.ord), 1), 4) AS exit_rate
      FROM sections sec) x),
    'scroll', (SELECT jsonb_agg(x ORDER BY x.depth) FROM (
      SELECT d.depth, count(s.id) AS sessions, round(count(s.id)::numeric / (SELECT n FROM total), 4) AS rate
      FROM (VALUES (25), (50), (75), (90), (100)) AS d(depth)
      LEFT JOIN s ON s.max_scroll >= d.depth
      GROUP BY d.depth) x),
    'clicks', (SELECT coalesce(jsonb_agg(x ORDER BY x.clicks DESC), '[]'::jsonb) FROM (
      SELECT props->>'target' AS target, count(*) AS clicks, count(DISTINCT session_id) AS sessions
      FROM e WHERE name = 'click' AND props ? 'target' GROUP BY 1 ORDER BY 2 DESC LIMIT 100) x),
    'outbound', (SELECT coalesce(jsonb_agg(x ORDER BY x.clicks DESC), '[]'::jsonb) FROM (
      SELECT props->>'href' AS href, count(*) AS clicks, count(DISTINCT session_id) AS sessions
      FROM e WHERE name = 'outbound' GROUP BY 1 ORDER BY 2 DESC LIMIT 100) x)
  ) INTO v_result;
  RETURN v_result;
END $$;

DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.admin_page_overlay(timestamptz, timestamptz, jsonb) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.admin_page_overlay(timestamptz, timestamptz, jsonb) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.admin_page_overlay(timestamptz, timestamptz, jsonb) TO authenticated;
  END IF;
END $$;

COMMIT;
