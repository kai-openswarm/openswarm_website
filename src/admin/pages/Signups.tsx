import { useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Eye, Loader2, Search, Trash2 } from 'lucide-react'
import { useApi, useDebounced, useQuery, useView } from '../hooks'
import { countryName, flag, fmtDateTime, fmtDuration, fmtInt, capitalize } from '../format'
import { errorMessage } from '../errors'
import { downloadText, toCsv } from '../csv'
import { toDateInput } from '../nav'
import type { ExportRow, SignupRow } from '../types'
import { Badge, Button, DataTable, Dialog, EmptyState, Panel, QueryView, SkeletonRows, inputClass, type Column } from '../ui'

const PAGE_SIZE = 50

const EXPORT_COLUMNS: (keyof ExportRow & string)[] = [
  'created_at', 'phone', 'placement', 'referral_code', 'referred_by', 'invites', 'consent_version', 'consented_at',
  'channel', 'traffic_source', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'referrer_domain',
  'landing_path', 'country', 'region', 'city', 'device_type', 'browser', 'os', 'seconds_to_signup', 'sessions_before',
]
// Values that cannot start a spreadsheet formula (phone is validated E.164 by the database).
const TRUSTED = new Set(['created_at', 'phone', 'consented_at', 'invites', 'seconds_to_signup', 'sessions_before'])

export function Signups() {
  const api = useApi()
  const { range } = useView()
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search.trim(), 300)
  const pageScope = `${debounced}|${range.fromIso}|${range.toIso}`
  const [pageState, setPageState] = useState({ scope: pageScope, page: 0 })
  // A new search or range starts at the first page.
  const page = pageState.scope === pageScope ? pageState.page : 0
  const setPage = (f: (p: number) => number) => setPageState({ scope: pageScope, page: f(page) })
  const [revealed, setRevealed] = useState<Record<string, string | { error: string } | 'loading'>>({})
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<SignupRow | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const r = { from: range.fromIso, to: range.toIso }

  const q = useQuery(`signups|${r.from}|${r.to}|${debounced}|${page}`, () => api.signups(r, debounced, PAGE_SIZE, page * PAGE_SIZE))

  async function reveal(code: string) {
    setRevealed((m) => ({ ...m, [code]: 'loading' }))
    try {
      const phone = await api.revealPhone(code)
      setRevealed((m) => ({ ...m, [code]: phone }))
    } catch (e) {
      setRevealed((m) => ({ ...m, [code]: { error: errorMessage(e) } }))
    }
  }

  async function doExport() {
    setExporting(true)
    setExportError(null)
    try {
      const rows = await api.exportSignups(r)
      const name = `openswarm-signups-${toDateInput(range.from)}-to-${toDateInput(new Date(range.to.getTime() - 86_400_000))}.csv`
      downloadText(name, toCsv(rows, EXPORT_COLUMNS, TRUSTED))
      setExportOpen(false)
      setNotice(`Exported ${fmtInt(rows.length)} signups to ${name}.`)
    } catch (e) {
      setExportError(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  const columns: Column<SignupRow>[] = [
    { key: 'created_at', label: 'Joined', render: (s) => <time dateTime={s.created_at} className="num">{fmtDateTime(s.created_at)}</time> },
    {
      key: 'phone', label: 'Phone', render: (s) => {
        const v = revealed[s.code]
        return (
          <span className="inline-flex items-center gap-2">
            <span className="font-mono text-[12.5px]">{typeof v === 'string' && v !== 'loading' ? v : s.phone_masked}</span>
            {v === undefined && (
              <button type="button" onClick={() => reveal(s.code)} className="inline-flex items-center gap-1 rounded px-1 text-[12px] text-ink-3 hover:bg-hover hover:text-ink" aria-label={`Reveal phone number ${s.phone_masked}`}>
                <Eye className="size-3.5" aria-hidden /> Reveal
              </button>
            )}
            {v === 'loading' && <Loader2 className="size-3.5 animate-spin text-ink-3" aria-label="Revealing" />}
            {typeof v === 'object' && <span className="text-[12px] text-down" role="alert">{v.error}</span>}
          </span>
        )
      },
    },
    { key: 'placement', label: 'Placement', render: (s) => s.placement },
    {
      key: 'channel', label: 'Channel / source', render: (s) => (
        <span className="flex flex-col leading-tight">
          <span>{s.channel ?? '(unknown)'}</span>
          <span className="max-w-[220px] truncate text-[12px] text-ink-3">
            {[s.traffic_source, s.utm_campaign].filter(Boolean).join(' · ') || '—'}
          </span>
        </span>
      ),
    },
    {
      key: 'location', label: 'Location', render: (s) => (
        <span className="inline-block max-w-[200px] truncate align-middle" title={[s.city, s.region, countryName(s.country)].filter(Boolean).join(', ')}>
          {flag(s.country)} {[s.city, s.country ? countryName(s.country) : null].filter(Boolean).join(', ') || 'Unknown'}
        </span>
      ),
    },
    { key: 'device', label: 'Device', render: (s) => [s.device_type ? capitalize(s.device_type) : null, s.browser].filter(Boolean).join(' · ') || '—' },
    { key: 'time', label: 'Time to join', align: 'right', render: (s) => fmtDuration(s.seconds_to_signup) },
    { key: 'invites', label: 'Invites', align: 'right', render: (s) => fmtInt(s.invites) },
    { key: 'invited', label: 'Invited?', render: (s) => (s.was_invited ? <Badge tone="accent">Invited</Badge> : <span className="text-ink-3">—</span>) },
    {
      key: 'actions', label: 'Actions', srOnly: true, render: (s) => (
        <button type="button" onClick={() => setToDelete(s)} className="rounded p-1.5 text-ink-3 hover:bg-hover hover:text-down" aria-label={`Delete signup ${s.phone_masked}`} title="Delete">
          <Trash2 className="size-4" aria-hidden />
        </button>
      ),
    },
  ]

  const total = q.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel px-4 py-2.5 text-[13px]">
          <span>{notice}</span>
          <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>
        </div>
      )}
      <Panel
        title={q.data ? `${fmtInt(total)} signups` : 'Signups'}
        subtitle="Phone numbers are masked. Revealing a number or exporting is recorded in the audit log."
        actions={
          <Button onClick={() => { setExportError(null); setExportOpen(true) }} disabled={!q.data || total === 0}>
            <Download className="size-3.5" aria-hidden /> Export CSV
          </Button>
        }
      >
        <div className="relative mb-3 max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <label htmlFor="signup-search" className="sr-only">Search signups</label>
          <input
            id="signup-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Phone digits, placement, campaign, country code…"
            className={`${inputClass} w-full pl-8`}
          />
        </div>
        <QueryView
          q={q}
          isEmpty={(d) => d.rows.length === 0}
          skeleton={<SkeletonRows rows={10} />}
          empty={<EmptyState text={debounced ? 'No signups match this search' : 'No signups in this range yet'} />}
        >
          {(d) => (
            <>
              <DataTable columns={columns} rows={d.rows} rowKey={(s) => s.code} caption="Signups" />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-ink-3">
                <span className="num">
                  {fmtInt(page * PAGE_SIZE + 1)}–{fmtInt(page * PAGE_SIZE + d.rows.length)} of {fmtInt(total)}
                </span>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                    <ChevronLeft className="size-4" aria-hidden /> Prev
                  </Button>
                  <span className="px-1 num">Page {page + 1} / {pages}</span>
                  <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                    Next <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            </>
          )}
        </QueryView>
      </Panel>

      <Dialog
        open={exportOpen}
        onClose={() => !exporting && setExportOpen(false)}
        title="Export signups to CSV?"
        footer={
          <>
            <Button onClick={() => setExportOpen(false)} disabled={exporting}>Cancel</Button>
            <Button variant="primary" onClick={doExport} disabled={exporting}>
              {exporting && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Export
            </Button>
          </>
        }
      >
        <p>
          This downloads every signup from <strong className="text-ink">{range.label}</strong> with <strong className="text-ink">full phone numbers</strong> and attribution. The export is recorded in the audit log with your email.
        </p>
        <p className="mt-2">Store the file securely and delete it when you are done.</p>
        {exportError && <p role="alert" className="mt-3 text-down">{exportError}</p>}
      </Dialog>

      <DeleteDialog
        key={toDelete?.code ?? 'none'}
        row={toDelete}
        onClose={() => setToDelete(null)}
        onDeleted={(row) => {
          setToDelete(null)
          setNotice(`Deleted signup ${row.phone_masked} and its visit history.`)
          q.reload()
        }}
      />
    </div>
  )
}

