import { appendFile, mkdir } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import Bowser from 'bowser'
import { isbot } from 'isbot'
import type { Connect } from 'vite'
import { RequestError, clientIp, hashValue, hashingSecret, header, originAllowed, readBody, requestGeo, respond } from './http.ts'

/** Events the browser tracker may send. Anything else is dropped. */
export const EVENT_NAMES = new Set([
  'pageview', 'engagement', 'scroll', 'section_view', 'click', 'outbound', 'tab',
  'waitlist_view', 'waitlist_start', 'waitlist_country', 'waitlist_error', 'waitlist_submit', 'waitlist_success', 'waitlist_fail',
  'referral_open', 'referral_copy', 'referral_share', 'privacy_optout', 'vital', 'error',
])

const MAX_BATCH_BYTES = 32_768
const MAX_EVENTS = 60
const MAX_PROPS = 12
const MAX_TEXT = 200
const MAX_CLOCK_SKEW_MS = 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROP_KEY = /^[a-z][a-z0-9_]{0,31}$/
const SCROLL_DEPTHS = new Set([25, 50, 75, 90, 100])
const REFERRAL_CODE = /^[A-Za-z0-9_-]{32}$/

export type IngestEvent = { name: string, path: string, at: string, props: Record<string, string | number | boolean> }

export type SessionMeta = {
  entry_path: string
  referrer: string | null
  referrer_domain: string | null
  channel: string
  source: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  click_id: string | null
  has_invite: boolean
  country: string | null
  region: string | null
  city: string | null
  browser: string | null
  browser_version: string | null
  os: string | null
  os_version: string | null
  device_type: string | null
  screen: string | null
  viewport: string | null
  language: string | null
  timezone: string | null
}

export type IngestBatch = {
  visitor_id: string
  session_id: string
  now: string
  internal: boolean
  meta: SessionMeta
  events: IngestEvent[]
}

export type AnalyticsStore = {
  ingest(batch: IngestBatch): Promise<void>
  /** Fixed-window rate limit; resolves false once the key is over its limit. */
  hit(key: string, windowSeconds: number, limit: number): Promise<boolean>
}

// ---------------------------------------------------------------------------
// Traffic classification
// ---------------------------------------------------------------------------

const SEARCH = [/(^|\.)google\.[a-z.]+$/, /(^|\.)bing\.com$/, /(^|\.)duckduckgo\.com$/, /(^|\.)yahoo\.[a-z.]+$/, /(^|\.)baidu\.com$/,
  /(^|\.)yandex\.[a-z.]+$/, /(^|\.)ecosia\.org$/, /^search\.brave\.com$/, /(^|\.)startpage\.com$/, /(^|\.)kagi\.com$/, /(^|\.)naver\.com$/]
const AI = [/^chatgpt\.com$/, /^chat\.openai\.com$/, /(^|\.)perplexity\.ai$/, /^claude\.ai$/, /^gemini\.google\.com$/,
  /^copilot\.microsoft\.com$/, /^you\.com$/, /(^|\.)phind\.com$/, /^poe\.com$/, /^chat\.deepseek\.com$/, /^grok\.com$/]
const SOCIAL = [/(^|\.)x\.com$/, /(^|\.)twitter\.com$/, /^t\.co$/, /(^|\.)linkedin\.com$/, /^lnkd\.in$/, /(^|\.)facebook\.com$/,
  /^fb\.com$/, /(^|\.)instagram\.com$/, /(^|\.)reddit\.com$/, /(^|\.)youtube\.com$/, /^youtu\.be$/, /(^|\.)tiktok\.com$/,
  /(^|\.)threads\.(net|com)$/, /(^|\.)discord\.(com|gg)$/, /^news\.ycombinator\.com$/, /(^|\.)producthunt\.com$/, /^bsky\.app$/,
  /(^|\.)mastodon\.[a-z.]+$/, /(^|\.)pinterest\.[a-z.]+$/, /^t\.me$/, /(^|\.)telegram\.org$/, /(^|\.)whatsapp\.com$/, /^wa\.me$/]
