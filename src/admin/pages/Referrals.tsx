import { useApi, useNow, useQuery, useView } from '../hooks'
import { countryName, flag, fmtDate, fmtDec, fmtInt, fmtPct } from '../format'
import { ColumnChart, Donut, StackedBars } from '../charts'
import { SERIES } from '../chartUtil'
import { DEFS } from '../definitions'
import type { Referrals } from '../types'
import { Badge, CsvButton, DataTable, EmptyState, ErrorState, InfoTip, Panel, QueryView, Skeleton, SkeletonRows } from '../ui'

/** Fixed colour order for share channels, so a channel keeps its colour between ranges. */
const SHARE_CHANNELS = ['native', 'copy', 'sms', 'whatsapp', 'x', 'email']
const SHARE_LABELS: Record<string, string> = { native: 'Share sheet', copy: 'Copy link', sms: 'SMS', whatsapp: 'WhatsApp', x: 'X', email: 'Email' }
const shareLabel = (c: string) => SHARE_LABELS[c] ?? c

function channelOrder(chs: string[]) {
  const known = SHARE_CHANNELS.filter((c) => chs.includes(c))
  const other = chs.filter((c) => !SHARE_CHANNELS.includes(c)).sort()
  return [...known, ...other]
}

function colorFor(label: string) {
  const key = Object.entries(SHARE_LABELS).find(([, v]) => v === label)?.[0] ?? label
  const i = SHARE_CHANNELS.indexOf(key)
  return i >= 0 ? SERIES[i] : 'var(--c-other)'
}

function Tile({ label, value, sub, info }: { label: string; value: string; sub?: string; info: string }) {
  return (
    <div className="relative min-w-0 bg-panel px-4 py-3.5 pr-8">
      <p className="text-[12.5px] leading-tight text-ink-3">{label}</p>
      <p className="mt-1 text-[22px] leading-7 font-semibold tracking-tight num">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-ink-3">{sub}</p>}
      <span className="absolute top-3.5 right-3 flex"><InfoTip text={info} label={`${label} definition`} /></span>
    </div>
  )
}

