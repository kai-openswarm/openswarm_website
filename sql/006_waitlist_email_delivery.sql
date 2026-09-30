BEGIN;

-- Additive and opt-in: existing signups retain their identifiers and attribution.
-- Applying this migration does not enqueue or send historical signup emails.
ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS email_opted_out_at timestamptz;

CREATE TABLE IF NOT EXISTS waitlist_email_outbox (
  id uuid PRIMARY KEY,
  referral_code text NOT NULL REFERENCES waitlist_signups (referral_code) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('welcome', 'priority')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'cancelled', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  first_attempt_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 8),
  lease_token uuid,
  lease_expires_at timestamptz,
  -- Persist the exact provider request bytes before the first attempt. Retrying
  -- with the same key AND body is essential when a provider response is lost.
  payload text,
  payload_hash text CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  provider_id text,
  sent_at timestamptz,
  failure_code text,
  CONSTRAINT waitlist_email_event_unique UNIQUE (kind, referral_code),
  CONSTRAINT waitlist_email_payload_pair CHECK ((payload IS NULL) = (payload_hash IS NULL)),
  CONSTRAINT waitlist_email_lease_state CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS waitlist_email_ready_idx
  ON waitlist_email_outbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION waitlist_email_preserve_payload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.kind IS DISTINCT FROM NEW.kind
    OR OLD.referral_code IS DISTINCT FROM NEW.referral_code
    OR (OLD.payload IS NOT NULL AND (OLD.payload IS DISTINCT FROM NEW.payload OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash)) THEN
    RAISE EXCEPTION 'An email event and its persisted payload are immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS waitlist_email_immutable_payload ON waitlist_email_outbox;
CREATE TRIGGER waitlist_email_immutable_payload BEFORE UPDATE ON waitlist_email_outbox
  FOR EACH ROW EXECUTE FUNCTION waitlist_email_preserve_payload();

-- Email addresses and rendered bodies are private server-side data.
ALTER TABLE waitlist_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON waitlist_email_outbox FROM PUBLIC;

COMMIT;
