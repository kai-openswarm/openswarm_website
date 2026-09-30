import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { waitUntil } from '@vercel/functions'
import { Pool } from 'pg'
import { createCollectHandler, parseUserAgent, type AnalyticsStore } from './analytics.ts'
import { readEmailDeliveryConfig, type EmailDeliverySetup } from './email-delivery.ts'
import { createUnsubscribeHandler } from './email-unsubscribe.ts'
import { RequestError, clientIp, hashValue, hashingSecret, header, originAllowed, requestGeo } from './http.ts'
import { createPostgresAnalyticsStore } from './postgres-analytics.ts'
import { createPostgresWaitlistStore } from './postgres-waitlist.ts'
import { cachedSignupConfig, type SignupConfig } from './signup-config.ts'
import { SUPABASE_ROOT_CA } from './supabase-ca.ts'
import { createWaitlistMailer, emailEvents } from './waitlist-mailer.ts'
import { createWaitlistMiddleware, type WaitlistOptions, type WaitlistStore } from './waitlist.ts'

const unavailable: WaitlistStore = {
  async add() { throw new Error('A database connection is required.') },
  async referral() { throw new Error('A database connection is required.') },
  async displayCount() { throw new Error('A database connection is required.') },
}

/** Dependency injection keeps endpoint tests isolated from credentials and live databases. */
export function createProductionWaitlistHandler(store: WaitlistStore, options: WaitlistOptions = {}) {
  const middleware = createWaitlistMiddleware(store, options)
  return (request: IncomingMessage, response: ServerResponse): Promise<void> => new Promise((resolve) => {
    const finished = () => {
      response.removeListener('finish', finished)
      response.removeListener('close', finished)
      resolve()
    }
    response.once('finish', finished)
    response.once('close', finished)
    middleware(request, response, () => {
      response.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify({ ok: false, error: 'Not found.' }))
    })
  })
}

let pool: Pool | undefined

/**
 * Supabase certificates chain to Supabase's own root, which Node does not trust by default.
 * Verify against that root rather than disabling verification. Other hosts use the
 * connection string's own sslmode.
 */
export function databaseTls(connectionString: string): { ssl?: { ca: string, rejectUnauthorized: true } } {
  try {
    const { hostname, searchParams } = new URL(connectionString)
    if (!/\.supabase\.(com|co)$/.test(hostname) || searchParams.has('sslmode')) return {}
    return { ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true } }
  } catch {
    return {}
  }
}

/** One small pool per function instance. Use the Supabase pooler URL (port 6543) in DATABASE_URL. */
export function productionPool(): Pool | null {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) return null
  pool = new Pool({
    connectionString,
    ...databaseTls(connectionString),
    max: 3,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 5_000,
    allowExitOnIdle: true,
  })
  // Idle connection failures must not crash the process or expose credentials in logs.
  // A subsequent request reconnects or receives the middleware's safe 503 response.
  pool.on('error', () => {})
  return pool
}

/** Cloudflare Turnstile verification. Disabled until TURNSTILE_SECRET_KEY is configured. */
export async function verifyTurnstile(token: string | undefined, request: IncomingMessage, secret = process.env.TURNSTILE_SECRET_KEY?.trim()) {
  if (!secret) return true
  if (!token || token.length > 2048) return false
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: clientIp(request) }),
      signal: AbortSignal.timeout(5_000),
    })
    const result = await response.json() as { success?: boolean }
    return result.success === true
  } catch {
    return false
  }
}

/** Origin checks, per-network rate limits, bot challenge and signup context for hosted requests. */
export function productionWaitlistOptions(analytics: AnalyticsStore, secret = hashingSecret()): WaitlistOptions {
  const network = (request: IncomingMessage) => hashValue(clientIp(request), secret)
  return {
    async guard(request, action, config) {
      if (action === 'stats') return
      if (!originAllowed(request)) throw new RequestError(403, 'This request was blocked. Please refresh and try again.')
      const key = network(request)
      const allowed = action === 'signup'
        ? await analytics.hit(`signup:${key}`, 3600, config?.signup_limit_per_hour ?? 10)
          && await analytics.hit(`signup-day:${key}`, 86_400, config?.signup_limit_per_day ?? 40)
        : await analytics.hit(`referral:${key}`, 60, 60)
      if (!allowed) throw new RequestError(429, 'Too many attempts. Please wait a few minutes and try again.')
    },
    verifyHuman: (token, request) => verifyTurnstile(token, request),
    context(request) {
      return {
        networkHash: network(request),
        fallback: { ...requestGeo(request), ...parseUserAgent(header(request, 'user-agent')) },
      }
    },
  }
}