const SOCIAL_SOURCES = /^(x|twitter|linkedin|facebook|fb|meta|instagram|ig|reddit|youtube|tiktok|threads|discord|hackernews|hn|producthunt|bluesky|mastodon|pinterest|telegram|whatsapp)$/
const SEARCH_SOURCES = /^(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|brave|kagi)$/
const PAID_MEDIUM = /^(cpc|ppc|paid|paid[-_]?search|paid[-_]?social|display|cpm|cpv|banner|ads?|retargeting|sponsored)$/
const CLICK_IDS: [string, string][] = [
  ['gclid', 'google'], ['gbraid', 'google'], ['wbraid', 'google'], ['msclkid', 'microsoft'], ['fbclid', 'meta'],
  ['twclid', 'x'], ['ttclid', 'tiktok'], ['li_fat_id', 'linkedin'], ['rdt_cid', 'reddit'],
]
const DOMAIN_ALIASES: Record<string, string> = {
  't.co': 'x.com', 'twitter.com': 'x.com', 'mobile.twitter.com': 'x.com', 'lnkd.in': 'linkedin.com',
  'm.facebook.com': 'facebook.com', 'l.facebook.com': 'facebook.com', 'lm.facebook.com': 'facebook.com',
  'out.reddit.com': 'reddit.com', 'old.reddit.com': 'reddit.com', 'm.youtube.com': 'youtube.com', 'youtu.be': 'youtube.com',
  'l.instagram.com': 'instagram.com', 'chat.openai.com': 'chatgpt.com', 'discord.gg': 'discord.com',
}

const matches = (host: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(host))

function cleanParam(value: string | null) {
  const cleaned = value?.trim().toLowerCase().slice(0, 100)
  return cleaned || null
}

function normalizeDomain(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  return DOMAIN_ALIASES[host] ?? host
}

/** Channel grouping modeled on common analytics defaults, plus invite links and AI assistants. */
export function classifyTraffic(landing: string | undefined, rawReferrer: string | undefined, siteHost: string | null) {
  let url: URL | null = null
  try {
    url = landing ? new URL(landing) : null
    if (url && !['http:', 'https:'].includes(url.protocol)) url = null
  } catch { url = null }
  const params = url?.searchParams ?? new URLSearchParams()
  const utm = {
    utm_source: cleanParam(params.get('utm_source')),
    utm_medium: cleanParam(params.get('utm_medium')),
    utm_campaign: cleanParam(params.get('utm_campaign')),
    utm_term: cleanParam(params.get('utm_term')),
    utm_content: cleanParam(params.get('utm_content')),
  }
  const clickEntry = CLICK_IDS.find(([key]) => params.get(key))
  const click_id = clickEntry?.[1] ?? null
  const has_invite = REFERRAL_CODE.test(params.get('ref') ?? '')

  let referrer: string | null = null
  let referrer_domain: string | null = null
  try {
    const parsed = rawReferrer ? new URL(rawReferrer) : null
    if (parsed && ['http:', 'https:'].includes(parsed.protocol)) {
      const self = siteHost && parsed.host.toLowerCase() === siteHost.toLowerCase()
      if (!self) {
        referrer_domain = normalizeDomain(parsed.hostname)
        // Paths can carry search terms or identifiers; keep only the origin and path.
        referrer = `${parsed.origin}${parsed.pathname}`.slice(0, 300)
      }
    }
  } catch { /* An unreadable referrer counts as direct. */ }

  const medium = utm.utm_medium ?? ''
  const src = utm.utm_source ?? ''
  const refDomain = referrer_domain ?? ''
  const socialish = SOCIAL_SOURCES.test(src) || matches(refDomain, SOCIAL) || ['meta', 'x', 'tiktok', 'linkedin', 'reddit'].includes(click_id ?? '')
  let channel: string
  if (PAID_MEDIUM.test(medium) || click_id) {
    channel = socialish || /social/.test(medium) ? 'Paid Social' : medium === 'display' || medium === 'cpm' || medium === 'banner' ? 'Display' : 'Paid Search'
  } else if (/e-?mail|newsletter/.test(medium) || /e-?mail|newsletter/.test(src)) {
    channel = 'Email'
  } else if (has_invite && !src && !medium) {
    channel = 'Invite link'
  } else if (matches(refDomain, AI) || /^(chatgpt|openai|perplexity|claude|gemini|copilot)$/.test(src)) {
    channel = 'AI Assistants'
  } else if (/social|sm|social[-_]network/.test(medium) || socialish) {
    channel = 'Organic Social'
  } else if (medium === 'organic' || matches(refDomain, SEARCH) || SEARCH_SOURCES.test(src)) {
    channel = 'Organic Search'
  } else if (medium === 'referral' || medium === 'affiliate' || refDomain) {
    channel = 'Referral'
  } else if (src || medium) {
    channel = 'Other Campaigns'
  } else {
    channel = 'Direct'
  }
  const source = utm.utm_source ?? (click_id ? click_id : null) ?? referrer_domain ?? (has_invite ? 'invite' : '(direct)')

  return {
    entry_path: (url?.pathname ?? '/').slice(0, 256),
    referrer,
    referrer_domain,
    channel,
    source,
    ...utm,
    click_id,
    has_invite,
  }
}

