import type { IncomingMessage, ServerResponse } from 'node:http'
import { hashValue, hashingSecret, header, readBody, respond } from './http.ts'
import type { WelcomeEmail } from './signup-config.ts'

export type EmailResult = { status: 'sent' | 'failed' | 'skipped', providerId?: string, detail?: string }

/** Public origin used in email links. */
export function publicOrigin(request?: IncomingMessage) {
  const configured = process.env.VITE_PUBLIC_SITE_URL?.trim()
  try {
    if (configured) return new URL(configured).origin
  } catch { /* Fall back to the request host. */ }
  const host = request && (header(request, 'x-forwarded-host') ?? header(request, 'host'))
  return host ? `https://${host}` : 'https://openswarm.com'
}

/** Unguessable per-signup token so unsubscribe links cannot be forged from a referral code alone. */
export function unsubscribeToken(code: string, secret = hashingSecret()) {
  return hashValue(`unsubscribe:${code}`, secret)
}

export function unsubscribeUrl(origin: string, code: string, secret?: string) {
  const url = new URL('/api/unsubscribe', origin)
  url.searchParams.set('c', code)
  url.searchParams.set('t', unsubscribeToken(code, secret))
  return url.toString()
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[character]!)
}

/** Plain-text template with {{invite_link}}; the unsubscribe link and postal address are always appended. */
export function renderWelcome(template: WelcomeEmail, inviteLink: string, unsubscribe: string) {
  const body = template.body.replaceAll('{{invite_link}}', inviteLink).trim()
  const footer = [
    'You’re receiving this because you joined the Open Swarm waitlist.',
    `Unsubscribe: ${unsubscribe}`,
    template.postal_address.trim(),
  ].filter(Boolean)
  const text = `${body}\n\n--\n${footer.join('\n')}\n`
  const linkify = (value: string) => escapeHtml(value).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`)
  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#111">`
    + body.split(/\n{2,}/).map((paragraph) => `<p>${linkify(paragraph).replaceAll('\n', '<br>')}</p>`).join('')
    + `<hr style="border:0;border-top:1px solid #ddd;margin:24px 0"><p style="font-size:12px;color:#666">${footer.map(linkify).join('<br>')}</p>`
    + '</body></html>'
  return { text, html }
}

/** Sends through Resend (https://resend.com) when RESEND_API_KEY is set. */
export async function sendWelcomeEmail(
  template: WelcomeEmail,
  to: string,
  inviteLink: string,
  unsubscribe: string,
  apiKey = process.env.RESEND_API_KEY?.trim(),
  request_: typeof fetch = fetch,
): Promise<EmailResult> {
  if (!apiKey) return { status: 'skipped', detail: 'RESEND_API_KEY is not configured.' }
  if (!template.from_email) return { status: 'skipped', detail: 'No from address is set.' }
  const { text, html } = renderWelcome(template, inviteLink, unsubscribe)
  try {
    const response = await request_('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: template.from_name ? `${template.from_name.replace(/[<>"]/g, '')} <${template.from_email}>` : template.from_email,
        to: [to],
        ...(template.reply_to ? { reply_to: template.reply_to } : {}),
        subject: template.subject,
        text,
        html,
        headers: {
          'List-Unsubscribe': `<${unsubscribe}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
      signal: AbortSignal.timeout(5_000),
    })
    const result = await response.json().catch(() => ({})) as { id?: string, message?: string }
    if (!response.ok) return { status: 'failed', detail: `Resend ${response.status}: ${result.message ?? 'request failed'}`.slice(0, 500) }
    return { status: 'sent', providerId: result.id }
  } catch (error) {
    return { status: 'failed', detail: error instanceof Error ? error.message.slice(0, 500) : 'Request failed' }
  }
}

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} | Open Swarm</title>
<style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;color:#111}button{font:inherit;padding:10px 18px;border-radius:999px;border:1px solid #111;background:#111;color:#fff;cursor:pointer}a{color:#111}@media(prefers-color-scheme:dark){body{background:#0b0b0c;color:#eee}button{background:#eee;color:#111;border-color:#eee}a{color:#eee}}</style></head><body>${body}</body></html>`

/**
 * GET shows a confirmation button (mail scanners follow links but do not submit forms);
 * POST unsubscribes, including RFC 8058 one-click requests from mail clients.
 */
export function createUnsubscribeHandler(unsubscribe: (code: string) => Promise<boolean>, secret?: string) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    let code = url.searchParams.get('c') ?? ''
    let token = url.searchParams.get('t') ?? ''
    const html = (status: number, title: string, body: string) => {
      response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' })
      response.end(page(title, body))
    }
    if (request.method === 'POST') {
      try {
        const form = new URLSearchParams(await readBody(request, 2_048))
        code = form.get('c') ?? code
        token = form.get('t') ?? token
      } catch { /* Query parameters remain. */ }
    } else if (request.method !== 'GET') {
      respond(response, 405, { ok: false, error: 'Use GET or POST.' }, { Allow: 'GET, POST' })
      return
    }
    const valid = /^[A-Za-z0-9_-]{32}$/.test(code) && token === unsubscribeToken(code, secret)
    if (!valid) return html(400, 'Link not valid', '<h1>This unsubscribe link isn’t valid</h1><p>It may be incomplete. Reply to any Open Swarm email and we’ll unsubscribe you.</p>')
    if (request.method === 'GET') {
      const safe = (value: string) => escapeHtml(value)
      return html(200, 'Unsubscribe', `<h1>Unsubscribe from Open Swarm emails?</h1><p>You’ll stay on the waitlist, but we won’t email you updates.</p><form method="post"><input type="hidden" name="c" value="${safe(code)}"><input type="hidden" name="t" value="${safe(token)}"><button type="submit">Unsubscribe</button></form>`)
    }
    try {
      await unsubscribe(code)
      html(200, 'Unsubscribed', '<h1>You’re unsubscribed</h1><p>We won’t send you more Open Swarm emails. You’re still on the waitlist.</p><p><a href="/">Back to Open Swarm</a></p>')
    } catch {
      html(503, 'Try again', '<h1>Something went wrong</h1><p>Please try again in a minute.</p>')
    }
  }
}
