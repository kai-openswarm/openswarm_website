import { useApi, useQuery, useView } from '../hooks'
import { fmtInt, fmtPct } from '../format'
import type { Funnel } from '../types'
import { CsvButton, DataTable, EmptyState, Panel, QueryView, RankedList, SkeletonRows } from '../ui'

const ERROR_LABELS: Record<string, string> = {
  invalid_email: 'Invalid email address',
  empty: 'Submitted without an email',
  invalid_phone: 'Invalid phone number (legacy)',
  rate_limited: 'Rate limited',
  network: 'Network error',
  captcha: 'Bot check failed',
  '400': 'Rejected request (400)',
  '429': 'Too many requests (429)',
  '500': 'Server error (500)',
  '503': 'Service unavailable (503)',
  waitlist_error: 'Error (no code)',
  waitlist_fail: 'Failure (no code)',
}

function Steps({ steps }: { steps: Funnel['steps'] }) {
  const top = steps[0]?.sessions ?? 0
  return (
    <ol className="space-y-3.5">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].sessions : null
        const overall = top > 0 ? s.sessions / top : 0
        const prevOverall = prev !== null && top > 0 ? prev / top : overall
        const stepRate = prev ? s.sessions / prev : null
        const drop = prev !== null ? Math.max(0, prev - s.sessions) : null
        const dropRate = prev ? drop! / prev : null
        return (
          <li key={s.key}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
              <span className="font-medium">
                <span className="mr-1.5 text-ink-3 num">{i + 1}.</span>
                {s.label}
              </span>
              <span className="text-ink-2 num">
                <span className="font-semibold text-ink">{fmtInt(s.sessions)}</span>
                <span className="text-ink-3"> · {fmtPct(overall)} of step 1</span>
                {stepRate !== null && <span className="text-ink-3"> · {fmtPct(Math.min(stepRate, 1))} of previous</span>}
              </span>
            </div>
            <div className="relative h-6 overflow-hidden rounded bg-hover" aria-hidden>
              {/* Drop-off from the previous step, then the part that continued. */}
              {prev !== null && prevOverall > overall && (
                <div
                  className="absolute inset-y-0 rounded-r"
                  style={{ left: `${Math.min(1, overall) * 100}%`, width: `${Math.min(1, prevOverall - overall) * 100}%`, background: 'color-mix(in srgb, var(--down) 22%, transparent)' }}
                />
              )}
              <div className="absolute inset-y-0 left-0 rounded bg-accent" style={{ width: `${Math.min(1, overall) * 100}%` }} />
            </div>
            {stepRate !== null && (
              <p className="mt-1 text-[12px] text-ink-3 num">
                → {fmtPct(Math.min(stepRate, 1))} continued
                {drop !== null && drop > 0 && dropRate !== null && <> · <span className="text-down">↓ {fmtPct(dropRate)} dropped off ({fmtInt(drop)})</span></>}
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
      <Panel
        title="Signup funnel"
        subtitle="Sessions reaching each step: % of step 1, % of the previous step, and the drop-off between them."
        actions={q.data && (
          <CsvButton
            name="funnel"
            getRows={() => {
              const st = q.data?.steps ?? []
              const top = st[0]?.sessions ?? 0
              return {
                header: ['Step', 'Label', 'Sessions', '% of step 1', '% of previous', 'Dropped off'],
                rows: st.map((x, i) => [i + 1, x.label, x.sessions, top ? x.sessions / top : 0, i && st[i - 1].sessions ? x.sessions / st[i - 1].sessions : null, i ? Math.max(0, st[i - 1].sessions - x.sessions) : null]),
              }
            }}
          />
        )}
      >
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
                csv={{ name: 'signup errors', nameHeader: 'Reason' }}
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
                csvName="submissions by placement"
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