export function parseUserAgent(userAgent: string | undefined) {
  if (!userAgent) return { browser: null, browser_version: null, os: null, os_version: null, device_type: null }
  const parsed = Bowser.parse(userAgent.slice(0, 512))
  const platform = parsed.platform.type
  return {
    browser: parsed.browser.name ?? null,
    browser_version: parsed.browser.version?.split('.')[0] ?? null,
    os: parsed.os.name ?? null,
    os_version: parsed.os.versionName ?? parsed.os.version ?? null,
    device_type: platform === 'mobile' || platform === 'tablet' || platform === 'desktop' || platform === 'tv' ? platform : 'desktop',
  }
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

function text(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, max)
  return trimmed || null
}

function dimension(value: unknown) {
  const cleaned = text(value, 20)
  return cleaned && /^\d{2,5}x\d{2,5}$/.test(cleaned) ? cleaned : null
}

function sanitizeProps(name: string, raw: unknown): Record<string, string | number | boolean> | null {
  const props: Record<string, string | number | boolean> = {}
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== 'object' || Array.isArray(raw)) return null
    for (const [key, value] of Object.entries(raw).slice(0, MAX_PROPS)) {
      if (!PROP_KEY.test(key)) continue
      if (typeof value === 'string') {
        const cleaned = text(value)
        if (cleaned) props[key] = cleaned
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        props[key] = value
      } else if (typeof value === 'boolean') {
        props[key] = value
      }
    }
  }
  // Fields the database aggregates must have the exact type it casts to.
  if (name === 'engagement') {
    if (typeof props.ms !== 'number' || props.ms < 0) return null
    props.ms = Math.min(Math.round(props.ms), 1_800_000)
  }
  if (name === 'scroll' && !(typeof props.depth === 'number' && SCROLL_DEPTHS.has(props.depth))) return null
  if (name === 'vital' && !(typeof props.value === 'number' && props.value >= 0 && typeof props.name === 'string')) return null
  if (name === 'waitlist_success' && 'added' in props && typeof props.added !== 'boolean') delete props.added
  return props
}

function sanitizePath(value: unknown) {
  const raw = text(value, 256)
  if (!raw || !raw.startsWith('/')) return '/'
  return raw.split(/[?#]/)[0] || '/'
}

export type ClientBatch = {
  visitorId: string
  sessionId: string
  internal: boolean
  automated: boolean
  landing?: string
  referrer?: string
  screen: string | null
  viewport: string | null
  language: string | null
  timezone: string | null
  events: IngestEvent[]
}

export function parseClientBatch(input: unknown, now = Date.now()): ClientBatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestError(400, 'Invalid analytics batch.')
  const body = input as Record<string, unknown>
  if (typeof body.vid !== 'string' || !UUID.test(body.vid) || typeof body.sid !== 'string' || !UUID.test(body.sid)) {
    throw new RequestError(400, 'Invalid analytics batch.')
  }
  const sent = typeof body.sent === 'number' && Number.isFinite(body.sent) ? body.sent : now
  const meta = body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta) ? body.meta as Record<string, unknown> : {}
  const events: IngestEvent[] = []
  for (const raw of Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : []) {
    if (!raw || typeof raw !== 'object') continue
    const event = raw as Record<string, unknown>
    if (typeof event.n !== 'string' || !EVENT_NAMES.has(event.n)) continue
    const props = sanitizeProps(event.n, event.d)
    if (!props) continue
    // Client clocks are unreliable; keep only the offset from the send time.
    const offset = typeof event.t === 'number' && Number.isFinite(event.t) ? Math.min(Math.max(sent - event.t, 0), MAX_CLOCK_SKEW_MS) : 0
    events.push({ name: event.n, path: sanitizePath(event.p), at: new Date(now - offset).toISOString(), props })
  }
  const language = text(meta.lang, 35)
  const timezone = text(meta.tz, 64)
  return {
    visitorId: body.vid.toLowerCase(),
    sessionId: body.sid.toLowerCase(),
    internal: body.internal === true,
    automated: body.wd === true,
    landing: text(meta.url, 2000) ?? undefined,
    referrer: text(meta.ref, 2000) ?? undefined,
    screen: dimension(meta.screen),
    viewport: dimension(meta.viewport),
    language: language && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language) ? language : null,
    timezone: timezone && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(timezone) ? timezone : null,
    events,
  }
}

