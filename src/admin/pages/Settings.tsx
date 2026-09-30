import { useState, type FormEvent } from 'react'
import { Loader2, UserMinus } from 'lucide-react'
import { useApi, useQuery } from '../hooks'
import { fmtAgo, fmtDate, fmtDateTime, fmtInt } from '../format'
import { errorMessage } from '../errors'
import type { AdminSettings, AuditEntry } from '../types'
import { Badge, Button, Dialog, EmptyState, Panel, QueryView, SkeletonRows, inputClass } from '../ui'

const ACTIONS: Record<string, string> = {
  reveal_phone: 'Revealed a phone number',
  export_signups: 'Exported signups',
  delete_signup: 'Deleted a signup',
  update_setting: 'Changed a setting',
  add_admin: 'Added an admin',
  remove_admin: 'Removed an admin',
}

function auditDetail(e: AuditEntry): string {
  const d = e.detail
  const s = (k: string) => (d[k] === undefined || d[k] === null ? '' : typeof d[k] === 'object' ? JSON.stringify(d[k]) : String(d[k]))
  switch (e.action) {
    case 'export_signups': return `${s('rows') ? `${fmtInt(Number(s('rows')))} rows, ` : ''}${s('from') ? fmtDate(s('from')) : ''} – ${s('to') ? fmtDate(s('to')) : ''}`
    case 'delete_signup': return s('masked')
    case 'update_setting': return `${s('key')} → ${s('value')}`
    case 'add_admin':
    case 'remove_admin': return s('email')
    case 'reveal_phone': return s('code') ? `code ${s('code').slice(0, 8)}…` : ''
    default: return JSON.stringify(d)
  }
}

export function SettingsPage() {
  const api = useApi()
  const q = useQuery('settings', () => api.settings())
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Waitlist counter" subtitle="The public count on the site is this baseline plus real signups.">
          <QueryView q={q} skeleton={<SkeletonRows rows={3} />}>
            {(d) => <BaselineForm key={String(d.settings.waitlist_count_baseline)} data={d} onSaved={q.reload} />}
          </QueryView>
        </Panel>
        <Panel title="Internal traffic" subtitle="Keep your own visits out of the numbers.">
          <QueryView q={q} skeleton={<SkeletonRows rows={3} />}>
            {(d) => <InternalToggle key={String(d.settings.include_internal === true)} value={d.settings.include_internal === true} onSaved={q.reload} />}
          </QueryView>
        </Panel>
      </div>

      <Panel title="Admins" subtitle="People who can sign in to this dashboard.">
        <QueryView q={q} skeleton={<SkeletonRows rows={4} />}>
          {(d) => <Admins data={d} onChanged={q.reload} />}
        </QueryView>
      </Panel>

      <Panel title="Audit log" subtitle="The 50 most recent sensitive actions.">
        <QueryView q={q} isEmpty={(d) => d.audit.length === 0} skeleton={<SkeletonRows rows={5} />} empty={<EmptyState text="Nothing recorded yet" />}>
          {(d) => (
            <ol className="-mx-4 divide-y divide-line">
              {d.audit.map((e, i) => (
                <li key={`${e.at}-${i}`} className="flex flex-col gap-0.5 px-4 py-2 text-[13px] sm:flex-row sm:items-baseline sm:gap-3">
                  <time dateTime={e.at} title={fmtDateTime(e.at)} className="w-28 shrink-0 text-[12px] text-ink-3">{fmtAgo(e.at)}</time>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{ACTIONS[e.action] ?? e.action}</span>
                    {auditDetail(e) && <span className="break-all text-ink-2"> · {auditDetail(e)}</span>}
                  </span>
                  <span className="shrink-0 truncate text-[12px] text-ink-3">{e.actor}</span>
                </li>
              ))}
            </ol>
          )}
        </QueryView>
      </Panel>
    </div>
  )
}

