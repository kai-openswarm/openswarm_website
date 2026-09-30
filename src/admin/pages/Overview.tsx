import { useState } from 'react'
import { Plus } from 'lucide-react'
import { clsx } from 'clsx'
import { useApi, useNow, useQuery, useView } from '../hooks'
import { browserTimeZone, toDateInput } from '../nav'
import { fmtAgo, fmtDuration, fmtInt, fmtPct } from '../format'
import { DEFS } from '../definitions'
import type { Kpis, TimeseriesPoint } from '../types'
import { TimeSeriesChart } from '../charts'
import { parseLocal } from '../chartUtil'
import { TopList } from '../Breakdown'
import { AnnotationForm } from '../Annotations'
import { Button, CsvButton, Delta, Dialog, EmptyState, ErrorState, InfoTip, Panel, QueryView, Skeleton } from '../ui'

type Metric = 'visitors' | 'sessions' | 'pageviews' | 'signups' | 'conversion' | 'bounce'

interface KpiDef {
  id: string
  label: string
  /** Value from the KPI object. */
  value: (k: Kpis) => number
  format: (n: number) => string
  info: string
  lowerIsBetter?: boolean
  /** Chart metric this tile drives, when the time series supports it. */
  metric?: Metric
}

const KPIS: KpiDef[] = [
  { id: 'visitors', label: 'Unique visitors', value: (k) => k.visitors, format: fmtInt, info: DEFS.visitors, metric: 'visitors' },
  { id: 'sessions', label: 'Sessions', value: (k) => k.sessions, format: fmtInt, info: DEFS.sessions, metric: 'sessions' },
  { id: 'pageviews', label: 'Page views', value: (k) => k.pageviews, format: fmtInt, info: DEFS.pageviews, metric: 'pageviews' },
  { id: 'signups', label: 'Signups', value: (k) => k.signups, format: fmtInt, info: DEFS.signups, metric: 'signups' },
  { id: 'conversion', label: 'Conversion rate', value: (k) => k.conversion_rate, format: fmtPct, info: DEFS.conversion, metric: 'conversion' },
  { id: 'bounce', label: 'Bounce rate', value: (k) => k.bounce_rate, format: fmtPct, lowerIsBetter: true, info: DEFS.bounce, metric: 'bounce' },
  { id: 'engagement', label: 'Avg. engagement', value: (k) => k.avg_engagement_seconds, format: fmtDuration, info: DEFS.avgEngagement },
  { id: 'referred', label: 'Referred', value: (k) => k.referred_signups, format: fmtInt, info: DEFS.referredSignups },
  { id: 'share', label: 'Referred share', value: (k) => (k.signups ? k.referred_signups / k.signups : 0), format: fmtPct, info: DEFS.referredShare },
]

const METRIC_LABEL: Record<Metric, string> = {
  visitors: 'Visitors', sessions: 'Sessions', pageviews: 'Page views', signups: 'Signups', conversion: 'Conversion rate', bounce: 'Bounce rate',
}

function metricValue(p: TimeseriesPoint, m: Metric): number {
  if (m === 'conversion') return p.visitors ? p.signups / p.visitors : 0
  if (m === 'bounce') return p.sessions ? 1 - p.engaged / p.sessions : 0
  return p[m]
}

/** Drops buckets that start in the future (ranges end at midnight after today). */
function trimFuture(pts: TimeseriesPoint[]) {
  const now = Date.now()
  return pts.filter((p) => parseLocal(p.t).getTime() <= now)
}

