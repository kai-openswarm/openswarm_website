-- The product is called OpenSwarm (the company stays Open Swarm Inc.). Renames the
-- stored waitlist email sender and subjects, leaving any custom wording untouched.
-- Apply after 009_page_overlay.sql.

BEGIN;

UPDATE analytics.settings
SET value = value
  || CASE WHEN value->>'from_name' = 'Open Swarm' THEN '{"from_name": "OpenSwarm"}'::jsonb ELSE '{}'::jsonb END
  || CASE WHEN value ? 'subject' THEN jsonb_build_object('subject', replace(value->>'subject', 'Open Swarm', 'OpenSwarm')) ELSE '{}'::jsonb END
  || CASE WHEN value ? 'body' THEN jsonb_build_object('body', replace(value->>'body', 'Open Swarm', 'OpenSwarm')) ELSE '{}'::jsonb END
WHERE key IN ('welcome_email', 'priority_email');

COMMIT;
