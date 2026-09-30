import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Pool } from 'pg'
import { emailPublicUrl } from './email-delivery.ts'
import type { EmailKind } from './email-outbox.ts'
import { RequestError, hashingSecret, header, originAllowed, readBody, respond } from './http.ts'
import { productionMailer, productionPool } from './production-waitlist.ts'
import { parseSignupConfig } from './signup-config.ts'
import { createWaitlistMailer, renderWaitlistPayload } from './waitlist-mailer.ts'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export type AdminDeps = {
  database: Pick<Pool, 'query'>
  supabaseUrl: string
  anonKey: string
  serviceKey: string
  fetch?: typeof fetch
}

type AdminAction = (context: { caller: string, input: Record<string, unknown>, request: IncomingMessage }) => Promise<object>

/** POST endpoints for signed-in admins: verifies the Supabase session and the allowlist, then runs the action. */
function adminEndpoint(deps: AdminDeps, failure: string, action: AdminAction) {
  const request_ = deps.fetch ?? fetch
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (request.method !== 'POST') throw new RequestError(405, 'Use POST.')
      if (!originAllowed(request)) throw new RequestError(403, 'Forbidden.')
      const token = header(request, 'authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
      if (!token) throw new RequestError(401, 'Sign in again.')

      const userResponse = await request_(`${deps.supabaseUrl}/auth/v1/user`, {
        headers: { apikey: deps.anonKey, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      })
      if (!userResponse.ok) throw new RequestError(401, 'Sign in again.')
      const caller = ((await userResponse.json()) as { email?: string }).email?.toLowerCase()
      if (!caller) throw new RequestError(401, 'Sign in again.')
      const isAdmin = await deps.database.query<{ allowed: boolean }>('SELECT analytics.is_admin_email($1) AS allowed', [caller])
      if (!isAdmin.rows[0]?.allowed) throw new RequestError(403, 'Admin access required.')

      let input: unknown
      try { input = JSON.parse(await readBody(request, 16_384)) } catch { throw new RequestError(400, 'Send JSON.') }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestError(400, 'Send a JSON object.')
      respond(response, 200, await action({ caller, input: input as Record<string, unknown>, request }))
    } catch (error) {
      if (error instanceof RequestError) respond(response, error.status, { ok: false, error: error.message })
      else respond(response, 503, { ok: false, error: failure })
    }
  }
}

/**
 * Adds an email to the admin allowlist and creates its Supabase login, so the person
 * can request a sign-in link. Public sign-up stays disabled in Supabase Auth.
 */
