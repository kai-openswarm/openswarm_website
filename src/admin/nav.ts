// Hash routing and URL-held view state: #/traffic?range=30d&f.country=US&tab=utm_source
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { Bucket, Dimension, Filters } from './types'
import { DIMENSIONS } from './types'

export const PAGES = [
  'overview', 'realtime', 'traffic', 'audience', 'behavior', 'funnel', 'signups', 'referrals', 'performance', 'settings',
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

export function useRoute() {
  const hash = useSyncExternalStore(subscribe, snapshot)
  const { page, params } = useMemo(() => parseHash(hash), [hash])

  const go = useCallback((next: Page, nextParams?: URLSearchParams) => {
    const cur = parseHash(window.location.hash).params
    // Range and filters follow you between pages; page-local params do not.
    const keep = new URLSearchParams()
    for (const [k, v] of nextParams ?? cur) {
      if (nextParams || k === 'range' || k === 'from' || k === 'to' || k.startsWith('f.')) keep.append(k, v)
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
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'month', label: 'This month' },
  { id: 'lastmonth', label: 'Last month' },
] as const
export type PresetId = (typeof PRESETS)[number]['id'] | 'custom'

export const DEFAULT_PRESET: PresetId = '30d'

export interface ResolvedRange {
  preset: PresetId
  /** Inclusive local start. */
  from: Date
  /** Exclusive local end (midnight after the last day). */
  to: Date
  label: string
  bucket: Bucket
  /** Query strings for the RPCs. */
  fromIso: string
  toIso: string
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

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
  return 'week'
}

const labelFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const labelFmtYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export function resolveRange(params: URLSearchParams, now = new Date()): ResolvedRange {
  const today = startOfDay(now)
  let preset = (params.get('range') ?? DEFAULT_PRESET) as PresetId
  let from: Date
  let to: Date
  switch (preset) {
    case 'today': from = today; to = addDays(today, 1); break
    case 'yesterday': from = addDays(today, -1); to = today; break
    case '7d': from = addDays(today, -6); to = addDays(today, 1); break
    case '90d': from = addDays(today, -89); to = addDays(today, 1); break
    case 'month': from = new Date(today.getFullYear(), today.getMonth(), 1); to = addDays(today, 1); break
    case 'lastmonth': from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 1); break
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
  const presetLabel = PRESETS.find((p) => p.id === preset)?.label
  const last = addDays(to, -1)
  const fmt = from.getFullYear() === now.getFullYear() && last.getFullYear() === now.getFullYear() ? labelFmt : labelFmtYear
  const span = +from === +last ? fmt.format(from) : `${fmt.format(from)} – ${fmt.format(last)}`
  return {
    preset, from, to, bucket: chooseBucket(from, to),
    label: presetLabel ?? span,
    fromIso: from.toISOString(), toIso: to.toISOString(),
  }
}

export function readFilters(params: URLSearchParams): Filters {
  const f: Filters = {}
  for (const [k, v] of params) {
    if (!k.startsWith('f.')) continue
    const dim = k.slice(2) as Dimension
    if ((DIMENSIONS as readonly string[]).includes(dim)) f[dim] = v
  }
  return f
}

export const browserTimeZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()
