import { useEffect, useState } from 'react'
import { Monitor, Smartphone, Tablet } from 'lucide-react'
import { useApi, useQuery } from '../hooks'
import { capitalize, countryName, eventDetail, eventName, flag, fmtInt, fmtTimeSec } from '../format'
import { MinuteBars } from '../charts'
import { EmptyState, Panel, QueryView, RankedList, Skeleton, SkeletonRows } from '../ui'
import type { RealtimeEvent } from '../types'

const REFRESH_MS = 15_000

export function Realtime() {
  const api = useApi()
  const q = useQuery('realtime', async () => ({ ...(await api.realtime()), fetchedAt: new Date() }), { refreshMs: REFRESH_MS })
  const updatedAt = q.data?.fetchedAt
  const [visible, setVisible] = useState(document.visibilityState === 'visible')

  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-[12px] text-ink-3" aria-live="polite">
        <span className={`inline-block size-2 rounded-full ${visible ? 'bg-good' : 'bg-ink-3'}`} aria-hidden />
        {visible ? 'Live' : 'Paused while this tab is hidden'}
        {updatedAt && <span>· Updated {fmtTimeSec(updatedAt)}</span>}
      </p>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Panel title="Active visitors" subtitle="In the last 5 minutes">
          <QueryView q={q} skeleton={<Skeleton className="h-16 w-32" />}>
            {(d) => (
              <div>
                <p className="text-[48px] leading-none font-semibold tracking-tight num">{fmtInt(d.active_visitors)}</p>
                <p className="mt-2 text-[12.5px] text-ink-3 num">{fmtInt(d.active_sessions)} active sessions</p>
              </div>
            )}
          </QueryView>
        </Panel>
        <Panel title="Visitors per minute" subtitle="Last 30 minutes">
          <QueryView q={q} skeleton={<Skeleton className="h-[140px]" />}>
            {(d) => <MinuteBars data={d.per_minute} />}
          </QueryView>
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Panel title="Countries">
          <QueryView q={q} isEmpty={(d) => d.countries.length === 0} empty={<EmptyState text="Nobody here right now" />}>
            {(d) => (
              <RankedList
                valueLabel="Visitors"
                items={d.countries.map((c) => ({
                  key: c.country, value: c.visitors, display: fmtInt(c.visitors), title: countryName(c.country),
                  label: <span className="truncate">{flag(c.country)} {countryName(c.country)}</span>,
                }))}
              />
            )}
          </QueryView>
        </Panel>
        <Panel title="Sources">
          <QueryView q={q} isEmpty={(d) => d.sources.length === 0} empty={<EmptyState text="Nobody here right now" />}>
            {(d) => <RankedList valueLabel="Visitors" items={d.sources.map((s) => ({ key: s.source, label: s.source, title: s.source, value: s.visitors, display: fmtInt(s.visitors) }))} />}
          </QueryView>
        </Panel>
        <Panel title="Devices">
          <QueryView q={q} isEmpty={(d) => d.devices.length === 0} empty={<EmptyState text="Nobody here right now" />}>
            {(d) => <RankedList valueLabel="Visitors" items={d.devices.map((s) => ({ key: s.device_type, label: capitalize(s.device_type), value: s.visitors, display: fmtInt(s.visitors) }))} />}
          </QueryView>
        </Panel>
      </div>

      <Panel title="Live events" subtitle="Most recent 40 events in the last 30 minutes (engagement pings and vitals hidden)">
        <QueryView q={q} isEmpty={(d) => d.recent.length === 0} skeleton={<SkeletonRows rows={8} />} empty={<EmptyState text="No events in the last 30 minutes" />}>
          {(d) => (
            <ol className="-mx-4 divide-y divide-line">
              {d.recent.map((e, i) => <EventRow key={`${e.occurred_at}-${i}`} e={e} />)}
            </ol>
          )}
        </QueryView>
      </Panel>
    </div>
  )
}

function DeviceIcon({ type }: { type: string | null }) {
  const Icon = type === 'mobile' ? Smartphone : type === 'tablet' ? Tablet : Monitor
  return <Icon className="size-3.5 shrink-0 text-ink-3" aria-label={type ?? 'unknown device'} />
}

function EventRow({ e }: { e: RealtimeEvent }) {
  const detail = eventDetail(e.name, e.props)
  const place = [e.city, e.country ? countryName(e.country) : null].filter(Boolean).join(', ')
  return (
    <li className="flex flex-col gap-0.5 px-4 py-2 text-[13px] sm:flex-row sm:items-center sm:gap-3">
      <time dateTime={e.occurred_at} className="w-24 shrink-0 text-[12px] text-ink-3 num">{fmtTimeSec(e.occurred_at)}</time>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{eventName(e.name)}</span>
        {detail && <span className="text-ink-2"> · {detail}</span>}
      </span>
      <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-[12px] text-ink-3 sm:max-w-[45%]">
        <DeviceIcon type={e.device_type} />
        <span className="truncate">{flag(e.country)} {place || 'Unknown location'} · {e.source}</span>
      </span>
    </li>
  )
}
