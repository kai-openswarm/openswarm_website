import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Pool } from 'pg'
import { RequestError, header, originAllowed, readBody, respond } from './http.ts'
import { productionPool } from './production-waitlist.ts'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export type AdminInviteDeps = {
  database: Pick<Pool, 'query'>
  supabaseUrl: string
  anonKey: string
  serviceKey: string
  fetch?: typeof fetch
}

/**
 * Adds an email to the admin allowlist and creates its Supabase login, so the person
 * can request a sign-in link. Public sign-up stays disabled in Supabase Auth.
 */
export function createAdminInviteHandler(deps: AdminInviteDeps) {
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
      const isAdmin = await deps.database.query('SELECT 1 FROM analytics.admin_users WHERE email = $1', [caller])
      if (isAdmin.rowCount === 0) throw new RequestError(403, 'Admin access required.')

      let input: unknown
      try { input = JSON.parse(await readBody(request, 1_024)) } catch { throw new RequestError(400, 'Send JSON.') }
      const email = typeof (input as { email?: unknown })?.email === 'string' ? (input as { email: string }).email.trim().toLowerCase() : ''
      if (!EMAIL.test(email) || email.length > 254) throw new RequestError(400, 'Enter a valid email address.')

      const created = await request_(`${deps.supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, email_confirm: true }),
        signal: AbortSignal.timeout(5_000),
      })
      // 422 means the login already exists, which is fine.
      if (!created.ok && created.status !== 422) throw new Error(`Supabase admin API returned ${created.status}`)

      await deps.database.query(
        'INSERT INTO analytics.admin_users (email, added_by) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
        [email, caller],
      )
      await deps.database.query('SELECT analytics.audit($1, $2, $3::jsonb)', [caller, 'add_admin', JSON.stringify({ email })])
      respond(response, 200, { ok: true })
    } catch (error) {
      if (error instanceof RequestError) respond(response, error.status, { ok: false, error: error.message })
      else respond(response, 503, { ok: false, error: 'The invitation could not be completed. Please try again.' })
    }
  }
}

let handler: ReturnType<typeof createAdminInviteHandler> | undefined

export function handleAdminInvite(request: IncomingMessage, response: ServerResponse) {
  if (!handler) {
    const database = productionPool()
    const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)?.trim().replace(/\/$/, '')
    const anonKey = (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY)?.trim()
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    if (!database || !supabaseUrl || !anonKey || !serviceKey) {
      respond(response, 503, { ok: false, error: 'Admin invitations are not configured.' })
      return Promise.resolve()
    }
    handler = createAdminInviteHandler({ database, supabaseUrl, anonKey, serviceKey })
  }
  return handler(request, response)
}
