-- Apply after 001_waitlist.sql, before deploying the email signup API.
-- Existing phone signups and every referral code/attribution stay in the same table.
-- This migration does not infer an email address or merge identities across channels.
BEGIN;

ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS email text;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'waitlist_signups'::regclass AND conname = 'waitlist_email_unique'
  ) THEN
    -- Referral codes already uniquely identify all records. Retain phone uniqueness
    -- while allowing new rows to carry an email instead of a phone number.
    ALTER TABLE waitlist_signups ADD CONSTRAINT waitlist_phone_unique UNIQUE (phone);
    ALTER TABLE waitlist_signups DROP CONSTRAINT waitlist_signups_pkey;
    ALTER TABLE waitlist_signups ALTER COLUMN phone DROP NOT NULL;
    ALTER TABLE waitlist_signups ADD CONSTRAINT waitlist_signups_pkey PRIMARY KEY (referral_code);
    ALTER TABLE waitlist_signups ADD CONSTRAINT waitlist_contact_present
      CHECK ((email IS NOT NULL) <> (phone IS NOT NULL));
    ALTER TABLE waitlist_signups ADD CONSTRAINT waitlist_email_canonical CHECK (
      email IS NULL OR (
        email = lower(btrim(email)) AND length(email) <= 254
        AND length(split_part(email, '@', 1)) BETWEEN 1 AND 64
        AND length(split_part(email, '@', 2)) BETWEEN 1 AND 253
        AND length(email) - length(replace(email, '@', '')) = 1
        AND email !~ '[[:space:][:cntrl:]]'
        AND split_part(email, '@', 1) ~ $local$^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$$local$
        AND split_part(email, '@', 2) ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
        AND split_part(email, '@', 2) ~ '\.([a-z]{2,63}|xn--[a-z0-9-]+)$'
      )
    );
    ALTER TABLE waitlist_signups ADD CONSTRAINT waitlist_email_unique UNIQUE (email);
  END IF;
END;
$migration$;

-- 001's referral FK, code uniqueness, no-self-referral check and RLS remain intact.
ALTER TABLE waitlist_signups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON waitlist_signups FROM PUBLIC;

COMMIT;
