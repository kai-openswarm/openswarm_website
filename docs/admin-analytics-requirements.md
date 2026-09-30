# Admin analytics: competitive review and requirements

Last updated 2026-09-30.

**Scope.** This review looks at what `/admin` should do, based on nine groups of analytics products:

- Wix Analytics
- HubSpot
- Google Analytics 4
- Plausible, Fathom, Umami, Simple Analytics and Pirsch
- Vercel and Cloudflare Web Analytics
- PostHog, Mixpanel and Amplitude
- Squarespace, Webflow Analyze, Framer, Shopify and Unbounce
- Waitlist and referral tools (Waitlist, Viral Loops, ReferralHero, GrowSurf, SparkLoop, Prefinery, LaunchList, KickoffLabs)
- Twilio's messaging and phone reporting

**Method.** Everything comes from public help centers, developer docs, marketing pages and public demo dashboards. The Plausible, Umami, Simple Analytics and Pirsch demos were viewed read-only. We created no accounts and logged into nothing. Items marked *(unverified)* rest on secondary sources or search snippets.

**Status legend** for our implementation, audited against `sql/003_analytics.sql`–`sql/005_admin_features.sql`, `src/lib/analytics.ts` and `src/admin/**` (statuses updated 2026-09-30 after the P0 pass):
- ✅ built
- 🟡 partial
- ❌ missing

Priority:
- **P0**: needed for launch
- **P1**: the next iteration
- **P2**: later
- **—**: out of scope

---

## 1. Executive summary

- **We already match or beat most of these tools on fundamentals.** We have:
  - a first-party visitor id, which works across days, unlike the daily-salt hashes in Plausible, Fathom, Pirsch and Vercel
  - live data, where Wix lags about 1 hour, Squarespace about 3 hours and GA4 24–48 hours
  - no sampling, unlike GA4 and Cloudflare
  - an AI Assistants channel
  - section reach and scroll depth
  - a signup funnel
  - Web Vitals
  - a referral leaderboard
  - audited PII access
  - filters encoded in the URL
- **Where the whole market beats us today:**
  1. The comparison and interaction layer: overlaying the previous period or previous year, clickable KPI tiles that drive the chart, and filter operators beyond "is".
  2. Alerts, digests and annotations.
  3. A per-visitor timeline and activity log.
  4. A time-of-day heatmap.
  5. Referral-loop depth: share channel, share → click → signup, classic K, cycle time, and the referral tree.
  6. Fraud review workflow: risk tiers and approve/reject.
  7. Phone intelligence: line type, VoIP, and country-code vs IP mismatch.
