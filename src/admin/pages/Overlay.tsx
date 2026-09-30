import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Monitor, RotateCw, Smartphone } from 'lucide-react'
import { clsx } from 'clsx'
import { useApi, useQuery, useView } from '../hooks'
import { SECTION_LABELS, fmtInt, fmtPct } from '../format'
import type { PageOverlay } from '../types'
import { Button, CsvButton, DataTable, EmptyState, InfoTip, Panel, QueryView, SkeletonRows, Tabs } from '../ui'

const EXIT_INFO = 'Left here: sessions whose deepest section was this one, so they left the page after it. Exit rate = left here ÷ reached. Sessions that never reported a section count as leaving at the top.'

type Overlay = PageOverlay
type Section = Overlay['sections'][number]

/** The section most exits happen after, as one sentence. */
function insight(d: Overlay): string | null {
  if (!d.sessions) return null
  const top = [...d.sections].sort((a, b) => b.exited - a.exited)[0]
  if (!top || !top.exited) return null
  const name = SECTION_LABELS[top.section] ?? top.section
  const share = fmtPct(top.exited / d.sessions)
  const last = d.sections[d.sections.length - 1]
  if (top.section === last?.section) return `Most visitors scroll all the way to the ${name.toLowerCase()} before leaving (${share} of sessions).`
  return `Most visitors who leave, leave after ${name} (${share} of sessions; ${fmtPct(top.exit_rate)} of those who reached it).`
}

