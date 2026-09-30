import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Send, X } from 'lucide-react'
import { useApi } from '../hooks'
import { errorMessage } from '../errors'
import type { AdminSettings, SettingKey, SettingValues, WelcomeEmail } from '../types'
import { DOMAIN_RE, MAX_BLOCKED_DOMAINS, SETTING_EMAIL_RE, normalizeDomain } from '../validation'
import { Badge, Button, Switch, inputClass } from '../ui'

const DEFAULT_WELCOME: WelcomeEmail = {
  enabled: false, from_name: 'Open Swarm', from_email: '', reply_to: '', subject: '', body: '', postal_address: '',
}

const SITE = (import.meta.env.VITE_PUBLIC_SITE_URL || 'https://openswarm.com').replace(/\/$/, '')

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

function welcomeProblems(w: WelcomeEmail): string[] {
  const p: string[] = []
  if (w.from_name.length > 80) p.push('The from name can be up to 80 characters.')
  if (w.from_email && !SETTING_EMAIL_RE.test(w.from_email)) p.push('The from address is not a valid email address.')
  if (w.reply_to && !SETTING_EMAIL_RE.test(w.reply_to)) p.push('The reply-to address is not a valid email address.')
  if (w.subject.trim().length < 1 || w.subject.trim().length > 150) p.push('The subject must be 1 to 150 characters.')
  if (w.body.trim().length < 1 || w.body.trim().length > 5000) p.push('The body must be 1 to 5,000 characters.')
  if (w.postal_address.length > 300) p.push('The postal address can be up to 300 characters.')
  if (w.enabled && (!w.from_email || !w.postal_address.trim())) p.push('Set a from address and a postal address before turning the welcome email on.')
  return p
}