export function buildIngestBatch(batch: ClientBatch, request: IncomingMessage, now = Date.now()): IngestBatch {
  const siteHost = header(request, 'x-forwarded-host') ?? header(request, 'host') ?? null
  return {
    visitor_id: batch.visitorId,
    session_id: batch.sessionId,
    now: new Date(now).toISOString(),
    internal: batch.internal,
    meta: {
      ...classifyTraffic(batch.landing, batch.referrer, siteHost),
      ...requestGeo(request),
      ...parseUserAgent(header(request, 'user-agent')),
      screen: batch.screen,
      viewport: batch.viewport,
      language: batch.language,
      timezone: batch.timezone,
    },
    events: batch.events,
  }
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

export type CollectOptions = {
  secret?: string
  now?: () => number
  /** Batches per minute from one network before requests are rejected. */
  perMinute?: number
}

export function createCollectHandler(store: AnalyticsStore, options: CollectOptions = {}) {
  const perMinute = options.perMinute ?? 240
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (request.method !== 'POST') {
        respond(response, 405, { ok: false, error: 'Use POST.' }, { Allow: 'POST' })
        return
      }
      if (!originAllowed(request)) throw new RequestError(403, 'Forbidden.')
      const contentType = header(request, 'content-type')?.split(';')[0].trim().toLowerCase()
      // sendBeacon may label the JSON body text/plain.
      if (contentType !== 'application/json' && contentType !== 'text/plain') throw new RequestError(415, 'Send JSON.')
      const body = await readBody(request, MAX_BATCH_BYTES)
      let input: unknown
      try { input = JSON.parse(body) } catch { throw new RequestError(400, 'Invalid analytics batch.') }
      const now = options.now?.() ?? Date.now()
      const batch = parseClientBatch(input, now)
      const userAgent = header(request, 'user-agent')
      // Crawlers, headless browsers and automation are acknowledged but not stored.
      if (batch.automated || !userAgent || isbot(userAgent) || batch.events.length === 0) {
        respond(response, 204, null)
        return
      }
      const network = hashValue(clientIp(request), options.secret ?? hashingSecret())
      if (!await store.hit(`collect:${network}`, 60, perMinute)) throw new RequestError(429, 'Too many requests.')
      await store.ingest(buildIngestBatch(batch, request, now))
      respond(response, 204, null)
    } catch (error) {
      if (error instanceof RequestError) respond(response, error.status, { ok: false, error: error.message })
      // Analytics failures never surface details; the tracker ignores responses.
      else respond(response, 503, { ok: false, error: 'Unavailable.' })
    }
  }
}

/** Local development store: appends enriched batches to a file so tracking can be inspected. */
export function createLocalCollectMiddleware(filePath: string): Connect.NextHandleFunction {
  const store: AnalyticsStore = {
    async ingest(batch) {
      await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
      await appendFile(filePath, `${JSON.stringify(batch)}\n`, { encoding: 'utf8', mode: 0o600 })
    },
    async hit() { return true },
  }
  const handler = createCollectHandler(store, { secret: 'local' })
  return (request, response, next) => {
    if (request.url?.split('?')[0] !== '/api/collect') return next()
    void handler(request, response)
  }
}
