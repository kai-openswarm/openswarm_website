import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { AdminApi } from './api'
import { resolveRange, useRoute } from './nav'
import type { Dimension, FilterClause, RangeQuery } from './types'
import { clearAllClauses, flipOp, readClauses, toWire, writeClause } from './filters'
import { markLoaded, useRefreshNonce } from './refresh'

export const ApiContext = createContext<AdminApi | null>(null)

export function useApi(): AdminApi {
  const api = useContext(ApiContext)
  if (!api) throw new Error('ApiContext missing')
  return api
}

export interface QueryState<T> {
  data: T | undefined
  error: Error | null
  /** True while a request is in flight (including background refreshes). */
  loading: boolean
  reload: () => void
}

/**
 * Runs fn whenever key changes. Keeps the last data while a new request runs so
 * panels do not flash; ignores responses that arrive after a newer request started.
 */
export function useQuery<T>(key: string, fn: (api: AdminApi) => Promise<T>, opts: { refreshMs?: number; enabled?: boolean } = {}): QueryState<T> {
  const api = useApi()
  const [nonce, setNonce] = useState(0)
  const global = useRefreshNonce()
  const request = `${key}#${nonce}#${global}`
  const [state, setState] = useState<{ doneFor: string | null; data?: T; error: Error | null }>({ doneFor: null, error: null })
  const seq = useRef(0)
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })
  const enabled = opts.enabled ?? true

  useEffect(() => {
    if (!enabled) return
    const id = ++seq.current
    fnRef.current(api).then(
      (data) => {
        if (id !== seq.current) return
        setState({ doneFor: request, data, error: null })
        markLoaded()
      },
      (error: unknown) => {
        if (id === seq.current) setState((s) => ({ ...s, doneFor: request, error: error instanceof Error ? error : new Error(String(error)) }))
      },
    )
  }, [api, request, enabled])

  // Background refresh; paused while the tab is hidden.
  useEffect(() => {
    if (!opts.refreshMs || !enabled) return
    let timer: number | undefined
    const tick = () => {
      if (document.visibilityState === 'visible') setNonce((n) => n + 1)
    }
    const start = () => {
      window.clearInterval(timer)
      timer = window.setInterval(tick, opts.refreshMs)
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        tick()
        start()
      } else window.clearInterval(timer)
    }
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [opts.refreshMs, enabled])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const loading = enabled && state.doneFor !== request
  return { data: state.data, error: loading ? null : state.error, loading, reload }
}

/** The global range, comparison and filters held in the URL. */
export function useView() {
  const { params, update } = useRoute()
  const refresh = useRefreshNonce()
  const paramStr = params.toString()
  // Recomputed on URL change and on manual refresh, so relative ranges roll forward.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const range = useMemo(() => resolveRange(new URLSearchParams(paramStr)), [paramStr, refresh])
  const clauses = useMemo(() => readClauses(new URLSearchParams(paramStr)), [paramStr])
  const filters = useMemo(() => toWire(clauses), [clauses])
  const query: RangeQuery = useMemo(() => ({ from: range.fromIso, to: range.toIso, filters }), [range, filters])
  const compareQuery: RangeQuery | null = useMemo(
    () => (range.compareFrom && range.compareTo ? { from: range.compareFrom.toISOString(), to: range.compareTo.toISOString(), filters } : null),
    [range, filters],
  )
  const key = `${range.fromIso}|${range.toIso}|${JSON.stringify(filters)}`

  /** Row clicks: adds the value to an existing "is" clause (OR), otherwise starts one. */
  const addFilter = useCallback((dim: Dimension, value: string) => update((p) => {
    const cur = readClauses(p)[dim]
    const values = cur?.op === 'is' ? [...new Set([...cur.values, value])] : [value]
    writeClause(p, dim, { op: 'is', values })
  }), [update])
  const setClause = useCallback((dim: Dimension, clause: FilterClause | null) => update((p) => writeClause(p, dim, clause)), [update])
  const toggleOp = useCallback((dim: Dimension) => update((p) => {
    const cur = readClauses(p)[dim]
    if (cur) writeClause(p, dim, { ...cur, op: flipOp(cur.op) })
  }), [update])
  const removeFilter = useCallback((dim: Dimension) => update((p) => writeClause(p, dim, null)), [update])
  const clearFilters = useCallback(() => update(clearAllClauses), [update])

  return { range, clauses, filters, query, compareQuery, key, addFilter, setClause, toggleOp, removeFilter, clearFilters, params, update }
}

/** Current time, updated every `ms` (for "x minutes ago" labels). */
export function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return now
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

/** Matches a CSS media query, e.g. "(min-width: 1024px)". */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}
