import { useApi, useQuery, useView } from '../hooks'
import { countryName, flag, fmtDate, fmtInt, fmtPct } from '../format'
import { ColumnChart } from '../charts'
import { Badge, DataTable, EmptyState, ErrorState, Panel, QueryView, Skeleton, SkeletonRows } from '../ui'

export function ReferralsPage() {
  const api = useApi()
  const { range } = useView()
  const q = useQuery(`referrals|${range.fromIso}|${range.toIso}`, () => api.referrals({ from: range.fromIso, to: range.toIso }))

  const kpis = q.data
    ? [
        { label: 'Signups', value: fmtInt(q.data.signups), hint: 'In this range' },
        { label: 'Referred signups', value: fmtInt(q.data.referred_signups), hint: 'Joined through an invite link' },
        { label: 'K-factor', value: fmtPct(q.data.k_factor), hint: 'Referred ÷ all signups in range' },
        { label: 'Active referrers', value: fmtInt(q.data.active_referrers), hint: 'People whose link brought someone in this range' },
        { label: 'Priority unlocked', value: fmtInt(q.data.priority_unlocked), hint: 'All time: people with 3+ invites' },
      ]
    : null

  return (
    <div className="flex flex-col gap-4">
      {q.error && !q.data ? (
        <div className="rounded-lg border border-line bg-panel"><ErrorState error={q.error} onRetry={q.reload} /></div>
      ) : (
        <section aria-label="Referral metrics" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-5">
          {(kpis ?? Array.from({ length: 5 }, () => null)).map((k, i) => (
            <div key={k?.label ?? i} className="min-w-0 bg-panel px-4 py-3.5 last:col-span-2 md:last:col-span-1">
              {k ? (
                <>
                  <p className="truncate text-[12.5px] text-ink-3">{k.label}</p>
                  <p className="mt-1 text-[22px] leading-7 font-semibold tracking-tight num">{k.value}</p>
                  <p className="mt-0.5 text-[12px] text-ink-3">{k.hint}</p>
                </>
              ) : (
                <>
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="mt-2 h-6 w-16" />
                </>
              )}
            </div>
          ))}
        </section>
      )}

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
                columns={[
                  { key: 'contact', label: 'Referrer', render: (r) => <span className="font-mono text-[12.5px]">{r.contact_masked}</span> },
                  { key: 'invites', label: 'Invites', align: 'right', sort: (r) => r.invites, render: (r) => fmtInt(r.invites) },
                  { key: 'range', label: 'In range', align: 'right', sort: (r) => r.invites_in_range, render: (r) => fmtInt(r.invites_in_range) },
                  { key: 'priority', label: 'Priority', render: (r) => (r.priority ? <Badge tone="good">Unlocked</Badge> : <span className="text-ink-3">—</span>) },
                  { key: 'channel', label: 'Channel', sort: (r) => r.channel ?? '', render: (r) => r.channel ?? '—' },
                  { key: 'country', label: 'Country', render: (r) => (r.country ? `${flag(r.country)} ${countryName(r.country)}` : '—') },
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
              columns={[
                { key: 'contact', label: 'Referrer', render: (r) => <span className="font-mono text-[12.5px]">{r.contact_masked}</span> },
                { key: 'invites', label: 'Invites', align: 'right', sort: (r) => r.invites, render: (r) => fmtInt(r.invites) },
                { key: 'shared', label: 'Same network', align: 'right', sort: (r) => r.shared, render: (r) => fmtInt(r.shared) },
                { key: 'share', label: 'Share', align: 'right', sort: (r) => (r.invites ? r.shared / r.invites : 0), render: (r) => fmtPct(r.invites ? r.shared / r.invites : 0) },
                { key: 'code', label: 'Referral code', render: (r) => <span className="font-mono text-[11.5px] text-ink-3">{r.code}</span> },
              ]}
            />
          )}
        </QueryView>
      </Panel>
    </div>
  )
}