- **Where nobody else goes, so we could differentiate:**
  - referral chain depth and generations
  - leaderboard rank movement
  - a signup goal line with a projected ETA
  - a quality-adjusted referral rate
  - funnels that backfill from raw events (Plausible's do not)
- **Things to deliberately not copy:**
  - Wix's and HubSpot's pageview-based bounce rate, which would read about 100% on a one-page site
  - GA4's jargon and its "(other)" and "(not set)" buckets
  - Unbounce's destructive stats reset
  - Squarespace's lack of export
  - HubSpot's retroactive re-categorisation of history

---

## 2. What each product does best

| Product | Worth copying | Avoid |
|---|---|---|
| **Wix** | Highlights page with a real-time widget and customizable key-stat cards. Real-time page: map, active pages, a 24h list of recent visitors with a per-session "Session info" timeline, and a live activity feed. A time-of-day heatmap report. A 4-step "Top navigation flows" graph. A Site Speed page: CrUX-style Good/Fair/Poor with a desktop/mobile toggle, a 30-day trend and a per-page view. "Insights" split into Attention required, Opportunities and Trends. Threshold alerts. Scheduled CSV emails. A "Bot traffic over time" report. | Bounce rate measured as one page viewed. No custom funnels. Private, unshareable saved views. Row caps of 1,500 on screen and 5,000 on export. |
| **HubSpot** | Ordered source rules where the first match wins (15 rules, including **AI Referrals**). Two drill-down levels per source (e.g. Referrals → domain → URL; AI → platform → campaign). Original and Latest source stored on each contact, with first page seen, sessions and first/last seen. Form funnel: page visit → form visible → interacted → submitted. Attribution models (first, last, linear, U-shaped, and so on). Goal lines on charts. Dashboard quick filters. Scheduled delivery to email, Slack or Google Chat. IP/CIDR and spam-referrer exclusion. A bot toggle. | The session-to-contact rate is defined confusingly. Past sessions get re-categorised when a contact's source changes. The best features are paywalled at Enterprise. |
| **GA4** | Clear definitions. An engaged session is one that lasts at least 10s, has a key event, or has 2 or more pageviews. Bounce rate is 1 − engagement rate. Scopes are kept apart: *first-user* source (fixed) versus *session* source. Comparisons: up to 4 colour-coded segments, OR within a condition and AND across conditions. Date compare against the previous period or year. Custom insights with a condition ("% change >", "has anomaly") and a frequency. Annotations with a date range and a colour. Realtime pages. A user snapshot. Cohort heatmap with day 1, 7 and 30 lines. Funnel exploration: open or closed funnels, elapsed time, and a trended view. Path exploration. | Jargon. Two sets of numbers (Reports vs Explore). Data thresholds and "(other)". Filters that apply only going forward. 24–48h lag. |
| **Plausible** | The reference layout: 6 clickable KPI tiles. Delta colour follows meaning, so rising bounce is red. The selected tile drives the chart. A 2-column panel grid, each panel with tabs (Channels/Sources/Campaigns, Top/Entry/Exit pages, Map/Countries/Regions/Cities, Browser/OS/Device). Click a row to filter. Filter operators: is, is not, contains, does not contain. Saved segments, personal or shared with the site. **Keyboard shortcuts** for date ranges (D, W, T, M, A…), X to compare, ←/→ to move the period, Esc to clear. Compare modes: previous, year-over-year, custom, and **match day of week**. Funnel display: "% of step 1 · count · →step% ↓drop%". Spike and drop alerts. Shared links, optionally password-protected, optionally limited to a segment. Per-report CSV that respects filters. | Funnels don't backfill. Slack only via email. Daily-salt unique visitors. |
| **Fathom** | Toggle several metrics on the chart at once. Drag to zoom. Secondary dimensions (e.g. pages × device). Clicking an "is" filter chip flips it to "is not". CSV per box. Comparison tooltips that show both periods' values. | No funnels and no event properties. |
| **Umami** | Six filter operators including regex, plus a **Match all / Match any** toggle. Funnels with a **time window in minutes** between steps. Journeys. Retention. Chart annotations. Custom "Boards". | Features spread across many sidebar pages. A slow demo. |
| **Pirsch** | **Weekday × hour heatmap**. Spike and **no-traffic** alerts plus webhooks. A built-in UTM link builder and shortener. Funnels measured against the previous step. | A dense grid. Its bounce denominator differs from everyone else's. |
| **Simple Analytics / Vercel / Cloudflare** | Simple Analytics: trend-line toggle, an AI question tab, embeddable live charts. Vercel: environment switch (prod/preview), a t.co resolver. Cloudflare: Core Web Vitals as a first-class view. | Visitor counting based only on the referrer (SA, CF). Cloudflare samples at about 10%. |
| **PostHog** | Web-analytics tiles, a **conversion-goal selector** that adds conversion columns to every table, an active-hours heatmap, a retention tile, and Web Vitals at p75/p90/p99 with a per-path table. Channel rules include **AI** by `utm_source` and referrer. Bots are split into Bot, AI Agent and Automation. Funnels offer sequential, strict or any-order steps, overall or relative %, **time-to-convert histogram**, historical conversion trend, exclusion steps, and a drop-off person list. Lifecycle chart: new, returning, resurrecting, dormant. Paths. Person timeline. **Alerts**: absolute or relative % thresholds, quiet hours, simulate before saving, Slack/webhook. Annotations. Subscriptions. An experiment results table. | Too broad to copy wholesale. |
| **Mixpanel / Amplitude** | Funnel conversion window, hold property constant, exclusion steps, counting by uniques, totals or sessions, time-to-convert stats. Amplitude's anomaly and forecast band: a shaded 95% confidence interval with anomalies marked. Journeys/Sankey. An activity feed on each user profile. | Enterprise gating. |
| **Squarespace** | A "Form & button conversions" table: unique views, conversions and conversion rate per element and placement. **Activity log**: the last 7 days of visits with time, location, referrer and page path, filterable. **Anomaly alerts** against the previous 28 days' 99% range, **annotated on the chart with the cause** (the top pages and channels behind a spike). | No export. A 3-hour lag. Sessions split at midnight. |
| **Webflow Analyze** | **Scroll depth and "average fold" lines drawn on the real page.** Click counts shown on each element (a clickmap). No-code goals. A dedicated AI referral source paired with goal reporting. | A paid add-on. Limited custom events. |
| **Framer** | Live visitors over the last 5 minutes. Funnels built from page views, tracked clicks and form submits. A/B tests with a custom traffic split and "probability to win". | Visitor ids reset daily. Only the top 20 pages. |
| **Shopify** | **Live View**: a globe or map, visitors right now, a 10-minute micro-funnel, and **"streamer mode"**, which hides numbers during screen shares. Dashboard cards you can rearrange and group into sections. **Metric targets**. Bots excluded by default. Sessions no longer split at midnight. A source hierarchy of channel → platform → medium → type. | Definitions changed partway through the data history. |
| **Unbounce** | Separates *conversions*, counted once per visitor, from *leads*, counted on every submit. Champion vs challenger variants with weighted splits and a chi-square confidence. | "Reset stats" permanently deletes history. |
| **Waitlist/referral tools** | Waitlist: "last successful signup/referral" heartbeat. Viral Loops: a Slack post for each signup naming the referrer, and a weekly round-up. GrowSurf: **classic K = invites per user × invite conversion**, referral rate, blocking of data-center IPs and countries. ReferralHero: **shares over time by channel** (WhatsApp, X, email, copy), risk tiers, and a High-risk list with an Approve button. SparkLoop: referral status Pending → Confirmed / Rejected, a **Referral Confirmation Rate**, and rewards held until referrals are confirmed. Prefinery: caps on signups and referrals per IP, and **invite the top N by position or segment**. KickoffLabs: share → view → signup. | None of these tools document chain depth or rank movement. |
| **Twilio (phone layer)** | Lookup line type (mobile, landline, fixed or non-fixed VoIP, toll-free) and carrier. SMS pumping risk score. Messaging Insights: delivery rate by carrier and country, opt-out rate, and error codes. | — |

---

## 3. Metric definitions (the source of truth for our tooltips)

Every tool defines these differently, so the dashboard must show its own definition next to every metric. Status is ✅ for every metric unless noted.

| Metric | Our definition | How others differ |
|---|---|---|
| Visitor | First-party uuid, stable across days | Plausible, Fathom, Pirsch and Vercel use a daily-salt hash, so the same person counts once per day. Umami rotates its salt monthly. Simple Analytics and Cloudflare count by referrer, so their "visitors" are really visits. Wix and GA4 identify by browser or device. |
| Session | Ends after 30 min of inactivity (`SESSION_TIMEOUT_MS`), with no midnight split | This matches everyone. HubSpot and Squarespace also split at midnight; Shopify stopped doing that in Sep 2026. |
| Engaged session | ≥10s active, **or** ≥50% scroll, **or** ≥2 pageviews, **or** an interaction, **or** a conversion | GA4 uses ≥10s, a key event, or ≥2 views. We add scroll, because this is a one-page site. |
| Bounce rate | 1 − engaged ÷ sessions | GA4 is the same. Wix, HubSpot, Squarespace and Fathom use "one page viewed", which reads close to 100% on a one-page site. PostHog uses one page, no interaction and under 10s. |
| Avg engagement | Mean active ms (hidden tabs excluded) | GA4's "engagement time" and Plausible's time on page match this. Wix and HubSpot measure wall-clock duration. |
| Conversion rate | Converting visitors ÷ visitors | Plausible and PostHog are the same. Wix uses orders ÷ sessions. Fathom defaults to pageviews. |
| Signups vs submissions | *Joined* is a new unique phone. *Submitted* counts every attempt. | Unbounce separates conversions from leads in the same way. We should show both. 🟡 The funnel shows both, but the KPI row does not. |
| K-factor (current) | Referred signups ÷ signups | This is Viral Loops' "K". GrowSurf and Andrew Chen define **K = invites per user × invite→signup rate**. 🟡 Relabel ours "Referred share" and add classic K (R40). |
| Channel | Our own rule set, 12 groups including `AI Assistants` and `Invite link` | See §4. |

**Data caveats footer.** Show this everywhere, like Wix's FAQ and HubSpot's GA-mismatch article:
- Visitors who opt out or block scripts are not counted.
- Location comes from IP and is approximate.
- Bots are excluded, and internal traffic is excluded by default.
- Raw sessions are pruned after 13 months. Signup attribution is kept.

---

## 4. Channel rules

Status: ✅ built (`server/analytics.ts`). Improvements are listed after the table.

We use ordered rules where the first match wins, like HubSpot and GA4.

| # | Channel | Current rule | Suggested change |
|---|---|---|---|
| 1 | Paid Search / Paid Social / Display | paid medium or click id | Split out **Paid Other** (GA4). |
| 2 | Email | medium or source contains email | Add **SMS**: `utm_medium=sms` or `source=sms`, as in GA4 and PostHog. Our own invite texts need this bucket. |
| 3 | Invite link | `?ref=` / has_invite | Keep it first-class. HubSpot and Shopify have nothing equivalent. |
| 4 | AI Assistants | referrer or utm matches chatgpt, perplexity, claude, gemini, copilot | Add meta.ai, mistral.ai, poe.com, grok.com and deepseek (HubSpot and GA4 lists). Match `utm_medium=ai-assistant`. |
| 5 | Organic Social / Search / Referral / Other campaigns / Direct | ✅ | Add a tooltip saying "Direct is inflated by untracked links and in-app browsers" (Squarespace). Merge sources that differ only in capitalisation (Plausible). |

**Drill-downs.** HubSpot gives each channel two drill-down levels:

| Channel | Drill-down 1 | Drill-down 2 |
|---|---|---|
| Referral | domain | full referrer |
| AI | platform | campaign |
| Social | network | campaign |
| Paid | campaign | term |
| Invite | inviter code | — |
| Direct | landing path | — |

Our `admin_breakdown` supports one dimension at a time. R12 adds drill-down.

---

## 5. Requirements

Every requirement has a status and a priority. Each one names the product it is modelled on.

### 5.1 Global controls

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R1 | **Date presets.** We have Today, Yesterday, 7d, 30d, 90d, This month and Last month. Add *Last 24h*, *Year to date*, *Last 12 months*, *All time* and a *Realtime* shortcut. | Plausible | ✅ | P0 |
| R2 | **Compare modes:** Previous period ✅, Previous year ❌, Custom ❌, and a *Match day of week* toggle. Show the comparison as a **dashed overlay line** on the main chart, and show both values in the tooltip. | Plausible, Fathom, GA4 | ✅ on Overview | P0 |
| R3 | **Granularity** switch for hour, day, week and month, with an automatic default based on range length. | All | ✅ | — |
| R4 | **Filters.** Click to filter ✅, chips ✅, filter state in the URL ✅. **Operators:** is ✅, is not ❌ (click a chip to flip it), contains / not contains ❌. **Multiple values OR'd within a dimension** ❌. Esc clears ❌. | Plausible, Fathom, Umami, GA4 | ✅ | P0 |
| R5 | **Saved segments.** A named filter set, either personal or shared with admins. | Plausible, Umami, GA4 | ❌ | P1 |
| R6 | **Keyboard shortcuts** with visible hints: D, E, W, T, M, P, A, C for ranges, X to compare, ←/→ to step the period, / to search, ? for help. | Plausible | ❌ | P1 |
| R7 | **Refresh.** A manual refresh button plus an "updated Xs ago" timestamp, and auto-refresh on the Realtime page. | Wix, HubSpot | ✅ | P0 |
| R8 | **Internal traffic badge** shown whenever internal traffic is included. **IP/CIDR exclusion list** in Settings, alongside the `?internal=1` cookie. | HubSpot, GA4 | 🟡 cookie only | P1 |
| R9 | **Streamer mode.** Blurs numbers and PII for screen shares and launch streams. | Shopify | ❌ | P2 |
| R10 | **Definitions tooltip** on every metric (§3), plus the data-caveats footer. | Wix glossary, GA4 | ✅ | P0 |

### 5.2 Overview (Wix Highlights / Plausible top)

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R11 | **KPI tiles:** Visitors, Sessions, Signups, Conversion rate, Engaged rate/Bounce, Avg engagement, **Current visitors** (live dot), and **Referred share / K**. Clicking a tile **sets the chart metric**. Delta colour follows meaning. | Plausible, PostHog | ✅ | P0 |
| R12 | **Main chart.** Supports the comparison overlay (R2), **several metrics toggled at once**, drag to zoom, annotations (R60) and a goal line (R61). | Fathom, HubSpot, GA4 | 🟡 | P0 |
| R13 | **Panel grid.** Channels/Sources/Campaigns, Entry/Exit pages, Map/Countries/Regions/Cities, and Device/Browser/OS. Each panel has tabs, a bar behind each row, an **expand-to-detail** view with search, and CSV export. | Plausible | ✅ | P0 |
| R14 | **Drill-down.** Clicking a channel row filters, then shows drill-down 1, then drill-down 2 (§4). | HubSpot, Vercel | ❌ | P1 |
| R15 | **Secondary dimension** on any breakdown table, for example Channel × Device. Needs `admin_breakdown2(dim_a, dim_b)`. | Fathom, GA4 | ❌ | P1 |
| R16 | **Customize the overview.** Show, hide and reorder tiles and panels, saved per admin. | Wix, Shopify | ❌ | P2 |
| R17 | **Heartbeat.** "Last signup 4 min ago · last referral 12 min ago". | Waitlist | ✅ | P0 |

### 5.3 Realtime (Wix / Shopify Live View / GA4)

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R18 | Active visitors over 5 minutes, a per-minute chart for the last 30 minutes, countries, sources and devices. | GA4, Wix | ✅ | — |
| R19 | **Active pages / sections right now.** | GA4 Realtime pages, Wix | 🟡 sections in view | P1 |
| R20 | **Map with dots.** Visits in one colour, signups in another. | Shopify, Wix | ❌ | P1 |
| R21 | **Live micro-funnel for the last 10 minutes:** viewing → saw form → started → joined. | Shopify | ❌ | P1 |
| R22 | **Live feed** of the last 40 events ✅. Add **"today since midnight"** counters for signups and referrals. | Wix, Shopify | ✅ | P0 |
| R23 | **Recent visitors list** for the last 24 hours: device, location, source, start time, pages, and whether they converted. Filterable by source, country and IP-hash. | Wix, Squarespace activity log | ❌ | P1 |
| R24 | **Session / visitor timeline.** Clicking a visitor, a signup or a leaderboard row opens the ordered events grouped by session, the first and latest source, the invitees and the inviter. | Wix "Session info", GA4 user snapshot, HubSpot contact timeline, Mixpanel profile | ❌ | P1 |

### 5.4 Acquisition

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R25 | Tabs for Channel, Source, Referrer, UTM ×5, Click id and Invite. Columns: visitors, sessions, pageviews, engaged rate, engagement, signups, conversion rate. | GA4 traffic acquisition | ✅ | — |
| R26 | **First-touch vs session scope toggle.** Show acquisition by the visitor's *first* channel (already stored on `visitors.first_*`) or by the session's channel. | GA4, HubSpot original/latest source | ❌ | P1 |
| R27 | **Channels over time.** Stacked area of the top N channels plus "Other", with a year-over-year option. | Wix, GA4 | ❌ | P1 |
| R28 | **Attribution for signups.** First touch, last touch, linear and U-shaped over the visitor's sessions before signup. Uses `signup_attribution.sessions_before` and the visitor's session history. | HubSpot | ❌ | P2 |
| R29 | **UTM link builder.** Generates tagged links, including `utm_medium=sms` for invite texts and influencer links, and keeps the list. | Pirsch, Squarespace | ❌ | P2 |
| R30 | **Search Console link-out.** Link to it only; no ingestion. | Wix, HubSpot, Squarespace | ❌ | P2 |

### 5.5 Audience

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R31 | Country, region and city; device, browser and OS; language; timezone; screen; new vs returning. | All | ✅ | — |
| R32 | **Choropleth map** view for countries. | Plausible, Wix | ❌ | P1 |
| R33 | **Weekday × hour heatmap** of sessions and signups. Tells us when to post launch content. | Wix, Pirsch, PostHog | ❌ | P1 |
| R34 | **Return-visit retention.** A weekly cohort heatmap of visitors, keyed on first visit, who came back. A second view keyed on signup, showing who returned to share. | GA4, PostHog | ❌ | P2 |
| R35 | **Lifecycle of inviters.** Per week: new, returning, resurrecting and dormant sharers. | PostHog, Amplitude | ❌ | P2 |

### 5.6 Behavior (the one-page site)

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R36 | Section reach, the scroll-depth distribution, tabs, clicks, outbound links, and an all-events table. | Plausible scroll depth, Wix clicks | ✅ | — |
| R37 | **Page overlay.** A screenshot or wireframe of the landing page with each section's reach %, an **average fold line**, and **per-CTA click counts** drawn on it. | Webflow Analyze | ❌ | P2 |
| R38 | **Per-element conversion table.** One row per CTA and placement (hero, nav, closing, and so on). Columns: unique viewers, clickers, CTR, joined, conversion rate. Needs a `placement` prop on `waitlist_view` and on clicks (partly there). | Squarespace Form & Button, HubSpot CTA rate | 🟡 by_source exists in the funnel | P1 |
| R39 | **Navigation flow.** A Sankey of the first 4 section steps plus exits. | Wix Top navigation flows, GA4 path, Plausible Explore | ❌ | P2 |
| R39a | **Rage and dead clicks.** At least 3 clicks within 1 second in a 30px area counts as rage; a click on a non-interactive element counts as dead. | PostHog, Webflow | ❌ | P2 |
| R39b | **Per-path table.** `/`, `/privacy`, `/terms` and future pages, with exit rate. | Wix, HubSpot | ❌ | P1 |

### 5.7 Signup funnel

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R40a | Steps: visited → saw form → started → submitted → joined → shared. Error reasons, and submissions by placement. | HubSpot form funnel | ✅ | — |
| R40b | **Each step shows** the count, the % of step 1, the % of the previous step, and a drop-off bar. The footer shows "→ step% ↓ drop%". | Plausible, PostHog, Pirsch | ✅ | P0 |
| R40c | **Time to convert.** A histogram of first visit → join, using `seconds_to_signup`, and of form start → submit. | PostHog, Mixpanel, GA4 elapsed time | ❌ | P1 |
| R40d | **Conversion over time** as a line for each step rate. | PostHog, Amplitude, Wix | ❌ | P1 |
| R40e | **Breakdown of the funnel** by channel, device and country, shown side by side. | PostHog, Mixpanel | 🟡 via global filter | P1 |
| R40f | **Drop-off list.** Recent sessions that started but did not join, linking to the timeline (R24). | PostHog, Mixpanel | ❌ | P2 |
| R40g | **Form field analytics.** Country-picker changes (`waitlist_country`), validation errors by reason, and time in the field. | HubSpot | 🟡 | P2 |

### 5.8 Referrals and virality (our advantage, extended)

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R41 | Referred share, active referrers, priority unlocked, the 0/1/2/3+ distribution, the leaderboard, and suspicious sharers. | Viral Loops, ReferralHero | ✅ | — |
| R42 | **Classic K** = (invite link clicks or shares per signup) × (invite→signup conversion). Show it next to **referral rate** (% of signups with at least one invite) and **invites per active referrer**. Every number carries a formula tooltip. | GrowSurf, Andrew Chen | ✅ | P0 |
| R43 | **Share channel.** `referral_share` currently has **no channel prop**. Track the share target: native share sheet, copy, SMS, WhatsApp, X, email. Show **shares over time by channel** and a pie of the mix. | ReferralHero, Viral Loops | 🟡 copy and native share tracked | P0 |
| R44 | **Referral loop funnel:** signups → opened the referral card → shared/copied → invite link visits (sessions with `has_invite`) → invitee joined → invitee shared. | KickoffLabs, Viral Loops | ✅ | P0 |
| R45 | **Viral cycle time.** A histogram of the time from an inviter's signup to each invitee's signup. Report the median. | Andrew Chen, forEntrepreneurs | ❌ | P1 |
| R46 | **K by signup-week cohort,** and "K at 7 days". | Andrew Chen | ❌ | P1 |
| R47 | **Referral tree.** Generation counts (gen 0 organic, gen 1, gen 2…), the largest trees, and a click-through tree view per root. No vendor documents this, so it would set us apart. | — | ❌ | P1 |
| R48 | **Rank movement.** Leaderboard "movers" over 24h and 7d. No vendor documents this, so it would set us apart. | — | ❌ | P2 |
| R49 | **Referral Confirmation Rate.** The share of referrals that are not flagged, and later the share that are phone-verified. | SparkLoop | ❌ | P1 |

### 5.9 Fraud and data quality

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R50 | **Risk tiers** (low / medium / high) on signups and referrers, with **reason codes**: same network hash, burst velocity, data-center IP, VoIP line, phone country ≠ IP country, same device fingerprint, self-referral. A shared IP alone is only *medium*, because offices share IPs. | ReferralHero, GrowSurf, Prefinery | 🟡 we have `network_hash` and a `suspicious` list | P1 |
| R51 | **Review queue.** Approve, reject or ban per signup, with bulk actions. Rejected referrals stop counting towards priority. Optionally **hold priority unlocks** until referrals are confirmed. Every action is written to the audit log. | SparkLoop, ReferralHero | ❌ | P1 |
| R52 | **Caps.** Signups per network per hour and referrals credited per network, both configurable in Settings. | Prefinery | ✅ configurable in Settings | P2 |
| R53 | **Bot traffic over time.** Sessions filtered as bots, split into Bot, AI agent and Automation by user agent. | Wix, PostHog | ❌ | P1 |
| R54 | **Spam referrer exclusion list.** | HubSpot, GA4 unwanted referrals | ❌ | P2 |

### 5.10 Phone and SMS (Twilio layer)

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R55 | **Country-code distribution** of signups, parsed from E.164, shown **next to IP country**, with a mismatch rate. | Twilio fraud guidance | — waitlist is email now | P1 |
| R56 | **Line type and carrier mix.** Mobile, landline, fixed and non-fixed VoIP, toll-free. Needs a Twilio Lookup v2 call at signup, which costs money per lookup and is a product decision. | Twilio Lookup | — waitlist is email now | P2 |
| R57 | **Consent audit.** Consent capture rate ✅ (`consent_version`, `consented_at`), the distribution of consent versions, and a per-signup consent record for export. The TCPA limitation period is 4 years, so retention must be at least that. | TCPA guidance | 🟡 email consent version recorded | P1 |
| R58 | **Once SMS sending exists:** sent → delivered → clicked, delivery rate by carrier and country, opt-out (STOP) rate, and error codes. | Twilio Messaging Insights | — waitlist is email now | P2 |

### 5.11 Performance

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R59a | LCP, INP, CLS, FCP and TTFB at p75, Good/NI/Poor by device, and JS errors. | Wix Site Speed, PostHog, Cloudflare | ✅ | — |
| R59b | **Percentile selector** (p75, p90, p99) and **trend over time** per metric. A "not enough data" state below 10 samples. | PostHog, Wix | ❌ | P1 |

### 5.12 Alerts, digests, annotations, goals, insights

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R60 | **Annotations.** A date or range, a title (60 chars), a colour, and the author. Shown on every time chart. Seed them from deploys and launch posts. | GA4, PostHog, Umami | ✅ | P0 for launch |
| R61 | **Goals and targets.** For example "10k signups by 2026-10-31", shown as a **goal line** with a **projected ETA** at the current run rate. | HubSpot goals, Shopify targets | ❌ | P1 |
| R62 | **Alerts.** Conditions: metric above or below N, % change against the previous period, and **anomaly** (outside the 99% band of the trailing 28 days). Includes **no-traffic** and **error spike** alerts. Delivered by email, Slack webhook or generic webhook. Supports quiet hours and a "simulate against the last 30 days" preview. Seeded with signups drop, traffic spike, error spike and fraud burst. | Squarespace, PostHog, GA4 custom insights, Pirsch | ❌ | P1 |
| R63 | **Anomaly band on the main chart.** A shaded expected range with outliers marked, **annotated with the cause**: the top channels and sections behind the change. | Amplitude, Squarespace | ❌ | P2 |
| R64 | **Slack feed.** One message per signup that names the channel and inviter, a milestone message at every 1k, and a daily and weekly digest. | Viral Loops, Waitlist | ❌ | P1 |
| R65 | **Scheduled email digest.** Weekly by default: KPIs with deltas, top channels, the funnel, referral stats and alerts fired. | Wix, HubSpot, Plausible | ❌ | P1 |
| R66 | **Insights feed.** Rules-based items in three groups: *Needs attention*, *Opportunities*, *Trends*. | Wix Insights | ❌ | P2 |
| R67 | **Ask the data.** A question box that returns a chart and **shows the query** it ran, restricted to the allowlisted `admin_*` RPCs. | PostHog AI, Mixpanel Spark, Wix Analytics Pro, Simple Analytics AI | ❌ | P2 |

### 5.13 Sharing, export, access

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R68 | Signups export (audited) ✅. **CSV export on every table and panel,** respecting the current filters. | Plausible, Fathom | ✅ | P0 |
| R69 | **Read-only shared link** for investors and advisors. It has an expiry, an optional password, an optional locked segment, **aggregate data only**, no PII, and is audited. | Plausible, Fathom | ❌ | P2 |
| R70 | **Roles.** Admin (full access) and Viewer (no phone reveal, export or delete). | Wix collaborators, LaunchList seats | ❌ all admins today | P1 |

### 5.14 Waitlist operations

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R71 | **Admit people from the waitlist.** Invite the top N by priority and position, or by segment (country, channel, invites ≥ N). Marks them `admitted`, fires a webhook, and records batch size and redemption rate. | Prefinery, Arc, Superhuman | ❌ | P2, at launch |
| R72 | **Tags and notes** on signups. | Prefinery | ❌ | P2 |
| R73 | **Webhooks:** `signup.created`, `referral.credited`, `priority.unlocked`, `signup.flagged`. | All waitlist tools | ❌ | P2 |

### 5.15 Experiments

| # | Requirement | Inspired by | Status | Pri |
|---|---|---|---|---|
| R74 | **Landing variants.** Show variant, exposed visitors, signups, conversion rate, Δ vs control, a 95% interval, chance to win, and a **secondary metric of invites per signup**. Include a "not enough data" state. Never allow a destructive stats reset. | PostHog, Unbounce, Framer | ❌ | P2 |

### Out of scope
- **Benchmarks against other sites** (Wix, Unbounce). We have no data from other sites.
- **Session replay and heatmap recordings** (Wix, PostHog). The consent and PII cost is too high on a phone form.
- **Commerce, bookings and email-campaign reports.**
- **Behavioral modeling for non-consenting users** (GA4).

---

## 6. Tracking changes these requirements need

Each change is small and is listed with the requirement it unblocks.

| Change | Unblocks |
|---|---|
| ✅ `referral_share` and `referral_copy`: add `channel`, one of `native`, `copy`, `sms`, `whatsapp`, `x`, `email` (native and copy exist today) | R42–R44 |
| ✅ On landing with `?ref=`, record `invite_visit` with the inviter code. | R44, R45, R47 |
| Put `placement` on every CTA `click` and on `waitlist_view` consistently | R38 |
| Add `rage_click` and `dead_click` (throttled) | R39a |
| At signup, store `phone_country` from E.164 (the country is already parsed client-side as `waitlist_country`) | R55 |
| Bot class (`bot`, `ai_agent`, `automation`) on `sessions`, from the user agent | R53 |
| New tables: `annotations`, `goals`, `alerts`, `alert_events`, `segments`, `signup_flags` (risk tier, reasons, review state) | R5, R50–R51, R60–R62 |

## 7. New or changed RPCs

| RPC | Change | Unblocks |
|---|---|---|
| `admin_overview` | Add `p_compare_from` and `p_compare_to` | R2 |
| `filtered_sessions` | Accept `{dim: {"in": [...]}}`, `{"neq"}`, `{"contains"}` alongside plain equality. Keep the allowlist. | R4 |
| `admin_breakdown2(dim_a, dim_b)` | New | R15 |
| drill-down variants | New | R14 |
| `admin_breakdown_series(dim, bucket, top_n)` | New | R27 |
| `admin_heatmap(tz)` | New | R33 |
| `admin_pages` | New | R39b |
| `admin_realtime` | Add `pages`, `today`, `micro_funnel` and dot coordinates (city centroid) | R19–R22 |
| `admin_recent_sessions` | New | R23 |
| `admin_visitor_timeline(visitor_id \| code)` | New | R24 |
| `admin_funnel` | Add `time_to_convert` buckets and a per-bucket series | R40c, R40d |
| `admin_referrals` | Add `classic_k`, `referral_rate`, `shares_by_channel`, `loop_funnel`, `cycle_time`, `generations`, `cohort_k` | R42–R47 |
| `admin_bots` | New | R53 |
| `admin_vitals_series(metric, pctl, bucket)` | New | R59b |
| CRUD for annotations, goals, alerts, segments and flags | New, all through `require_admin()` and audited | R5, R50–R51, R60–R62 |

## 8. Anti-patterns, with what we do instead

| Anti-pattern | Where it comes from | Our rule |
|---|---|---|
| Pageview-based bounce on a one-page site | Wix, HubSpot, Squarespace | Engagement-based bounce, with the definition shown in a tooltip |
| Jargon and "(not set)", "(other)", "Unassigned" | GA4 | Plain labels, "(none)" with a tooltip, never silent truncation |
| Filters and settings that apply only going forward, silently | GA4, HubSpot | Show "applies from <date>" wherever that is true |
| Recategorising past data | HubSpot | Attribution stays frozen at signup (`signup_attribution`) |
| No export, or capped exports | Squarespace, Wix | CSV everywhere, respecting filters |
| Destructive stats reset | Unbounce | Annotations instead |
| Funnels that start counting only when created | Plausible | Compute funnels from raw events so they backfill |
| PII in analytics | Plausible and Vercel forbid it; we have the risk | Phones stay in `waitlist_signups`; reveals are audited; shared links carry aggregates only |

## 9. Suggested build order

1. **Pre-launch (P0).**
   - Compare overlay and previous year (R2).
   - Filter operators (R4).
   - Clickable KPI tiles with a live tile and the heartbeat (R11, R17).
   - Panel expand and CSV (R13, R68).
   - Funnel step % (R40b).
   - Classic K and share channel tracking (R42–R44).
   - Annotations (R60).
   - Definitions tooltips (R10).
2. **Launch week (P1a).**
   - Slack feed and alerts (R62, R64).
   - Goal line with ETA (R61).
   - Realtime additions (R19–R23).
   - Visitor timeline (R24).
   - Weekday × hour heatmap (R33).
3. **P1b.**
   - First-touch toggle (R26).
   - Channels over time (R27).
   - Drill-downs and secondary dimensions (R14, R15).
   - Cycle time and the referral tree (R45, R47).
   - Fraud tiers and the review queue (R50, R51).
   - Phone country vs IP country (R55).
   - Bot report (R53).
   - Vitals trend (R59b).
   - Roles (R70).
   - Weekly digest (R65).
4. **P2.** Everything else, in the order the launch data shows we need it.

---

## Appendix: main sources

**Wix**
- support.wix.com articles: `wix-analytics-about-the-highlights-page`, `wix-analytics-reports-glossary`, `customizing-wix-analytics-reports`, `using-wix-analytics-alerts`, `wix-analytics-about-real-time-analytics`, `understanding-your-site-speed-dashboard`, `wix-analytics-insights`

**HubSpot**
- knowledge.hubspot.com/reports/: `analyze-your-site-traffic-with-the-traffic-analytics-tool`, `understand-hubspots-traffic-sources-in-the-traffic-analytics-tool`, `understand-attribution-reporting`, `create-a-journey-report`, `exclude-traffic-from-your-site-analytics`
- knowledge.hubspot.com/forms/analyze-form-submissions-data

**GA4**
- support.google.com/analytics/answer/: 9756891 (channels), 12195621 (bounce/engagement), 9269518 (comparisons), 9443595 (insights), 15884203 (annotations), 9271392 (realtime), 9327974 (funnels), 10104470 (internal traffic)
- The Data API schema

**Privacy-first tools**
- plausible.io/docs: `metrics-definitions`, `filters-segments`, `keyboard-shortcuts`, `compare-stats`, `funnel-analysis`, `traffic-spikes`, `shared-links`
- The plausible.io public demo
- usefathom.com/docs
- docs.umami.is
- docs.pirsch.io
- vercel.com/docs/analytics
- developers.cloudflare.com/web-analytics

**Product analytics**
- posthog.com/docs: `web-analytics/dashboard`, `data/channel-type`, `product-analytics/funnels`, `alerts`, `data/annotations`, `experiments/analyzing-results`
- docs.mixpanel.com: funnels-advanced, alerts
- amplitude.com/docs: anomaly-forecast, journeys

**Site builders**
- Squarespace support: traffic sources, form & button conversions, activity log, site traffic alerts
- Webflow: Analyze clickmaps and goals, AI traffic insights
- framer.com/help: how Framer's built-in analytics work
- Shopify help: live-view, session-measurement-update
- Unbounce documentation, read via excerpts

**Waitlist and referral tools**
- getwaitlist.com/docs/guides/analytics
- growsurf.com/glossary/viral-coefficient
- support.referralhero.com: analytics/shares, settings/security
- help.sparkloop.app: referral confirmation rate, anti-fraud
- help.prefinery.com: fraud-protection per IP, invite users
- andrewchen.com: viral coefficient

**Phone and SMS**
- twilio.com: Lookup, Messaging Insights
- TCPA consent guidance: activeprospect.com