function ExitChart({ d }: { d: Overlay }) {
  const worst = [...d.sections].sort((a, b) => b.exited - a.exited)[0]?.section
  const n = Math.max(d.sessions, 1)
  return (
    <ol className="space-y-3">
      {d.sections.map((s) => (
        <li key={s.section} className={clsx('rounded-md px-2 py-1.5', s.section === worst && s.exited > 0 && 'bg-[color-mix(in_srgb,var(--poor)_8%,transparent)] ring-1 ring-poor/30')}>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
            <span className="font-medium">
              <span className="mr-1.5 text-ink-3 num">{s.ord}.</span>
              {SECTION_LABELS[s.section] ?? s.section}
            </span>
            <span className="text-[12.5px] text-ink-2 num">
              Reached <span className="font-semibold text-ink">{fmtPct(s.reach_rate)}</span>
              <span className="text-ink-3"> · </span>
              {s.section === 'closing'
                ? <span className="text-ink-2">read to the end</span>
                : <span className="text-down">{fmtPct(s.exit_rate)} left here</span>}
              <span className="text-ink-3"> ({fmtInt(s.exited)}, {fmtInt(s.exited_without_signup)} without signing up)</span>
            </span>
          </div>
          <div className="relative h-4 overflow-hidden rounded bg-hover" role="img" aria-label={`${fmtInt(s.reached)} reached, ${fmtInt(s.exited)} left here`}>
            <div className="absolute inset-y-0 left-0 rounded bg-accent/35" style={{ width: `${(s.reached / n) * 100}%` }} />
            {/* The exiting part of those who reached it, drawn at the right end of the reach bar. */}
            <div
              className="absolute inset-y-0 rounded-r"
              style={{ left: `${((s.reached - s.exited) / n) * 100}%`, width: `${(s.exited / n) * 100}%`, background: 'var(--poor)', opacity: 0.75 }}
            />
          </div>
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------------------
// The overlay on the live page
// ---------------------------------------------------------------------------

interface Box { x: number; y: number; w: number; h: number }

interface Measure {
  height: number
  width: number
  sections: Partial<Record<string, Box>>
  clicks: Record<string, Box | null>
  outbound: Record<string, Box | null>
}

const DEVICES = { desktop: 1280, mobile: 390 } as const
type Device = keyof typeof DEVICES
const ZOOMS = [
  { key: 'fit', label: 'Fit' },
  { key: '0.5', label: '50%' },
  { key: '0.75', label: '75%' },
  { key: '1', label: '100%' },
] as const
type Zoom = (typeof ZOOMS)[number]['key']

const MAX_HEIGHT = 40_000

function visibleBox(el: Element, win: Window): Box | null {
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return null
  const cs = win.getComputedStyle(el)
  if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[inert],[aria-hidden="true"]')) return null
  return { x: r.left + win.scrollX, y: r.top + win.scrollY, w: r.width, h: r.height }
}

const quote = (v: string) => v.replace(/["\\]/g, '\\$&')

/** Maps a click target to the elements it came from, per the tracker's naming. */
function clickElements(doc: Document, target: string): Element[] {
  if (target.startsWith('anchor:')) return [...doc.querySelectorAll(`a[href="#${quote(target.slice(7))}"]`)]
  return [...doc.querySelectorAll(`[data-track="${quote(target)}"]`)]
}

/** Outbound hrefs are recorded as host + path; compare against each link's resolved URL. */
function outboundElements(doc: Document, href: string): Element[] {
  return [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) => {
    try {
      const u = new URL(a.href)
      return `${u.hostname}${u.pathname}` === href || `${u.hostname}${u.pathname}`.replace(/\/$/, '') === href.replace(/\/$/, '')
    } catch {
      return false
    }
  })
}

function firstVisible(els: Element[], win: Window) {
  for (const el of els) {
    const b = visibleBox(el, win)
    if (b) return b
  }
  return null
}

function tint(exitRate: number) {
  return `color-mix(in srgb, var(--poor) ${Math.round(4 + Math.min(1, exitRate) * 40)}%, transparent)`
}

function PageOverlayView({ d }: { d: Overlay }) {
  const [device, setDevice] = useState<Device>(() => (window.innerWidth < 768 ? 'mobile' : 'desktop'))
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errText, setErrText] = useState('')
  const [measure, setMeasure] = useState<Measure | null>(null)
  const [boxWidth, setBoxWidth] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const frame = useRef<HTMLIFrameElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const frameW = DEVICES[device]

  const measureNow = useCallback(() => {
    const f = frame.current
    let doc: Document | null = null
    try {
      doc = f?.contentDocument ?? null
    } catch {
      doc = null
    }
    const win = f?.contentWindow
    if (!f || !doc || !win || !doc.body) {
      setStatus('error')
      setErrText('The page could not be read (it must be served from the same origin as the dashboard).')
      return
    }
    const height = Math.min(MAX_HEIGHT, Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight))
    const sections: Measure['sections'] = {}
    doc.querySelectorAll<HTMLElement>('[data-section]').forEach((el) => {
      const b = visibleBox(el, win)
      const key = el.dataset.section
      if (b && key && !sections[key]) sections[key] = b
    })
    const clicks: Measure['clicks'] = {}
    for (const c of d.clicks) clicks[c.target] = firstVisible(clickElements(doc, c.target), win)
    const outbound: Measure['outbound'] = {}
    for (const o of d.outbound) outbound[o.href] = firstVisible(outboundElements(doc, o.href), win)
    // Grow the frame to the full page so nothing scrolls inside it.
    if (Math.abs(f.offsetHeight - height) > 1) f.style.height = `${height}px`
    setMeasure({ height, width: frameW, sections, clicks, outbound })
    setStatus('ready')
  }, [d.clicks, d.outbound, frameW])

  // Re-measure after load as fonts, images and animations settle, and when the page resizes.
  useEffect(() => {
    const f = frame.current
    if (!f) return
    setStatus('loading')
    let timers: number[] = []
    let observer: ResizeObserver | null = null
    const failTimer = window.setTimeout(() => {
      setStatus((s) => (s === 'loading' ? 'error' : s))
      setErrText('The page took too long to load.')
    }, 20_000)
    const onLoad = () => {
      window.clearTimeout(failTimer)
      measureNow()
      timers = [300, 1000, 2500, 5000].map((ms) => window.setTimeout(measureNow, ms))
      try {
        const win = f.contentWindow as (Window & typeof globalThis) | null
        if (win?.ResizeObserver && f.contentDocument?.body) {
          let raf = 0
          observer = new win.ResizeObserver(() => {
            cancelAnimationFrame(raf)
            raf = requestAnimationFrame(measureNow)
          })
          observer.observe(f.contentDocument.body)
        }
      } catch { /* measured by the timers instead */ }
    }
    f.addEventListener('load', onLoad)
    if (f.contentDocument?.readyState === 'complete' && f.contentDocument.body?.childElementCount) onLoad()
    return () => {
      f.removeEventListener('load', onLoad)
      window.clearTimeout(failTimer)
      timers.forEach((t) => window.clearTimeout(t))
      observer?.disconnect()
    }
  }, [measureNow, reloadKey])

  // Changing the device width re-lays out the page; measure again once it settles.
  useEffect(() => {
    const t = window.setTimeout(measureNow, 400)
    return () => window.clearTimeout(t)
  }, [frameW, measureNow])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth))
    ro.observe(el)
    setBoxWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const fit = boxWidth ? Math.min(1, boxWidth / frameW) : 0.5
  const scale = zoom === 'fit' ? fit : Number(zoom)
  const H = measure?.height ?? 2400

  const unresolved = useMemo(() => {
    if (!measure) return []
    return [
      ...d.clicks.filter((c) => measure.clicks[c.target] === null).map((c) => ({ kind: 'Click', what: c.target, clicks: c.clicks, sessions: c.sessions })),
      ...d.outbound.filter((o) => measure.outbound[o.href] === null).map((o) => ({ kind: 'Outbound link', what: o.href, clicks: o.clicks, sessions: o.sessions })),
    ]
  }, [d, measure])

  const missingSections = measure ? d.sections.filter((s) => !measure.sections[s.section]).map((s) => SECTION_LABELS[s.section] ?? s.section) : []

  // Bands from each section's top to the next section's top.
  const bands = useMemo(() => {
    if (!measure) return []
    const found = d.sections
      .map((s) => ({ s, box: measure.sections[s.section] }))
      .filter((x): x is { s: Section; box: Box } => !!x.box)
      .sort((a, b) => a.box.y - b.box.y)
    return found.map((x, i) => ({ ...x, top: x.box.y, bottom: found[i + 1]?.box.y ?? Math.max(x.box.y + x.box.h, measure.height) }))
  }, [d.sections, measure])

  const badges = measure
    ? [
        ...d.clicks.map((c) => ({ key: `c:${c.target}`, box: measure.clicks[c.target], n: c.clicks, title: `${c.target}: ${fmtInt(c.clicks)} clicks by ${fmtInt(c.sessions)} sessions`, out: false })),
        ...d.outbound.map((o) => ({ key: `o:${o.href}`, box: measure.outbound[o.href], n: o.clicks, title: `Outbound ${o.href}: ${fmtInt(o.clicks)} clicks by ${fmtInt(o.sessions)} sessions`, out: true })),
      ].filter((b): b is typeof b & { box: Box } => !!b.box)
    : []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          label="Device"
          value={device}
          onChange={setDevice}
          tabs={[{ key: 'desktop', label: 'Desktop 1280px' }, { key: 'mobile', label: 'Phone 390px' }] as const}
        />
        <div className="flex items-center gap-2">
          <Tabs label="Zoom" value={zoom} onChange={setZoom} tabs={ZOOMS} />
          <Button size="sm" variant="ghost" onClick={() => { setMeasure(null); setReloadKey((k) => k + 1) }} aria-label="Reload the page">
            <RotateCw className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm" style={{ background: tint(0.1) }} />low exit rate</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm" style={{ background: tint(0.6) }} />high exit rate</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-accent" />scroll depth</span>
        <span className="inline-flex items-center gap-1.5"><span className="rounded-full bg-btn px-1.5 text-[10.5px] font-semibold text-btn-ink">12</span>clicks</span>
      </div>

      <div ref={wrap} className="relative -mx-4 overflow-x-auto border-y border-line bg-panel-2 sm:mx-0 sm:rounded-md sm:border">
        <div className="relative mx-auto" style={{ width: frameW * scale, height: H * scale }}>
          <div className="absolute top-0 left-0 origin-top-left" style={{ width: frameW, height: H, transform: `scale(${scale})` }}>
            <iframe
              key={reloadKey}
              ref={frame}
              src="/"
              title="Landing page (non-interactive preview)"
              tabIndex={-1}
              scrolling="no"
              className="block border-0 bg-white"
              style={{ width: frameW, height: H, pointerEvents: 'none' }}
            />
          </div>

          {/* Overlays are drawn unscaled so their labels stay readable. */}
          <div className="pointer-events-none absolute inset-0">
            {bands.map(({ s, top, bottom }) => (
              <div key={s.section} className="absolute inset-x-0 border-t border-poor/40" style={{ top: top * scale, height: (bottom - top) * scale, background: tint(s.exit_rate) }}>
                <span style={{ top: top === 0 ? 72 * scale + 6 : 6 }} className="absolute left-1.5 max-w-[calc(100%-12px)] truncate rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white shadow num">
                  {SECTION_LABELS[s.section] ?? s.section} · Reached {fmtPct(s.reach_rate)}{s.section === 'closing' ? ' · read to the end' : ` · ${fmtPct(s.exit_rate)} left here`}
                </span>
              </div>
            ))}
            {measure && d.scroll.filter((x) => x.depth < 100).map((x) => (
              <div key={x.depth} className="absolute inset-x-0 border-t-2 border-dashed border-accent" style={{ top: (x.depth / 100) * H * scale }}>
                <span className="absolute right-1.5 -top-2.5 rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-white shadow num">
                  {fmtPct(x.rate)} scrolled {x.depth}%
                </span>
              </div>
            ))}
            {badges.map((b) => (
              <span
                key={b.key}
                title={b.title}
                className={clsx(
                  'pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full px-1.5 py-0.5 text-[11px] font-semibold shadow-md ring-2 ring-white num',
                  b.out ? 'bg-[var(--c7)] text-white' : 'bg-[#0b0b0b] text-white',
                )}
                style={{ left: (b.box.x + b.box.w) * scale, top: b.box.y * scale }}
              >
                {fmtInt(b.n)}
              </span>
            ))}
          </div>

          {status !== 'ready' && (
            <div className="absolute inset-0 flex items-start justify-center bg-panel-2/80 pt-16">
              {status === 'loading' ? (
                <span className="inline-flex items-center gap-2 text-[13px] text-ink-2"><Loader2 className="size-4 animate-spin" aria-hidden /> Loading the page…</span>
              ) : (
                <div role="alert" className="flex max-w-sm flex-col items-center gap-2 px-4 text-center text-[13px] text-ink-2">
                  <AlertTriangle className="size-5 text-poor" aria-hidden />
                  {errText || 'The page could not be loaded.'}
                  <Button size="sm" onClick={() => { setMeasure(null); setReloadKey((k) => k + 1) }}>Try again</Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="text-[12px] text-ink-3">
        The live landing page, non-interactive. Bands are tinted by how many of the sessions that reached each section left there; badges show tracked clicks
        (purple: links to other sites). Scroll lines are placed at that share of the page’s height, so they are approximate on the phone layout.
      </p>
      {missingSections.length > 0 && (
        <p className="text-[12.5px] text-ink-2"><AlertTriangle className="mr-1 inline size-3.5 text-warn" aria-hidden />Sections not found on the page: {missingSections.join(', ')}.</p>
      )}
      {unresolved.length > 0 && (
        <div>
          <h3 className="mb-1 text-[12.5px] font-semibold">Not on the page</h3>
          <p className="mb-2 text-[12px] text-ink-3">Tracked clicks whose element isn’t visible on this layout (removed since, only in a menu, or only on the other device width).</p>
          <DataTable
            rows={unresolved}
            rowKey={(r) => `${r.kind}|${r.what}`}
            caption="Tracked clicks not found on the page"
            csvName="overlay targets not on page"
            dense
            defaultSort={{ key: 'clicks', dir: 'desc' }}
            columns={[
              { key: 'kind', label: 'Kind', sort: (r) => r.kind, render: (r) => r.kind },
              { key: 'what', label: 'Target', sort: (r) => r.what, render: (r) => <span className="inline-block max-w-[280px] truncate align-middle font-mono text-[12px]" title={r.what}>{r.what}</span> },
              { key: 'clicks', label: 'Clicks', align: 'right', sort: (r) => r.clicks, render: (r) => fmtInt(r.clicks) },
              { key: 'sessions', label: 'Sessions', align: 'right', sort: (r) => r.sessions, render: (r) => fmtInt(r.sessions) },
            ]}
          />
        </div>
      )}
    </div>
  )
}

export function OverlayPage() {
  const api = useApi()
  const { query, key } = useView()
  const q = useQuery(`overlay|${key}`, () => api.pageOverlay(query))
  const d = q.data
  const line = d ? insight(d) : null

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Where visitors leave"
        info={EXIT_INFO}
        subtitle={d ? `${fmtInt(d.sessions)} sessions, sections in page order.` : 'Sections in page order.'}
        actions={d && (
          <CsvButton
            name="exit sections"
            getRows={() => ({
              header: ['Section', 'Order', 'Reached', 'Reach rate', 'Left here', 'Left without signing up', 'Exit rate'],
              rows: (d?.sections ?? []).map((s) => [SECTION_LABELS[s.section] ?? s.section, s.ord, s.reached, s.reach_rate, s.exited, s.exited_without_signup, s.exit_rate]),
            })}
          />
        )}
      >
        <QueryView q={q} isEmpty={(x) => x.sessions === 0} skeleton={<SkeletonRows rows={6} />}>
          {(x) => (
            <>
              {line && (
                <p className="mb-3 flex items-start gap-2 rounded-md bg-hover px-3 py-2 text-[13px] font-medium">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-poor" aria-hidden />
                  {line}
                </p>
              )}
              <div className="mb-2 flex flex-wrap gap-x-4 text-[12px] text-ink-3" aria-hidden>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-accent/35" />reached</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-poor opacity-75" />left here</span>
                <span className="inline-flex items-center gap-1">bar width: share of all sessions <InfoTip text={EXIT_INFO} label="Exit definition" /></span>
              </div>
              <ExitChart d={x} />
            </>
          )}
        </QueryView>
      </Panel>

      <Panel
        title={<span className="inline-flex items-center gap-2">Page overlay <Monitor className="size-3.5 text-ink-3" aria-hidden /><Smartphone className="size-3.5 text-ink-3" aria-hidden /></span>}
        subtitle="Exit rates, scroll depth and clicks drawn on the real landing page, for the current range and filters."
      >
        <QueryView q={q} isEmpty={(x) => x.sessions === 0} skeleton={<SkeletonRows rows={8} />} empty={<EmptyState />}>
          {(x) => <PageOverlayView d={x} />}
        </QueryView>
      </Panel>
    </div>
  )
}
