import nodemailer from 'nodemailer'
import type { EmailPayload } from './email-outbox.ts'
import { hashingSecret } from './http.ts'

/** SMTP server credentials. Sender name, address and message settings live in the admin dashboard. */
export type SmtpConfig = { host: string, port: number, user: string, password: string }

export type EmailDeliveryConfig = {
  /** Primary sender. */
  smtp?: SmtpConfig
  /** Backup sender (Resend), used when SMTP clearly did not take a message, or alone when SMTP is not set. */
  resendApiKey?: string
  /** Canonical HTTPS site URL used for invite, artwork and unsubscribe links. */
  publicUrl: string
  /** Signs unsubscribe links. */
  secret: string
  /** Authorizes the scheduled worker. Optional: without it only signups and admins drain the queue. */
  cronSecret?: string
}

export type EmailDeliverySetup =
  | { state: 'disabled' }
  | { state: 'invalid' }
  | { state: 'ready', config: EmailDeliveryConfig }

/** SMTP settings from SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD; null unless host, user and password are all set. */
export function smtpFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim()
  const user = env.SMTP_USER?.trim()
  // Google shows app passwords in groups of four; the spaces are not part of the password.
  const password = env.SMTP_PASSWORD?.replace(/\s+/g, '')
  if (!host || !user || !password) return null
  const port = Number(env.SMTP_PORT?.trim() || 587)
  return { host, port: Number.isInteger(port) && port > 0 ? port : 587, user, password }
}

/**
 * Where email links point. Vercel's production URL follows the project's primary domain,
 * so links move from the vercel.app address to openswarm.com when the domain is attached.
 */
export function emailPublicUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.WAITLIST_EMAIL_PUBLIC_URL?.trim(),
    env.VERCEL_PROJECT_PRODUCTION_URL?.trim() && `https://${env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`,
    env.VITE_PUBLIC_SITE_URL?.trim(),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (url.protocol === 'https:' && !url.username && !url.password && url.hostname !== 'localhost') return url.origin
    } catch { /* Try the next source. */ }
  }
  return null
}

/** Delivery is possible once SMTP or Resend credentials and a public HTTPS URL exist; turning emails on is an admin setting. */
export function readEmailDeliveryConfig(env: NodeJS.ProcessEnv = process.env): EmailDeliverySetup {
  const smtp = smtpFromEnv(env)
  const resendApiKey = env.RESEND_API_KEY?.trim()
  if (!smtp && !resendApiKey) return { state: 'disabled' }
  if (resendApiKey && /\s/.test(resendApiKey)) return { state: 'invalid' }
  const publicUrl = emailPublicUrl(env)
  const secret = env.WAITLIST_EMAIL_SECRET?.trim() || hashingSecret()
  const cronSecret = env.CRON_SECRET?.trim()
  if (!publicUrl || Buffer.byteLength(secret) < 32 || (cronSecret && (Buffer.byteLength(cronSecret) < 32 || /[\r\n]/.test(cronSecret)))) {
    return { state: 'invalid' }
  }
  return { state: 'ready', config: {
    ...(smtp ? { smtp } : {}), ...(resendApiKey ? { resendApiKey } : {}),
    publicUrl, secret, ...(cronSecret ? { cronSecret } : {}),
  } }
}

/** Provider detail is deliberately excluded from the error message. */
export class EmailDeliveryError extends Error {
  readonly retryable: boolean
  /** True when the server definitely did not accept the message, so another sender cannot cause a duplicate. */
  readonly notAccepted: boolean
  constructor(message: string, options: { retryable: boolean, notAccepted?: boolean }) {
    super(message)
    this.name = 'EmailDeliveryError'
    this.retryable = options.retryable
    this.notAccepted = options.notAccepted ?? false
  }
}

export type Transport = (payload: EmailPayload, idempotencyKey: string) => Promise<{ id: string }>

/** SMTP errors raised before the server accepted the message: connection, DNS, login, or an explicit reply code. */
const NOT_ACCEPTED_CODES = new Set(['ECONNECTION', 'EDNS', 'EAUTH', 'ETLS', 'EENVELOPE', 'EMESSAGE'])

type MailTransport = {
  sendMail(message: Record<string, unknown>): Promise<{ messageId?: string }>
  close?(): void
}