function BaselineForm({ data, onSaved }: { data: AdminSettings; onSaved: () => void }) {
  const api = useApi()
  const baseline = typeof data.settings.waitlist_count_baseline === 'number' ? data.settings.waitlist_count_baseline : 0
  const realSignups = data.display_count - baseline
  const [value, setValue] = useState(String(baseline))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const n = Number(value)
  const valid = value.trim() !== '' && Number.isInteger(n) && n >= 0
  const preview = valid ? n + realSignups : null

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setMsg(null)
    try {
      await api.updateSetting('waitlist_count_baseline', n)
      setMsg({ ok: true, text: 'Saved.' })
      onSaved()
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="baseline" className="text-[12px] font-medium text-ink-2">Baseline</label>
        <div className="flex gap-2">
          <input
            id="baseline"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={`${inputClass} w-40 num`}
            aria-invalid={!valid}
            aria-describedby="baseline-help"
          />
          <Button type="submit" variant="primary" disabled={!valid || busy || n === baseline}>
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Save
          </Button>
        </div>
      </div>
      <dl id="baseline-help" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        <dt className="text-ink-3">Real signups</dt>
        <dd className="num">{fmtInt(realSignups)}</dd>
        <dt className="text-ink-3">Public count now</dt>
        <dd className="font-medium num">{fmtInt(data.display_count)}</dd>
        {preview !== null && n !== baseline && (
          <>
            <dt className="text-ink-3">After saving</dt>
            <dd className="font-medium text-accent num">{fmtInt(preview)}</dd>
          </>
        )}
      </dl>
      {!valid && <p role="alert" className="text-[12.5px] text-down">Enter a whole number of 0 or more.</p>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-[12.5px] ${msg.ok ? 'text-up' : 'text-down'}`}>{msg.text}</p>}
    </form>
  )
}

function InternalToggle({ value, onSaved }: { value: boolean; onSaved: () => void }) {
  const api = useApi()
  const [on, setOn] = useState(value)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function toggle() {
    const next = !on
    setOn(next)
    setBusy(true)
    setErr(null)
    try {
      await api.updateSetting('include_internal', next)
      onSaved()
    } catch (e) {
      setOn(!next)
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex items-center justify-between gap-4">
        <span id="internal-label" className="font-medium">Include internal traffic in reports</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="internal-label"
          disabled={busy}
          onClick={toggle}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? 'bg-accent' : 'bg-line-strong'}`}
        >
          <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
        </button>
      </div>
      <p className="text-ink-2">
        Visiting the site with <code className="rounded bg-hover px-1 font-mono text-[12px]">?internal=1</code> marks that browser as internal, and <code className="rounded bg-hover px-1 font-mono text-[12px]">?internal=0</code> undoes it. Do this once on each browser and device the team uses. Internal visits are {on ? <strong>included</strong> : <strong>excluded</strong>} everywhere in this dashboard, including real-time.
      </p>
      {err && <p role="alert" className="text-[12.5px] text-down">{err}</p>}
    </div>
  )
}

function Admins({ data, onChanged }: { data: AdminSettings; onChanged: () => void }) {
  const api = useApi()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeErr, setRemoveErr] = useState<string | null>(null)

  async function invite(e: FormEvent) {
    e.preventDefault()
    const value = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setMsg({ ok: false, text: 'Enter a valid email address.' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await api.inviteAdmin(value)
      setMsg({ ok: true, text: `Added ${value}. Tell them to open ${window.location.origin}/admin/ and request a sign-in link.` })
      setEmail('')
      onChanged()
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!removing) return
    setRemoveBusy(true)
    setRemoveErr(null)
    try {
      await api.removeAdmin(removing)
      setRemoving(null)
      onChanged()
    } catch (e) {
      setRemoveErr(errorMessage(e))
    } finally {
      setRemoveBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="-mx-4 divide-y divide-line border-y border-line">
        {data.admins.map((a) => (
          <li key={a.email} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{a.email}</span>
                {a.email === data.me && <Badge>You</Badge>}
              </span>
              <span className="block truncate text-[12px] text-ink-3">
                Added {fmtDate(a.added_at)}{a.added_by ? ` by ${a.added_by}` : ''}
              </span>
            </span>
            {a.email !== data.me && (
              <Button size="sm" variant="ghost" onClick={() => { setRemoveErr(null); setRemoving(a.email) }} aria-label={`Remove ${a.email}`}>
                <UserMinus className="size-3.5" aria-hidden /> <span className="hidden sm:inline">Remove</span>
              </Button>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={invite} className="flex flex-col gap-1.5" noValidate>
        <label htmlFor="invite-email" className="text-[12px] font-medium text-ink-2">Invite an admin</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="invite-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@openswarm.com"
            className={`${inputClass} w-full sm:max-w-xs`}
          />
          <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Invite
          </Button>
        </div>
        <p className="text-[12px] text-ink-3">They’re added to the allowlist and can then request a sign-in link on this page. No email is sent automatically. Admins get full access, including phone numbers.</p>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-[12.5px] ${msg.ok ? 'text-up' : 'text-down'}`}>{msg.text}</p>}
      </form>

      <Dialog
        open={removing !== null}
        onClose={() => !removeBusy && setRemoving(null)}
        title="Remove admin access?"
        footer={
          <>
            <Button onClick={() => setRemoving(null)} disabled={removeBusy}>Cancel</Button>
            <Button variant="danger" onClick={remove} disabled={removeBusy}>
              {removeBusy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Remove
            </Button>
          </>
        }
      >
        <p><span className="font-medium text-ink">{removing}</span> will lose access to this dashboard immediately. You can invite them again later.</p>
        {removeErr && <p role="alert" className="mt-2 text-down">{removeErr}</p>}
      </Dialog>
    </div>
  )
}
