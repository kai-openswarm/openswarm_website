import { useApi, useQuery, useView } from '../hooks'
import { SECTION_LABELS, eventName, fmtInt, fmtPct } from '../format'
import type { Engagement } from '../types'
import { CsvButton, DataTable, EmptyState, Panel, QueryView, RankedList, SkeletonRows } from '../ui'

function RateBars({ rows }: { rows: { key: string; label: string; sessions: number; rate: number }[] }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 text-ink-2 num">
              {fmtPct(r.rate)} <span className="text-ink-3">· {fmtInt(r.sessions)}</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-hover" aria-hidden>
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(1, r.rate) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

const countCols = <T extends { count: number; sessions: number }>(label: string, name: (r: T) => string) => [
  { key: 'name', label, sort: (r: T) => name(r), render: (r: T) => <span className="inline-block max-w-[200px] truncate align-middle sm:max-w-[240px]" title={name(r)}>{name(r)}</span> },
  { key: 'count', label: 'Count', align: 'right' as const, sort: (r: T) => r.count, render: (r: T) => fmtInt(r.count) },
  { key: 'sessions', label: 'Sessions', align: 'right' as const, sort: (r: T) => r.sessions, render: (r: T) => fmtInt(r.sessions) },
]

export function Behavior() {
  const api = useApi()
  const { query, key } = useView()
  const q = useQuery(`engagement|${key}`, () => api.engagement(query))
  const noSessions = (d: Engagement) => d.total_sessions === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Section reach" subtitle="Share of sessions that scrolled each section into view" actions={q.data && <CsvButton name="section reach" getRows={() => ({ header: ['Section', 'Sessions', 'Rate'], rows: (q.data?.sections ?? []).map((x) => [SECTION_LABELS[x.section] ?? x.section, x.sessions, x.rate]) })} />}>
          <QueryView q={q} isEmpty={noSessions} skeleton={<SkeletonRows rows={6} />}>
            {(d) => (
              <RateBars rows={[...d.sections].sort((a, b) => a.ord - b.ord).map((s) => ({ key: s.section, label: SECTION_LABELS[s.section] ?? s.section, sessions: s.sessions, rate: s.rate }))} />
            )}
          </QueryView>
        </Panel>
        <Panel title="Scroll depth" subtitle="Share of sessions that scrolled at least this far" actions={q.data && <CsvButton name="scroll depth" getRows={() => ({ header: ['Depth %', 'Sessions', 'Rate'], rows: (q.data?.scroll ?? []).map((x) => [x.depth, x.sessions, x.rate]) })} />}>
          <QueryView q={q} isEmpty={noSessions} skeleton={<SkeletonRows rows={5} />}>
            {(d) => <RateBars rows={d.scroll.map((s) => ({ key: String(s.depth), label: `${s.depth}%`, sessions: s.sessions, rate: s.rate }))} />}
          </QueryView>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Use-case tabs" subtitle="Tabs opened, by group">
          <QueryView q={q} isEmpty={(d) => d.tabs.length === 0} skeleton={<SkeletonRows />}>
            {(d) => (
              <RankedList valueLabel="Opens" csv={{ name: 'use-case tabs', nameHeader: 'Tab' }} items={d.tabs.map((t) => ({ key: t.tab, label: t.tab, title: t.tab, value: t.count, display: <>{fmtInt(t.count)} <span className="text-ink-3">· {fmtInt(t.sessions)} sess.</span></> }))} />
            )}
          </QueryView>
        </Panel>
        <Panel title="Top clicks" subtitle="Tracked buttons and links">
          <QueryView q={q} isEmpty={(d) => d.clicks.length === 0} skeleton={<SkeletonRows />}>
            {(d) => (
              <RankedList limit={12} valueLabel="Clicks" csv={{ name: 'top clicks', nameHeader: 'Target' }} items={d.clicks.map((c) => ({ key: c.target, label: c.target, title: c.target, value: c.count, display: <>{fmtInt(c.count)} <span className="text-ink-3">· {fmtInt(c.sessions)} sess.</span></> }))} />
            )}
          </QueryView>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Outbound links">
          <QueryView q={q} isEmpty={(d) => d.outbound.length === 0} skeleton={<SkeletonRows />} empty={<EmptyState text="No outbound clicks in this range" />}>
            {(d) => (
              <DataTable
                rows={d.outbound}
                rowKey={(r) => r.href ?? '(none)'}
                defaultSort={{ key: 'count', dir: 'desc' }}
                columns={countCols<Engagement['outbound'][number]>('Link', (r) => (r.href ?? '(none)').replace(/^https?:\/\//, ''))}
                caption="Outbound links"
                csvName="outbound links"
              />
            )}
          </QueryView>
        </Panel>
        <Panel title="All events" subtitle="Every tracked event in sessions from this range">
          <QueryView q={q} isEmpty={(d) => d.events.length === 0} skeleton={<SkeletonRows rows={8} />}>
            {(d) => (
              <DataTable
                rows={d.events}
                rowKey={(r) => r.name}
                defaultSort={{ key: 'count', dir: 'desc' }}
                dense
                columns={[
                  { key: 'name', label: 'Event', sort: (r) => eventName(r.name), render: (r) => <span title={r.name}>{eventName(r.name)}</span> },
                  { key: 'count', label: 'Count', align: 'right', sort: (r) => r.count, render: (r) => fmtInt(r.count) },
                  { key: 'sessions', label: 'Sessions', align: 'right', sort: (r) => r.sessions, render: (r) => fmtInt(r.sessions) },
                ]}
                caption="All events"
                csvName="all events"
              />
            )}
          </QueryView>
        </Panel>
      </div>
    </div>
  )
}
