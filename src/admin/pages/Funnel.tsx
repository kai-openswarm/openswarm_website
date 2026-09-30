import { useApi, useQuery, useView } from '../hooks'
import { fmtInt, fmtPct } from '../format'
import type { Funnel } from '../types'
import { DataTable, EmptyState, Panel, QueryView, RankedList, SkeletonRows } from '../ui'

const ERROR_LABELS: Record<string, string> = {
  invalid_phone: 'Invalid phone number',
  rate_limited: 'Rate limited',
  network: 'Network error',
  unsupported_country: 'Unsupported country',
  captcha: 'Bot check failed',
  '400': 'Rejected request (400)',
  '429': 'Too many requests (429)',
  '500': 'Server error (500)',
  waitlist_error: 'Error (no code)',
  waitlist_fail: 'Failure (no code)',
}

function Steps({ steps }: { steps: Funnel['steps'] }) {
  const top = steps[0]?.sessions ?? 0
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].sessions : null
        const overall = top > 0 ? s.sessions / top : 0
        const stepRate = prev ? s.sessions / prev : null
        const drop = prev !== null ? prev - s.sessions : null
        return (
          <li key={s.key}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
              <span className="font-medium">
                <span className="mr-1.5 text-ink-3 num">{i + 1}.</span>
                {s.label}
              </span>
              <span className="text-ink-2 num">
                <span className="font-semibold text-ink">{fmtInt(s.sessions)}</span>
                <span className="text-ink-3"> · {fmtPct(overall)} of visits</span>
              </span>
            </div>
            <div className="h-6 overflow-hidden rounded bg-hover" aria-hidden>
              <div className="h-full rounded bg-accent" style={{ width: `${Math.min(1, overall) * 100}%`, opacity: 1 - i * 0.1 }} />
            </div>
            {stepRate !== null && (
              <p className="mt-1 text-[12px] text-ink-3 num">
                {fmtPct(Math.min(stepRate, 1))} from previous step
                {drop !== null && drop > 0 && <> · <span className="text-down">{fmtInt(drop)} dropped off</span></>}
                {stepRate > 1 && <> · includes sessions that skipped the previous step</>}
              </p>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function FunnelPage() {
  const api = useApi()
  const { query, key } = useView()
  const q = useQuery(`funnel|${key}`, () => api.funnel(query))

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Signup funnel" subtitle="Sessions reaching each step. Step-to-step and overall conversion.">
        <QueryView q={q} isEmpty={(d) => (d.steps[0]?.sessions ?? 0) === 0} skeleton={<SkeletonRows rows={6} />}>
          {(d) => (
            <>
              <Steps steps={d.steps} />
              {(() => {
                const visited = d.steps.find((s) => s.key === 'visited')?.sessions ?? 0
                const joined = d.steps.find((s) => s.key === 'joined')?.sessions ?? 0
                return (
                  <p className="mt-4 border-t border-line pt-3 text-[13px] text-ink-2">
                    Overall: <span className="font-semibold text-ink num">{fmtPct(visited ? joined / visited : 0)}</span> of sessions ended in a new signup.
                  </p>
                )
              })()}
            </>
          )}
        </QueryView>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Signup errors" subtitle="Why submissions failed">
          <QueryView q={q} isEmpty={(d) => d.errors.length === 0} empty={<EmptyState text="No signup errors in this range" />}>
            {(d) => (
              <RankedList
                valueLabel="Count"
                items={d.errors.map((e) => ({ key: e.reason, label: ERROR_LABELS[e.reason] ?? e.reason, title: e.reason, value: e.count, display: fmtInt(e.count) }))}
              />
            )}
          </QueryView>
        </Panel>
        <Panel title="By form placement" subtitle="Which signup form was used">
          <QueryView q={q} isEmpty={(d) => d.by_source.length === 0} empty={<EmptyState text="No submissions in this range" />}>
            {(d) => (
              <DataTable
                rows={d.by_source}
                rowKey={(r) => r.source}
                defaultSort={{ key: 'submitted', dir: 'desc' }}
                caption="Submissions by form placement"
                columns={[
                  { key: 'source', label: 'Placement', sort: (r) => r.source, render: (r) => r.source },
                  { key: 'submitted', label: 'Submitted', align: 'right', sort: (r) => r.submitted, render: (r) => fmtInt(r.submitted) },
                  { key: 'joined', label: 'Joined', align: 'right', sort: (r) => r.joined, render: (r) => fmtInt(r.joined) },
                  { key: 'rate', label: 'Success', align: 'right', sort: (r) => (r.submitted ? r.joined / r.submitted : 0), render: (r) => fmtPct(r.submitted ? r.joined / r.submitted : 0) },
                ]}
              />
            )}
          </QueryView>
        </Panel>
      </div>
    </div>
  )
}
