// Types for the public.admin_* RPC functions in sql/003_analytics.sql and sql/005_admin_features.sql.
// Field names and nullability mirror the jsonb each function builds.

/** analytics.dimensions(): the only keys allowed in p_filters and p_dimension. */
export const DIMENSIONS = [
  'channel', 'source', 'referrer_domain', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_term', 'utm_content', 'click_id', 'country', 'region', 'city', 'device_type', 'browser', 'os',
  'language', 'timezone', 'screen', 'entry_path', 'exit_path', 'is_new_visitor', 'has_invite',
] as const

export type Dimension = (typeof DIMENSIONS)[number]

export const FILTER_OPS = ['is', 'is_not', 'contains', 'not_contains'] as const
export type FilterOp = (typeof FILTER_OPS)[number]

/** One dimension's condition. Several values are OR'd. */
export interface FilterClause {
  op: FilterOp
  values: string[]
}

/**
 * p_filters as the SQL takes it: per dimension either a plain string ("is") or
 * {op, values}. Dimensions are AND'd. Missing values are the literal "(none)".
 */
export type Filters = Partial<Record<Dimension, string | FilterClause>>

export const NONE = '(none)'

export type Bucket = 'hour' | 'day' | 'week' | 'month'

/** Half-open range [from, to) as ISO timestamps. */
export interface Range {
  from: string
  to: string
}

export interface RangeQuery extends Range {
  filters: Filters
}

export interface Whoami {
  email: string | null
  is_admin: boolean
}

export interface Kpis {
  visitors: number
  new_visitors: number
  returning_visitors: number
  sessions: number
  pageviews: number
  engaged_sessions: number
  /** 0..1 */
  bounce_rate: number
  avg_engagement_seconds: number
  pages_per_session: number
  signups: number
  referred_signups: number
  converting_visitors: number
  /** 0..1, converting visitors / visitors */
  conversion_rate: number
}

export interface Overview {
  current: Kpis
  /** KPIs for the comparison range (compare_from..compare_to). */
  previous: Kpis
  compare_from: string
  compare_to: string
  all_time_signups: number
  display_count: number
  last_signup_at: string | null
  last_referral_at: string | null
}

export interface TimeseriesPoint {
  /** Bucket start as local wall time in the requested zone, "YYYY-MM-DDTHH:MM:SS" (no offset). */
  t: string
  visitors: number
  sessions: number
  pageviews: number
  engaged: number
  signups: number
}

export interface BreakdownRow {
  /** Dimension value; "(none)" when missing; "true"/"false" for boolean dimensions. */
  value: string
  visitors: number
  sessions: number
  pageviews: number
  engaged_rate: number
  avg_engagement_seconds: number
  /** Converted sessions in this group. */
  signups: number
  conversion_rate: number
}

export type FunnelStepKey = 'visited' | 'saw_form' | 'started' | 'submitted' | 'joined' | 'shared'

export interface Funnel {
  steps: { key: FunnelStepKey; label: string; sessions: number }[]
  errors: { reason: string; count: number }[]
  by_source: { source: string; submitted: number; joined: number }[]
}

export type SectionKey = 'top' | 'intro' | 'capabilities' | 'use-cases' | 'marketplace' | 'closing'

export interface Engagement {
  total_sessions: number
  sections: { section: SectionKey; ord: number; sessions: number; rate: number }[]
  scroll: { depth: number; sessions: number; rate: number }[]
  /** tab is "group: tab" */
  tabs: { tab: string; count: number; sessions: number }[]
  clicks: { target: string; count: number; sessions: number }[]
  outbound: { href: string | null; count: number; sessions: number }[]
  events: { name: string; count: number; sessions: number }[]
}

export interface RealtimeEvent {
  occurred_at: string
  name: string
  path: string | null
  props: Record<string, unknown>
  country: string | null
  city: string | null
  device_type: string | null
  browser: string | null
  source: string
}

export interface Realtime {
  active_visitors: number
  active_sessions: number
  /** 30 one-minute buckets, oldest first; t is an ISO timestamp. */
  per_minute: { t: string; visitors: number }[]
  countries: { country: string; visitors: number }[]
  sources: { source: string; visitors: number }[]
  devices: { device_type: string; visitors: number }[]
  /** Sections seen in the last 5 minutes (section_view events). */
  sections: { section: string | null; visitors: number }[]
  /** Since local midnight in the requested time zone. */
  today: { since: string; signups: number; referred_signups: number; visitors: number }
  recent: RealtimeEvent[]
}

