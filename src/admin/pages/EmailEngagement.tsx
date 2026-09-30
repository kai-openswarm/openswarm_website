import { useApi, useQuery } from '../hooks'
import { fmtInt, fmtPct } from '../format'
import { DailyLines } from '../charts'
import type { EmailKind, EmailKindEngagement } from '../types'
import { DataTable, EmptyState, InfoTip, Panel, QueryView, RankedList, Skeleton, SkeletonRows } from '../ui'

const KIND_LABEL: Record<EmailKind, string> = { welcome: 'Welcome', priority: 'Priority' }
const LINK_LABEL: Record<string, string> = { share: 'Share your invite', explore: 'Explore OpenSwarm', resend_link: 'Link (Resend)' }

const TIPS = {
  sent: 'Emails the mail server accepted, for jobs queued in this range.',
  opened: 'Emails opened at least once, from a 1-pixel image. Approximate: Apple Mail preloads images (counts opens that never happened) and many clients block images (misses real ones). Scanner and bot opens are excluded.',
  clicked: 'Emails whose main button was clicked: “Share your invite” in the welcome email, “Explore OpenSwarm” in the priority email. The plain invite link is deliberately not tracked, so friends’ visits still count as invites (see Referrals). Bot clicks are excluded.',
  cto: 'Click-to-open: clicked ÷ opened.',
  unsub: 'People who unsubscribed after this email was sent ÷ sent.',
  resend: 'Delivered, bounced and complaints come only from Resend’s webhooks, so they cover only emails the Resend backup sent. SMTP (Google Workspace) does not report them.',
  automated: 'Opens and clicks from link scanners and bots (for example corporate mail security). Excluded from every rate.',
}

export function EmailEngagementSection({ r }: { r: { from: string; to: string } }) {
  const api = useApi()
  const q = useQuery(`email-engagement|${r.from}|${r.to}`, () => api.emailEngagement(r))
  const noResend = (q.data?.resend_events ?? 0) === 0
  const rate = (n: number, rt: number, show = true) => (show ? <>{fmtInt(n)} <span className="text-ink-3">({fmtPct(rt)})</span></> : '—')

  return (
    <Panel
      title="Engagement"
      subtitle="How people interacted with the emails queued in this range. Opens are approximate; clicks count only each email’s main button."
    >
      <QueryView q={q} skeleton={<SkeletonRows rows={3} />} isEmpty={(d) => d.kinds.every((k) => k.sent === 0)} empty={<EmptyState text="No emails sent in this range" />}>
        {(d) => (
          <div className="flex flex-col gap-5">
            <DataTable<EmailKindEngagement>
              rows={d.kinds}
              rowKey={(k) => k.kind}
              caption="Email engagement by email"
              csvName="email engagement"
              columns={[
                { key: 'kind', label: 'Email', csv: (k) => KIND_LABEL[k.kind], render: (k) => <span className="font-medium">{KIND_LABEL[k.kind]}</span> },
                { key: 'sent', label: 'Sent', align: 'right', info: TIPS.sent, sort: (k) => k.sent, render: (k) => fmtInt(k.sent) },
                { key: 'opened', label: 'Opened', align: 'right', info: TIPS.opened, csv: (k) => k.opened, render: (k) => rate(k.opened, k.open_rate) },
                { key: 'open_rate', label: 'Open rate', csvOnly: true, csv: (k) => k.open_rate, render: () => null },
                { key: 'clicked', label: 'Clicked', align: 'right', info: TIPS.clicked, csv: (k) => k.clicked, render: (k) => rate(k.clicked, k.click_rate) },
                { key: 'click_rate', label: 'Click rate', csvOnly: true, csv: (k) => k.click_rate, render: () => null },
                { key: 'cto', label: 'Click-to-open', align: 'right', info: TIPS.cto, csv: (k) => k.click_to_open, render: (k) => (k.opened ? fmtPct(k.click_to_open) : '—') },
                { key: 'unsub', label: 'Unsubscribed', align: 'right', info: TIPS.unsub, csv: (k) => k.unsubscribed, render: (k) => rate(k.unsubscribed, k.unsubscribe_rate) },
                {
                  key: 'bounced', label: 'Bounced / complaints', align: 'right', info: TIPS.resend,
                  csv: (k) => (noResend ? null : k.bounced),
                  render: (k) => (noResend ? '—' : <>{rate(k.bounced, k.bounce_rate)} <span className="text-ink-3">/ {fmtInt(k.complained)}</span></>),
                },
                { key: 'complained', label: 'Complaints', csvOnly: true, csv: (k) => (noResend ? null : k.complained), render: () => null },
                { key: 'automated', label: 'Bot events', csvOnly: true, csv: (k) => k.automated, render: () => null },
              ]}
            />
            <p className="-mt-3 text-[12px] text-ink-3">
              {noResend
                ? 'Bounced and complaints show “—”: no emails went through the Resend backup in this range, and SMTP doesn’t report them.'
                : `Bounced and complaints cover only emails sent through the Resend backup (${fmtInt(d.resend_events)} Resend events).`}
              {(d.tests.opens > 0 || d.tests.clicks > 0) && ` Test emails are excluded (${fmtInt(d.tests.opens)} opens, ${fmtInt(d.tests.clicks)} clicks).`}
              {' '}{fmtInt(d.kinds.reduce((t, k) => t + k.automated, 0))} opens and clicks from scanners and bots are excluded from the rates.{' '}
              <InfoTip text={TIPS.automated} label="Bot events definition" />
            </p>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <h3 className="mb-2 text-[12.5px] font-semibold">By day</h3>
                {d.daily.some((x) => x.sent || x.opened || x.clicked) ? (
                  <DailyLines
                    label="Emails sent, opened and clicked per day"
                    data={d.daily}
                    series={[
                      { key: 'sent', label: 'Sent', color: 'var(--c1)' },
                      { key: 'opened', label: 'Opened', color: 'var(--c2)' },
                      { key: 'clicked', label: 'Clicked', color: 'var(--c3)' },
                    ]}
                  />
                ) : <Skeleton className="h-[200px] animate-none" />}
              </div>
              <div className="min-w-0">
                <h3 className="mb-2 flex items-center gap-1 text-[12.5px] font-semibold">Clicks by button <InfoTip text={TIPS.clicked} label="Clicks by button definition" /></h3>
                {d.links.length ? (
                  <RankedList
                    valueLabel="Clicks"
                    csv={{ name: 'email clicks by button', nameHeader: 'Button' }}
                    items={d.links.map((l) => {
                      const name = `${LINK_LABEL[l.link] ?? l.link} · ${KIND_LABEL[l.kind] ?? l.kind}`
                      return { key: `${l.kind}|${l.link}`, label: name, title: name, value: l.clicks, display: <>{fmtInt(l.clicks)} <span className="text-ink-3">· {fmtInt(l.people)} {l.people === 1 ? "person" : "people"}</span></> }
                    })}
                  />
                ) : <EmptyState text="No button clicks in this range" />}
              </div>
            </div>
          </div>
        )}
      </QueryView>
    </Panel>
  )
}