function DeleteDialog({ row, onClose, onDeleted }: { row: SignupRow | null; onClose: () => void; onDeleted: (r: SignupRow) => void }) {
  const api = useApi()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!row || typed.trim().toLowerCase() !== 'delete') return
    setBusy(true)
    setError(null)
    try {
      await api.deleteSignup(row.code)
      onDeleted(row)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const ok = typed.trim().toLowerCase() === 'delete'
  return (
    <Dialog
      open={row !== null}
      onClose={() => !busy && onClose()}
      title="Permanently delete this person?"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={confirm} disabled={!ok || busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Delete permanently
          </Button>
        </>
      }
    >
      {row && (
        <form onSubmit={(e) => { e.preventDefault(); void confirm() }}>
          <p>
            This erases <span className="font-mono text-ink">{row.phone_masked}</span> from the waitlist, along with their attribution and their entire visit history. Use it for deletion requests. It cannot be undone.
          </p>
          <p className="mt-2">People they invited stay on the waitlist.</p>
          <label htmlFor="confirm-delete" className="mt-4 block text-[12px] font-medium text-ink-2">
            Type <span className="font-mono text-ink">delete</span> to confirm
          </label>
          <input id="confirm-delete" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-autofocus className={`${inputClass} mt-1 w-full`} />
          {error && <p role="alert" className="mt-2 text-down">{error}</p>}
        </form>
      )}
    </Dialog>
  )
}
