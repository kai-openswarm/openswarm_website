// Types for the public.admin_* RPC functions in sql/003_analytics.sql.
// Field names and nullability mirror the jsonb each function builds.

/** analytics.dimensions(): the only keys allowed in p_filters and p_dimension. */
export const DIMENSIONS = [
  'channel', 'source', 'referrer_domain', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_term', 'utm_content', 'click_id', 'country', 'region', 'city', 'device_type', 'browser', 'os',
  'language', 'timezone', 'screen', 'entry_path', 'exit_path', 'is_new_visitor', 'has_invite',
] as const

export type Dimension = (typeof DIMENSIONS)[number]

/** Equality filters on session dimensions. Missing values are the literal "(none)". */
export type Filters = Partial<Record<Dimension, string>>

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
  previous: Kpis
  all_time_signups: number
  display_count: number
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

export interface Referrals {
  signups: number
  referred_signups: number
  /** Share of signups in range that were referred (0..1). */
  k_factor: number
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

export interface AdminSettings {
  me: string
  admins: { email: string; added_at: string; added_by: string | null }[]
  settings: { waitlist_count_baseline?: number; include_internal?: boolean } & Record<string, unknown>
  display_count: number
  audit: AuditEntry[]
}

export type SettingKey = 'waitlist_count_baseline' | 'include_internal'
