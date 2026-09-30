import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { AdminApi } from './api'
import { readFilters, resolveRange, useRoute } from './nav'
import type { Dimension, RangeQuery } from './types'

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
  const request = `${key}#${nonce}`
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
      (data) => { if (id === seq.current) setState({ doneFor: request, data, error: null }) },
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

/** The global range + filters held in the URL. */
export function useView() {
  const { params, update } = useRoute()
  const paramStr = params.toString()
  // Recomputed per URL change; "today" rolls over on the next navigation or reload.
  const range = useMemo(() => resolveRange(new URLSearchParams(paramStr)), [paramStr])
  const filters = useMemo(() => readFilters(new URLSearchParams(paramStr)), [paramStr])
  const query: RangeQuery = useMemo(() => ({ from: range.fromIso, to: range.toIso, filters }), [range, filters])
  const key = `${range.fromIso}|${range.toIso}|${JSON.stringify(filters)}`

  const addFilter = useCallback((dim: Dimension, value: string) => update((p) => p.set(`f.${dim}`, value)), [update])
  const removeFilter = useCallback((dim: Dimension) => update((p) => p.delete(`f.${dim}`)), [update])
  const clearFilters = useCallback(() => update((p) => {
    for (const k of [...p.keys()]) if (k.startsWith('f.')) p.delete(k)
  }), [update])

  return { range, filters, query, key, addFilter, removeFilter, clearFilters, params, update }
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
