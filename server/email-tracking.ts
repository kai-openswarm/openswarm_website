import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isbot } from 'isbot'
import { header, readBody, respond } from './http.ts'
import { exploreUrl, shareMailto } from './waitlist-email.ts'

/** What a tracked email belongs to: a queued job, or a dashboard test send (no job). */
export type TrackedEmail = { kind: 'welcome' | 'priority' | 'test', jobId: string | null, referralCode: string }

export type EmailEvent = {
  job_id?: string | null
  provider_id?: string
  kind?: TrackedEmail['kind']
  type: 'open' | 'click' | 'delivered' | 'delivery_delayed' | 'bounced' | 'complained'
  link?: string
  source: 'site' | 'resend'
  automated?: boolean
  provider_event_id?: string
  detail?: string
  occurred_at?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODE = /^[A-Za-z0-9_-]{32}$/
const KINDS = new Set(['welcome', 'priority', 'test'])
/** The only buttons that are measured. The invite link stays unwrapped so friends' visits count as invites. */
const LINKS = new Set(['share', 'explore'])

const sign = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(`email-track:v1:${payload}`).digest('base64url').slice(0, 22)

/** Signed so opens and clicks cannot be forged for other people's emails. */
export function trackingToken(email: TrackedEmail, secret: string) {
  const payload = Buffer.from(`${email.kind}:${email.jobId ?? '-'}:${email.referralCode}`).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

export function readTrackingToken(token: string, secret: string): TrackedEmail | null {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined || payload.length > 200) return null
  const expected = Buffer.from(sign(payload, secret))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  const [kind, job, code] = Buffer.from(payload, 'base64url').toString('utf8').split(':')
  if (!KINDS.has(kind) || !CODE.test(code ?? '') || (job !== '-' && !UUID.test(job ?? ''))) return null
  return { kind: kind as TrackedEmail['kind'], jobId: job === '-' ? null : job, referralCode: code }
}

/** The tracked button link and open pixel for one email. */
export function trackingUrls(publicUrl: string, email: TrackedEmail, secret: string) {
  const token = trackingToken(email, secret)
  const base = publicUrl.replace(/\/$/, '')
  const link = email.kind === 'priority' ? 'explore' : 'share'
  return {
    action: `${base}/api/email/click?t=${encodeURIComponent(token)}&l=${link}`,
    pixel: `${base}/api/email/open?t=${encodeURIComponent(token)}`,
  }
}

/** Crawlers, link scanners and prefetchers (HEAD requests, empty or bot user agents) are recorded but flagged. */
function automated(request: IncomingMessage) {
  const agent = header(request, 'user-agent')
  return request.method === 'HEAD' || !agent || isbot(agent)
}

function event(email: TrackedEmail, type: 'open' | 'click', request: IncomingMessage, link?: string): EmailEvent {
  return {
    ...(email.jobId ? { job_id: email.jobId } : { kind: 'test' as const }),
    type, source: 'site', automated: automated(request), ...(link ? { link } : {}),
  }
}

// 1×1 transparent GIF.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export type TrackingDeps = { secret: string, publicUrl: string, record: (event: EmailEvent) => Promise<unknown> }

/** Always returns the pixel, even for bad tokens or storage failures, so mail clients never show a broken image. */
export function createOpenHandler(deps: TrackingDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const token = new URL(request.url ?? '/', 'https://x.invalid').searchParams.get('t') ?? ''
    const email = readTrackingToken(token, deps.secret)
    if (email && (request.method === 'GET' || request.method === 'HEAD')) {
      await deps.record(event(email, 'open', request)).catch(() => undefined)
    }
    response.writeHead(200, {
      'Content-Type': 'image/gif', 'Content-Length': String(PIXEL.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, private', 'X-Robots-Tag': 'noindex',
    })
    response.end(request.method === 'HEAD' ? undefined : PIXEL)
  }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)

/**
 * Records the click, then sends the person on. Destinations are fixed by the link name, so this is
 * not an open redirect. The share button opens the person's email app through a small page,
 * because a redirect straight to mailto: is unreliable across browsers.
 */
export function createClickHandler(deps: TrackingDeps) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'https://x.invalid')
    const email = readTrackingToken(url.searchParams.get('t') ?? '', deps.secret)
    const link = url.searchParams.get('l') ?? ''
    const site = `${deps.publicUrl.replace(/\/$/, '')}/`
    if (!email || !LINKS.has(link)) {
      response.writeHead(302, { Location: site, 'Cache-Control': 'no-store' })
      response.end()
      return
    }
    await deps.record(event(email, 'click', request, link)).catch(() => undefined)
    if (link === 'explore') {
      response.writeHead(302, { Location: exploreUrl(site), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
      response.end()
      return
    }
    const invite = new URL(site)
    invite.searchParams.set('ref', email.referralCode)
    const mailto = escapeHtml(shareMailto(invite.href))
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    })
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${mailto}"><title>Share your invite · Open Swarm</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f3;color:#292b27}main{max-width:440px;margin:14vh auto;padding:32px;background:#fff;border:1px solid #e6e7e3;border-radius:12px}a.button{display:inline-block;background:#292b27;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none}p{color:#62645e;line-height:1.6}code{word-break:break-all}</style></head>
<body><main><h1 style="font-weight:400">Share your invite</h1><p>Your email app should open with a message ready to send. If it doesn’t, use the button or copy your link.</p>
<p><a class="button" href="${mailto}">Open email draft</a></p><p>Your invite link:<br><code>${escapeHtml(invite.href)}</code></p></main></body></html>`)
  }
}

const RESEND_TYPES: Record<string, EmailEvent['type']> = {
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.opened': 'open',
  'email.clicked': 'click',
}

/** Resend signs webhooks with Svix: HMAC-SHA256 of `id.timestamp.body` using the base64 part of `whsec_…`. */
export function verifyResendSignature(body: string, headers: { id?: string, timestamp?: string, signature?: string }, secret: string, now = Date.now()) {
  if (!headers.id || !headers.timestamp || !headers.signature) return false
  const timestamp = Number(headers.timestamp)
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${body}`).digest()
  return headers.signature.split(' ').some((part) => {
    const [version, value] = part.split(',')
    if (version !== 'v1' || !value) return false
    const actual = Buffer.from(value, 'base64')
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  })
}

