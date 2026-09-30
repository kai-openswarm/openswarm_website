// One data interface for the dashboard. The live implementation calls the
// public.admin_* RPCs; in development, mock mode swaps in fixtures with the same shapes.
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMockMode } from './mode'
import { getSupabase } from './supabase'
import type {
  AdminSettings, Annotation, Bucket, BreakdownRow, Dimension, EmailReport, Engagement, ExportRow, Funnel, NewAnnotation, Overview,
  Performance, Range, RangeQuery, Realtime, Referrals, SettingKey, SettingValues, SignupsPage, TimeseriesPoint, WelcomeEmail, Whoami,
} from './types'

export interface AdminApi {
  readonly mode: 'live' | 'mock'
  whoami(): Promise<Whoami>
  /** compare defaults (server side) to the previous period of the same length. */
  overview(q: RangeQuery, compare?: Range): Promise<Overview>
  timeseries(q: RangeQuery, bucket: Bucket, tz: string): Promise<TimeseriesPoint[]>
  breakdown(q: RangeQuery, dimension: Dimension, limit?: number): Promise<BreakdownRow[]>
  funnel(q: RangeQuery): Promise<Funnel>
  engagement(q: RangeQuery): Promise<Engagement>
  /** tz decides where "today" starts. */
  realtime(tz: string): Promise<Realtime>
  signups(r: Range, search: string, limit: number, offset: number): Promise<SignupsPage>
  /** Returns the full email (or phone, for legacy signups). The server records the reveal in the audit log. */
  revealContact(code: string): Promise<string>
  /** Full rows including email addresses. The server records the export in the audit log. */
  exportSignups(r: Range): Promise<ExportRow[]>
  /** Permanently erases the signup, its attribution and the linked visitor history. */
  deleteSignup(code: string): Promise<void>
  referrals(r: Range): Promise<Referrals>
  performance(q: RangeQuery): Promise<Performance>
  settings(): Promise<AdminSettings>
  updateSetting<K extends SettingKey>(key: K, value: SettingValues[K]): Promise<void>
  removeAdmin(email: string): Promise<void>
  /** Adds the email to the allowlist and creates its login (POST /api/admin/invite). */
  inviteAdmin(email: string): Promise<void>
  /** Sends the given (possibly unsaved) welcome email to the signed-in admin (POST /api/admin/test-email). */
  /** Resolves true when the test used the admin's own waitlist signup (real invite and unsubscribe links). */
  testEmail(welcome: WelcomeEmail): Promise<boolean>
  annotations(r: Range): Promise<Annotation[]>
  addAnnotation(a: NewAnnotation): Promise<number>
  deleteAnnotation(id: number): Promise<void>
  emailReport(r: Range): Promise<EmailReport>
}

export class ApiError extends Error {
  readonly code: string | undefined
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
  /** Postgres insufficient_privilege, raised by analytics.require_admin(). */
  get forbidden(): boolean {
    return this.code === '42501'
  }
}

function createLiveApi(sb: SupabaseClient): AdminApi {
  async function rpc<T>(fn: string, params?: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.rpc(fn, params)
    if (error) throw new ApiError(error.message || 'Request failed.', error.code)
    return data as T
  }
  /** Admin endpoints on the website API authenticate with the Supabase access token. */
  async function postAdmin(path: string, payload: unknown, failure: string): Promise<Record<string, unknown>> {
    const { data } = await sb.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new ApiError('Your session has expired. Sign in again.', '401')
    let res: Response
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
    } catch {
      throw new ApiError('Could not reach the server. Check your connection and try again.')
    }
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } & Record<string, unknown> | null
    if (!res.ok || !body?.ok) throw new ApiError(body?.error || `${failure} (${res.status}).`, String(res.status))
    return body
  }
  const rq = (q: RangeQuery) => ({ p_from: q.from, p_to: q.to, p_filters: q.filters })

  return {
    mode: 'live',
    whoami: () => rpc('admin_whoami'),
    overview: (q, compare) => rpc('admin_overview', { ...rq(q), p_compare_from: compare?.from ?? null, p_compare_to: compare?.to ?? null }),
    timeseries: (q, bucket, tz) => rpc('admin_timeseries', { ...rq(q), p_bucket: bucket, p_tz: tz }),
    breakdown: (q, dimension, limit = 50) => rpc('admin_breakdown', { ...rq(q), p_dimension: dimension, p_limit: limit }),
    funnel: (q) => rpc('admin_funnel', rq(q)),
    engagement: (q) => rpc('admin_engagement', rq(q)),
    realtime: (tz) => rpc('admin_realtime', { p_tz: tz }),
    signups: (r, search, limit, offset) =>
      rpc('admin_signups', { p_from: r.from, p_to: r.to, p_search: search || null, p_limit: limit, p_offset: offset }),
    revealContact: (code) => rpc('admin_reveal_contact', { p_code: code }),
    exportSignups: (r) => rpc('admin_export_signups', { p_from: r.from, p_to: r.to }),
    deleteSignup: (code) => rpc('admin_delete_signup', { p_code: code }),
    referrals: (r) => rpc('admin_referrals', { p_from: r.from, p_to: r.to }),
    performance: (q) => rpc('admin_performance', rq(q)),
    settings: () => rpc('admin_settings'),
    updateSetting: (key, value) => rpc<void>('admin_update_setting', { p_key: key, p_value: value }),
    removeAdmin: (email) => rpc('admin_remove_admin', { p_email: email }),
    inviteAdmin: async (email) => { await postAdmin('/api/admin/invite', { email }, 'Invite failed') },
    testEmail: async (welcome) => (await postAdmin('/api/admin/test-email', { welcome_email: welcome }, 'Test email failed')).realLinks === true,
    annotations: (r) => rpc('admin_annotations', { p_from: r.from, p_to: r.to }),
    addAnnotation: (a) => rpc('admin_add_annotation', { p_starts_on: a.starts_on, p_ends_on: a.ends_on, p_title: a.title, p_color: a.color }),
    deleteAnnotation: (id) => rpc('admin_delete_annotation', { p_id: id }),
    emailReport: (r) => rpc('admin_email_report', { p_from: r.from, p_to: r.to }),
  }
}

let apiPromise: Promise<AdminApi> | null = null

/** Resolves the data layer once. Mock code is only reachable in development builds. */
export function loadApi(): Promise<AdminApi> {
  apiPromise ??= (async () => {
    if (import.meta.env.DEV && isMockMode) {
      const { createMockApi } = await import('./mock')
      return createMockApi()
    }
    const sb = getSupabase()
    if (!sb) throw new ApiError('Supabase is not configured.', 'config')
    return createLiveApi(sb)
  })()
  return apiPromise
}
