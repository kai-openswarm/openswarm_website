import { useApi, useQuery, useView } from '../hooks'
import { BreakdownTabs } from '../Breakdown'
import { Donut } from '../charts'
import { dimValue } from '../format'
import type { Dimension } from '../types'
import { EmptyState, Panel, QueryView, Skeleton } from '../ui'

const DIMS = [
  'country', 'region', 'city', 'device_type', 'browser', 'os', 'screen', 'language', 'timezone', 'is_new_visitor',
] as const

function DonutPanel({ dim, title }: { dim: Dimension; title: string }) {
  const api = useApi()
  const { query, key, filters, addFilter } = useView()
  const q = useQuery(`donut|${dim}|${key}`, () => api.breakdown(query, dim, 20))
  return (
    <Panel title={title} subtitle="Unique visitors">
      <QueryView q={q} isEmpty={(r) => r.length === 0} skeleton={<Skeleton className="h-36" />} empty={<EmptyState />}>
        {(rows) => (
          <Donut
            label={title}
            items={rows.map((r) => ({ key: r.value, label: dimValue(dim, r.value), value: r.visitors }))}
            onSelect={filters[dim] !== undefined ? undefined : (v) => addFilter(dim, v)}
          />
        )}
      </QueryView>
    </Panel>
  )
}

export function Audience() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <DonutPanel dim="device_type" title="Device" />
        <DonutPanel dim="is_new_visitor" title="New vs returning" />
      </div>
      <BreakdownTabs dims={DIMS} title="Audience details" />
    </div>
  )
}
