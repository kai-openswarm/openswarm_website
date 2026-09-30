import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import type { Connect, Plugin } from 'vite'
import { normalizePhone } from '../src/lib/phone.ts'
import { RequestError, readBody, respond } from './http.ts'
import { createLocalCollectMiddleware } from './analytics.ts'

type WaitlistEntry = {
  phone: string
  source: string
  createdAt: string
  referralCode?: string
  referredBy?: string
  consentVersion?: string
}

export type ReferralStatus = {
  code: string
  count: number
  goal: 3
  priorityAccess: boolean
}

/** Optional details recorded with a new signup. None of it changes signup behavior. */
export type SignupContext = {
  visitorId?: string
  sessionId?: string
  consentVersion?: string
  networkHash?: string
  fallback?: Record<string, string | null>
}

export type WaitlistStore = {
  add(phone: string, source: string, referralCode?: string, context?: SignupContext): Promise<{ added: boolean, referral: ReferralStatus }>
  referral(code: string): Promise<ReferralStatus | null>
  /** The public waitlist size, including any configured baseline. */
  displayCount?(): Promise<number>
}

export type WaitlistOptions = {
  /** Runs before storage is touched; throws a RequestError to reject (origin, rate limit). */
  guard?(request: IncomingMessage, action: 'signup' | 'referral' | 'stats'): Promise<void>
  /** Verifies a bot-challenge token when one is configured. */
  verifyHuman?(token: string | undefined, request: IncomingMessage): Promise<boolean>
  /** Server-derived signup details such as the hashed network and approximate location. */
  context?(request: IncomingMessage): SignupContext
}

const MAX_BODY_BYTES = 4_096
const REFERRAL_CODE = /^[A-Za-z0-9_-]{32}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONSENT_VERSION = /^[a-z0-9-]{1,32}$/
/** The hero previously showed this supplied figure; hosted builds read it from settings. */
export const DEFAULT_COUNT_BASELINE = 6327

function isReferralCode(value: unknown): value is string {
  return typeof value === 'string' && REFERRAL_CODE.test(value)
}

// Vite 8's defaults are internal. Keep them when adding the local data deny rule.
const DEFAULT_SERVER_FS_DENY = [
  '.env',
  '.env.*',
  '*.{crt,pem,key,p12,pfx,cer,der}',
  '.npmrc',
  '.yarnrc.yml',
  '**/.git/**',
]

function isEntry(value: unknown): value is WaitlistEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<WaitlistEntry>
  return (
    typeof entry.phone === 'string' &&
    normalizePhone(entry.phone) === entry.phone &&
    typeof entry.source === 'string' &&
    entry.source.trim().length > 0 &&
    entry.source.length <= 64 &&
    typeof entry.createdAt === 'string' &&
    Number.isFinite(Date.parse(entry.createdAt)) &&
    (entry.referralCode === undefined || isReferralCode(entry.referralCode)) &&
    (entry.referredBy === undefined || isReferralCode(entry.referredBy))
  )
}

