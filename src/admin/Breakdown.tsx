import { useMemo, useState } from 'react'
import { Maximize2, Search } from 'lucide-react'
import { useApi, useQuery, useView } from './hooks'
import { useRoute } from './nav'
import { DIMENSION_LABELS, dimValue, flag, fmtDuration, fmtInt, fmtPct } from './format'
import { DEFS } from './definitions'
import type { BreakdownRow, Dimension } from './types'
import { Button, CsvButton, DataTable, Dialog, EmptyState, Panel, QueryView, RankedList, SkeletonRows, Tabs, inputClass, type Column } from './ui'

const DETAIL_LIMIT = 500

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

function breakdownCsv(dim: Dimension, rows: BreakdownRow[]) {
  return {
    header: [DIMENSION_LABELS[dim], 'Value', 'Visitors', 'Sessions', 'Page views', 'Engaged rate', 'Avg engagement (s)', 'Signups', 'Conversion rate'],
    rows: rows.map((r) => [dimValue(dim, r.value), r.value, r.visitors, r.sessions, r.pageviews, r.engaged_rate, r.avg_engagement_seconds, r.signups, r.conversion_rate]),
  }
}

/** CSV of the full breakdown (up to 500 rows) under the current range and filters. */
export function BreakdownCsv({ dim }: { dim: Dimension }) {
  const api = useApi()
  const { query, range } = useView()
  return (
    <CsvButton
      name={`${DIMENSION_LABELS[dim]} ${range.label}`}
      getRows={async () => breakdownCsv(dim, await api.breakdown(query, dim, DETAIL_LIMIT))}
    />
  )
}

export function BreakdownTable({ dim, rows, onPicked }: { dim: Dimension; rows: BreakdownRow[]; onPicked?: () => void }) {
  const { clauses, addFilter } = useView()
  const maxVisitors = Math.max(...rows.map((r) => r.visitors), 1)
  const active = clauses[dim]
  const columns: Column<BreakdownRow>[] = [
    {
      key: 'value', label: DIMENSION_LABELS[dim], sort: (r) => dimValue(dim, r.value),
      render: (r) => <DimLabel dim={dim} value={r.value} />,
    },
    {
      key: 'visitors', label: 'Visitors', align: 'right', sort: (r) => r.visitors, info: DEFS.visitors,
      render: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-hover sm:inline-block" aria-hidden>
            <span className="block h-full rounded-full bg-accent" style={{ width: `${(r.visitors / maxVisitors) * 100}%` }} />
          </span>
          <span className="min-w-[3.5ch]">{fmtInt(r.visitors)}</span>
        </span>
      ),
    },
    { key: 'sessions', label: 'Sessions', align: 'right', sort: (r) => r.sessions, render: (r) => fmtInt(r.sessions), info: DEFS.sessions },
    { key: 'engaged_rate', label: 'Engaged', align: 'right', sort: (r) => r.engaged_rate, render: (r) => fmtPct(r.engaged_rate), info: DEFS.engagedRate },
    { key: 'avg', label: 'Avg. engagement', align: 'right', sort: (r) => r.avg_engagement_seconds, render: (r) => fmtDuration(r.avg_engagement_seconds), info: DEFS.avgEngagement },
    { key: 'signups', label: 'Signups', align: 'right', sort: (r) => r.signups, render: (r) => fmtInt(r.signups), info: DEFS.rowSignups },
    { key: 'conversion_rate', label: 'Conv. rate', align: 'right', sort: (r) => r.conversion_rate, render: (r) => fmtPct(r.conversion_rate), info: DEFS.convRateRow },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.value}
      defaultSort={{ key: 'visitors', dir: 'desc' }}
      onRowClick={(r) => {
        if (!(active?.op === 'is' && active.values.includes(r.value))) addFilter(dim, r.value)
        onPicked?.()
      }}
      rowLabel={(r) => `Filter by ${DIMENSION_LABELS[dim]}: ${dimValue(dim, r.value)}`}
      caption={`Breakdown by ${DIMENSION_LABELS[dim]}`}
    />
  )
}

