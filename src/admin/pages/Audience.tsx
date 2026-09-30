import { Component, Suspense, lazy, type ReactNode } from 'react'
import { useApi, useQuery, useView } from '../hooks'
import { BreakdownCsv, BreakdownTabs } from '../Breakdown'
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
    <Panel title={title} subtitle="Unique visitors" actions={<BreakdownCsv dim={dim} />}>
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

// The country outlines are about 110 KB, so they load only when this page is opened.
const WorldMap = lazy(() => import('../WorldMap'))

/** A stale tab can fail to fetch the map's code after a redeploy; keep that to this panel instead of a blank page. */
class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed
      ? <EmptyState text="The map couldn’t load" hint="Reload the page to try again. The table below has the same numbers." />
      : this.props.children
  }
}

function MapPanel() {
  const api = useApi()
  const { query, key, clauses, addFilter } = useView()
  const q = useQuery(`map|country|${key}`, () => api.breakdown(query, 'country', 500))
  const active = clauses.country
  return (
    <Panel title="Where visitors are" subtitle="Unique visitors by country. Click a country to filter the whole dashboard by it." actions={<BreakdownCsv dim="country" />}>
      <QueryView q={q} isEmpty={(r) => r.length === 0} skeleton={<Skeleton className="aspect-[960/470] w-full" />} empty={<EmptyState />}>
        {(rows) => (
          <MapBoundary>
            <Suspense fallback={<Skeleton className="aspect-[960/470] w-full" />}>
              <WorldMap
                data={rows.map((r) => ({ code: r.value, value: r.visitors }))}
                onSelect={(code) => { if (!(active?.op === 'is' && active.values.includes(code))) addFilter('country', code) }}
              />
            </Suspense>
          </MapBoundary>
        )}
      </QueryView>
    </Panel>
  )
}

export function Audience() {
  return (
    <div className="flex flex-col gap-4">
      <MapPanel />
      <div className="grid gap-4 md:grid-cols-2">
        <DonutPanel dim="device_type" title="Device" />
        <DonutPanel dim="is_new_visitor" title="New vs returning" />
      </div>
      <BreakdownTabs dims={DIMS} title="Audience details" />
    </div>
  )
}
