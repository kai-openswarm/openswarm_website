import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

const REFERRAL_CODE = /^[A-Za-z0-9_-]{32}$/
const TOKEN = /^([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/

/** Domain separation prevents a referral link from authorizing email changes. */
export function createUnsubscribeToken(referralCode: string, secret: string): string {
  if (!REFERRAL_CODE.test(referralCode) || Buffer.byteLength(secret) < 32) throw new Error('Invalid unsubscribe configuration.')
  const signature = createHmac('sha256', secret).update(`waitlist-unsubscribe:v1:${referralCode}`).digest('base64url')
  return `${referralCode}.${signature}`
}

export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  const match = TOKEN.exec(token)
  if (!match || Buffer.byteLength(secret) < 32) return null
  const expected = createUnsubscribeToken(match[1], secret).split('.')[1]
  const actualBytes = Buffer.from(match[2])
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes) ? match[1] : null
}

export function unsubscribeUrl(publicUrl: string, referralCode: string, secret: string): string {
  const url = new URL(`${publicUrl.replace(/\/$/, '')}/api/waitlist/unsubscribe`)
  url.searchParams.set('token', createUnsubscribeToken(referralCode, secret))
  return url.href
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

function page(title: string, message: string, token?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} · Open Swarm</title><style>body{margin:0;background:#f3f5f8;color:#202836;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:440px;margin:12vh auto;padding:36px;background:#fff;border:1px solid #e1e5eb;border-radius:24px;box-shadow:0 18px 60px #2739510d}p{font-size:16px;line-height:1.6;color:#566173}h1{font-size:30px;letter-spacing:-1px;font-weight:600}small{color:#617085}button{appearance:none;background:#202b41;color:white;border:0;border-radius:12px;padding:15px 20px;font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #5881e6;outline-offset:4px}@media(max-width:540px){main{margin:48px 16px;padding:28px}}</style></head><body><main><small>OPEN SWARM</small><h1>${title}</h1><p>${message}</p>${token ? `<form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Unsubscribe from emails</button></form>` : ''}</main></body></html>`
}

function send(response: ServerResponse, status: number, html: string) {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  })
  response.end(html)
}

/** GET never mutates: email link scanners can safely inspect the confirmation page. */
export function createUnsubscribeHandler(options: { secret: string, unsubscribe: (code: string) => Promise<void> }) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST')
      send(response, 405, page('Method not allowed', 'Open the unsubscribe link in your email.'))
      return
    }
    let url: URL
    try { url = new URL(request.url ?? '', 'https://waitlist.invalid') } catch {
      send(response, 400, page('This link is invalid', 'Use the unsubscribe link from your Open Swarm email.'))
      return
    }
    // The signed token stays in the URL for browser forms and RFC8058 one-click POSTs.
    // No recipient or public referral code by itself can authorize an opt-out.
    const token = url.searchParams.get('token') ?? ''
    const code = verifyUnsubscribeToken(token, options.secret)
    if (!code) {
      send(response, 400, page('This link is invalid', 'Use the unsubscribe link from your Open Swarm email.'))
      return
    }
    if (request.method === 'GET') {
      send(response, 200, page('Fewer emails?', 'You can stop Open Swarm waitlist emails here. Your waitlist place and referral progress will be kept.', token))
      return
    }
    try {
      await options.unsubscribe(code)
      send(response, 200, page('You’re unsubscribed.', 'Open Swarm waitlist emails have been turned off. Your waitlist place and referral progress are still saved.'))
    } catch {
      send(response, 503, page('Please try again', 'We couldn’t update your email preference. Please try this link again shortly.', token))
    }
  }
}
