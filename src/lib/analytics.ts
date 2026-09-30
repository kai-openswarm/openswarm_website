/*
  First-party website analytics. Events go only to this site's /api/collect endpoint
  and are stored in the Open Swarm database; nothing here is shared with ad networks.
  The visitor id is a random value in this browser's storage. No email addresses,
  form contents or query strings are ever sent.
*/

type Props = Record<string, string | number | boolean>
type QueuedEvent = { n: string, t: number, p: string, d?: Props }

const VISITOR_KEY = 'openswarm:vid'
const SESSION_KEY = 'openswarm:session'
const INTERNAL_KEY = 'openswarm:internal'
const SESSION_TIMEOUT_MS = 30 * 60 * 1000
const FLUSH_INTERVAL_MS = 5_000
const MAX_QUEUE = 50
const MAX_ERRORS = 5

const endpoint = `${import.meta.env.BASE_URL}api/collect`
let queue: QueuedEvent[] = []
let started = false
let visibleSince = 0
let activeMs = 0
let errorsSent = 0
let landing = ''
let referrer = ''
let memoryVisitor = ''
let memorySession: { id: string, last: number } | null = null

function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function read(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* Storage can be blocked; ids then last for this page view. */ }
}

function visitorId() {
  const stored = read(VISITOR_KEY)
  if (stored && /^[0-9a-f-]{36}$/.test(stored)) return stored
  memoryVisitor ||= uuid()
  write(VISITOR_KEY, memoryVisitor)
  return memoryVisitor
}

/** Sessions are shared across tabs and end after 30 minutes without activity. */
function sessionId(touch = true) {
  const now = Date.now()
  let session = memorySession
  try {
    const parsed = JSON.parse(read(SESSION_KEY) ?? 'null') as { id?: unknown, last?: unknown } | null
    if (parsed && typeof parsed.id === 'string' && typeof parsed.last === 'number') session = { id: parsed.id, last: parsed.last }
  } catch { /* Corrupt values start a new session. */ }
  if (!session || now - session.last > SESSION_TIMEOUT_MS) session = { id: uuid(), last: now }
  if (touch) session.last = now
  memorySession = session
  write(SESSION_KEY, JSON.stringify(session))
  return session.id
}

/** Ids for attaching a signup to the visit that produced it. */
export function analyticsIds() {
  if (typeof window === 'undefined') return {}
  return { visitorId: visitorId(), sessionId: sessionId(false) }
}

function internal() {
  return read(INTERNAL_KEY) === '1'
}

export function track(name: string, props?: Props) {
  if (!started) return
  queue.push({ n: name, t: Date.now(), p: window.location.pathname, ...(props ? { d: props } : {}) })
  if (queue.length >= MAX_QUEUE) flush()
}

function recordEngagement() {
  if (visibleSince) {
    activeMs += Date.now() - visibleSince
    visibleSince = document.visibilityState === 'visible' ? Date.now() : 0
  }
  if (activeMs >= 1_000) {
    track('engagement', { ms: Math.round(activeMs) })
    activeMs = 0
  }
}