export function Overview() {
  const api = useApi()
  const { query, compareQuery, key, range, params, update } = useView()
  const metricParam = params.get('metric') as Metric | null
  const metric: Metric = metricParam && metricParam in METRIC_LABEL ? metricParam : 'visitors'
  const [annotating, setAnnotating] = useState(false)
  const now = useNow(30_000)

  const cmp = compareQuery ? { from: compareQuery.from, to: compareQuery.to } : undefined
  const overview = useQuery(`overview|${key}|${cmp?.from}`, () => api.overview(query, cmp))
  const series = useQuery(`ts|${key}|${range.bucket}`, () => api.timeseries(query, range.bucket, browserTimeZone))
  const compareSeries = useQuery(
    `ts-cmp|${compareQuery?.from}|${compareQuery?.to}|${key}|${range.bucket}`,
    () => (compareQuery ? api.timeseries(compareQuery, range.bucket, browserTimeZone) : Promise.resolve([])),
  )
  const annotations = useQuery(`ann|${range.fromIso}|${range.toIso}`, () => api.annotations({ from: range.fromIso, to: range.toIso }))
  const live = useQuery('live-visitors', () => api.realtime(browserTimeZone), { refreshMs: 30_000 })

  const setMetric = (m: Metric) => update((p) => { if (m === 'visitors') p.delete('metric'); else p.set('metric', m) }, true)
  const showDelta = range.compare !== 'off'
  const d = overview.data

  return (
    <div className="flex flex-col gap-4">
      {d && (
        <p className="-mt-1 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-3" aria-live="polite">
          <span className="inline-block size-1.5 rounded-full bg-good" aria-hidden />
          <span>Last signup <span className="font-medium text-ink-2">{d.last_signup_at ? fmtAgo(d.last_signup_at, now) : 'never'}</span></span>
          <span aria-hidden>·</span>
          <span>last referral <span className="font-medium text-ink-2">{d.last_referral_at ? fmtAgo(d.last_referral_at, now) : 'never'}</span></span>
        </p>
      )}

      <section aria-label="Key metrics">
        {overview.error && !d ? (
          <div className="rounded-lg border border-line bg-panel"><ErrorState error={overview.error} onRetry={overview.reload} /></div>
        ) : (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
            <div className="min-w-0 bg-panel px-4 py-3.5">
              <p className="flex items-center gap-1 text-[12.5px] text-ink-3">
                <span className="relative inline-flex size-2" aria-hidden>
                  <span className="absolute inset-0 animate-ping rounded-full bg-good opacity-60 motion-reduce:animate-none" />
                  <span className="relative inline-block size-2 rounded-full bg-good" />
                </span>
                <span className="leading-tight">Live now</span>
                <InfoTip text={DEFS.currentVisitors} label="Live now (current visitors) definition" />
              </p>
              {live.data ? (
                <>
                  <p className="mt-1 text-[22px] leading-7 font-semibold tracking-tight num">{fmtInt(live.data.active_visitors)}</p>
                  <p className="mt-0.5 text-[12px] text-ink-3">last 5 minutes</p>
                </>
              ) : live.error ? (
                <button type="button" onClick={live.reload} className="mt-1 text-[12px] text-down underline">Retry</button>
              ) : (
                <Skeleton className="mt-1.5 h-6 w-12" />
              )}
            </div>
            {KPIS.map((k) => {
              const selected = k.metric === metric
              const body = d ? (
                <>
                  <p className="mt-1 text-[22px] leading-7 font-semibold tracking-tight num">{k.format(k.value(d.current))}</p>
                  {showDelta && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-3">
                      <Delta current={k.value(d.current)} previous={k.value(d.previous)} lowerIsBetter={k.lowerIsBetter} />
                      <span className="truncate">vs {k.format(k.value(d.previous))}</span>
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Skeleton className="mt-1.5 h-6 w-20" />
                  <Skeleton className="mt-1.5 h-3.5 w-24" />
                </>
              )
              const head = (
                <span className="block text-[12.5px] leading-tight text-ink-3">{k.label}</span>
              )
              return (
                <div key={k.id} className={clsx('relative min-w-0 bg-panel', selected && 'bg-[color-mix(in_srgb,var(--accent)_7%,var(--panel))]')}>
                  {selected && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" aria-hidden />}
                  {k.metric ? (
                    <button
                      type="button"
                      onClick={() => setMetric(k.metric!)}
                      aria-pressed={selected}
                      className="block w-full px-4 py-3.5 pr-8 text-left hover:bg-hover"
                      title={`Show ${k.label.toLowerCase()} on the chart`}
                    >
                      {head}
                      {body}
                    </button>
                  ) : (
                    <div className="px-4 py-3.5 pr-8">
                      {head}
                      {body}
                    </div>
                  )}
                  <span className="absolute top-3.5 right-3 flex"><InfoTip text={k.info} label={`${k.label} definition`} /></span>
                </div>
              )
            })}
          </div>
        )}
        {d && (
          <p className="mt-2 text-[12px] text-ink-3">
            {showDelta && range.compareLabel ? <>Compared with {range.compareLabel}. </> : null}
            <span className="whitespace-nowrap">All-time signups: <span className="font-medium text-ink-2 num">{fmtInt(d.all_time_signups)}</span></span>{' · '}
            <span className="whitespace-nowrap">Public counter: <span className="font-medium text-ink-2 num">{fmtInt(d.display_count)}</span></span>{' '}
            <InfoTip text={DEFS.displayCount} label="Public counter definition" />
          </p>
        )}
      </section>

      <Panel
        title={`${METRIC_LABEL[metric]} over time`}
        subtitle={`By ${range.bucket} · ${browserTimeZone} · click a metric tile above to change the chart`}
        actions={
          <>
            {series.data && (
              <CsvButton
                name={`timeseries ${range.label}`}
                getRows={() => ({
                  header: ['Bucket', 'Visitors', 'Sessions', 'Page views', 'Engaged sessions', 'Signups'],
                  rows: (series.data ?? []).map((p) => [p.t, p.visitors, p.sessions, p.pageviews, p.engaged, p.signups]),
                })}
              />
            )}
            <Button size="sm" variant="ghost" onClick={() => setAnnotating(true)}>
              <Plus className="size-3.5" aria-hidden /> Annotate
            </Button>
          </>
        }
      >
        <QueryView q={series} isEmpty={(pts) => pts.every((p) => p.visitors === 0 && p.signups === 0)} skeleton={<Skeleton className="h-[260px]" />} empty={<div className="flex h-[260px] items-center justify-center"><EmptyState /></div>}>
          {(pts) => {
            const cur = trimFuture(pts)
            const prev = compareQuery ? compareSeries.data : undefined
            const pct = metric === 'conversion' || metric === 'bounce'
            return (
              <TimeSeriesChart
                data={cur.map((p, i) => ({
                  t: p.t,
                  value: metricValue(p, metric),
                  compare: prev?.[i] ? metricValue(prev[i], metric) : null,
                  compareT: prev?.[i]?.t ?? null,
                }))}
                label={METRIC_LABEL[metric]}
                bucket={range.bucket}
                format={pct ? fmtPct : fmtInt}
                compareLabel={range.compareLabel ? `${range.compare === 'year' ? 'Previous year' : 'Previous period'} (${range.compareLabel})` : null}
                annotations={annotations.data ?? []}
              />
            )
          }}
        </QueryView>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <TopList dim="channel" title="Channels" more={{ page: 'traffic' }} />
        <TopList dim="source" title="Sources" more={{ page: 'traffic' }} />
        <TopList dim="country" title="Countries" more={{ page: 'audience' }} />
        <TopList dim="device_type" title="Devices" more={{ page: 'audience' }} />
      </div>

      <Dialog open={annotating} onClose={() => setAnnotating(false)} title="Add an annotation">
        {annotating && (
          <AnnotationForm
            initialDate={toDateInput(new Date(Math.min(now, range.to.getTime() - 1)))}
            onCancel={() => setAnnotating(false)}
            onSaved={() => {
              setAnnotating(false)
              annotations.reload()
            }}
          />
        )}
      </Dialog>
    </div>
  )
}
