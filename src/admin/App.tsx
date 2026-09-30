import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { AdminApi } from './api'
import { loadApi } from './api'
import { ApiContext } from './hooks'
import { Brand, Centered, Login } from './Login'
import { Shell } from './Shell'
import { getSupabase, supabaseConfigured } from './supabase'
import { isMockMode } from './mode'
import { errorMessage } from './errors'
import { Button } from './ui'

type Auth =
  | { status: 'loading' }
  | { status: 'config' }
  | { status: 'signedOut' }
  | { status: 'denied'; email: string | null }
  | { status: 'ready'; email: string }
  | { status: 'error'; message: string }

/** Supabase puts auth errors in the redirect URL fragment, e.g. an expired link. */
function readRedirectError(): string | null {
  const h = window.location.hash
  if (!h.includes('error_description=')) return null
  const p = new URLSearchParams(h.slice(1))
  const d = p.get('error_description')
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/overview`)
  return d ? `${d.replace(/\+/g, ' ')}. Request a new link.` : null
}

function normalizeHash() {
  if (!window.location.hash.startsWith('#/')) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/overview`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
}

export function App() {
  const [api, setApi] = useState<AdminApi | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [redirectError] = useState(readRedirectError)
  const [liveSession, setLiveSession] = useState<string | null | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const [check, setCheck] = useState<{ for: string; auth: Auth } | null>(null)
  const configMissing = !isMockMode && !supabaseConfigured

  // Resolve the data layer.
  useEffect(() => {
    if (configMissing) return
    loadApi().then(setApi, (e: unknown) => setLoadError(errorMessage(e)))
  }, [configMissing])

  // Track the Supabase session (live mode only).
  useEffect(() => {
    if (!api || api.mode === 'mock') return
    const sb = getSupabase()
    if (!sb) return
    sb.auth.getSession().then(({ data }) => setLiveSession(data.session?.user.id ?? null))
    const { data } = sb.auth.onAuthStateChange((_event, session) => {
      setLiveSession(session?.user.id ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [api])

  const sessionKey = api?.mode === 'mock' ? 'mock' : liveSession
  const checkFor = `${sessionKey}#${attempt}`

  // Check admin access whenever the signed-in user changes.
  useEffect(() => {
    if (!api || !sessionKey) return
    let cancelled = false
    api.whoami().then(
      (w) => {
        if (cancelled) return
        normalizeHash()
        setCheck({ for: checkFor, auth: w.is_admin && w.email ? { status: 'ready', email: w.email } : { status: 'denied', email: w.email } })
      },
      (e: unknown) => {
        if (!cancelled) setCheck({ for: checkFor, auth: { status: 'error', message: errorMessage(e) } })
      },
    )
    return () => { cancelled = true }
  }, [api, sessionKey, checkFor])

  let auth: Auth
  if (configMissing) auth = { status: 'config' }
  else if (loadError) auth = { status: 'error', message: loadError }
  else if (!api || sessionKey === undefined) auth = { status: 'loading' }
  else if (sessionKey === null) auth = { status: 'signedOut' }
  else if (check?.for !== checkFor) auth = { status: 'loading' }
  else auth = check.auth

  const signOut = async () => {
    await getSupabase()?.auth.signOut()
    setLiveSession(null)
  }

  switch (auth.status) {
    case 'loading':
      return (
        <main className="flex min-h-svh items-center justify-center" role="status" aria-label="Loading">
          <Loader2 className="size-5 animate-spin text-ink-3" aria-hidden />
        </main>
      )
    case 'config':
      return (
        <Centered>
          <Brand />
          <h1 className="text-[16px] font-semibold">Dashboard not configured</h1>
          <p className="mt-2 text-[13px] text-ink-2">
            Set <code className="font-mono text-[12px]">VITE_SUPABASE_URL</code> and <code className="font-mono text-[12px]">VITE_SUPABASE_ANON_KEY</code> for this build, then rebuild and redeploy.
          </p>
          {import.meta.env.DEV && (
            <p className="mt-3 text-[13px] text-ink-2">
              To review the UI with fixture data, open <a className="underline" href="?mock=1">/admin/?mock=1</a> or set <code className="font-mono text-[12px]">VITE_ADMIN_MOCK=1</code>.
            </p>
          )}
        </Centered>
      )
    case 'signedOut':
      return <Login initialError={redirectError} />
    case 'denied':
      return (
        <Centered>
          <Brand />
          <h1 className="text-[16px] font-semibold">This account does not have admin access</h1>
          <p className="mt-2 text-[13px] text-ink-2">
            {auth.email ? <>You are signed in as <span className="font-medium text-ink">{auth.email}</span>. </> : null}
            Ask an existing admin to invite you, or sign in with a different account.
          </p>
          <Button variant="primary" className="mt-4" onClick={signOut}>Sign out</Button>
        </Centered>
      )
    case 'error':
      return (
        <Centered>
          <Brand />
          <h1 className="text-[16px] font-semibold">Something went wrong</h1>
          <p className="mt-2 text-[13px] text-ink-2" role="alert">{auth.message}</p>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
            {api?.mode === 'live' && <Button onClick={signOut}>Sign out</Button>}
          </div>
        </Centered>
      )
    case 'ready':
      return (
        <ApiContext.Provider value={api}>
          <Shell email={auth.email} mock={api?.mode === 'mock'} onSignOut={signOut} />
        </ApiContext.Provider>
      )
  }
}