const defaultTransport = (smtp: SmtpConfig): MailTransport => nodemailer.createTransport({
  host: smtp.host,
  port: smtp.port,
  // Port 465 is TLS from the first byte; other ports must upgrade with STARTTLS before signing in.
  secure: smtp.port === 465,
  requireTLS: smtp.port !== 465,
  auth: { user: smtp.user, pass: smtp.password },
  dnsTimeout: 3_000,
  connectionTimeout: 4_000,
  greetingTimeout: 4_000,
  socketTimeout: 8_000,
})

/** Parses `Name <address>` so punctuation in the name cannot change the header's meaning. */
function mailbox(value: string) {
  const match = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/)
  return match ? { name: match[1].replace(/^"|"$/g, ''), address: match[2] } : value
}

/**
 * One bounded SMTP attempt; the durable outbox owns retries. SMTP has no idempotency key,
 * so a send that times out after the server accepted it can be delivered twice on retry.
 * Server rejections (5xx) are permanent; everything else is retried.
 */
export function createSmtpTransport(smtp: SmtpConfig, createTransport: (smtp: SmtpConfig) => MailTransport = defaultTransport) {
  return async (payload: EmailPayload): Promise<{ id: string }> => {
    const transport = createTransport(smtp)
    try {
      const sent = await transport.sendMail({
        from: mailbox(payload.from),
        to: payload.to,
        ...(payload.reply_to ? { replyTo: payload.reply_to } : {}),
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        headers: payload.headers ?? {},
      })
      return { id: sent.messageId || 'smtp-accepted' }
    } catch (error) {
      const code = (error as { responseCode?: unknown })?.responseCode
      const kind = (error as { code?: unknown })?.code
      const permanent = typeof code === 'number' && code >= 500 && code !== 535 && code !== 534
      // A timeout during the message itself is ambiguous: the server may have accepted it.
      const notAccepted = typeof code === 'number' || (typeof kind === 'string' && NOT_ACCEPTED_CODES.has(kind))
      throw new EmailDeliveryError('Email delivery was not accepted.', { retryable: !permanent, notAccepted })
    } finally {
      transport.close?.()
    }
  }
}

export function createResendTransport(apiKey: string, fetcher: typeof fetch = fetch, timeoutMs = 8_000) {
  return async (payload: EmailPayload, idempotencyKey: string): Promise<{ id: string }> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: 'error',
      })
      if (!response.ok) {
        // Retry an in-flight idempotent request; a changed payload with the same key is permanent.
        let concurrent = false
        if (response.status === 409) {
          const body: unknown = await response.json().catch(() => null)
          concurrent = !!body && typeof body === 'object' &&
            (body as { name?: unknown }).name === 'concurrent_idempotent_requests'
        } else {
          await response.body?.cancel().catch(() => undefined)
        }
        const retryable = concurrent || response.status === 408 || response.status === 429 || response.status >= 500
        throw new EmailDeliveryError('Email delivery was not accepted.', { retryable, notAccepted: true })
      }
      const result: unknown = await response.json()
      if (!result || typeof result !== 'object' || typeof (result as { id?: unknown }).id !== 'string' ||
        !(result as { id: string }).id) {
        throw new EmailDeliveryError('Email delivery could not be confirmed.', { retryable: true })
      }
      return { id: (result as { id: string }).id }
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error
      throw new EmailDeliveryError('Email delivery is temporarily unavailable.', { retryable: true })
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * SMTP first; Resend only when SMTP definitely did not take the message, so a message is never
 * handed to both. Ambiguous SMTP failures are left to the queue's retry instead.
 */
export function createDeliveryTransport(config: Pick<EmailDeliveryConfig, 'smtp' | 'resendApiKey'>, options: {
  smtp?: Transport
  resend?: Transport
} = {}): Transport {
  const smtp = options.smtp ?? (config.smtp ? createSmtpTransport(config.smtp) : undefined)
  const resend = options.resend ?? (config.resendApiKey ? createResendTransport(config.resendApiKey) : undefined)
  if (!smtp && !resend) throw new Error('No email sender is configured.')
  return async (payload, idempotencyKey) => {
    if (!smtp) return prefixed('resend', await resend!(payload, idempotencyKey))
    try {
      return prefixed('smtp', await smtp(payload, idempotencyKey))
    } catch (error) {
      if (!resend || !(error instanceof EmailDeliveryError && error.notAccepted)) throw error
      return prefixed('resend', await resend(payload, idempotencyKey))
    }
  }
}

function prefixed(via: 'smtp' | 'resend', result: { id: string }) {
  return { id: result.id.startsWith(`${via}:`) ? result.id : `${via}:${result.id}` }
}