export function createAdminInviteHandler(deps: AdminDeps) {
  const request_ = deps.fetch ?? fetch
  return adminEndpoint(deps, 'The invitation could not be completed. Please try again.', async ({ caller, input }) => {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
    if (!EMAIL.test(email) || email.length > 254) throw new RequestError(400, 'Enter a valid email address.')
    const created = await request_(`${deps.supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, email_confirm: true }),
      signal: AbortSignal.timeout(5_000),
    })
    // 422 means the login already exists, which is fine.
    if (!created.ok && created.status !== 422) throw new Error(`Supabase admin API returned ${created.status}`)
    await deps.database.query('SELECT analytics.add_admin($1, $2)', [caller, email])
    return { ok: true }
  })
}

type Mailer = Pick<ReturnType<typeof createWaitlistMailer>, 'sendTest' | 'drain'>

/** Email settings from the dashboard form, which may be unsaved. */
function formConfig(input: Record<string, unknown>) {
  return parseSignupConfig({ welcome_email: input.welcome_email, priority_email: input.priority_email })
}

function emailKind(input: Record<string, unknown>): EmailKind {
  return input.kind === 'priority' ? 'priority' : 'welcome'
}

/** The admin's own waitlist signup, so test emails carry working invite and unsubscribe links. */
async function ownSignup(database: AdminDeps['database'], email: string) {
  return (await database.query<{ referral_code: string }>(
    'SELECT referral_code FROM waitlist_signups WHERE email = $1', [email],
  )).rows[0]?.referral_code
}

/** Sends the welcome or priority email, as currently set in the form, to the signed-in admin. */
export function createTestEmailHandler(deps: AdminDeps, mailer: Mailer | null) {
  return adminEndpoint(deps, 'The test email could not be sent. Please try again.', async ({ caller, input }) => {
    if (!mailer) throw new RequestError(503, 'Email sending is not configured: set SMTP_HOST, SMTP_USER and SMTP_PASSWORD (or RESEND_API_KEY) in Vercel.')
    const config = formConfig(input)
    if (!config.welcome_email.from_email) throw new RequestError(400, 'Set a from address first.')
    const kind = emailKind(input)
    const own = await ownSignup(deps.database, caller)
    let via: 'smtp' | 'resend'
    try {
      const sent = await mailer.sendTest(kind, own ?? 'x'.repeat(32), caller, config)
      via = sent.id.startsWith('resend:') ? 'resend' : 'smtp'
      await deps.database.query('SELECT analytics.log_email($1, $2, $3, $4, $5)', [own ?? null, 'test', 'sent', sent.id, `${kind} via ${via}`])
    } catch {
      await deps.database.query('SELECT analytics.log_email($1, $2, $3, $4, $5)', [own ?? null, 'test', 'failed', null, `${kind}: the SMTP server did not accept the message`])
      throw new RequestError(502, 'Neither email sender accepted the message. Check the SMTP settings, that the sender address is allowed for that mailbox, and (for the Resend backup) that its domain is verified in Resend.')
    }
    // via tells the admin whether the Resend backup had to step in.
    return { ok: true, sentTo: caller, kind, realLinks: !!own, via }
  })
}

/** Renders an email exactly as recipients get it, for the dashboard preview. Sends nothing. */
export function createEmailPreviewHandler(deps: AdminDeps, links: () => { publicUrl: string, secret: string }) {
  return adminEndpoint(deps, 'The preview could not be rendered.', async ({ caller, input }) => {
    const config = formConfig(input)
    const kind = emailKind(input)
    const own = await ownSignup(deps.database, caller)
    const preview = renderWaitlistPayload(kind, own ?? 'x'.repeat(32), caller,
      { ...config, welcome_email: { ...config.welcome_email, from_email: config.welcome_email.from_email || 'sender@example.com' } }, links())
    return { ok: true, kind, from: preview.from, subject: preview.subject, html: preview.html, text: preview.text }
  })
}

/** Sends queued waitlist emails now instead of waiting for the next signup or the daily run. */
export function createSendPendingHandler(deps: AdminDeps, mailer: Mailer | null) {
  return adminEndpoint(deps, 'Queued emails could not be sent. Please try again.', async ({ caller }) => {
    if (!mailer) throw new RequestError(503, 'Email sending is not configured: set SMTP_HOST, SMTP_USER and SMTP_PASSWORD (or RESEND_API_KEY) in Vercel.')
    const result = await mailer.drain(20)
    await deps.database.query('SELECT analytics.audit($1, $2, $3::jsonb)', [caller, 'send_pending_emails', JSON.stringify(result)])
    return { ok: true, result }
  })
}

function productionDeps(): AdminDeps | null {
  const database = productionPool()
  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim().replace(/\/$/, '')
  const anonKey = (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY)?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  return database && supabaseUrl && anonKey && serviceKey ? { database, supabaseUrl, anonKey, serviceKey } : null
}

let inviteHandler: ReturnType<typeof createAdminInviteHandler> | undefined
let emailHandlers: { test: ReturnType<typeof createTestEmailHandler>, preview: ReturnType<typeof createEmailPreviewHandler>, pending: ReturnType<typeof createSendPendingHandler> } | undefined

export function handleAdminInvite(request: IncomingMessage, response: ServerResponse) {
  const deps = inviteHandler ? null : productionDeps()
  if (!inviteHandler && !deps) {
    respond(response, 503, { ok: false, error: 'Admin invitations are not configured.' })
    return Promise.resolve()
  }
  inviteHandler ??= createAdminInviteHandler(deps!)
  return inviteHandler(request, response)
}

function adminEmailHandlers() {
  if (emailHandlers) return emailHandlers
  const deps = productionDeps()
  if (!deps) return null
  const mailer = productionMailer(deps.database as Pool)
  const links = () => ({
    publicUrl: emailPublicUrl() ?? 'https://openswarm.com',
    secret: process.env.WAITLIST_EMAIL_SECRET?.trim() || hashingSecret(),
  })
  emailHandlers = {
    test: createTestEmailHandler(deps, mailer),
    preview: createEmailPreviewHandler(deps, links),
    pending: createSendPendingHandler(deps, mailer),
  }
  return emailHandlers
}

function withEmailHandler(pick: (handlers: NonNullable<typeof emailHandlers>) => (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const handlers = adminEmailHandlers()
    if (!handlers) {
      respond(response, 503, { ok: false, error: 'Admin actions are not configured.' })
      return Promise.resolve()
    }
    return pick(handlers)(request, response)
  }
}

export const handleTestEmail = withEmailHandler((handlers) => handlers.test)
export const handleEmailPreview = withEmailHandler((handlers) => handlers.preview)
export const handleSendPending = withEmailHandler((handlers) => handlers.pending)