/** A single local process owns this file; queued writes cannot lose another signup. */
export function createWaitlistStore(filePath: string) {
  let queue: Promise<unknown> = Promise.resolve()

  async function readEntries(): Promise<WaitlistEntry[]> {
    let entries: WaitlistEntry[] = []
    let contents: string | undefined
    try {
      contents = await readFile(filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    if (contents !== undefined) {
      const parsed: unknown = JSON.parse(contents)
      if (!Array.isArray(parsed) || !parsed.every(isEntry)) {
        throw new Error('The local waitlist file is invalid.')
      }
      entries = parsed
    }
    const codes = entries.flatMap((entry) => entry.referralCode ? [entry.referralCode] : [])
    if (new Set(entries.map((entry) => entry.phone)).size !== entries.length || new Set(codes).size !== codes.length) {
      throw new Error('The local waitlist file has duplicate entries.')
    }
    return entries
  }

  async function writeEntries(entries: WaitlistEntry[]) {
    const directory = path.dirname(filePath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`
    try {
      const file = await open(temporaryPath, 'wx', 0o600)
      try {
        await file.writeFile(`${JSON.stringify(entries, null, 2)}\n`, 'utf8')
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temporaryPath, filePath)
      const directoryHandle = await open(directory, 'r')
      try {
        await directoryHandle.sync()
      } finally {
        await directoryHandle.close()
      }
    } finally {
      await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  }

  function referralStatus(entries: WaitlistEntry[], code: string): ReferralStatus {
    const count = entries.filter((entry) => entry.referredBy === code && entry.referralCode !== code).length
    return { code, count, goal: 3, priorityAccess: count >= 3 }
  }

  function queued<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation)
    // A failed write must not block later requests after the underlying issue is fixed.
    queue = result.catch(() => undefined)
    return result
  }

  return {
    add(phone: string, source: string, referralCode?: string, context?: SignupContext) {
      return queued(async () => {
        const entries = await readEntries()
        let entry = entries.find((candidate) => candidate.phone === phone)
        const added = !entry
        if (!entry) {
          entry = { phone, source, createdAt: new Date().toISOString() }
          if (context?.consentVersion) entry.consentVersion = context.consentVersion
          // Attribute only a first signup. Re-submission cannot change an inviter or credit a second signup.
          if (referralCode && entries.some((candidate) => candidate.referralCode === referralCode)) {
            entry.referredBy = referralCode
          }
          entries.push(entry)
        }
        if (!entry.referralCode) {
          // 192 random bits; public share codes never encode a phone number or a record index.
          let code: string
          do {
            code = randomBytes(24).toString('base64url')
          } while (entries.some((candidate) => candidate.referralCode === code))
          entry.referralCode = code
          // Legacy records gain only a code; original fields and unknown metadata remain intact.
          await writeEntries(entries)
        }
        return { added, referral: referralStatus(entries, entry.referralCode) }
      })
    },
    referral(code: string) {
      return queued(async () => {
        const entries = await readEntries()
        if (!entries.some((entry) => entry.referralCode === code)) return null
        return referralStatus(entries, code)
      })
    },
    displayCount() {
      return queued(async () => DEFAULT_COUNT_BASELINE + (await readEntries()).length)
    },
  }
}

export function createWaitlistMiddleware(storage: string | WaitlistStore, options: WaitlistOptions = {}): Connect.NextHandleFunction {
  const store = typeof storage === 'string' ? createWaitlistStore(storage) : storage

  return (request, response, next) => {
    let requestPath = request.url?.split('?')[0] ?? ''
    try {
      requestPath = decodeURIComponent(requestPath).replaceAll('\\', '/')
    } catch {
      // Vite handles malformed URL encoding for paths outside this middleware.
    }
    if (requestPath.toLowerCase().split('/').includes('.data')) {
      respond(response, 404, { ok: false, error: 'Not found.' })
      return
    }
    const rawPath = request.url?.split('?')[0]
    const isReferralRequest = rawPath === '/api/waitlist/referral'
    const isStatsRequest = rawPath === '/api/stats'
    if (rawPath !== '/api/waitlist' && !isReferralRequest && !isStatsRequest) return next()
    const allowedMethod = isReferralRequest || isStatsRequest ? 'GET' : 'POST'
    if (request.method !== allowedMethod) {
      response.setHeader('Allow', allowedMethod)
      respond(response, 405, { ok: false, error: allowedMethod === 'GET' ? 'Use GET for this request.' : 'Use POST to join the waitlist.' })
      return
    }

    async function handle() {
      if (isStatsRequest) {
        await options.guard?.(request, 'stats')
        if (!store.displayCount) throw new RequestError(404, 'Not found.')
        const count = await store.displayCount()
        // Shared caches may serve this briefly; it changes with each signup, not per visitor.
        respond(response, 200, { ok: true, count }, { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' })
        return
      }
      if (isReferralRequest) {
        await options.guard?.(request, 'referral')
        const code = new URL(request.url ?? '', 'http://localhost').searchParams.get('code')
        if (!isReferralCode(code)) throw new RequestError(404, 'This invite link was not found.')
        const referral = await store.referral(code)
        if (!referral) throw new RequestError(404, 'This invite link was not found.')
        respond(response, 200, { ok: true, referral })
        return
      }
      const contentType = request.headers['content-type']?.split(';')[0].trim().toLowerCase()
      if (contentType !== 'application/json') {
        throw new RequestError(415, 'Send the form as JSON.')
      }

      let input: unknown
      const body = await readBody(request, MAX_BODY_BYTES)
      try {
        input = JSON.parse(body)
      } catch {
        throw new RequestError(400, 'The form could not be read. Please try again.')
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new RequestError(400, 'Enter a valid US number, or use + and your country code.')
      }
      const { phone: rawPhone, source: rawSource = 'website', referralCode, visitorId, sessionId, consentVersion, turnstileToken } = input as Record<string, unknown>
      const phone = typeof rawPhone === 'string' ? normalizePhone(rawPhone) : null
      if (!phone) {
        throw new RequestError(400, 'Enter a valid US number, or use + and your country code.')
      }
      if (typeof rawSource !== 'string' || !rawSource.trim() || rawSource.length > 64) {
        throw new RequestError(400, 'The form source is invalid. Please refresh and try again.')
      }
      if (referralCode !== undefined && !isReferralCode(referralCode)) {
        throw new RequestError(400, 'The invite code is invalid. Please refresh and try again.')
      }
      await options.guard?.(request, 'signup')
      if (options.verifyHuman && !await options.verifyHuman(typeof turnstileToken === 'string' ? turnstileToken : undefined, request)) {
        throw new RequestError(403, 'We couldn’t verify this request. Please refresh and try again.')
      }

      // Analytics identifiers are optional and never block a signup when missing or malformed.
      const context: SignupContext = {
        ...options.context?.(request),
        ...(typeof visitorId === 'string' && UUID.test(visitorId) ? { visitorId: visitorId.toLowerCase() } : {}),
        ...(typeof sessionId === 'string' && UUID.test(sessionId) ? { sessionId: sessionId.toLowerCase() } : {}),
        ...(typeof consentVersion === 'string' && CONSENT_VERSION.test(consentVersion) ? { consentVersion } : {}),
      }
      const { added, referral } = await store.add(phone, rawSource.trim(), referralCode, context)
      respond(response, added ? 201 : 200, { ok: true, referral })
    }

    void handle().catch((error: unknown) => {
      if (error instanceof RequestError) {
        respond(response, error.status, { ok: false, error: error.message })
      } else {
        // Do not expose phone numbers, file contents, or filesystem paths in responses or logs.
        respond(response, 503, { ok: false, error: 'The waitlist could not be saved. Please try again.' })
      }
    })
  }
}

/** Local development and local preview only. Static hosting needs a hosted API. */
export function localWaitlistPlugin(): Plugin {
  let middleware: Connect.NextHandleFunction
  let collect: Connect.NextHandleFunction
  return {
    name: 'local-phone-waitlist',
    config(config) {
      return {
        server: {
          fs: {
            deny: [...new Set([
              ...DEFAULT_SERVER_FS_DENY,
              ...(config.server?.fs?.deny ?? []),
              '**/.data/**',
            ])],
          },
        },
      }
    },
    configResolved(config) {
      middleware = createWaitlistMiddleware(path.join(config.root, '.data', 'waitlist.json'))
      collect = createLocalCollectMiddleware(path.join(config.root, '.data', 'analytics.ndjson'))
    },
    configureServer(server) {
      server.middlewares.use(collect)
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(collect)
      server.middlewares.use(middleware)
    },
  }
}