/** Full list (up to 500) with search, in a dialog (R13). */
function BreakdownDetail({ dim, open, onClose }: { dim: Dimension; open: boolean; onClose: () => void }) {
  const api = useApi()
  const { query, key, range } = useView()
  const [search, setSearch] = useState('')
  const q = useQuery(`detail|${dim}|${key}`, () => api.breakdown(query, dim, DETAIL_LIMIT), { enabled: open })
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    const all = q.data ?? []
    return s ? all.filter((r) => r.value.toLowerCase().includes(s) || dimValue(dim, r.value).toLowerCase().includes(s)) : all
  }, [q.data, search, dim])
  return (
    <Dialog open={open} onClose={onClose} title={`${DIMENSION_LABELS[dim]} · ${range.label}`} size="lg">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${DIMENSION_LABELS[dim].toLowerCase()}…`}
            aria-label={`Search ${DIMENSION_LABELS[dim]}`}
            data-autofocus
            className={`${inputClass} w-full pl-8`}
          />
        </div>
        <div className="flex items-center gap-2 text-[12px] text-ink-3">
          {q.data && <span className="num">{fmtInt(rows.length)} of {fmtInt(q.data.length)}{q.data.length >= DETAIL_LIMIT ? ' (first 500)' : ''}</span>}
          <CsvButton name={`${DIMENSION_LABELS[dim]} ${range.label}`} getRows={() => breakdownCsv(dim, rows)} />
        </div>
      </div>
      <div className="max-h-[60svh] overflow-y-auto px-4 -mx-4">
        <QueryView q={q} isEmpty={() => rows.length === 0} skeleton={<SkeletonRows rows={10} />} empty={<EmptyState text={search ? 'No matches' : undefined} />}>
          {() => <BreakdownTable dim={dim} rows={rows} onPicked={onClose} />}
        </QueryView>
      </div>
    </Dialog>
  )
}

function ExpandButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} aria-label={`Expand ${label}`} title="Expand: full list with search">
      <Maximize2 className="size-3.5" aria-hidden /> <span className="hidden sm:inline">Expand</span>
    </Button>
  )
}

/** A panel with dimension tabs (kept in the URL as ?tab=) over a breakdown table. */
export function BreakdownTabs<D extends Dimension>({ dims, title, subtitle }: { dims: readonly D[]; title: string; subtitle?: string }) {
  const { params, update } = useRoute()
  const tabParam = params.get('tab') as D | null
  const dim: D = tabParam && dims.includes(tabParam) ? tabParam : dims[0]
  const api = useApi()
  const { query, key } = useView()
  const [expanded, setExpanded] = useState(false)
  const q = useQuery(`breakdown|${dim}|${key}`, () => api.breakdown(query, dim, 100))
  return (
    <Panel
      title={title}
      subtitle={subtitle ?? 'Click a row to filter the whole dashboard by it.'}
      actions={<><BreakdownCsv dim={dim} /><ExpandButton label={DIMENSION_LABELS[dim]} onClick={() => setExpanded(true)} /></>}
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
        {q.data && q.data.length >= 100 && (
          <p className="mt-2 text-[12px] text-ink-3">Showing the top 100. Expand for up to 500 with search.</p>
        )}
      </div>
      <BreakdownDetail key={dim} dim={dim} open={expanded} onClose={() => setExpanded(false)} />
    </Panel>
  )
}

/** Compact top-N list for one dimension; rows add a filter. */
export function TopList({ dim, title, limit = 5, more }: { dim: Dimension; title: string; limit?: number; more?: { page: 'traffic' | 'audience'; label?: string } }) {
  const api = useApi()
  const { query, key, clauses, addFilter } = useView()
  const { go, params } = useRoute()
  const [expanded, setExpanded] = useState(false)
  const q = useQuery(`top|${dim}|${key}`, () => api.breakdown(query, dim, limit))
  const active = clauses[dim]
  return (
    <Panel
      title={title}
      actions={
        <>
          <BreakdownCsv dim={dim} />
          <ExpandButton label={title} onClick={() => setExpanded(true)} />
          {more && (
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
        </>
      }
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
            onSelect={(v) => { if (!(active?.op === 'is' && active.values.includes(v))) addFilter(dim, v) }}
          />
        )}
      </QueryView>
      <BreakdownDetail dim={dim} open={expanded} onClose={() => setExpanded(false)} />
    </Panel>
  )
}