let signupConfig: (() => Promise<SignupConfig>) | undefined

/** Admin-edited signup and email settings, read at most every 30 seconds per instance. */
export function productionSignupConfig(database: Pick<Pool, 'query'>) {
  signupConfig ??= cachedSignupConfig(async () => (await database.query('SELECT analytics.signup_config() AS config')).rows[0]?.config)
  return signupConfig
}

/** The waitlist mailer when SMTP is configured; emails still only go out when switched on in the dashboard. */
export function productionMailer(database: Pool, setup: EmailDeliverySetup = readEmailDeliveryConfig()) {
  return setup.state === 'ready'
    ? createWaitlistMailer({ database, delivery: setup.config, config: productionSignupConfig(database) })
    : null
}

let productionHandler: ReturnType<typeof createProductionWaitlistHandler> | undefined

/** Hosted entry points never fall back to a process-local JSON file. */
export function handleProductionWaitlist(request: IncomingMessage, response: ServerResponse) {
  if (!productionHandler) {
    const database = productionPool()
    if (!database) return createProductionWaitlistHandler(unavailable)(request, response)
    const mailer = productionMailer(database)
    productionHandler = createProductionWaitlistHandler(createPostgresWaitlistStore(database), {
      ...productionWaitlistOptions(createPostgresAnalyticsStore(database)),
      config: productionSignupConfig(database),
      emailEvents: (config) => emailEvents(config, !!mailer),
      // The signup and its email job commit together; delivery happens after the response.
      // A daily worker and the dashboard's "Send pending now" pick up anything left over.
      afterSignup: mailer ? async () => { waitUntil(mailer.drain(2).catch(() => undefined)) } : undefined,
    })
  }
  return productionHandler(request, response)
}

let collectHandler: ReturnType<typeof createCollectHandler> | undefined

export function handleProductionCollect(request: IncomingMessage, response: ServerResponse) {
  if (!collectHandler) {
    const database = productionPool()
    if (!database) {
      response.writeHead(503, { 'Cache-Control': 'no-store' })
      response.end()
      return Promise.resolve()
    }
    collectHandler = createCollectHandler(createPostgresAnalyticsStore(database))
  }
  return collectHandler(request, response)
}


function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

function authorized(value: string | undefined, secret: string): boolean {
  if (!value || value.length > 1_024 || Buffer.byteLength(secret) < 32) return false
  const digest = (text: string) => createHash('sha256').update(text).digest()
  return timingSafeEqual(digest(value), digest(`Bearer ${secret}`))
}

/** GET supports Vercel Cron (which sends CRON_SECRET as a Bearer token); POST supports a deliberate drain. */
export function createEmailWorkerHandler(options: {
  secret?: string
  setup: EmailDeliverySetup
  drain?: () => Promise<unknown>
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST')
      json(response, 405, { ok: false, error: 'Method not allowed.' })
      return
    }
    if (!options.secret || Buffer.byteLength(options.secret) < 32) {
      json(response, 503, { ok: false, error: 'Email delivery is not configured.' })
      return
    }
    if (!authorized(request.headers.authorization, options.secret)) {
      json(response, 401, { ok: false, error: 'Unauthorized.' })
      return
    }
    if (options.setup.state !== 'ready' || !options.drain) {
      json(response, 503, { ok: false, error: 'Email delivery is not configured.' })
      return
    }
    try {
      const result = await options.drain()
      json(response, 200, { ok: true, result })
    } catch {
      json(response, 503, { ok: false, error: 'Email delivery is temporarily unavailable.' })
    }
  }
}

export function handleProductionEmailWorker(request: IncomingMessage, response: ServerResponse) {
  const setup = readEmailDeliveryConfig()
  const database = setup.state === 'ready' ? productionPool() : null
  const mailer = database ? productionMailer(database, setup) : null
  return createEmailWorkerHandler({
    secret: setup.state === 'ready' ? setup.config.cronSecret : undefined,
    setup,
    drain: mailer ? () => mailer.drain(10) : undefined,
  })(request, response)
}

/** Opt-out keeps working while sending is off, as long as the signing secret is unchanged. */
export function handleProductionUnsubscribe(request: IncomingMessage, response: ServerResponse) {
  const secret = process.env.WAITLIST_EMAIL_SECRET?.trim() || hashingSecret()
  const database = productionPool()
  if (!database) {
    json(response, 503, { ok: false, error: 'Email preferences are temporarily unavailable.' })
    return Promise.resolve()
  }
  return createUnsubscribeHandler({
    secret,
    async unsubscribe(code) { await database.query('SELECT analytics.unsubscribe($1)', [code]) },
  })(request, response)
}
