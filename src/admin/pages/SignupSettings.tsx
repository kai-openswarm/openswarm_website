import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Send, X } from 'lucide-react'
import { useApi, useDebounced, useQuery } from '../hooks'
import { errorMessage } from '../errors'
import type { AdminSettings, EmailKind, PriorityEmail, SettingKey, SettingValues, WelcomeEmail } from '../types'
import { DOMAIN_RE, MAX_BLOCKED_DOMAINS, SETTING_EMAIL_RE, normalizeDomain } from '../validation'
import { Button, ErrorState, Skeleton, Switch, Tabs, inputClass } from '../ui'

const DEFAULT_WELCOME: WelcomeEmail = {
  enabled: false, from_name: 'OpenSwarm', from_email: '', reply_to: '', subject: '', body: '', postal_address: '',
}

type Msg = { ok: boolean; text: string } | null

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null
  return <p role={msg.ok ? 'status' : 'alert'} className={`text-[12.5px] ${msg.ok ? 'text-up' : 'text-down'}`}>{msg.text}</p>
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t border-line pt-4 first:border-0 first:pt-0">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {description && <p className="mt-0.5 text-[12.5px] text-ink-3">{description}</p>}
      <div className="mt-3">{children}</div>
    </div>
  )
}

/** Saves one setting and reports the result. */
function useSave(onSaved: () => void) {
  const api = useApi()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  async function save<K extends SettingKey>(key: K, value: SettingValues[K], okText = 'Saved.') {
    setBusy(true)
    setMsg(null)
    try {
      await api.updateSetting(key, value)
      setMsg({ ok: true, text: okText })
      onSaved()
      return true
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) })
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, msg, setMsg, save }
}

