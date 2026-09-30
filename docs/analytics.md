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
| `waitlist_start` | Email field first focused | `placement` |
| `waitlist_error` | Client validation failed | `code` (`invalid_email`, `empty`) |
| `waitlist_submit` | Valid email submitted | `placement`, `source`, `invited` |
| `waitlist_success` | API accepted the signup | `placement`, `source`, `added` (false for an existing email), `invited` |
| `waitlist_fail` | API rejected or failed | `placement`, `status` |
| `referral_open` / `referral_copy` / `referral_share` | Invite dialog actions | `just_joined` on open; `channel` (`copy`, `native`) on copy and share |
| `invite_visit` | Page load with a valid `?ref=` | `code` (the inviter's share code), used for the referral loop and K-factor |
| `vital` | Core Web Vitals (LCP, INP, CLS, FCP, TTFB) | `name`, `value`, `rating` |
| `error` | Uncaught error or rejection, at most 5 per page | `message`, `source` |

To track a new button, add `data-track="some-name"` to it. To add an event name, add it to `EVENT_NAMES` in `server/analytics.ts`; unknown names are dropped.

A session is **engaged** (not a bounce) after 10 s of visible time, 2+ page views, 50% scroll, any interaction, or a signup. **Signups** in reports are server-confirmed new email addresses, not client events.

## Channel rules

Applied in order in `classifyTraffic` (`server/analytics.ts`): paid (`utm_medium` cpc/ppc/paid/display… or an ad click id such as `gclid`, `fbclid`, `twclid`) → Email → Invite link (`?ref=` with no UTM) → AI Assistants (chatgpt.com, perplexity.ai, claude.ai, gemini…) → Organic Social → Organic Search → Referral → Other Campaigns → Direct. Tag campaign links with `utm_source`, `utm_medium` and `utm_campaign` so they group correctly.

## One-time setup

1. **Database.** In the Supabase SQL editor, or with `supabase db query --linked -f <file>`, run `sql/001_waitlist.sql` through `sql/007_email_admin.sql` in order. All are safe to re-run. `003` seeds the four admin emails and schedules the retention job. `004` creates the least-privilege `openswarm_api` role the website connects as; give it a generated password with `ALTER ROLE openswarm_api LOGIN PASSWORD '…'` and use that in `DATABASE_URL`. `005` adds the email signup settings, annotations and the extra dashboard functions.
2. **Auth.** In Supabase → Authentication:
   - Disable "Allow new users to sign up". Admin logins are created by the allowlist, not by visitors.
   - Set the Site URL to `https://openswarm.com` and add `https://openswarm.com/admin/` (plus any preview domain's `/admin/`) to the redirect URLs.
   - Create logins for the four admins (Authentication → Users → Add user → "Send magic link", or invite from the dashboard's Settings page once one admin can sign in).
   - For reliable sign-in email delivery, configure custom SMTP (for example the Google Workspace noreply mailbox). Supabase's built-in sender is rate-limited.
3. **Vercel environment variables** (Production and Preview): `DATABASE_URL` (transaction pooler, port 6543, user `openswarm_api.<project-ref>`), `ANALYTICS_SALT`, `SMTP_HOST`, `SMTP_USER` and `SMTP_PASSWORD` (waitlist emails), optionally `RESEND_API_KEY` (backup sender), `CRON_SECRET` (daily email retry), `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optionally `TURNSTILE_SECRET_KEY` + `VITE_TURNSTILE_SITE_KEY`, `VITE_X_SIGNUP_EVENT_ID`, `ALLOWED_ORIGINS`. See `.env.example`.
4. **Deploy** and check that `/api/stats` returns a count, a page view appears under Real-time, and a test signup shows its channel on the Signups page.

## Email signup settings

Admins change these in **Settings → Email signup**; the API reads them at most every 30 seconds.

| Setting | Effect |
| --- | --- |
| Signups open | When off, the form shows the closed message and the API rejects new signups with it. Existing invite links and referral progress keep working. |
| Blocked domains | Rejects addresses at these domains and their subdomains. |
| Block disposable email | Rejects about 9,000 known throwaway-email domains (`disposable-email-domains-js`). |
| Signup limits | New signups allowed per network (hashed IP) per hour and per day. |
| Sender | Name, from address, reply-to and postal address used by every waitlist email. The from address must be the SMTP mailbox or one of its aliases. |
| Welcome email | On/off and subject. Queued with each new signup and sent right after it; the content is the branded template in `server/waitlist-email.ts`. |
| Priority email | On/off and subject. Queued once when a person's third invited friend joins. |

Emails use the queue from [the email flow](waitlist-email-flow.md): a signup and its email job commit together, sending happens right after the response, and failures retry with backoff. Anything left over goes out with the next signup, the daily Vercel Cron run, or **Email → Send pending now**. Test sends and previews on the Settings page use the unsaved form and the admin's own waitlist signup, so links in tests are real.

Unsubscribe links (`/api/waitlist/unsubscribe`) are signed with `WAITLIST_EMAIL_SECRET`, or a secret derived from `ANALYTICS_SALT` when that is unset; changing it invalidates links in emails already sent. Opening a link shows a confirmation button; mail clients' one-click unsubscribe posts directly. Unsubscribing sets `email_opted_out_at`, cancels queued emails and keeps the person's place on the waitlist.

## Page overlay and session replays

**Page overlay** (dashboard): the live landing page, loaded in a frame, with each section's reach and exit rate, scroll-depth lines and click counts drawn on the buttons, plus an exit-section chart built from `admin_page_overlay` (`sql/009_page_overlay.sql`). The tracker and the X pixel do not run inside a frame, so the overlay never counts as a visit.

**Session replays** (`src/lib/replay.ts`): PostHog, configured for replays only. Autocapture, pageviews, heatmaps, surveys and feature flags are off, every form input is masked, and nothing personal is identified (`person_profiles: 'never'`). It loads after the page is idle and never runs locally, in the overlay frame, for internal browsers (`?internal=1`), after the privacy opt-out, or with Global Privacy Control. Each recording carries `openswarm_visitor` and `openswarm_session` properties, so a replay can be matched to a visit in the dashboard. Set `VITE_POSTHOG_KEY` (and `VITE_POSTHOG_HOST` for the EU cloud) in Vercel and redeploy; in PostHog, turn on session replay for the project and set the authorized domain to the site.

## Advertising pixel

`src/lib/x-pixel.ts` loads the X pixel on hosted builds unless the browser sends Global Privacy Control or the visitor opted out on `/privacy/#your-choices`. It reports `.dmg` download clicks and, when `VITE_X_SIGNUP_EVENT_ID` is set, each new waitlist signup as a conversion. Create that conversion event in X Ads Manager first.

## Local development

`npm run dev` serves `/api/collect` and `/api/stats` locally. Collected batches are appended to `.data/analytics.ndjson` (Git-ignored) so you can inspect exactly what would be stored. The dashboard needs a real Supabase project; for UI work without one, run `VITE_ADMIN_MOCK=1 npm run dev` and open `/admin/`.

Tests: `node --experimental-strip-types --test server/*.test.ts`. With `TEST_DATABASE_URL` pointing at a PostgreSQL server where the test may create databases, the suite also applies both migrations to a throwaway database and exercises ingestion, attribution, admin access control and every dashboard function.
