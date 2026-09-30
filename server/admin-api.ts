import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Pool } from 'pg'
import { publicOrigin, sendWelcomeEmail, unsubscribeUrl } from './email.ts'
import { RequestError, header, originAllowed, readBody, respond } from './http.ts'
import { productionPool } from './production-waitlist.ts'
import { parseSignupConfig } from './signup-config.ts'

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

/** Sends the (possibly unsaved) welcome email template to the signed-in admin. */
export function createTestEmailHandler(deps: AdminDeps, send: typeof sendWelcomeEmail = sendWelcomeEmail) {
  return adminEndpoint(deps, 'The test email could not be sent. Please try again.', async ({ caller, input, request }) => {
    const template = parseSignupConfig({ welcome_email: input.welcome_email }).welcome_email
    if (!template.from_email) throw new RequestError(400, 'Set a from address first.')
    const origin = publicOrigin(request)
    // Use the admin's own waitlist signup when there is one, so every link in the test works.
    const own = (await deps.database.query<{ referral_code: string }>(
      'SELECT referral_code FROM waitlist_signups WHERE email = $1', [caller],
    )).rows[0]?.referral_code
    const code = own ?? 'x'.repeat(32)
    const sample = own ? template : {
      ...template,
      body: `${template.body}\n\n(Test email: ${caller} isn't on the waitlist, so the invite and unsubscribe links above are samples. Join the waitlist with this address to test real links.)`,
    }
    const result = await send({ ...sample, subject: `[Test] ${template.subject}` }, caller, new URL(`/?ref=${code}`, origin).toString(), unsubscribeUrl(origin, code))
    await deps.database.query('SELECT analytics.log_email($1, $2, $3, $4, $5)', [own ?? null, 'test', result.status, result.providerId ?? null, result.detail ?? null])
    if (result.status !== 'sent') throw new RequestError(502, result.detail ?? 'The email provider rejected the message.')
    return { ok: true, sentTo: caller, realLinks: !!own }
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
let testEmailHandler: ReturnType<typeof createTestEmailHandler> | undefined

export function handleAdminInvite(request: IncomingMessage, response: ServerResponse) {
  const deps = inviteHandler ? null : productionDeps()
  if (!inviteHandler && !deps) {
    respond(response, 503, { ok: false, error: 'Admin invitations are not configured.' })
    return Promise.resolve()
  }
  inviteHandler ??= createAdminInviteHandler(deps!)
  return inviteHandler(request, response)
}

export function handleTestEmail(request: IncomingMessage, response: ServerResponse) {
  const deps = testEmailHandler ? null : productionDeps()
  if (!testEmailHandler && !deps) {
    respond(response, 503, { ok: false, error: 'Admin actions are not configured.' })
    return Promise.resolve()
  }
  testEmailHandler ??= createTestEmailHandler(deps!)
  return testEmailHandler(request, response)
}