export type ContactType = 'email' | 'phone'

export interface SignupRow {
  code: string
  /** Email as "a•••@example.com"; legacy phone signups as "••• ••• 1234". */
  contact_masked: string
  contact_type: ContactType
  created_at: string
  placement: string
  was_invited: boolean
  invites: number
  channel: string | null
  traffic_source: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  referrer_domain: string | null
  country: string | null
  region: string | null
  city: string | null
  device_type: string | null
  browser: string | null
  os: string | null
  seconds_to_signup: number | null
  sessions_before: number | null
  consent_version: string | null
  consented_at: string | null
}

export interface SignupsPage {
  total: number
  rows: SignupRow[]
}

export interface ExportRow {
  /** Null only for legacy phone signups. */
  email: string | null
  /** Null for email signups. */
  phone: string | null
  created_at: string
  placement: string
  referral_code: string
  referred_by: string | null
  consent_version: string | null
  consented_at: string | null
  invites: number
  channel: string | null
  traffic_source: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  referrer_domain: string | null
  landing_path: string | null
  country: string | null
  region: string | null
  city: string | null
  device_type: string | null
  browser: string | null
  os: string | null
  seconds_to_signup: number | null
  sessions_before: number | null
}

export type LoopStepKey = 'joined' | 'opened' | 'shared' | 'visited' | 'converted' | 'priority'

export interface Referrals {
  signups: number
  referred_signups: number
  /** Referred signups ÷ signups in range (0..1). */
  referred_share: number
  /** Deprecated alias of referred_share. */
  k_factor: number
  /** Cohort (joined in range): invitees ÷ cohort size. */
  classic_k: number
  /** Distinct visitors on cohort invite links ÷ cohort size. */
  invite_visits_per_signup: number
  /** Cohort invitees ÷ invite-link visitors, capped at 1. */
  invite_conversion: number
  /** Cohort members with at least one invitee ÷ cohort size. */
  referral_rate: number
  invites_per_active_referrer: number
  loop_funnel: { key: LoopStepKey; label: string; people: number }[]
  shares_by_channel: { channel: string; shares: number }[]
  /** day is "YYYY-MM-DD" (database time zone). */
  shares_by_day: { day: string; channel: string; shares: number }[]
  active_referrers: number
  /** All time: people with 3+ invites. */
  priority_unlocked: number
  /** All time. */
  distribution: { bucket: '0' | '1' | '2' | '3+'; people: number }[]
  leaderboard: {
    code: string
    contact_masked: string
    joined_at: string
    invites: number
    invites_in_range: number
    priority: boolean
    channel: string | null
    country: string | null
  }[]
  suspicious: { code: string; contact_masked: string; invites: number; shared: number }[]
}

export interface VitalRow {
  metric: string | null
  /** null on the overall row for a metric (GROUPING SETS). */
  device_type: string | null
  samples: number
  p75: number
  good: number
  needs_improvement: number
  poor: number
}

export interface Performance {
  vitals: VitalRow[]
  errors: { message: string | null; source: string | null; count: number; sessions: number; last_seen: string }[]
}

export interface AuditEntry {
  at: string
  actor: string
  action: string
  detail: Record<string, unknown>
}

/**
 * The welcome email settings. The sender fields and postal address apply to every
 * waitlist email. `body` is no longer used (the content is a fixed branded template)
 * but is kept and sent back unchanged.
 */
export interface WelcomeEmail {
  enabled: boolean
  from_name: string
  from_email: string
  reply_to: string
  subject: string
  body?: string
  postal_address: string
}

/** Sent once, when someone's third invitee joins. Uses the welcome email's sender. */
export interface PriorityEmail {
  enabled: boolean
  subject: string
}

export type EmailKind = 'welcome' | 'priority'

export interface EmailPreview {
  kind: EmailKind
  from: string
  subject: string
  html: string
  text: string
}

