import { useApi, useQuery, useView } from './hooks'
import { useRoute } from './nav'
import { DIMENSION_LABELS, dimValue, flag, fmtDuration, fmtInt, fmtPct } from './format'
import type { BreakdownRow, Dimension } from './types'
import { DataTable, EmptyState, Panel, QueryView, RankedList, SkeletonRows, Tabs, type Column } from './ui'

/** Label cell content for a dimension value (flags for countries). */
export function DimLabel({ dim, value }: { dim: Dimension; value: string }) {
  const f = dim === 'country' ? flag(value) : ''
  return (
    <span className="inline-flex max-w-[280px] items-center gap-1.5 truncate">
      {f && <span aria-hidden>{f}</span>}
      <span className="truncate">{dimValue(dim, value)}</span>
    </span>
  )
}

export function BreakdownTable({ dim, rows }: { dim: Dimension; rows: BreakdownRow[] }) {
  const { filters, addFilter } = useView()
  const maxVisitors = Math.max(...rows.map((r) => r.visitors), 1)
  const filtered = filters[dim] !== undefined
  const columns: Column<BreakdownRow>[] = [
    {
      key: 'value', label: DIMENSION_LABELS[dim], sort: (r) => dimValue(dim, r.value),
      render: (r) => <DimLabel dim={dim} value={r.value} />,
    },
    {
      key: 'visitors', label: 'Visitors', align: 'right', sort: (r) => r.visitors,
      render: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-hover sm:inline-block" aria-hidden>
            <span className="block h-full rounded-full bg-accent" style={{ width: `${(r.visitors / maxVisitors) * 100}%` }} />
          </span>
          <span className="min-w-[3.5ch]">{fmtInt(r.visitors)}</span>
        </span>
      ),
    },
    { key: 'sessions', label: 'Sessions', align: 'right', sort: (r) => r.sessions, render: (r) => fmtInt(r.sessions) },
    { key: 'engaged_rate', label: 'Engaged', align: 'right', sort: (r) => r.engaged_rate, render: (r) => fmtPct(r.engaged_rate) },
    { key: 'avg', label: 'Avg. engagement', align: 'right', sort: (r) => r.avg_engagement_seconds, render: (r) => fmtDuration(r.avg_engagement_seconds) },
    { key: 'signups', label: 'Signups', align: 'right', sort: (r) => r.signups, render: (r) => fmtInt(r.signups) },
    { key: 'conversion_rate', label: 'Conv. rate', align: 'right', sort: (r) => r.conversion_rate, render: (r) => fmtPct(r.conversion_rate) },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.value}
      defaultSort={{ key: 'visitors', dir: 'desc' }}
      onRowClick={filtered ? undefined : (r) => addFilter(dim, r.value)}
      rowLabel={(r) => `Filter by ${DIMENSION_LABELS[dim]}: ${dimValue(dim, r.value)}`}
      caption={`Breakdown by ${DIMENSION_LABELS[dim]}`}
    />
  )
}

/** A panel with dimension tabs (kept in the URL as ?tab=) over a breakdown table. */
export function BreakdownTabs<D extends Dimension>({ dims, title, subtitle }: { dims: readonly D[]; title: string; subtitle?: string }) {
  const { params, update } = useRoute()
  const tabParam = params.get('tab') as D | null
  const dim: D = tabParam && dims.includes(tabParam) ? tabParam : dims[0]
  const api = useApi()
  const { query, key } = useView()
  const q = useQuery(`breakdown|${dim}|${key}`, () => api.breakdown(query, dim, 100))
  return (
    <Panel
      title={title}
      subtitle={subtitle ?? 'Click a row to filter the whole dashboard by it.'}
    >
      <Tabs
        label="Dimension"
        tabs={dims.map((d) => ({ key: d, label: DIMENSION_LABELS[d] }))}
        value={dim}
        onChange={(d) => update((p) => p.set('tab', d), true)}
        className="mb-3"
      />
      <div role="tabpanel" aria-label={DIMENSION_LABELS[dim]}>
        <QueryView q={q} isEmpty={(rows) => rows.length === 0} skeleton={<SkeletonRows rows={8} />}>
          {(rows) => <BreakdownTable dim={dim} rows={rows} />}
        </QueryView>
      </div>
    </Panel>
  )
}

/** Compact top-N list for one dimension; rows add a filter. */
export function TopList({ dim, title, limit = 5, more }: { dim: Dimension; title: string; limit?: number; more?: { page: 'traffic' | 'audience'; label?: string } }) {
  const api = useApi()
  const { query, key, filters, addFilter } = useView()
  const { go, params } = useRoute()
  const q = useQuery(`top|${dim}|${key}`, () => api.breakdown(query, dim, limit))
  const filtered = filters[dim] !== undefined
  return (
    <Panel
      title={title}
      actions={more && (
        <button
          type="button"
          className="text-[12.5px] text-ink-3 hover:text-ink hover:underline"
          onClick={() => {
            const p = new URLSearchParams(params)
            p.set('tab', dim)
            go(more.page, p)
          }}
        >
          {more.label ?? 'View all'}
        </button>
      )}
    >
      <QueryView q={q} isEmpty={(r) => r.length === 0} skeleton={<SkeletonRows rows={limit} />} empty={<EmptyState />}>
        {(rows) => (
          <RankedList
            valueLabel="Visitors"
            items={[...rows].sort((x, y) => y.visitors - x.visitors).map((r) => ({
              key: r.value,
              label: <DimLabel dim={dim} value={r.value} />,
              title: dimValue(dim, r.value),
              value: r.visitors,
              display: fmtInt(r.visitors),
            }))}
            onSelect={filtered ? undefined : (v) => addFilter(dim, v)}
          />
        )}
      </QueryView>
    </Panel>
  )
}