export function flush(useBeacon = false) {
  if (!queue.length) return
  const events = queue.splice(0, MAX_QUEUE)
  const body = JSON.stringify({
    v: 1,
    vid: visitorId(),
    sid: sessionId(),
    sent: Date.now(),
    internal: internal() || undefined,
    wd: navigator.webdriver || undefined,
    meta: {
      url: landing,
      ref: referrer,
      screen: `${window.screen.width}x${window.screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      lang: navigator.language,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    events,
  })
  // Beacons survive page unload; normal sends use keepalive fetch.
  if (useBeacon && typeof navigator.sendBeacon === 'function') {
    if (navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))) return
  }
  void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' })
    .catch(() => { /* Analytics never interferes with the page. */ })
  if (queue.length) flush(useBeacon)
}

function observeSections() {
  if (typeof IntersectionObserver === 'undefined') return
  const seen = new Set<string>()
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const section = (entry.target as HTMLElement).dataset.section
      if (!entry.isIntersecting || !section || seen.has(section)) continue
      seen.add(section)
      track('section_view', { section })
      observer.unobserve(entry.target)
    }
  // A section counts once it crosses the middle band of the screen, which also works
  // for sections taller than the viewport.
  }, { rootMargin: '-40% 0px -40% 0px', threshold: 0 })
  const attach = () => document.querySelectorAll<HTMLElement>('[data-section]').forEach((element) => {
    if (!seen.has(element.dataset.section ?? '')) observer.observe(element)
  })
  attach()
  // Sections render after hydration; catch any that mount later.
  window.setTimeout(attach, 1_500)
}

function observeScroll() {
  const reached = new Set<number>()
  let frame = 0
  const check = () => {
    frame = 0
    const scrollable = document.documentElement.scrollHeight - window.innerHeight
    const depth = scrollable <= 0 ? 100 : Math.min(100, ((window.scrollY + 1) / scrollable) * 100)
    for (const mark of [25, 50, 75, 90, 100]) {
      if (depth >= mark - 0.5 && !reached.has(mark)) {
        reached.add(mark)
        track('scroll', { depth: mark })
      }
    }
  }
  window.addEventListener('scroll', () => { frame ||= requestAnimationFrame(check) }, { passive: true })
}

function label(element: Element) {
  const text = element.getAttribute('aria-label') || element.textContent || ''
  return text.replace(/\s+/g, ' ').trim().slice(0, 80)
}

function observeClicks() {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return
    const tracked = target.closest<HTMLElement>('[data-track]')
    if (tracked?.dataset.track) track('click', { target: tracked.dataset.track, label: label(tracked) })
    const anchor = target.closest<HTMLAnchorElement>('a[href]')
    if (!anchor) return
    try {
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin && /^https?:$/.test(url.protocol)) {
        track('outbound', { href: `${url.hostname}${url.pathname}`.slice(0, 200), label: label(anchor) })
        // The next page load may cancel pending requests.
        flush(true)
      } else if (!tracked && url.origin === window.location.origin && url.hash) {
        track('click', { target: `anchor:${url.hash.slice(1)}`, label: label(anchor) })
      }
    } catch { /* Unparseable links are ignored. */ }
  }, { capture: true })
}

function observeErrors() {
  const report = (message: string, source: string) => {
    if (errorsSent >= MAX_ERRORS) return
    errorsSent++
    track('error', { message: message.slice(0, 200), source: source.slice(0, 200) })
  }
  window.addEventListener('error', (event) => {
    const file = event.filename ? new URL(event.filename, window.location.href).pathname : ''
    report(event.message || 'Error', `${file}:${event.lineno || 0}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
    report(reason || 'Unhandled rejection', 'promise')
  })
}

async function observeVitals() {
  const { onCLS, onFCP, onINP, onLCP, onTTFB } = await import('web-vitals')
  const send = (metric: { name: string, value: number, rating: string }) => track('vital', {
    name: metric.name,
    value: metric.name === 'CLS' ? Math.round(metric.value * 1000) / 1000 : Math.round(metric.value),
    rating: metric.rating,
  })
  onCLS(send)
  onFCP(send)
  onINP(send)
  onLCP(send)
  onTTFB(send)
}

/** Starts tracking once per page load. Visiting with ?internal=1 marks this browser as the team's. */
export function startAnalytics() {
  if (started || typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  if (params.get('internal') === '1') write(INTERNAL_KEY, '1')
  if (params.get('internal') === '0') write(INTERNAL_KEY, null)
  started = true
  // Only the landing URL's campaign parameters are read on the server; the signup form never touches the URL.
  landing = window.location.href
  referrer = document.referrer

  visibleSince = document.visibilityState === 'visible' ? Date.now() : 0
  track('pageview')
  // Links back to the inviter so the dashboard can measure each invite link's reach.
  const invitedBy = params.get('ref')
  if (invitedBy && /^[A-Za-z0-9_-]{32}$/.test(invitedBy)) track('invite_visit', { code: invitedBy })
  observeSections()
  observeScroll()
  observeClicks()
  observeErrors()
  void observeVitals().catch(() => undefined)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      recordEngagement()
      flush(true)
    } else {
      visibleSince = Date.now()
    }
  })
  window.addEventListener('pagehide', () => {
    recordEngagement()
    flush(true)
  })
  window.setInterval(() => {
    // Long visible visits report engagement periodically so real-time stays current.
    if (activeMs + (visibleSince ? Date.now() - visibleSince : 0) >= 15_000) recordEngagement()
    flush()
  }, FLUSH_INTERVAL_MS)
  window.setTimeout(() => flush(), 1_000)
}