function LoopFunnel({ steps }: { steps: Referrals['loop_funnel'] }) {
  const top = steps[0]?.people ?? 0
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].people : null
        const share = top ? s.people / top : 0
        return (
          <li key={s.key}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
              <span className="font-medium"><span className="mr-1.5 text-ink-3 num">{i + 1}.</span>{s.label}</span>
              <span className="text-ink-2 num">
                <span className="font-semibold text-ink">{fmtInt(s.people)}</span>
                <span className="text-ink-3"> · {fmtPct(share)}{prev ? ` · ${fmtPct(Math.min(1, s.people / prev))} of previous` : ''}</span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-hover" aria-hidden>
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(1, share) * 100}%` }} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function ReferralsPage() {
  const api = useApi()
  const { range } = useView()
  const r = { from: range.fromIso, to: range.toIso }
  const q = useQuery(`referrals|${r.from}|${r.to}`, () => api.referrals(r))
  const annotations = useQuery(`ann|${r.from}|${r.to}`, () => api.annotations(r))
  const d = q.data
  const now = useNow(60_000)

  return (
    <div className="flex flex-col gap-4">
      {q.error && !d ? (
        <div className="rounded-lg border border-line bg-panel"><ErrorState error={q.error} onRetry={q.reload} /></div>
      ) : (
        <section aria-label="Referral metrics" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
          {d ? (
            <>
              <div className="relative col-span-2 min-w-0 bg-panel px-4 py-3.5 pr-8">
                <p className="text-[12.5px] text-ink-3">K (viral coefficient)</p>
                <p className="mt-1 text-[28px] leading-8 font-semibold tracking-tight num">{fmtDec(d.classic_k)}</p>
                <p className="mt-1 text-[12.5px] text-ink-2 num">
                  = <span className="font-medium text-ink">{fmtDec(d.invite_visits_per_signup)}</span> invite visits per signup
                  {' '}<InfoTip text={DEFS.inviteVisitsPerSignup} label="Invite visits per signup definition" />
                  {' '}× <span className="font-medium text-ink">{fmtPct(d.invite_conversion)}</span> invite conversion
                  {' '}<InfoTip text={DEFS.inviteConversion} label="Invite conversion definition" />
                </p>
                <p className="mt-0.5 text-[12px] text-ink-3">Cohort: the {fmtInt(d.signups)} people who joined in this range.</p>
                <span className="absolute top-3.5 right-3 flex"><InfoTip text={DEFS.classicK} label="K definition" /></span>
              </div>
              <Tile label="Referral rate" value={fmtPct(d.referral_rate)} sub="of the cohort brought someone" info={DEFS.referralRate} />
              <Tile label="Invites per active referrer" value={fmtDec(d.invites_per_active_referrer)} info={DEFS.invitesPerReferrer} />
              <Tile label="Signups" value={fmtInt(d.signups)} sub="in this range" info={DEFS.signups} />
              <Tile label="Referred share" value={fmtPct(d.referred_share)} sub={`${fmtInt(d.referred_signups)} referred signups`} info={DEFS.referredShare} />
              <Tile label="Active referrers" value={fmtInt(d.active_referrers)} sub="in this range" info={DEFS.activeReferrers} />
              <Tile label="Priority unlocked" value={fmtInt(d.priority_unlocked)} sub="all time, 3+ invites" info={DEFS.priorityUnlocked} />
            </>
          ) : (
            Array.from({ length: 7 }, (_, i) => (
              <div key={i} className={`min-w-0 bg-panel px-4 py-3.5 ${i === 0 ? 'col-span-2' : ''}`}>
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="mt-2 h-6 w-16" />
              </div>
            ))
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Referral loop"
          subtitle="What the people who joined in this range did next"
          actions={d && <CsvButton name="referral loop" getRows={() => ({ header: ['Step', 'People'], rows: (d?.loop_funnel ?? []).map((x) => [x.label, x.people]) })} />}
        >
          <QueryView q={q} skeleton={<SkeletonRows rows={6} />} isEmpty={(x) => (x.loop_funnel[0]?.people ?? 0) === 0}>
            {(x) => <LoopFunnel steps={x.loop_funnel} />}
          </QueryView>
        </Panel>
        <Panel
          title="Shares by channel"
          subtitle="Invite link copies and shares in this range"
          actions={d && <CsvButton name="shares by channel" getRows={() => ({ header: ['Channel', 'Shares'], rows: (d?.shares_by_channel ?? []).map((x) => [x.channel, x.shares]) })} />}
        >
          <QueryView q={q} skeleton={<Skeleton className="h-36" />} isEmpty={(x) => x.shares_by_channel.length === 0} empty={<EmptyState text="No shares in this range" />}>
            {(x) => {
              const order = channelOrder(x.shares_by_channel.map((c) => c.channel))
              const by = Object.fromEntries(x.shares_by_channel.map((c) => [c.channel, c.shares]))
              return <Donut label="Shares by channel" valueLabel="Shares" colorFor={colorFor} items={order.map((c) => ({ key: c, label: shareLabel(c), value: by[c] ?? 0 }))} />
            }}
          </QueryView>
        </Panel>
      </div>

      <Panel
        title="Shares over time"
        subtitle="By day and channel"
        actions={d && <CsvButton name="shares by day" getRows={() => ({ header: ['Day', 'Channel', 'Shares'], rows: (d?.shares_by_day ?? []).map((x) => [x.day, x.channel, x.shares]) })} />}
      >
        <QueryView q={q} skeleton={<Skeleton className="h-[220px]" />} isEmpty={(x) => x.shares_by_day.length === 0} empty={<EmptyState text="No shares in this range" />}>
          {(x) => {
            const order = channelOrder([...new Set(x.shares_by_day.map((s) => s.channel))])
            const days = new Map<string, Record<string, number>>()
            // Every day in the range, so gaps show as gaps.
            for (let t = new Date(range.from); t < range.to && t.getTime() <= now; t.setDate(t.getDate() + 1)) {
              const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
              days.set(key, {})
            }
            for (const s of x.shares_by_day) {
              const row = days.get(s.day) ?? {}
              row[shareLabel(s.channel)] = (row[shareLabel(s.channel)] ?? 0) + s.shares
              days.set(s.day, row)
            }
            const data = [...days.entries()].sort(([a2], [b2]) => a2.localeCompare(b2)).map(([day, row]) => ({ day, ...row }))
            return <StackedBars data={data} keys={order.map(shareLabel)} colorFor={colorFor} label="Shares per day by channel" annotations={annotations.data ?? []} />
          }}
        </QueryView>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Panel title="Invites per person" subtitle="Successful invites per person, all time">
          <QueryView q={q} skeleton={<Skeleton className="h-[200px]" />} isEmpty={(d) => d.distribution.every((b) => b.people === 0)}>
            {(d) => <ColumnChart data={d.distribution.map((b) => ({ label: b.bucket, value: b.people }))} label="People by number of successful invites" valueLabel="People" />}
          </QueryView>
        </Panel>
        <Panel title="Leaderboard" subtitle="Top 25 referrers, all time. “In range” counts invitees who joined in the selected range.">
          <QueryView q={q} isEmpty={(d) => d.leaderboard.length === 0} skeleton={<SkeletonRows rows={8} />} empty={<EmptyState text="Nobody has invited anyone yet" />}>
            {(d) => (
              <DataTable
                rows={d.leaderboard}
                rowKey={(r) => r.code}
                defaultSort={{ key: 'invites', dir: 'desc' }}
                caption="Referral leaderboard"
                csvName="referral leaderboard"
                columns={[
                  { key: 'contact', label: 'Referrer', csv: (r) => r.contact_masked, render: (r) => <span className="font-mono text-[12.5px]">{r.contact_masked}</span> },
                  { key: 'invites', label: 'Invites', align: 'right', sort: (r) => r.invites, render: (r) => fmtInt(r.invites) },
                  { key: 'range', label: 'In range', align: 'right', sort: (r) => r.invites_in_range, render: (r) => fmtInt(r.invites_in_range) },
                  { key: 'priority', label: 'Priority', csv: (r) => r.priority, render: (r) => (r.priority ? <Badge tone="good">Unlocked</Badge> : <span className="text-ink-3">—</span>) },
                  { key: 'channel', label: 'Channel', sort: (r) => r.channel ?? '', render: (r) => r.channel ?? '—' },
                  { key: 'country', label: 'Country', csv: (r) => r.country, render: (r) => (r.country ? `${flag(r.country)} ${countryName(r.country)}` : '—') },
                  { key: 'joined', label: 'Joined', sort: (r) => r.joined_at, render: (r) => fmtDate(r.joined_at) },
                ]}
              />
            )}
          </QueryView>
        </Panel>
      </div>

      <Panel
        title="Possible self-referrals"
        subtitle="Referrers with two or more invitees who signed up from the same network as the referrer or as each other. Shared networks (offices, campuses, mobile carriers) can be innocent, so review before acting."
      >
        <QueryView q={q} isEmpty={(d) => d.suspicious.length === 0} skeleton={<SkeletonRows rows={3} />} empty={<EmptyState text="Nothing suspicious found" />}>
          {(d) => (
            <DataTable
              rows={d.suspicious}
              rowKey={(r) => r.code}
              defaultSort={{ key: 'shared', dir: 'desc' }}
              caption="Possible self-referrals"
              csvName="possible self-referrals"
              columns={[
                { key: 'contact', label: 'Referrer', csv: (r) => r.contact_masked, render: (r) => <span className="font-mono text-[12.5px]">{r.contact_masked}</span> },
                { key: 'invites', label: 'Invites', align: 'right', sort: (r) => r.invites, render: (r) => fmtInt(r.invites) },
                { key: 'shared', label: 'Same network', align: 'right', sort: (r) => r.shared, render: (r) => fmtInt(r.shared) },
                { key: 'share', label: 'Share', align: 'right', sort: (r) => (r.invites ? r.shared / r.invites : 0), render: (r) => fmtPct(r.invites ? r.shared / r.invites : 0) },
                { key: 'code', label: 'Referral code', csv: (r) => r.code, render: (r) => <span className="font-mono text-[11.5px] text-ink-3">{r.code}</span> },
              ]}
            />
          )}
        </QueryView>
      </Panel>
    </div>
  )
}
