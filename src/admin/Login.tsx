import { useState, type FormEvent, type ReactNode } from 'react'
import { Loader2, Mail } from 'lucide-react'
import { getSupabase } from './supabase'
import { Button, inputClass } from './ui'

export function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px] rounded-lg border border-line bg-panel p-6">{children}</div>
    </main>
  )
}

export function Brand() {
  return (
    <div className="mb-5 flex items-center gap-2">
      <img src="../favicon.png" alt="" className="size-6 rounded" />
      <span className="text-[14px] font-semibold">OpenSwarm Admin</span>
    </div>
  )
}

export function Login({ initialError }: { initialError?: string | null }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(initialError ?? null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const sb = getSupabase()
    if (!sb) return
    const value = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setError('Enter a valid email address.')
      return
    }
    setState('sending')
    setError(null)
    const { error: err } = await sb.auth.signInWithOtp({
      email: value,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/admin/` },
    })
    if (err) {
      setState('idle')
      // With shouldCreateUser false, unknown emails fail; keep the message generic.
      setError(err.status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'Could not send a sign-in link to that address. Only invited admins can sign in.')
      return
    }
    setState('sent')
  }

  if (state === 'sent') {
    return (
      <Centered>
        <Brand />
        <div className="flex flex-col items-start gap-2">
          <Mail className="size-5 text-accent" aria-hidden />
          <h1 className="text-[16px] font-semibold">Check your email for a sign-in link</h1>
          <p className="text-[13px] text-ink-2">
            We sent a link to <span className="font-medium text-ink">{email.trim().toLowerCase()}</span>. Open it on this device to sign in. It expires in an hour.
          </p>
          <Button variant="ghost" size="sm" className="-ml-2.5" onClick={() => setState('idle')}>Use a different email</Button>
        </div>
      </Centered>
    )
  }

  return (
    <Centered>
      <Brand />
      <h1 className="text-[16px] font-semibold">Sign in</h1>
      <p className="mt-1 text-[13px] text-ink-2">We’ll email you a one-time sign-in link.</p>
      <form className="mt-5 flex flex-col gap-3" onSubmit={submit} noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="admin-email" className="text-[12px] font-medium text-ink-2">Work email</label>
          <input
            id="admin-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@openswarm.com"
            className={`${inputClass} h-9`}
            aria-invalid={!!error}
            aria-describedby={error ? 'admin-email-error' : undefined}
          />
        </div>
        {error && <p id="admin-email-error" role="alert" className="text-[12.5px] text-down">{error}</p>}
        <Button type="submit" variant="primary" className="h-9" disabled={state === 'sending' || !email.trim()}>
          {state === 'sending' && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Send sign-in link
        </Button>
      </form>
    </Centered>
  )
}
