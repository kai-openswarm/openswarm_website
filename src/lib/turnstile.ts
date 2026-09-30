/*
  Cloudflare Turnstile bot check for the waitlist. Inactive until VITE_TURNSTILE_SITE_KEY
  (and the server's TURNSTILE_SECRET_KEY) are configured. The widget stays hidden unless
  Cloudflare needs the visitor to interact.
*/

type Turnstile = {
  render(container: HTMLElement, options: Record<string, unknown>): string
  execute(widget: string): void
  reset(widget: string): void
  remove(widget: string): void
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? ''
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading: Promise<Turnstile> | null = null

function load(): Promise<Turnstile> {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const existing = (window as Window & { turnstile?: Turnstile }).turnstile
    if (existing) return resolve(existing)
    const script = document.createElement('script')
    script.src = SCRIPT
    script.async = true
    script.onload = () => {
      const api = (window as Window & { turnstile?: Turnstile }).turnstile
      if (api) resolve(api)
      else reject(new Error('Turnstile unavailable'))
    }
    script.onerror = () => {
      loading = null
      reject(new Error('Turnstile unavailable'))
    }
    document.head.appendChild(script)
  })
  return loading
}

export const turnstileEnabled = !!SITE_KEY

/** Starts loading early (for example when the email field is focused). */
export function prepareTurnstile() {
  if (SITE_KEY) void load().catch(() => undefined)
}

/** Resolves a single-use token, or undefined when Turnstile is not configured. */
export async function turnstileToken(): Promise<string | undefined> {
  if (!SITE_KEY) return undefined
  const api = await load()
  const container = document.createElement('div')
  container.className = 'turnstile-host'
  document.body.appendChild(container)
  return new Promise<string>((resolve, reject) => {
    let widget = ''
    const cleanup = () => {
      window.clearTimeout(timer)
      try { api.remove(widget) } catch { /* Already removed. */ }
      container.remove()
    }
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('Verification timed out')) }, 60_000)
    widget = api.render(container, {
      sitekey: SITE_KEY,
      appearance: 'interaction-only',
      execution: 'execute',
      action: 'waitlist',
      callback: (token: string) => { cleanup(); resolve(token) },
      'error-callback': () => { cleanup(); reject(new Error('Verification failed')) },
    })
    api.execute(widget)
  })
}
