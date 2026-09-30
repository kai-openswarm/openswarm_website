const X_PIXEL_ID = 'rfqm7'
const X_DOWNLOAD_EVENT_ID = 'tw-rfqm7-rg3iv'
// Create a "Sign up" conversion event in X Ads Manager and set its id here.
const X_SIGNUP_EVENT_ID = import.meta.env.VITE_X_SIGNUP_EVENT_ID?.trim() ?? ''
export const AD_OPT_OUT_KEY = 'openswarm:ads-opt-out'

interface XWindow extends Window {
  twq?: {
    (...args: unknown[]): void
    exe?: (...args: unknown[]) => void
    queue: unknown[][]
    version: string
  }
}

let installed = false
let lastDownloadAt = 0

function xWindow() {
  return window as XWindow
}

function createQueue(): NonNullable<XWindow['twq']> {
  const twq: NonNullable<XWindow['twq']> = function (...args: unknown[]) {
    if (twq.exe) {
      twq.exe(...args)
    } else {
      twq.queue.push(args)
    }
  }

  twq.version = '1.1'
  twq.queue = [] as unknown[][]
  return twq
}

function trackDownload() {
  const now = Date.now()
  if (now - lastDownloadAt < 1000) return

  lastDownloadAt = now
  xWindow().twq?.('event', X_DOWNLOAD_EVENT_ID, {})
}

function isDownloadLink(target: EventTarget | null) {
  if (!(target instanceof Element)) return false

  const anchor = target.closest<HTMLAnchorElement>('a[href]')
  if (!anchor) return false

  try {
    return new URL(anchor.href, window.location.href).pathname.toLowerCase().endsWith('.dmg')
  } catch {
    return false
  }
}

/** Global Privacy Control or the site's "Your privacy choices" opt-out keeps ad tracking off. */
export function adTrackingAllowed() {
  if (typeof window === 'undefined') return false
  if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true) return false
  try {
    return localStorage.getItem(AD_OPT_OUT_KEY) !== '1'
  } catch {
    return true
  }
}

/** Reports a completed waitlist signup as an X conversion, when configured and allowed. */
export function trackXSignup() {
  if (!installed || !X_SIGNUP_EVENT_ID || !adTrackingAllowed()) return
  xWindow().twq?.('event', X_SIGNUP_EVENT_ID, {})
}

export function installXPixel() {
  if (installed || typeof window === 'undefined' || !adTrackingAllowed()) return
  const hostname = window.location.hostname.toLowerCase().replace(/\.$/, '')
  // Keep local waitlist testing local; ad scripts can inspect form interactions.
  if (
    import.meta.env.DEV ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname === '0.0.0.0'
  ) return
  installed = true

  const win = xWindow()
  win.twq ??= createQueue()
  win.twq('config', X_PIXEL_ID)

  const script = document.createElement('script')
  script.async = true
  script.src = 'https://static.ads-twitter.com/uwt.js'
  document.head.appendChild(script)

  document.addEventListener(
    'click',
    (event) => {
      if (isDownloadLink(event.target)) trackDownload()
    },
    true,
  )
}