/** Delivery, bounce, delay and complaint events for emails Resend sent (the backup sender). */
export function createResendWebhookHandler(deps: { secret?: string, record: (event: EmailEvent) => Promise<unknown>, now?: () => number }) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== 'POST') {
      respond(response, 405, { ok: false }, { Allow: 'POST' })
      return
    }
    if (!deps.secret) {
      respond(response, 503, { ok: false, error: 'Webhook secret is not configured.' })
      return
    }
    let body: string
    try { body = await readBody(request, 64_000) } catch {
      respond(response, 413, { ok: false })
      return
    }
    const signed = verifyResendSignature(body, {
      id: header(request, 'svix-id'), timestamp: header(request, 'svix-timestamp'), signature: header(request, 'svix-signature'),
    }, deps.secret, deps.now?.())
    if (!signed) {
      respond(response, 401, { ok: false })
      return
    }
    try {
      const payload = JSON.parse(body) as { type?: string, created_at?: string, data?: Record<string, unknown> }
      const type = RESEND_TYPES[payload.type ?? '']
      const emailId = typeof payload.data?.email_id === 'string' ? payload.data.email_id : null
      // Other event types (for example email.sent) and unknown emails are acknowledged and ignored.
      if (type && emailId) {
        const bounce = payload.data?.bounce as { type?: string, subType?: string } | undefined
        const click = payload.data?.click as { link?: string } | undefined
        await deps.record({
          provider_id: `resend:${emailId}`, type, source: 'resend',
          provider_event_id: header(request, 'svix-id'),
          ...(payload.created_at ? { occurred_at: payload.created_at } : {}),
          ...(bounce ? { detail: [bounce.type, bounce.subType].filter(Boolean).join(': ') } : {}),
          ...(click?.link ? { link: 'resend_link', detail: String(click.link).slice(0, 200) } : {}),
        })
      }
      respond(response, 200, { ok: true })
    } catch {
      // A failure here makes Resend retry, which the unique event id keeps idempotent.
      respond(response, 503, { ok: false })
    }
  }
}
