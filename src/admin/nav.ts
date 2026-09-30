// Hash routing and URL-held view state: #/traffic?range=30d&f.country=US&tab=utm_source
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { Bucket } from './types'
import { isFilterKey } from './filters'

export const PAGES = [
  'overview', 'realtime', 'traffic', 'audience', 'behavior', 'overlay', 'funnel', 'signups', 'email', 'referrals', 'performance', 'settings',
] as const
export type Page = (typeof PAGES)[number]

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  window.addEventListener('popstate', cb)
  return () => {
    window.removeEventListener('hashchange', cb)
    window.removeEventListener('popstate', cb)
  }
}

const snapshot = () => window.location.hash

export function parseHash(hash: string): { page: Page; params: URLSearchParams } {
  // Anything not shaped like "#/page" (e.g. a Supabase "#access_token=..." redirect) is the default view.
  if (!hash.startsWith('#/')) return { page: 'overview', params: new URLSearchParams() }
  const [path, query = ''] = hash.slice(2).split('?')
  const page = (PAGES as readonly string[]).includes(path) ? (path as Page) : 'overview'
  return { page, params: new URLSearchParams(query) }
}

export function buildHash(page: Page, params: URLSearchParams) {
  const q = params.toString()
  return `#/${page}${q ? `?${q}` : ''}`
}

const GLOBAL_KEYS = new Set(['range', 'from', 'to', 'cmp'])

export function useRoute() {
  const hash = useSyncExternalStore(subscribe, snapshot)
  const { page, params } = useMemo(() => parseHash(hash), [hash])

  const go = useCallback((next: Page, nextParams?: URLSearchParams) => {
    const cur = parseHash(window.location.hash).params
    // Range, comparison and filters follow you between pages; page-local params do not.
    const keep = new URLSearchParams()
    for (const [k, v] of nextParams ?? cur) {
      if (nextParams || GLOBAL_KEYS.has(k) || isFilterKey(k)) keep.append(k, v)
    }
    window.location.hash = buildHash(next, keep)
  }, [])

  const update = useCallback((mut: (p: URLSearchParams) => void, replace = false) => {
    const cur = parseHash(window.location.hash)
    const p = new URLSearchParams(cur.params)
    mut(p)
    const h = buildHash(cur.page, p)
    if (replace) {
      window.history.replaceState(null, '', h)
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    } else {
      window.location.hash = h
    }
  }, [])

  return { page, params, go, update }
}

// ---------------------------------------------------------------------------
// Date ranges
// ---------------------------------------------------------------------------

export const PRESETS = [
  { id: '24h', label: 'Last 24 hours' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'month', label: 'This month' },
  { id: 'lastmonth', label: 'Last month' },
  { id: 'ytd', label: 'Year to date' },
  { id: '12m', label: 'Last 12 months' },
  { id: 'all', label: 'All time' },
] as const
export type PresetId = (typeof PRESETS)[number]['id'] | 'custom'

export const DEFAULT_PRESET: PresetId = '30d'

/** Nothing was tracked before this; "All time" starts here. */
export const ALL_TIME_START = new Date(2026, 0, 1)

export const COMPARE_MODES = [
  { id: 'prev', label: 'Previous period' },
  { id: 'year', label: 'Previous year' },
  { id: 'off', label: 'No comparison' },
] as const
export type CompareMode = (typeof COMPARE_MODES)[number]['id']

export interface ResolvedRange {
  preset: PresetId
  /** Inclusive local start. */
  from: Date
  /** Exclusive end (local midnight after the last day, or the next hour for "Last 24 hours"). */
  to: Date
  label: string
  bucket: Bucket
  /** Query strings for the RPCs. */
  fromIso: string
  toIso: string
  compare: CompareMode
  /** Comparison range, or null when comparison is off. */
  compareFrom: Date | null
  compareTo: Date | null
  compareLabel: string | null
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const minusYear = (d: Date) => {
  const x = new Date(d)
  x.setFullYear(x.getFullYear() - 1)
  return x
}

export function toDateInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function fromDateInput(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return Number.isNaN(date.getTime()) ? null : date
}

export function chooseBucket(from: Date, to: Date): Bucket {
  const days = (to.getTime() - from.getTime()) / 86_400_000
  if (days <= 2) return 'hour'
  if (days <= 90) return 'day'
  if (days <= 400) return 'week'
  return 'month'
}

const labelFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const labelFmtYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const hourFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })

export function spanLabel(from: Date, to: Date, now = new Date()) {
  const whole = +from === +startOfDay(from) && +to === +startOfDay(to)
  if (!whole) return `${hourFmt.format(from)} – ${hourFmt.format(to)}`
  const last = addDays(to, -1)
  const fmt = from.getFullYear() === now.getFullYear() && last.getFullYear() === now.getFullYear() ? labelFmt : labelFmtYear
  return +from === +last ? fmt.format(from) : `${fmt.format(from)} – ${fmt.format(last)}`
}

export function resolveRange(params: URLSearchParams, now = new Date()): ResolvedRange {
  const today = startOfDay(now)
  let preset = (params.get('range') ?? DEFAULT_PRESET) as PresetId
  let from: Date
  let to: Date
  switch (preset) {
    case '24h': {
      // Whole hours, so the range (and its cache key) is stable within the hour.
      to = new Date(now)
      to.setMinutes(0, 0, 0)
      to = new Date(to.getTime() + 3_600_000)
      from = new Date(to.getTime() - 24 * 3_600_000)
      break
    }
    case 'today': from = today; to = addDays(today, 1); break
    case 'yesterday': from = addDays(today, -1); to = today; break
    case '7d': from = addDays(today, -6); to = addDays(today, 1); break
    case '90d': from = addDays(today, -89); to = addDays(today, 1); break
    case 'month': from = new Date(today.getFullYear(), today.getMonth(), 1); to = addDays(today, 1); break
    case 'lastmonth': from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 1); break
    case 'ytd': from = new Date(today.getFullYear(), 0, 1); to = addDays(today, 1); break
    case '12m': from = addDays(minusYear(today), 1); to = addDays(today, 1); break
    case 'all': from = ALL_TIME_START; to = addDays(today, 1); break
    case 'custom': {
      const f = fromDateInput(params.get('from'))
      const t = fromDateInput(params.get('to'))
      if (f && t && f <= t) {
        from = f
        to = addDays(t, 1)
        break
      }
      preset = DEFAULT_PRESET
      from = addDays(today, -29)
      to = addDays(today, 1)
      break
    }
    default: preset = '30d'; from = addDays(today, -29); to = addDays(today, 1)
  }

  const cmpParam = params.get('cmp')
  const compare: CompareMode = cmpParam === 'year' || cmpParam === 'off' ? cmpParam : 'prev'
  let compareFrom: Date | null = null
  let compareTo: Date | null = null
  if (compare === 'prev') {
    compareFrom = new Date(from.getTime() - (to.getTime() - from.getTime()))
    compareTo = from
  } else if (compare === 'year') {
    compareFrom = minusYear(from)
    compareTo = minusYear(to)
  }

  return {
    preset, from, to, bucket: chooseBucket(from, to),
    label: PRESETS.find((p) => p.id === preset)?.label ?? spanLabel(from, to, now),
    fromIso: from.toISOString(), toIso: to.toISOString(),
    compare, compareFrom, compareTo,
    compareLabel: compareFrom && compareTo ? spanLabel(compareFrom, compareTo, now) : null,
  }
}

export const browserTimeZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()
