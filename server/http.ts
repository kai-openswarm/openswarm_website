import { createHash, createHmac } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export class RequestError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  // Vercel's Node runtime may have already parsed/consumed the request stream.
  // Normalize that body through the same JSON validation and size limit as local requests.
  if ('body' in request && request.body !== undefined) {
    const body = Buffer.isBuffer(request.body)
      ? request.body.toString('utf8')
      : typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
    if (Buffer.byteLength(body ?? '', 'utf8') > maxBytes) {
      return Promise.reject(new RequestError(413, 'This request is too large.'))
    }
    return Promise.resolve(body ?? '')
  }
  if (request.readableEnded) return Promise.resolve('')
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    let tooLarge = false
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        if (!tooLarge) reject(new RequestError(413, 'This request is too large.'))
        tooLarge = true
        chunks.length = 0
      } else if (!tooLarge) {
        chunks.push(chunk)
      }
    })
    request.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    request.on('error', reject)
    request.on('aborted', () => reject(new RequestError(400, 'The request was interrupted.')))
  })
}

export function respond(response: ServerResponse, status: number, body: object | null, headers: Record<string, string> = {}) {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, {
    ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  response.end(body ? JSON.stringify(body) : undefined)
}

export function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()]
  const first = Array.isArray(value) ? value[0] : value
  return first?.trim() || undefined
}

/** The connecting client as reported by the hosting proxy. Never stored; only hashed. */
export function clientIp(request: IncomingMessage): string {
  const forwarded = header(request, 'x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || header(request, 'x-real-ip') || request.socket?.remoteAddress || 'unknown'
}

/** Keyed hash so stored values cannot be reversed to an IP address without the secret. */
export function hashValue(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url').slice(0, 22)
}

/** Server-only secret for hashing. Falls back to a digest of the database URL. */
export function hashingSecret(): string {
  const configured = process.env.ANALYTICS_SALT?.trim()
  if (configured) return configured
  return createHash('sha256').update(`openswarm-analytics:${process.env.DATABASE_URL ?? 'local'}`).digest('base64url')
}

function decodeHeader(value: string | undefined) {
  if (!value) return null
  try {
    return decodeURIComponent(value).slice(0, 100) || null
  } catch {
    return value.slice(0, 100)
  }
}

/** Vercel adds approximate location headers derived from the client IP. */
export function requestGeo(request: IncomingMessage) {
  const country = header(request, 'x-vercel-ip-country')?.toUpperCase()
  return {
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    region: decodeHeader(header(request, 'x-vercel-ip-country-region')),
    city: decodeHeader(header(request, 'x-vercel-ip-city')),
  }
}

function hostOf(value: string | undefined) {
  if (!value) return null
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).host.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Browsers always send Origin on POST. Reject cross-site posts; a missing Origin
 * (curl, server-to-server) is left to rate limiting because it can be forged anyway.
 */
export function originAllowed(request: IncomingMessage, allowedOrigins = process.env.ALLOWED_ORIGINS): boolean {
  const origin = header(request, 'origin')
  if (!origin) return true
  const originHost = hostOf(origin)
  if (!originHost) return false
  const requestHost = hostOf(header(request, 'x-forwarded-host') ?? header(request, 'host'))
  if (originHost === requestHost) return true
  return (allowedOrigins ?? '').split(',').map((entry) => hostOf(entry.trim())).includes(originHost)
}