function OpenToggle({ open, message, onSaved }: { open: boolean; message: string; onSaved: () => void }) {
  const id = useId()
  const toggle = useSave(onSaved)
  const text = useSave(onSaved)
  const [value, setValue] = useState(open)
  const [draft, setDraft] = useState(message)
  const trimmed = draft.trim()
  const valid = trimmed.length >= 1 && trimmed.length <= 200

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4 text-[13px]">
        <span id={id} className="font-medium">Accept new signups</span>
        <Switch
          checked={value}
          disabled={toggle.busy}
          labelledBy={id}
          onChange={async (next) => {
            setValue(next)
            if (!(await toggle.save('signups_open', next, next ? 'Signups are open.' : 'Signups are closed.'))) setValue(!next)
          }}
        />
      </div>
      {!value && (
        <div role="alert" className="flex gap-2 rounded-md border border-poor/40 bg-[color-mix(in_srgb,var(--poor)_10%,transparent)] px-3 py-2 text-[12.5px] text-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-poor" aria-hidden />
          <span>Signups are <strong>closed</strong>. Nobody can join the waitlist; visitors see the message below instead of the form.</span>
        </div>
      )}
      <Status msg={toggle.msg} />
      <form
        className="flex flex-col gap-1.5"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault()
          if (valid) await text.save('signups_closed_message', trimmed)
        }}
      >
        <label htmlFor={`${id}-msg`} className="text-[12px] font-medium text-ink-2">Message shown while signups are closed</label>
        <textarea
          id={`${id}-msg`}
          rows={2}
          maxLength={200}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={`${inputClass} h-auto py-1.5`}
          aria-invalid={!valid}
        />
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[11.5px] num ${valid ? 'text-ink-3' : 'text-down'}`}>{trimmed.length}/200</span>
          <Button type="submit" size="sm" variant="primary" disabled={!valid || text.busy || trimmed === message}>
            {text.busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Save message
          </Button>
        </div>
        <Status msg={text.msg} />
      </form>
    </div>
  )
}

function DomainList({ block, domains, onSaved }: { block: boolean; domains: string[]; onSaved: () => void }) {
  const id = useId()
  const toggle = useSave(onSaved)
  const list = useSave(onSaved)
  const [disposable, setDisposable] = useState(block)
  const [items, setItems] = useState(domains)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const dirty = JSON.stringify(items) !== JSON.stringify(domains)

  const add = () => {
    const parts = text.split(/[\s,;]+/).map(normalizeDomain).filter(Boolean)
    if (!parts.length) return
    const invalid = parts.filter((d) => !DOMAIN_RE.test(d))
    if (invalid.length) {
      setErr(`Not a domain: ${invalid.join(', ')}. Use a form like example.com.`)
      return
    }
    const next = [...new Set([...items, ...parts])]
    if (next.length > MAX_BLOCKED_DOMAINS) {
      setErr(`Up to ${MAX_BLOCKED_DOMAINS} domains.`)
      return
    }
    setItems(next)
    setText('')
    setErr(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4 text-[13px]">
        <span id={id}>
          <span className="font-medium">Block disposable email addresses</span>
          <span className="block text-[12px] text-ink-3">Throwaway inboxes such as mailinator.com, from a built-in list.</span>
        </span>
        <Switch
          checked={disposable}
          disabled={toggle.busy}
          labelledBy={id}
          onChange={async (next) => {
            setDisposable(next)
            if (!(await toggle.save('block_disposable_email', next))) setDisposable(!next)
          }}
        />
      </div>
      <Status msg={toggle.msg} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-add`} className="text-[12px] font-medium text-ink-2">
          Blocked domains <span className="font-normal text-ink-3">({items.length}/{MAX_BLOCKED_DOMAINS})</span>
        </label>
        {items.length > 0 ? (
          <ul className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
            {items.map((d) => (
              <li key={d} className="inline-flex items-center gap-0.5 rounded bg-hover py-0.5 pr-0.5 pl-1.5 font-mono text-[12px]">
                {d}
                <button type="button" className="rounded p-0.5 text-ink-3 hover:text-ink" aria-label={`Unblock ${d}`} onClick={() => setItems(items.filter((x) => x !== d))}>
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-ink-3">No domains blocked.</p>
        )}
        <div className="flex gap-2">
          <input
            id={`${id}-add`}
            value={text}
            onChange={(e) => { setText(e.target.value); setErr(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            placeholder="example.com (several: separate with commas)"
            className={`${inputClass} w-full`}
            autoComplete="off"
            aria-invalid={!!err}
          />
          <Button onClick={add} disabled={!text.trim()}>Add</Button>
        </div>
        {err && <p role="alert" className="text-[12.5px] text-down">{err}</p>}
        <div className="flex items-center justify-end gap-2">
          {dirty && <span className="text-[12px] text-ink-3">Unsaved changes</span>}
          {dirty && <Button size="sm" variant="ghost" onClick={() => setItems(domains)}>Discard</Button>}
          <Button size="sm" variant="primary" disabled={!dirty || list.busy} onClick={() => list.save('blocked_email_domains', items)}>
            {list.busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Save domains
          </Button>
        </div>
        <Status msg={list.msg} />
      </div>
    </div>
  )
}

function Limits({ hour, day, onSaved }: { hour: number; day: number; onSaved: () => void }) {
  const id = useId()
  const s = useSave(onSaved)
  const [h, setH] = useState(String(hour))
  const [d, setD] = useState(String(day))
  const ok = (v: string) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 10000
  const valid = ok(h) && ok(d)
  const dirty = Number(h) !== hour || Number(d) !== day

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!valid) return
        s.setMsg(null)
        if (Number(h) !== hour && !(await s.save('signup_limit_per_hour', Number(h)))) return
        if (Number(d) !== day) await s.save('signup_limit_per_day', Number(d))
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label htmlFor={`${id}-h`} className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Per hour
          <input id={`${id}-h`} type="number" min={1} max={10000} step={1} inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} className={`${inputClass} num`} aria-invalid={!ok(h)} />
        </label>
        <label htmlFor={`${id}-d`} className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Per day
          <input id={`${id}-d`} type="number" min={1} max={10000} step={1} inputMode="numeric" value={d} onChange={(e) => setD(e.target.value)} className={`${inputClass} num`} aria-invalid={!ok(d)} />
        </label>
      </div>
      {!valid && <p role="alert" className="text-[12.5px] text-down">Limits are whole numbers from 1 to 10,000.</p>}
      {valid && Number(d) < Number(h) && <p className="text-[12.5px] text-ink-3">The daily limit is lower than the hourly one, so it will be the one that applies.</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="primary" disabled={!valid || !dirty || s.busy}>
          {s.busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Save limits
        </Button>
      </div>
      <Status msg={s.msg} />
    </form>
  )
}

const DEFAULT_PRIORITY: PriorityEmail = { enabled: false, subject: 'You’ve unlocked priority early access' }

function emailProblems(w: WelcomeEmail, p: PriorityEmail): string[] {
  const out: string[] = []
  if (w.from_name.length > 80) out.push('The sender name can be up to 80 characters.')
  if (w.from_email && !SETTING_EMAIL_RE.test(w.from_email)) out.push('The sender address is not a valid email address.')
  if (w.reply_to && !SETTING_EMAIL_RE.test(w.reply_to)) out.push('The reply-to address is not a valid email address.')
  if (w.postal_address.length > 300) out.push('The postal address can be up to 300 characters.')
  if (w.subject.trim().length < 1 || w.subject.trim().length > 150) out.push('The welcome subject must be 1 to 150 characters.')
  if (p.subject.trim().length < 1 || p.subject.trim().length > 150) out.push('The priority subject must be 1 to 150 characters.')
  if ((w.enabled || p.enabled) && (!w.from_email || !w.postal_address.trim())) {
    out.push('Set the sender address and the postal address before turning an email on.')
  }
  return out
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function EmailPreviewPane({ w, p }: { w: WelcomeEmail; p: PriorityEmail }) {
  const [kind, setKind] = useState<EmailKind>('welcome')
  const [plain, setPlain] = useState(false)
  // Re-render on the server shortly after typing stops.
  const payload = useDebounced(JSON.stringify({ kind, w, p }), 500)
  const q = useQuery(`email-preview|${payload}`, (a) => {
    const x = JSON.parse(payload) as { kind: EmailKind; w: WelcomeEmail; p: PriorityEmail }
    return a.emailPreview(x.kind, x.w, x.p)
  })
  const d = q.data
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Tabs label="Preview email" tabs={[{ key: 'welcome', label: 'Welcome' }, { key: 'priority', label: 'Priority' }] as const} value={kind} onChange={setKind} />
        <label className="inline-flex items-center gap-2 text-[12px] text-ink-2">
          <input type="checkbox" checked={plain} onChange={(e) => setPlain(e.target.checked)} />
          Plain text
        </label>
      </div>
      <div className="overflow-hidden rounded-md border border-line bg-panel-2 text-[13px]" aria-busy={q.loading}>
        {q.error && !d ? (
          <ErrorState error={q.error} onRetry={q.reload} />
        ) : !d ? (
          <Skeleton className="m-3 h-[420px]" />
        ) : (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-b border-line px-3 py-2 text-[12px]">
              <dt className="text-ink-3">From</dt>
              <dd className="min-w-0 truncate">{d.from}</dd>
              {w.reply_to && (<><dt className="text-ink-3">Reply-to</dt><dd className="min-w-0 truncate">{w.reply_to}</dd></>)}
              <dt className="text-ink-3">Subject</dt>
              <dd className="min-w-0 truncate font-medium">{d.subject}</dd>
            </dl>
            <div className={q.loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
              {plain ? (
                <pre className="max-h-[480px] overflow-auto px-3 py-3 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap">{d.text}</pre>
              ) : (
                // No scripts, no same-origin access: the HTML is shown, never trusted.
                <iframe title={`${d.kind === 'priority' ? 'Priority' : 'Welcome'} email preview`} sandbox="" srcDoc={d.html} className="block h-[480px] w-full border-0 bg-white" />
              )}
            </div>
          </>
        )}
      </div>
      <p className="mt-1.5 text-[12px] text-ink-3">Rendered by the server with your unsaved changes. Links point at your own waitlist signup when you have one.</p>
    </div>
  )
}

function EmailsForm({ savedWelcome, savedPriority, onSaved }: { savedWelcome: WelcomeEmail; savedPriority: PriorityEmail; onSaved: () => void }) {
  const api = useApi()
  const id = useId()
  const [w, setW] = useState<WelcomeEmail>({ ...DEFAULT_WELCOME, ...savedWelcome })
  const [p, setP] = useState<PriorityEmail>({ ...DEFAULT_PRIORITY, ...savedPriority })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const [testing, setTesting] = useState<EmailKind | null>(null)
  const [testMsg, setTestMsg] = useState<Msg>(null)
  const setWf = <K extends keyof WelcomeEmail>(k: K, v: WelcomeEmail[K]) => setW((x) => ({ ...x, [k]: v }))
  const problems = emailProblems(w, p)
  const baseW = { ...DEFAULT_WELCOME, ...savedWelcome }
  const baseP = { ...DEFAULT_PRIORITY, ...savedPriority }
  const dirtyW = !same(w, baseW)
  const dirtyP = !same(p, baseP)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (problems.length) return
    setBusy(true)
    setMsg(null)
    try {
      // The sender is saved first: the server checks the saved sender before enabling the priority email.
      // body is unused (fixed template) and goes back exactly as it was.
      if (dirtyW) await api.updateSetting('welcome_email', { ...w, subject: w.subject.trim(), body: savedWelcome.body ?? w.body ?? '' })
      if (dirtyP) await api.updateSetting('priority_email', { ...p, subject: p.subject.trim() })
      setMsg({ ok: true, text: 'Saved.' })
      onSaved()
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  async function sendTest(kind: EmailKind) {
    setTesting(kind)
    setTestMsg(null)
    try {
      const r = await api.testEmail(kind, w, p)
      setTestMsg({
        ok: true,
        text: `Sent the ${r.kind} email to ${r.sentTo}${r.via === 'resend' ? ' via the Resend backup, because SMTP didn’t accept it' : ' via SMTP'}, as the form is now (saved or not). ${r.realLinks
          ? 'Its invite and unsubscribe links are your own waitlist links.'
          : 'Your address isn’t on the waitlist, so its links are samples; join with it to test real links.'}`,
      })
    } catch (err) {
      const m = errorMessage(err)
      setTestMsg({ ok: false, text: /not configured/i.test(m) ? `${m} Until one of them is set up on the server, no waitlist email can be sent.` : m })
    } finally {
      setTesting(null)
    }
  }

  const input = (k: 'from_name' | 'from_email' | 'reply_to', label: string, extra: { type?: string; placeholder?: string; maxLength?: number; hint?: string } = {}) => (
    <label htmlFor={`${id}-${k}`} className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-ink-2">
      {label}
      <input id={`${id}-${k}`} type={extra.type ?? 'text'} value={w[k]} maxLength={extra.maxLength} placeholder={extra.placeholder} onChange={(e) => setWf(k, e.target.value)} className={inputClass} autoComplete="off" />
      {extra.hint && <span className="font-normal text-ink-3">{extra.hint}</span>}
    </label>
  )

  const group = (title: string, description: string, children: ReactNode) => (
    <fieldset className="rounded-md border border-line p-3">
      <legend className="px-1 text-[12.5px] font-semibold">{title}</legend>
      <p className="-mt-0.5 mb-2.5 text-[12px] text-ink-3">{description}</p>
      {children}
    </fieldset>
  )

  const emailGroup = (kind: EmailKind, enabled: boolean, setEnabled: (v: boolean) => void, subject: string, setSubject: (v: string) => void) => (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-4 text-[13px]">
        <span id={`${id}-${kind}-on`} className="font-medium">Send the {kind} email</span>
        <Switch checked={enabled} labelledBy={`${id}-${kind}-on`} onChange={setEnabled} />
      </div>
      <label htmlFor={`${id}-${kind}-subject`} className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
        Subject
        <input id={`${id}-${kind}-subject`} value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
      </label>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => sendTest(kind)} disabled={testing !== null || !w.from_email}>
          {testing === kind ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />} Send test
        </Button>
      </div>
    </div>
  )

  return (
    <form className="grid gap-5 lg:grid-cols-2" onSubmit={save} noValidate>
      <div className="flex min-w-0 flex-col gap-3">
        {group('Sender', 'Used by every waitlist email (welcome and priority).', (
          <div className="grid gap-3 sm:grid-cols-2">
            {input('from_name', 'Sender name', { maxLength: 80 })}
            {input('from_email', 'Sender address', { type: 'email', placeholder: 'hello@openswarm.com', hint: 'Must be allowed to send through the SMTP account (and verified in Resend, if the backup is set up).' })}
            {input('reply_to', 'Reply-to (optional)', { type: 'email', placeholder: 'team@openswarm.com' })}
            <label htmlFor={`${id}-addr`} className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-ink-2 sm:col-span-2">
              Postal address
              <textarea id={`${id}-addr`} rows={2} maxLength={300} value={w.postal_address} onChange={(e) => setWf('postal_address', e.target.value)} placeholder="Company name, street, city, postcode, country" className={`${inputClass} h-auto py-1.5`} />
              <span className="font-normal text-ink-3">Shown in the footer of every email, as anti-spam laws (CAN-SPAM) require.</span>
            </label>
          </div>
        ))}
        {group('Welcome email', 'Sent right after someone joins. The content is the branded template; you set the subject.',
          emailGroup('welcome', w.enabled, (v) => setWf('enabled', v), w.subject, (v) => setWf('subject', v)))}
        {group('Priority email', 'Sent once, when someone’s third friend joins and they unlock priority access.',
          emailGroup('priority', p.enabled, (v) => setP((x) => ({ ...x, enabled: v })), p.subject, (v) => setP((x) => ({ ...x, subject: v }))))}
        {problems.length > 0 && (
          <ul role="alert" className="list-disc pl-4 text-[12.5px] text-down">
            {problems.map((x) => <li key={x}>{x}</li>)}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {(dirtyW || dirtyP) && <span className="text-[12px] text-ink-3">Unsaved changes</span>}
          {(dirtyW || dirtyP) && <Button size="sm" variant="ghost" onClick={() => { setW(baseW); setP(baseP) }}>Discard</Button>}
          <Button type="submit" size="sm" variant="primary" disabled={!(dirtyW || dirtyP) || busy || problems.length > 0}>
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Save emails
          </Button>
        </div>
        <Status msg={msg} />
        {testMsg && (
          <p role={testMsg.ok ? 'status' : 'alert'} className={`flex items-start gap-1.5 text-[12.5px] ${testMsg.ok ? 'text-up' : 'text-down'}`}>
            {testMsg.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
            {testMsg.text}
          </p>
        )}
      </div>
      <EmailPreviewPane w={w} p={p} />
    </form>
  )
}

export function SignupSettings({ data, onSaved }: { data: AdminSettings; onSaved: () => void }) {
  const st = data.settings
  const open = st.signups_open !== false
  const message = typeof st.signups_closed_message === 'string' ? st.signups_closed_message : ''
  const domains = Array.isArray(st.blocked_email_domains) ? st.blocked_email_domains : []
  return (
    <div className="flex flex-col gap-5">
      <Section title="Signups" description="Pause the waitlist without a deploy.">
        <OpenToggle open={open} message={message} onSaved={onSaved} />
      </Section>
      <Section title="Blocking" description="Rejected addresses see a generic error, so the rules can’t be probed.">
        <DomainList block={st.block_disposable_email !== false} domains={domains} onSaved={onSaved} />
      </Section>
      <Section title="Rate limits" description="Maximum signups from one network (IP address). Offices and campuses share one, so leave some headroom.">
        <Limits hour={Number(st.signup_limit_per_hour ?? 10)} day={Number(st.signup_limit_per_day ?? 40)} onSaved={onSaved} />
      </Section>
      <Section title="Waitlist emails" description="Sent over SMTP (Google Workspace), with Resend as a backup when it is configured. If neither accepts an email, it stays queued and is retried daily.">
        <EmailsForm savedWelcome={st.welcome_email ?? DEFAULT_WELCOME} savedPriority={st.priority_email ?? DEFAULT_PRIORITY} onSaved={onSaved} />
      </Section>
    </div>
  )
}
