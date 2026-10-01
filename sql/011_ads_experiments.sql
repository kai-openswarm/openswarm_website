-- Paid ads and experiments. Apply after 010_openswarm_name.sql.
--   * Each signup keeps the ad click identifiers it arrived with (fbclid, twclid, ...)
--     so conversions can be matched back to ads, and the experiment variants it saw.
--   * admin_experiments reports visitors and signups per experiment variant.

BEGIN;

ALTER TABLE analytics.signup_attribution
  ADD COLUMN IF NOT EXISTS click_ids jsonb,
  ADD COLUMN IF NOT EXISTS experiments jsonb;

-- Called by the waitlist API inside the signup transaction, after attribute_signup.
-- Only short identifier strings are kept; anything else is dropped.
CREATE OR REPLACE FUNCTION analytics.attribute_signup_ads(p_code text, p_click_ids jsonb, p_experiments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_clicks jsonb;
  v_experiments jsonb;
BEGIN
  SELECT jsonb_object_agg(key, value) INTO v_clicks
  FROM jsonb_each(CASE WHEN jsonb_typeof(p_click_ids) = 'object' THEN p_click_ids ELSE '{}'::jsonb END)
  WHERE key IN ('fbclid', 'fbc', 'fbp', 'twclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'ttclid', 'rdt_cid', 'li_fat_id', 'clicked_at')
    AND jsonb_typeof(value) = 'string' AND length(value #>> '{}') BETWEEN 1 AND 500;

  SELECT jsonb_object_agg(key, value) INTO v_experiments
  FROM jsonb_each(CASE WHEN jsonb_typeof(p_experiments) = 'object' THEN p_experiments ELSE '{}'::jsonb END)
  WHERE key ~ '^[a-z][a-z0-9_]{0,31}$' AND jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ '^[a-z0-9_]{1,32}$';

  UPDATE analytics.signup_attribution SET click_ids = v_clicks, experiments = v_experiments
  WHERE referral_code = p_code;
END $$;

REVOKE ALL ON FUNCTION analytics.attribute_signup_ads(text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics.attribute_signup_ads(text, jsonb, jsonb) TO openswarm_api;

-- Visitors who saw each variant (from 'experiment' events) and the signups they produced.
-- Internal and bot sessions are excluded.
CREATE OR REPLACE FUNCTION public.admin_experiments(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM analytics.require_admin();
  WITH exposure AS (
    SELECT e.props->>'exp' AS exp, e.props->>'variant' AS variant, e.visitor_id,
      min(e.occurred_at) AS first_seen, bool_or(e.props->>'assigned' = 'forced') AS forced
    FROM analytics.events e
    JOIN analytics.sessions s ON s.id = e.session_id
    WHERE e.name = 'experiment' AND e.occurred_at >= p_from AND e.occurred_at < p_to
      AND NOT s.is_internal AND NOT s.is_bot AND e.props ? 'exp' AND e.props ? 'variant'
    GROUP BY 1, 2, 3
  ),
  signups AS (
    SELECT x.key AS exp, x.value #>> '{}' AS variant, count(*) AS signups
    FROM public.waitlist_signups w
    JOIN analytics.signup_attribution a ON a.referral_code = w.referral_code
    LEFT JOIN analytics.sessions s ON s.id = a.session_id
    CROSS JOIN LATERAL jsonb_each(coalesce(a.experiments, '{}'::jsonb)) x
    WHERE w.created_at >= p_from AND w.created_at < p_to AND NOT coalesce(s.is_internal, false)
    GROUP BY 1, 2
  ),
  variants AS (
    SELECT exp, variant, count(*) AS visitors, count(*) FILTER (WHERE forced) AS from_ads, min(first_seen) AS first_seen
    FROM exposure GROUP BY 1, 2
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'exp', coalesce(v.exp, g.exp), 'variant', coalesce(v.variant, g.variant),
      'visitors', coalesce(v.visitors, 0), 'from_ads', coalesce(v.from_ads, 0),
      'signups', coalesce(g.signups, 0), 'first_seen', v.first_seen)
    ORDER BY coalesce(v.exp, g.exp), coalesce(v.variant, g.variant)), '[]'::jsonb)
  INTO v_result
  FROM variants v FULL JOIN signups g ON g.exp = v.exp AND g.variant = v.variant;
  RETURN v_result;
END $$;

DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.admin_experiments(timestamptz, timestamptz) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.admin_experiments(timestamptz, timestamptz) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.admin_experiments(timestamptz, timestamptz) TO authenticated;
  END IF;
END $$;

COMMIT;