function WelcomeEmailForm({ saved, me, onSaved }: { saved: WelcomeEmail; me: string; onSaved: () => void }) {
  const api = useApi()
  const id = useId()
  const s = useSave(onSaved)
  const [w, setW] = useState<WelcomeEmail>({ ...DEFAULT_WELCOME, ...saved })
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<Msg>(null)
  const set = <K extends keyof WelcomeEmail>(k: K, v: WelcomeEmail[K]) => setW((x) => ({ ...x, [k]: v }))
  const problems = welcomeProblems(w)
  const dirty = JSON.stringify(w) !== JSON.stringify({ ...DEFAULT_WELCOME, ...saved })
  const inviteExample = `${SITE}/?ref=EXAMPLE-INVITE-CODE`
  const preview = w.body.split('{{invite_link}}').join(inviteExample)
  const hasLink = w.body.includes('{{invite_link}}')

  async function sendTest() {
    setTesting(true)
    setTestMsg(null)
    try {
      await api.testEmail(w)
      setTestMsg({ ok: true, text: `Sent a test to ${me}. It uses the form as it is now, saved or not.` })
    } catch (e) {
      const m = errorMessage(e)
      setTestMsg({ ok: false, text: /RESEND_API_KEY/i.test(m) ? `${m} Ask whoever runs the server to set RESEND_API_KEY; until then no email can be sent.` : m })
    } finally {
      setTesting(false)
    }
  }

  const field = (k: 'from_name' | 'from_email' | 'reply_to' | 'subject', label: string, extra: { type?: string; placeholder?: string; maxLength?: number; hint?: string } = {}) => (
    <label htmlFor={`${id}-${k}`} className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-ink-2">
      {label}
      <input
        id={`${id}-${k}`}
        type={extra.type ?? 'text'}
        value={w[k]}
        maxLength={extra.maxLength}
        placeholder={extra.placeholder}
        onChange={(e) => set(k, e.target.value)}
        className={inputClass}
        autoComplete="off"
      />
      {extra.hint && <span className="font-normal text-ink-3">{extra.hint}</span>}
    </label>
  )

  return (
    <form
      className="grid gap-5 lg:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!problems.length) await s.save('welcome_email', { ...w, subject: w.subject.trim(), body: w.body.trim() })
      }}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <label className="flex items-center justify-between gap-4 text-[13px]">
          <span id={`${id}-en`}>
            <span className="font-medium">Send a welcome email to new signups</span>
            <span className="block text-[12px] text-ink-3">Needs a from address and a postal address. Takes effect when you save.</span>
          </span>
          <Switch checked={w.enabled} labelledBy={`${id}-en`} onChange={(v) => set('enabled', v)} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('from_name', 'From name', { maxLength: 80 })}
          {field('from_email', 'From address', { type: 'email', placeholder: 'hello@openswarm.com', hint: 'Must be on a domain verified with the email provider.' })}
          {field('reply_to', 'Reply-to (optional)', { type: 'email', placeholder: 'team@openswarm.com' })}
          {field('subject', 'Subject', { maxLength: 150 })}
        </div>
        <label htmlFor={`${id}-body`} className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Body (plain text)
          <textarea
            id={`${id}-body`}
            rows={9}
            maxLength={5000}
            value={w.body}
            onChange={(e) => set('body', e.target.value)}
            className={`${inputClass} h-auto py-1.5 font-mono text-[12.5px] leading-relaxed`}
            aria-describedby={`${id}-body-help`}
          />
          <span id={`${id}-body-help`} className="font-normal text-ink-3">
            <code className="rounded bg-hover px-1 font-mono">{'{{invite_link}}'}</code> is replaced with the person’s invite link; an unsubscribe link and the postal address are added automatically.
            <span className="ml-1 num">{w.body.trim().length}/5000</span>
          </span>
        </label>
        <label htmlFor={`${id}-addr`} className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Postal address
          <textarea
            id={`${id}-addr`}
            rows={2}
            maxLength={300}
            value={w.postal_address}
            onChange={(e) => set('postal_address', e.target.value)}
            placeholder="Company name, street, city, postcode, country"
            className={`${inputClass} h-auto py-1.5`}
          />
          <span className="font-normal text-ink-3">Required by anti-spam laws (CAN-SPAM) in every marketing email.</span>
        </label>
        {problems.length > 0 && (
          <ul role="alert" className="list-disc pl-4 text-[12.5px] text-down">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        {!hasLink && w.body.trim() && <p className="text-[12.5px] text-ink-3">Tip: add {'{{invite_link}}'} so people can share their link straight from the email.</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty && <span className="text-[12px] text-ink-3">Unsaved changes</span>}
          {dirty && <Button size="sm" variant="ghost" onClick={() => setW({ ...DEFAULT_WELCOME, ...saved })}>Discard</Button>}
          <Button size="sm" onClick={sendTest} disabled={testing || !w.from_email || problems.some((p) => !p.startsWith('Set a from'))}>
            {testing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />} Send test email
          </Button>
          <Button type="submit" size="sm" variant="primary" disabled={!dirty || s.busy || problems.length > 0}>
            {s.busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Save welcome email
          </Button>
        </div>
        <Status msg={s.msg} />
        {testMsg && (
          <p role={testMsg.ok ? 'status' : 'alert'} className={`flex items-start gap-1.5 text-[12.5px] ${testMsg.ok ? 'text-up' : 'text-down'}`}>
            {testMsg.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
            {testMsg.text}
          </p>
        )}
      </div>

      <div className="min-w-0">
        <p className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-ink-2">
          Preview {w.enabled ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}
        </p>
        <div className="overflow-hidden rounded-md border border-line bg-panel-2 text-[13px]">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-b border-line px-3 py-2 text-[12px]">
            <dt className="text-ink-3">From</dt>
            <dd className="min-w-0 truncate">{w.from_name || '(no name)'} &lt;{w.from_email || 'not set'}&gt;</dd>
            {w.reply_to && (<><dt className="text-ink-3">Reply-to</dt><dd className="min-w-0 truncate">{w.reply_to}</dd></>)}
            <dt className="text-ink-3">Subject</dt>
            <dd className="min-w-0 truncate font-medium">{w.subject || '(no subject)'}</dd>
          </dl>
          <div className="px-3 py-3 break-words whitespace-pre-wrap">{preview || <span className="text-ink-3">(empty body)</span>}</div>
          <div className="border-t border-dashed border-line px-3 py-2 text-[11.5px] whitespace-pre-wrap text-ink-3">
            {'Don’t want these emails? [one-click unsubscribe link]'}{'\n'}{w.postal_address || '(postal address not set)'}
          </div>
        </div>
      </div>
    </form>
  )
}

export function SignupSettings({ data, onSaved }: { data: AdminSettings; onSaved: () => void }) {
  const st = data.settings
  const open = st.signups_open !== false
  const message = typeof st.signups_closed_message === 'string' ? st.signups_closed_message : ''
  const domains = Array.isArray(st.blocked_email_domains) ? st.blocked_email_domains : []
  const welcome = st.welcome_email ?? DEFAULT_WELCOME
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
      <Section title="Welcome email" description="Sent once, right after someone joins.">
        <WelcomeEmailForm saved={welcome} me={data.me} onSaved={onSaved} />
      </Section>
    </div>
  )
}
