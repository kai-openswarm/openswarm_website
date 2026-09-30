import { useState } from 'react'
import { useApi, useQuery, useView } from '../hooks'
import { browserTimeZone } from '../nav'
import { fmtDuration, fmtInt, fmtPct } from '../format'
import type { Kpis, TimeseriesPoint } from '../types'
import { TimeSeriesChart } from '../charts'
import { parseLocal } from '../chartUtil'
import { TopList } from '../Breakdown'
import { Delta, EmptyState, ErrorState, Panel, QueryView, Skeleton, Tabs } from '../ui'

type Metric = 'visitors' | 'sessions' | 'pageviews' | 'signups'
const METRICS: { key: Metric; label: string }[] = [
  { key: 'visitors', label: 'Visitors' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'pageviews', label: 'Page views' },
  { key: 'signups', label: 'Signups' },
]

interface KpiDef {
  key: keyof Kpis
  label: string
  format: (n: number) => string
  lowerIsBetter?: boolean
  hint?: string
}

const KPIS: KpiDef[] = [
  { key: 'visitors', label: 'Unique visitors', format: fmtInt },
  { key: 'sessions', label: 'Sessions', format: fmtInt },
  { key: 'pageviews', label: 'Page views', format: fmtInt },
  { key: 'signups', label: 'Signups', format: fmtInt },
  { key: 'conversion_rate', label: 'Conversion rate', format: fmtPct, hint: 'Visitors who joined ÷ visitors' },
  { key: 'bounce_rate', label: 'Bounce rate', format: fmtPct, lowerIsBetter: true, hint: 'Sessions that were not engaged. Lower is better.' },
  { key: 'avg_engagement_seconds', label: 'Avg. engagement time', format: fmtDuration, hint: 'Active time on page per session' },
  { key: 'referred_signups', label: 'Referred signups', format: fmtInt, hint: 'Signups that came through an invite link' },
]

export function Overview() {
  const api = useApi()
  const { query, key, range } = useView()
  const [metric, setMetric] = useState<Metric>('visitors')
  const overview = useQuery(`overview|${key}`, () => api.overview(query))
  const series = useQuery(`ts|${key}|${range.bucket}`, () => api.timeseries(query, range.bucket, browserTimeZone))

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Key metrics">
        {overview.error && !overview.data ? (
          <div className="rounded-lg border border-line bg-panel"><ErrorState error={overview.error} onRetry={overview.reload} /></div>
        ) : (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
            {KPIS.map((k) => (
              <div key={k.key} className="min-w-0 bg-panel px-4 py-3.5" title={k.hint}>
                <p className="truncate text-[12.5px] text-ink-3">{k.label}</p>
                {overview.data ? (
                  <>
                    <p className="mt-1 text-[22px] leading-7 font-semibold tracking-tight num">{k.format(overview.data.current[k.key])}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-3">
                      <Delta current={overview.data.current[k.key]} previous={overview.data.previous[k.key]} lowerIsBetter={k.lowerIsBetter} />
                      <span className="truncate">vs {k.format(overview.data.previous[k.key])}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <Skeleton className="mt-1.5 h-6 w-20" />
                    <Skeleton className="mt-1.5 h-3.5 w-24" />
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {overview.data && (
          <p className="mt-2 text-[12px] text-ink-3">
            Compared with the previous period of the same length.{' '}
            <span className="whitespace-nowrap">All-time signups: <span className="font-medium text-ink-2 num">{fmtInt(overview.data.all_time_signups)}</span></span>{' · '}
            <span className="whitespace-nowrap">Public counter: <span className="font-medium text-ink-2 num">{fmtInt(overview.data.display_count)}</span></span>
          </p>
        )}
      </section>

      <Panel
        title="Over time"
        subtitle={`By ${range.bucket} · ${browserTimeZone}`}
      >
        <Tabs label="Chart metric" tabs={METRICS} value={metric} onChange={setMetric} className="mb-2" />
        <QueryView q={series} isEmpty={(pts) => pts.every((p) => p.visitors === 0 && p.signups === 0)} skeleton={<Skeleton className="h-[260px]" />} empty={<div className="flex h-[260px] items-center justify-center"><EmptyState /></div>}>
          {(pts) => <TimeSeriesChart data={trimFuture(pts).map((p) => ({ t: p.t, value: p[metric] }))} label={METRICS.find((m) => m.key === metric)!.label} bucket={range.bucket} />}
        </QueryView>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <TopList dim="channel" title="Channels" more={{ page: 'traffic' }} />
        <TopList dim="source" title="Sources" more={{ page: 'traffic' }} />
        <TopList dim="country" title="Countries" more={{ page: 'audience' }} />
        <TopList dim="device_type" title="Devices" more={{ page: 'audience' }} />
      </div>
    </div>
  )
}

/** Drops buckets that start in the future (ranges end at midnight after today). */
function trimFuture(pts: TimeseriesPoint[]) {
  const now = Date.now()
  return pts.filter((p) => parseLocal(p.t).getTime() <= now)
}
