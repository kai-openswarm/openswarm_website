import { useState } from 'react'
import { useApi, useQuery, useView } from '../hooks'
import { capitalize, fmtAgo, fmtDateTime, fmtInt, fmtPct } from '../format'
import type { VitalRow } from '../types'
import { Badge, DataTable, EmptyState, Panel, QueryView, SkeletonRows, Tabs } from '../ui'

interface VitalSpec {
  label: string
  description: string
  good: number
  poor: number
  unit: 'ms' | ''
}

// Google's thresholds for "good" and "poor" at p75.
const VITALS: Record<string, VitalSpec> = {
  LCP: { label: 'LCP', description: 'Largest Contentful Paint', good: 2500, poor: 4000, unit: 'ms' },
  INP: { label: 'INP', description: 'Interaction to Next Paint', good: 200, poor: 500, unit: 'ms' },
  CLS: { label: 'CLS', description: 'Cumulative Layout Shift', good: 0.1, poor: 0.25, unit: '' },
  FCP: { label: 'FCP', description: 'First Contentful Paint', good: 1800, poor: 3000, unit: 'ms' },
  TTFB: { label: 'TTFB', description: 'Time to First Byte', good: 800, poor: 1800, unit: 'ms' },
}
const ORDER = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB']

function fmtVital(metric: string, v: number) {
  const spec = VITALS[metric]
  if (!spec) return String(v)
  if (spec.unit === 'ms') return `${fmtInt(v)} ms`
  return v.toFixed(3)
}

function rating(metric: string, v: number): 'good' | 'ni' | 'poor' | null {
  const spec = VITALS[metric]
  if (!spec) return null
  return v <= spec.good ? 'good' : v <= spec.poor ? 'ni' : 'poor'
}

function RatingBadge({ r }: { r: ReturnType<typeof rating> }) {
  if (r === 'good') return <Badge tone="good">Good</Badge>
  if (r === 'ni') return <Badge tone="warn">Needs improvement</Badge>
  if (r === 'poor') return <Badge tone="poor">Poor</Badge>
  return null
}

function Distribution({ row }: { row: VitalRow }) {
  const parts = [
    { key: 'good', label: 'Good', value: row.good, color: 'var(--good)' },
    { key: 'ni', label: 'Needs improvement', value: row.needs_improvement, color: 'var(--warn)' },
    { key: 'poor', label: 'Poor', value: row.poor, color: 'var(--poor)' },
  ]
  const text = parts.map((p) => `${p.label} ${fmtPct(p.value)}`).join(', ')
  return (
    <div className="flex w-48 flex-col gap-1" title={text}>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={text}>
        {parts.map((p) => p.value > 0 && <div key={p.key} style={{ width: `${p.value * 100}%`, background: p.color }} />)}
      </div>
      <div className="flex justify-between text-[11px] text-ink-3 num" aria-hidden>
        <span>{fmtPct(row.good)}</span>
        <span>{fmtPct(row.needs_improvement)}</span>
        <span>{fmtPct(row.poor)}</span>
      </div>
    </div>
  )
}

export function PerformancePage() {
  const api = useApi()
  const { query, key } = useView()
  const q = useQuery(`perf|${key}`, () => api.performance(query))
  const [device, setDevice] = useState<string>('__all')

  const devices = [...new Set((q.data?.vitals ?? []).filter((v) => v.device_type !== null).map((v) => v.device_type as string))].sort()
  const tabs = [{ key: '__all', label: 'All devices' }, ...devices.map((d) => ({ key: d, label: capitalize(d) }))]
  const active = tabs.some((t) => t.key === device) ? device : '__all'

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Core Web Vitals"
        subtitle="75th percentile of real visits. Google counts a page as good when p75 is in the green band."
      >
        {devices.length > 0 && <Tabs label="Device" tabs={tabs} value={active} onChange={setDevice} className="mb-3" />}
        <QueryView q={q} isEmpty={(d) => d.vitals.length === 0} skeleton={<SkeletonRows rows={5} />} empty={<EmptyState text="No vitals reported for this range yet" />}>
          {(d) => {
            const rows = d.vitals
              .filter((v) => v.metric && (active === '__all' ? v.device_type === null : v.device_type === active))
              .sort((a, b) => ORDER.indexOf(a.metric ?? '') - ORDER.indexOf(b.metric ?? ''))
            if (rows.length === 0) return <EmptyState text="No vitals for this device" />
            return (
              <DataTable
                rows={rows}
                rowKey={(r) => `${r.metric}|${r.device_type}`}
                caption="Core Web Vitals"
                columns={[
                  {
                    key: 'metric', label: 'Metric', render: (r) => (
                      <span className="flex flex-col leading-tight">
                        <span className="font-medium">{VITALS[r.metric ?? '']?.label ?? r.metric}</span>
                        <span className="text-[12px] text-ink-3">{VITALS[r.metric ?? '']?.description ?? ''}</span>
                      </span>
                    ),
                  },
                  { key: 'p75', label: 'p75', align: 'right', render: (r) => <span className="font-medium">{fmtVital(r.metric ?? '', r.p75)}</span> },
                  { key: 'rating', label: 'Rating', render: (r) => <RatingBadge r={rating(r.metric ?? '', r.p75)} /> },
                  { key: 'dist', label: 'Good / NI / Poor', render: (r) => <Distribution row={r} /> },
                  { key: 'samples', label: 'Samples', align: 'right', render: (r) => fmtInt(r.samples) },
                ]}
              />
            )
          }}
        </QueryView>
      </Panel>

      <Panel title="JavaScript errors" subtitle="Grouped by message and source">
        <QueryView q={q} isEmpty={(d) => d.errors.length === 0} skeleton={<SkeletonRows rows={5} />} empty={<EmptyState text="No errors in this range" />}>
          {(d) => (
            <DataTable
              rows={d.errors}
              rowKey={(r) => `${r.message}|${r.source}`}
              defaultSort={{ key: 'count', dir: 'desc' }}
              caption="JavaScript errors"
              columns={[
                { key: 'message', label: 'Message', render: (r) => <span className="inline-block max-w-[420px] truncate align-middle font-mono text-[12px]" title={r.message ?? ''}>{r.message ?? '(no message)'}</span> },
                { key: 'source', label: 'Source', render: (r) => <span className="inline-block max-w-[220px] truncate align-middle font-mono text-[12px] text-ink-3" title={r.source ?? ''}>{r.source ?? '—'}</span> },
                { key: 'count', label: 'Count', align: 'right', sort: (r) => r.count, render: (r) => fmtInt(r.count) },
                { key: 'sessions', label: 'Sessions', align: 'right', sort: (r) => r.sessions, render: (r) => fmtInt(r.sessions) },
                { key: 'last', label: 'Last seen', sort: (r) => r.last_seen, render: (r) => <time dateTime={r.last_seen} title={fmtDateTime(r.last_seen)}>{fmtAgo(r.last_seen)}</time> },
              ]}
            />
          )}
        </QueryView>
      </Panel>
    </div>
  )
}
