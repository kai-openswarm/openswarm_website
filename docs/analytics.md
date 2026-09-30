# Analytics and admin dashboard

The site records its own first-party analytics in Supabase Postgres and shows them in a private dashboard at `/admin/`. It covers traffic, sources and campaigns, audience, on-page behavior, the signup funnel, referrals, performance and errors. Nothing from these analytics is sent to advertisers. The X pixel is separate; see [Advertising pixel](#advertising-pixel).

## How it works

```
Browser tracker (src/lib/analytics.ts)
  └─ batches events every 5 s and on tab hide ──▶ POST /api/collect (api/collect.ts)
                                                   ├─ origin check, 240 batches/min per network, bot filter
                                                   ├─ adds: channel + source (server/analytics.ts), country/region/city
                                                   │        (Vercel headers), browser/OS/device (bowser)
                                                   └─ SELECT analytics.ingest(batch)  (one round trip)
POST /api/waitlist ── same transaction: analytics.attribute_signup() copies the visit that produced the signup
GET  /api/stats    ── public waitlist count = admin baseline + real signups (CDN-cached 5 min)
/admin/            ── Supabase Auth magic link ──▶ public.admin_* RPC functions (admin allowlist enforced in SQL)
```

- **Storage:** tables live in the private `analytics` schema (`visitors`, `sessions`, `events`, `signup_attribution`, `settings`, `admin_users`, `admin_audit_log`, `rate_limits`). Supabase's API does not expose that schema, and every table has RLS enabled and all API-role privileges revoked.
- **Identity:** a random visitor id is kept in `localStorage`. A session is shared across tabs and ends after 30 minutes of inactivity. IP addresses are never stored. Rate limits and referral-fraud checks use a keyed HMAC of the IP (`ANALYTICS_SALT`).
- **Privacy of form input:** the tracker records form steps, never what was typed. Query strings are stripped from paths. Referrers keep only origin and path.
- **Retention:** `analytics.prune()` runs daily via `pg_cron` and deletes events and sessions older than 13 months. Signups and their attribution are kept until deleted from the dashboard.
- **Internal traffic:** open the site once with `?internal=1` to mark that browser as the team's (`?internal=0` undoes it). Internal and bot sessions are excluded from reports unless "Include internal traffic" is on in Settings.

## Event dictionary

| Event | Sent when | Properties |
| --- | --- | --- |
| `pageview` | Page load | none |
| `engagement` | Tab hidden, page unload, or every 15 s of visible time | `ms` visible time since the last report |
| `scroll` | First time reaching 25/50/75/90/100% | `depth` |
| `section_view` | A `[data-section]` crosses the middle of the screen | `section`: `top`, `intro`, `capabilities`, `use-cases`, `marketplace`, `closing` |
| `click` | Click on any `[data-track]` element or in-page anchor | `target` (e.g. `waitlist-link:nav`, `anchor:marketplace`), `label` |
| `outbound` | Click on a link to another site | `href` (host + path), `label` |
| `tab` | Use-case tab change | `group`, `tab` |
| `waitlist_view` | Signup form half visible | `placement` |
| `waitlist_start` | Phone field first focused | `placement` |
| `waitlist_country` | Country changed | `country` |
| `waitlist_error` | Client validation failed | `code` (`invalid_phone`, `empty`), `country` |
| `waitlist_submit` | Valid number submitted | `placement`, `source`, `country`, `invited` |
| `waitlist_success` | API accepted the signup | `placement`, `source`, `added` (false for an existing number), `invited` |
| `waitlist_fail` | API rejected or failed | `placement`, `status` |
| `referral_open` / `referral_copy` / `referral_share` | Invite dialog actions | `just_joined` on open |
| `vital` | Core Web Vitals (LCP, INP, CLS, FCP, TTFB) | `name`, `value`, `rating` |
| `error` | Uncaught error or rejection, at most 5 per page | `message`, `source` |

To track a new button, add `data-track="some-name"` to it. To add an event name, add it to `EVENT_NAMES` in `server/analytics.ts`; unknown names are dropped.

A session is **engaged** (not a bounce) after 10 s of visible time, 2+ page views, 50% scroll, any interaction, or a signup. **Signups** in reports are server-confirmed new numbers, not client events.

## Channel rules

Applied in order in `classifyTraffic` (`server/analytics.ts`): paid (`utm_medium` cpc/ppc/paid/display… or an ad click id such as `gclid`, `fbclid`, `twclid`) → Email → Invite link (`?ref=` with no UTM) → AI Assistants (chatgpt.com, perplexity.ai, claude.ai, gemini…) → Organic Social → Organic Search → Referral → Other Campaigns → Direct. Tag campaign links with `utm_source`, `utm_medium` and `utm_campaign` so they group correctly.

## One-time setup

1. **Database.** In the Supabase SQL editor (or `psql` with the direct connection string), run `sql/001_waitlist.sql` and then `sql/002_analytics.sql`. Both are safe to re-run. The second one seeds the four admin emails and schedules the retention job.
2. **Auth.** In Supabase → Authentication:
   - Disable "Allow new users to sign up". Admin logins are created by the allowlist, not by visitors.
   - Set the Site URL to `https://openswarm.com` and add `https://openswarm.com/admin/` (plus any preview domain's `/admin/`) to the redirect URLs.
   - Create logins for the four admins (Authentication → Users → Add user → "Send magic link", or invite from the dashboard's Settings page once one admin can sign in).
   - For reliable sign-in email delivery, configure custom SMTP (for example Resend). Supabase's built-in sender is rate-limited.
3. **Vercel environment variables** (Production and Preview): `DATABASE_URL` (transaction pooler, port 6543), `ANALYTICS_SALT`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optionally `TURNSTILE_SECRET_KEY` + `VITE_TURNSTILE_SITE_KEY`, `VITE_X_SIGNUP_EVENT_ID`, `ALLOWED_ORIGINS`. See `.env.example`.
4. **Deploy** and check that `/api/stats` returns a count, a page view appears under Real-time, and a test signup shows its channel on the Signups page.

## Advertising pixel

`src/lib/x-pixel.ts` loads the X pixel on hosted builds unless the browser sends Global Privacy Control or the visitor opted out on `/privacy/#your-choices`. It reports `.dmg` download clicks and, when `VITE_X_SIGNUP_EVENT_ID` is set, each new waitlist signup as a conversion. Create that conversion event in X Ads Manager first.

## Local development

`npm run dev` serves `/api/collect` and `/api/stats` locally. Collected batches are appended to `.data/analytics.ndjson` (Git-ignored) so you can inspect exactly what would be stored. The dashboard needs a real Supabase project; for UI work without one, run `VITE_ADMIN_MOCK=1 npm run dev` and open `/admin/`.

Tests: `node --experimental-strip-types --test server/*.test.ts`. With `TEST_DATABASE_URL` pointing at a PostgreSQL server where the test may create databases, the suite also applies both migrations to a throwaway database and exercises ingestion, attribution, admin access control and every dashboard function.
