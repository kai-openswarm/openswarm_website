// One data interface for the dashboard. The live implementation calls the
// public.admin_* RPCs; in development, mock mode swaps in fixtures with the same shapes.
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMockMode } from './mode'
import { getSupabase } from './supabase'
import type {
  AdminSettings, Bucket, BreakdownRow, Dimension, Engagement, ExportRow, Funnel, Overview,
  Performance, Range, RangeQuery, Realtime, Referrals, SettingKey, SignupsPage, TimeseriesPoint, Whoami,
} from './types'

export interface AdminApi {
  readonly mode: 'live' | 'mock'
  whoami(): Promise<Whoami>
  overview(q: RangeQuery): Promise<Overview>
  timeseries(q: RangeQuery, bucket: Bucket, tz: string): Promise<TimeseriesPoint[]>
  breakdown(q: RangeQuery, dimension: Dimension, limit?: number): Promise<BreakdownRow[]>
  funnel(q: RangeQuery): Promise<Funnel>
  engagement(q: RangeQuery): Promise<Engagement>
  realtime(): Promise<Realtime>
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
  updateSetting(key: 'waitlist_count_baseline', value: number): Promise<void>
  updateSetting(key: 'include_internal', value: boolean): Promise<void>
  updateSetting(key: SettingKey, value: number | boolean): Promise<void>
  removeAdmin(email: string): Promise<void>
  /** Adds the email to the allowlist and creates its login (POST /api/admin/invite). */
  inviteAdmin(email: string): Promise<void>
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
  const rq = (q: RangeQuery) => ({ p_from: q.from, p_to: q.to, p_filters: q.filters })

  return {
    mode: 'live',
    whoami: () => rpc('admin_whoami'),
    overview: (q) => rpc('admin_overview', rq(q)),
    timeseries: (q, bucket, tz) => rpc('admin_timeseries', { ...rq(q), p_bucket: bucket, p_tz: tz }),
    breakdown: (q, dimension, limit = 50) => rpc('admin_breakdown', { ...rq(q), p_dimension: dimension, p_limit: limit }),
    funnel: (q) => rpc('admin_funnel', rq(q)),
    engagement: (q) => rpc('admin_engagement', rq(q)),
    realtime: () => rpc('admin_realtime'),
    signups: (r, search, limit, offset) =>
      rpc('admin_signups', { p_from: r.from, p_to: r.to, p_search: search || null, p_limit: limit, p_offset: offset }),
    revealContact: (code) => rpc('admin_reveal_contact', { p_code: code }),
    exportSignups: (r) => rpc('admin_export_signups', { p_from: r.from, p_to: r.to }),
    deleteSignup: (code) => rpc('admin_delete_signup', { p_code: code }),
    referrals: (r) => rpc('admin_referrals', { p_from: r.from, p_to: r.to }),
    performance: (q) => rpc('admin_performance', rq(q)),
    settings: () => rpc('admin_settings'),
    updateSetting: (key: SettingKey, value: number | boolean) => rpc<void>('admin_update_setting', { p_key: key, p_value: value }),
    removeAdmin: (email) => rpc('admin_remove_admin', { p_email: email }),
    async inviteAdmin(email) {
      const { data } = await sb.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new ApiError('Your session has expired. Sign in again.', '401')
      let res: Response
      try {
        res = await fetch('/api/admin/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ email }),
        })
      } catch {
        throw new ApiError('Could not reach the server. Check your connection and try again.')
      }
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !body?.ok) {
        throw new ApiError(body?.error || `Invite failed (${res.status}).`, String(res.status))
      }
    },
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
