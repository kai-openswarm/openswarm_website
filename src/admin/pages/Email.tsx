import { useState } from 'react'
import { AlertTriangle, Ban, Loader2 } from 'lucide-react'
import { useApi, useQuery, useView } from '../hooks'
import { useRoute } from '../nav'
import { fmtAgo, fmtDateTime, fmtInt, fmtPct } from '../format'
import { errorMessage } from '../errors'
import { MAJOR_PROVIDERS, MAX_BLOCKED_DOMAINS } from '../validation'
import { Badge, Button, DataTable, Dialog, EmptyState, ErrorState, InfoTip, Panel, QueryView, Skeleton, SkeletonRows } from '../ui'

function Tile({ label, value, sub, info, tone }: { label: string; value: string; sub?: string; info: string; tone?: 'poor' }) {
  return (
    <div className="relative min-w-0 bg-panel px-4 py-3.5 pr-8">
      <p className="text-[12.5px] leading-tight text-ink-3">{label}</p>
      <p className={`mt-1 text-[22px] leading-7 font-semibold tracking-tight num ${tone === 'poor' ? 'text-down' : ''}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-ink-3">{sub}</p>}
      <span className="absolute top-3.5 right-3 flex"><InfoTip text={info} label={`${label} definition`} /></span>
    </div>
  )
}

export function EmailPage() {
  const api = useApi()
  const { range } = useView()
  const { go } = useRoute()
  const r = { from: range.fromIso, to: range.toIso }
  const q = useQuery(`email|${r.from}|${r.to}`, () => api.emailReport(r))
  const settings = useQuery('settings', () => api.settings())
  const [blocking, setBlocking] = useState<{ domain: string; signups: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const blocked = new Set(settings.data?.settings.blocked_email_domains ?? [])
  const welcomeOn = settings.data?.settings.welcome_email?.enabled === true
  const d = q.data
  const attempts = d ? d.welcome.sent + d.welcome.failed : 0

  async function block() {
    if (!blocking) return
    setBusy(true)
    setErr(null)
    try {
      // Read the latest list right before writing, so a concurrent edit is not lost.
      const fresh = await api.settings()
      const list = fresh.settings.blocked_email_domains ?? []
      if (!list.includes(blocking.domain)) {
        if (list.length >= MAX_BLOCKED_DOMAINS) throw new Error(`The block list is full (${MAX_BLOCKED_DOMAINS} domains). Remove some in Settings first.`)
        await api.updateSetting('blocked_email_domains', [...list, blocking.domain])
      }
      setNotice(`Blocked ${blocking.domain}. New signups from it will be rejected; existing signups are kept.`)
      setBlocking(null)
      settings.reload()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {settings.data && !welcomeOn && (
        <p className="rounded-lg border border-line bg-panel px-4 py-2.5 text-[13px] text-ink-2">
          The welcome email is off.{' '}
          <button type="button" className="font-medium text-ink underline" onClick={() => go('settings')}>Set it up in Settings</button>.
        </p>
      )}
      {notice && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel px-4 py-2.5 text-[13px]">
          <span>{notice}</span>
          <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>
        </div>
      )}

      {q.error && !d ? (
        <div className="rounded-lg border border-line bg-panel"><ErrorState error={q.error} onRetry={q.reload} /></div>
      ) : (
        <section aria-label="Email metrics" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-5">
          {d ? (
            <>
              <Tile label="Welcome sent" value={fmtInt(d.welcome.sent)} sub={attempts ? `${fmtPct(d.welcome.sent / attempts)} delivered to the provider` : undefined} info="Welcome emails the provider accepted in this range. Accepted is not the same as delivered to the inbox." />
              <Tile label="Failed" value={fmtInt(d.welcome.failed)} tone={d.welcome.failed > 0 ? 'poor' : undefined} info="Welcome emails the provider rejected or that errored. See recent failures below." />
              <Tile label="Skipped" value={fmtInt(d.welcome.skipped)} info="Signups the server decided not to email (it logs the reason, for example that the welcome email was off)." />
              <Tile label="Unsubscribed" value={fmtInt(d.unsubscribed)} sub="in this range" info="People who used the unsubscribe link in this range." />
              <Tile label="Unsubscribed, all time" value={fmtInt(d.unsubscribed_all_time)} info="Everyone currently unsubscribed. They stay on the waitlist but get no more email." />
            </>
          ) : (
            Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="min-w-0 bg-panel px-4 py-3.5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="mt-2 h-6 w-12" />
              </div>
            ))
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Top email domains" subtitle="Email signups in this range, top 25. Block a domain to reject new signups from it.">
          <QueryView q={q} isEmpty={(x) => x.domains.length === 0} skeleton={<SkeletonRows rows={8} />} empty={<EmptyState text="No email signups in this range" />}>
            {(x) => {
              const total = x.domains.reduce((t, r2) => t + r2.signups, 0)
              return (
                <DataTable
                  rows={x.domains}
                  rowKey={(r2) => r2.domain}
                  defaultSort={{ key: 'signups', dir: 'desc' }}
                  caption="Top email domains"
                  csvName={`email domains ${range.label}`}
                  columns={[
                    { key: 'domain', label: 'Domain', sort: (r2) => r2.domain, render: (r2) => <span className="font-mono text-[12.5px]">{r2.domain}</span> },
                    { key: 'signups', label: 'Signups', align: 'right', sort: (r2) => r2.signups, render: (r2) => fmtInt(r2.signups) },
                    { key: 'share', label: 'Share of top 25', align: 'right', sort: (r2) => (total ? r2.signups / total : 0), render: (r2) => fmtPct(total ? r2.signups / total : 0) },
                    {
                      key: 'action', label: 'Block', srOnly: true, csv: (r2) => (blocked.has(r2.domain) ? 'blocked' : ''),
                      render: (r2) => blocked.has(r2.domain) ? (
                        <Badge tone="poor">Blocked</Badge>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={!settings.data} onClick={() => { setErr(null); setBlocking(r2) }} aria-label={`Block ${r2.domain}`}>
                          <Ban className="size-3.5" aria-hidden /> Block
                        </Button>
                      ),
                    },
                  ]}
                />
              )
            }}
          </QueryView>
        </Panel>

        <Panel title="Recent failures" subtitle="The last 20 failed sends in this range (welcome and test emails).">
          <QueryView q={q} isEmpty={(x) => x.recent_failures.length === 0} skeleton={<SkeletonRows rows={5} />} empty={<EmptyState text="No failed sends in this range" />}>
            {(x) => (
              <DataTable
                rows={x.recent_failures}
                rowKey={(r2) => `${r2.created_at}|${r2.detail}`}
                caption="Recent email failures"
                csvName={`email failures ${range.label}`}
                columns={[
                  { key: 'at', label: 'When', sort: (r2) => r2.created_at, render: (r2) => <time dateTime={r2.created_at} title={fmtDateTime(r2.created_at)}>{fmtAgo(r2.created_at)}</time> },
                  { key: 'kind', label: 'Kind', sort: (r2) => r2.kind, render: (r2) => <Badge>{r2.kind}</Badge> },
                  { key: 'detail', label: 'Detail', csv: (r2) => r2.detail, render: (r2) => <span className="inline-block max-w-[340px] truncate align-middle font-mono text-[12px]" title={r2.detail ?? ''}>{r2.detail ?? '—'}</span> },
                ]}
              />
            )}
          </QueryView>
        </Panel>
      </div>

      <Dialog
        open={blocking !== null}
        onClose={() => !busy && setBlocking(null)}
        title={`Block ${blocking?.domain ?? ''}?`}
        footer={
          <>
            <Button onClick={() => setBlocking(null)} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={block} disabled={busy}>
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Block domain
            </Button>
          </>
        }
      >
        {blocking && (
          <>
            <p>
              New signups from <span className="font-mono text-ink">@{blocking.domain}</span> will be rejected. The {fmtInt(blocking.signups)} signups already in this range stay on the waitlist. You can unblock it in Settings.
            </p>
            {MAJOR_PROVIDERS.has(blocking.domain) && (
              <p role="alert" className="mt-3 flex gap-2 rounded-md border border-poor/40 bg-[color-mix(in_srgb,var(--poor)_10%,transparent)] px-3 py-2 text-ink">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-poor" aria-hidden />
                <span>{blocking.domain} is a major email provider. Blocking it would turn away a large share of real people.</span>
              </p>
            )}
            {err && <p role="alert" className="mt-3 text-down">{err}</p>}
          </>
        )}
      </Dialog>
    </div>
  )
}