export interface TestEmailResult {
  sentTo: string
  kind: EmailKind
  /** True when the admin has their own signup, so the links in the test work. */
  realLinks: boolean
  /** Which sender delivered it: SMTP (primary) or the Resend backup. */
  via: 'smtp' | 'resend'
}

export interface SendPendingResult {
  sent: number
  retried: number
  failed: number
  cancelled: number
}

export interface SettingValues {
  waitlist_count_baseline: number
  include_internal: boolean
  signups_open: boolean
  signups_closed_message: string
  blocked_email_domains: string[]
  block_disposable_email: boolean
  signup_limit_per_hour: number
  signup_limit_per_day: number
  welcome_email: WelcomeEmail
  priority_email: PriorityEmail
}

export type SettingKey = keyof SettingValues

export interface AdminSettings {
  me: string
  admins: { email: string; added_at: string; added_by: string | null }[]
  settings: Partial<SettingValues> & Record<string, unknown>
  display_count: number
  audit: AuditEntry[]
}

export const ANNOTATION_COLORS = ['blue', 'green', 'orange', 'red', 'purple', 'gray'] as const
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]

export interface Annotation {
  id: number
  /** "YYYY-MM-DD" */
  starts_on: string
  ends_on: string | null
  title: string
  color: AnnotationColor
  created_by: string
  created_at: string
}

export interface NewAnnotation {
  starts_on: string
  ends_on: string | null
  title: string
  color: AnnotationColor
}

export interface EmailReport {
  /** Queue jobs created in the range. skipped is always 0 (kept for older dashboards). */
  welcome: { sent: number; failed: number; pending: number; cancelled: number; skipped: number }
  priority: { sent: number; failed: number; pending: number; cancelled: number }
  /** Everything still queued, regardless of range. */
  pending_all_time: number
  oldest_pending_at: string | null
  tests: { sent: number; failed: number }
  /** detail is a failure code for queue jobs, free text for tests. */
  recent_failures: { created_at: string; kind: EmailKind | 'test'; detail: string | null }[]
  unsubscribed: number
  unsubscribed_all_time: number
  /** Top 200 domains of email signups in range. */
  domains: { domain: string; signups: number }[]
}

export interface EmailKindEngagement {
  kind: EmailKind
  sent: number
  /** delivered/bounced/complained come only from Resend webhooks (emails the Resend backup sent). */
  delivered: number
  bounced: number
  complained: number
  /** Distinct emails opened / clicked, excluding automated (scanner) events. */
  opened: number
  clicked: number
  clicks: number
  /** Opens and clicks attributed to scanners and bots; excluded from the rates. */
  automated: number
  unsubscribed: number
  open_rate: number
  click_rate: number
  click_to_open: number
  unsubscribe_rate: number
  bounce_rate: number
}

export type EmailLink = 'share' | 'explore' | 'resend_link'

export interface EmailEngagement {
  kinds: EmailKindEngagement[]
  links: { kind: EmailKind; link: EmailLink | string; clicks: number; people: number }[]
  /** day is "YYYY-MM-DD" in the database time zone. */
  daily: { day: string; sent: number; opened: number; clicked: number }[]
  /** Webhook events from Resend in the range; 0 means no Resend-only numbers are available. */
  resend_events: number
  tests: { opens: number; clicks: number }
}

export interface PageOverlay {
  sessions: number
  /** In page order. exited = sessions whose deepest section was this one; exit_rate = exited ÷ reached. */
  sections: {
    section: SectionKey
    ord: number
    reached: number
    reach_rate: number
    exited: number
    exited_without_signup: number
    exit_rate: number
  }[]
  scroll: { depth: number; sessions: number; rate: number }[]
  /** target is a data-track value (e.g. "waitlist-link:nav") or "anchor:<id>". */
  clicks: { target: string; clicks: number; sessions: number }[]
  /** href is host + path, e.g. "x.com/openswarm". */
  outbound: { href: string; clicks: number; sessions: number }[]
}

/** One experiment variant: visitors who saw it and the signups it produced (admin_experiments). */
export interface ExperimentRow {
  exp: string
  variant: string
  visitors: number
  /** Visitors who arrived on a link that picked this variant (ads and campaigns). */
  from_ads: number
  signups: number
  first_seen: string | null
}
