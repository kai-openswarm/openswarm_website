import { createHash, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

type Database = Pick<Pool, 'query' | 'connect'>
export type EmailKind = 'welcome' | 'priority'
export type EmailPayload = {
  from: string
  to: string[]
  subject: string
  html: string
  text: string
  reply_to?: string
  headers?: Record<string, string>
}
export type EmailMessage = { kind: EmailKind, referralCode: string, email: string, createdAt: string }
export type EmailWorker = {
  render: (message: EmailMessage) => EmailPayload | Promise<EmailPayload>
  send: (payload: EmailPayload, idempotencyKey: string) => Promise<{ id: string }>
  limit?: number
}
type Job = {
  id: string
  kind: EmailKind
  referral_code: string
  email: string
  created_at: Date | string
  payload: string | null
  payload_hash: string | null
  attempt_count: number
}
type Prepared = { payload: string, payload_hash: string, attempt_count: number }

const RETRY_SECONDS = [30, 120, 600, 1_800, 7_200, 21_600, 21_600]
const MAX_ATTEMPTS = 8
const HASH = (payload: string) => createHash('sha256').update(payload).digest('hex')

function validatePayload(payload: EmailPayload, email: string) {
  if (!payload || !Array.isArray(payload.to) || payload.to.length !== 1 || payload.to[0] !== email ||
    !['from', 'subject', 'html', 'text'].every((field) => typeof payload[field as keyof EmailPayload] === 'string' && payload[field as keyof EmailPayload])) {
    throw new Error('The email payload is invalid.')
  }
}

/**
 * Durable at-least-once attempts with provider idempotency. A provider timeout can
 * mean acceptance, so every retry uses the same request and key, and attempts
 * stop after 23 hours (before the provider's 24-hour idempotency window expires).
 * Failed/ambiguous jobs are intentionally never reset or replayed automatically.
 */
export function createEmailOutbox(database: Database) {
  async function drain({ render, send, limit = 10 }: EmailWorker) {
    const totals = { sent: 0, retried: 0, failed: 0, cancelled: 0 }
    const batchSize = Math.max(1, Math.min(25, Number.isFinite(limit) ? Math.floor(limit) : 10))

    // Suppression cancels unsent work, including expired leases. These queries
    // also keep never-sent jobs out of the retry loop without exposing recipients.
    const cancelled = await database.query(`
      UPDATE waitlist_email_outbox AS job
      SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL, failure_code = 'unsubscribed'
      WHERE status IN ('pending', 'processing') AND EXISTS (
        SELECT 1 FROM waitlist_signups AS signup WHERE signup.referral_code = job.referral_code
          AND (signup.email_opted_out_at IS NOT NULL OR signup.email IS NULL)
      )
    `)
    totals.cancelled += cancelled.rowCount ?? 0
    const expired = await database.query(`
      UPDATE waitlist_email_outbox SET status = 'failed', lease_token = NULL,
        lease_expires_at = NULL, failure_code = 'retry_window_exhausted'
      WHERE (status = 'pending' OR (status = 'processing' AND lease_expires_at <= clock_timestamp()))
        AND (attempt_count >= 8 OR first_attempt_at <= clock_timestamp() - interval '23 hours')
    `)
    totals.failed += expired.rowCount ?? 0

    for (let index = 0; index < batchSize; index++) {
      const lease = randomUUID()
      const claimed = await database.query<Job>(`
        WITH candidate AS (
          SELECT job.id, signup.email FROM waitlist_email_outbox AS job
          JOIN waitlist_signups AS signup ON signup.referral_code = job.referral_code
          WHERE ((job.status = 'pending' AND job.next_attempt_at <= clock_timestamp())
            OR (job.status = 'processing' AND job.lease_expires_at <= clock_timestamp()))
            AND signup.email IS NOT NULL AND signup.email_opted_out_at IS NULL
            AND job.attempt_count < 8
            AND (job.first_attempt_at IS NULL OR job.first_attempt_at > clock_timestamp() - interval '23 hours')
          ORDER BY job.next_attempt_at, job.created_at
          LIMIT 1 FOR UPDATE OF job SKIP LOCKED
        )
        UPDATE waitlist_email_outbox AS job SET status = 'processing', lease_token = $1,
          lease_expires_at = clock_timestamp() + interval '1 minute'
        FROM candidate WHERE job.id = candidate.id
        RETURNING job.id, job.kind, job.referral_code, job.created_at,
          job.payload, job.payload_hash, job.attempt_count, candidate.email
      `, [lease])
      const job = claimed.rows[0]
      if (!job) break

      let serialized: string
      try {
        if (job.payload !== null) {
          if (HASH(job.payload) !== job.payload_hash) throw new Error('The stored email payload is invalid.')
          validatePayload(JSON.parse(job.payload) as EmailPayload, job.email)
          serialized = job.payload
        } else {
          const payload = await render({
            kind: job.kind, referralCode: job.referral_code, email: job.email,
            createdAt: new Date(job.created_at).toISOString(),
          })
          validatePayload(payload, job.email)
          serialized = JSON.stringify(payload)
        }
      } catch {
        const failed = await database.query(`
          UPDATE waitlist_email_outbox SET status = 'failed', failure_code = 'invalid_payload',
            lease_token = NULL, lease_expires_at = NULL
          WHERE id = $1 AND status = 'processing' AND lease_token = $2
        `, [job.id, lease])
        totals.failed += failed.rowCount ?? 0
        continue
      }

      // Persist payload and attempt BEFORE contacting the provider. Renewing the
      // lease and rechecking suppression fences off an old or cancelled worker.
      const prepared = await database.query<Prepared>(`
        UPDATE waitlist_email_outbox AS job SET payload = COALESCE(payload, $3),
          payload_hash = COALESCE(payload_hash, $4), attempt_count = attempt_count + 1,
          first_attempt_at = COALESCE(first_attempt_at, clock_timestamp()),
          lease_expires_at = clock_timestamp() + interval '1 minute'
        WHERE id = $1 AND status = 'processing' AND lease_token = $2
          AND lease_expires_at > clock_timestamp() AND attempt_count < 8
          AND (first_attempt_at IS NULL OR first_attempt_at > clock_timestamp() - interval '23 hours')
          AND EXISTS (SELECT 1 FROM waitlist_signups AS signup
            WHERE signup.referral_code = job.referral_code AND signup.email_opted_out_at IS NULL AND signup.email IS NOT NULL)
        RETURNING payload, payload_hash, attempt_count
      `, [job.id, lease, serialized, HASH(serialized)])
      const attempt = prepared.rows[0]
      if (!attempt) { totals.cancelled++; continue }
      try {
        const delivered = await send(JSON.parse(attempt.payload) as EmailPayload, `waitlist/${job.id}`)
        if (!delivered || typeof delivered.id !== 'string' || !delivered.id) throw new Error('The provider response is incomplete.')
        const saved = await database.query(`
          UPDATE waitlist_email_outbox SET status = 'sent', provider_id = $3,
            sent_at = clock_timestamp(), failure_code = NULL, lease_token = NULL, lease_expires_at = NULL
          WHERE id = $1 AND status = 'processing' AND lease_token = $2
        `, [job.id, lease, delivered.id])
        totals.sent += saved.rowCount ?? 0
      } catch (error) {
        // Only an explicit permanent provider failure suppresses retries. Network
        // failures are ambiguous, and are safe to retry only under the stored key.
        const permanent = typeof error === 'object' && error !== null && 'retryable' in error && error.retryable === false
        const exhausted = attempt.attempt_count >= MAX_ATTEMPTS
        const delay = RETRY_SECONDS[Math.min(attempt.attempt_count - 1, RETRY_SECONDS.length - 1)]
        const saved = await database.query<{ status: string }>(`
          UPDATE waitlist_email_outbox SET
            status = CASE WHEN $3 OR first_attempt_at <= clock_timestamp() - interval '23 hours' THEN 'failed' ELSE 'pending' END,
            failure_code = $4, next_attempt_at = clock_timestamp() + $5 * interval '1 second',
            lease_token = NULL, lease_expires_at = NULL
          WHERE id = $1 AND status = 'processing' AND lease_token = $2
          RETURNING status
        `, [job.id, lease, permanent || exhausted, permanent ? 'provider_rejected' : exhausted ? 'attempts_exhausted' : 'delivery_uncertain', delay])
        if (saved.rows[0]?.status === 'failed') totals.failed++
        else if (saved.rows[0]?.status === 'pending') totals.retried++
      }
    }
    return totals
  }

  /** Caller verifies a separate HMAC unsubscribe token; a public referral code is insufficient. */
  async function unsubscribe(referralCode: string) {
    const client = await database.connect()
    try {
      await client.query('BEGIN')
      await client.query(`
        UPDATE waitlist_signups SET email_opted_out_at = COALESCE(email_opted_out_at, clock_timestamp())
        WHERE referral_code = $1 AND email IS NOT NULL
      `, [referralCode])
      await client.query(`
        UPDATE waitlist_email_outbox SET status = 'cancelled', failure_code = 'unsubscribed',
          lease_token = NULL, lease_expires_at = NULL
        WHERE referral_code = $1 AND status IN ('pending', 'processing')
      `, [referralCode])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  return { drain, unsubscribe }
}
