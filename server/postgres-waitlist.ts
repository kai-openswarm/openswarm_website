import { randomBytes, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { normalizeEmail } from '../src/lib/email.ts'
import type { ReferralStatus, SignupContext, WaitlistStore } from './waitlist.ts'

type Database = Pick<Pool, 'connect' | 'query'>
type CodeRow = { referral_code: string }
type ProgressRow = CodeRow & { count: number }
type InsertedRow = CodeRow & { referred_by: string | null }

const STATUS_QUERY = `
  SELECT owner.referral_code, COUNT(invitee.referral_code)::integer AS count
  FROM waitlist_signups AS owner
  LEFT JOIN waitlist_signups AS invitee
    ON invitee.referred_by = owner.referral_code AND invitee.referral_code <> owner.referral_code
  WHERE owner.referral_code = $1
  GROUP BY owner.referral_code
`

function status(row: ProgressRow): ReferralStatus {
  return { code: row.referral_code, count: row.count, goal: 3, priorityAccess: row.count >= 3 }
}

/** Shared PostgreSQL state; uniqueness and first-referral attribution are enforced by the database. */
export function createPostgresWaitlistStore(
  database: Database,
  createCode: () => string = () => randomBytes(24).toString('base64url'),
): WaitlistStore {
  async function add(email: string, source: string, referralCode?: string, context: SignupContext = {}) {
    const canonicalEmail = normalizeEmail(email)
    if (!canonicalEmail) throw new Error('The email address is invalid.')
    for (let attempt = 0; attempt < 3; attempt++) {
      const client: PoolClient = await database.connect()
      let retry = false
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
        // Serializing on the inviter BEFORE inserting makes the third referral
        // observable exactly once even when several friends join concurrently.
        if (context.emailEvents?.priority && referralCode) {
          await client.query(`
            SELECT referral_code FROM waitlist_signups
            WHERE referral_code = $1 AND email IS DISTINCT FROM $2 FOR UPDATE
          `, [referralCode, canonicalEmail])
        }
        const inserted = await client.query<InsertedRow>(`
          INSERT INTO waitlist_signups (email, source, referral_code, referred_by, consent_version, consented_at, network_hash)
          SELECT $1, $2, $3, inviter.referral_code, $5::text, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END, $6
          FROM (SELECT $4::text AS code) AS requested
          LEFT JOIN waitlist_signups AS inviter ON inviter.referral_code = requested.code AND inviter.email IS DISTINCT FROM $1
          ON CONFLICT (email) DO NOTHING
          RETURNING referral_code, referred_by
        `, [canonicalEmail, source, createCode(), referralCode ?? null, context.consentVersion ?? null, context.networkHash ?? null])
        const added = inserted.rows.length === 1
        if (added) {
          // Copy the visit that produced this signup; ids are optional and unverified hints.
          await client.query('SELECT analytics.attribute_signup($1, $2::uuid, $3::uuid, $4::jsonb)', [
            inserted.rows[0].referral_code, context.visitorId ?? null, context.sessionId ?? null, JSON.stringify(context.fallback ?? {}),
          ])
        }
        // A concurrent insert may have won the unique email constraint. A separate
        // READ COMMITTED statement sees that committed row without rewriting its inviter.
        const owner = added ? inserted.rows[0] : (await client.query<CodeRow>(
          'SELECT referral_code FROM waitlist_signups WHERE email = $1', [canonicalEmail],
        )).rows[0]
        if (!owner) throw new Error('The waitlist signup could not be read.')
        // Queue writes share the signup transaction: neither can commit alone.
        if (context.emailEvents?.welcome && added) {
          await client.query(`
            INSERT INTO waitlist_email_outbox (id, referral_code, kind)
            SELECT $1, referral_code, 'welcome' FROM waitlist_signups
            WHERE referral_code = $2 AND email IS NOT NULL AND email_opted_out_at IS NULL
            ON CONFLICT (kind, referral_code) DO NOTHING
          `, [randomUUID(), owner.referral_code])
        }
        if (context.emailEvents?.priority && added && inserted.rows[0].referred_by) {
          await client.query(`
            INSERT INTO waitlist_email_outbox (id, referral_code, kind)
            SELECT $1, inviter.referral_code, 'priority' FROM waitlist_signups AS inviter
            WHERE inviter.referral_code = $2 AND inviter.email IS NOT NULL
              AND inviter.email_opted_out_at IS NULL
              AND (SELECT COUNT(*) FROM waitlist_signups AS friend
                WHERE friend.referred_by = inviter.referral_code
                  AND friend.referral_code <> inviter.referral_code) = 3
            ON CONFLICT (kind, referral_code) DO NOTHING
          `, [randomUUID(), inserted.rows[0].referred_by])
        }
        const progress = (await client.query<ProgressRow>(STATUS_QUERY, [owner.referral_code])).rows[0]
        if (!progress) throw new Error('The waitlist progress could not be read.')
        await client.query('COMMIT')
        return { added, referral: status(progress) }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        const failure = error as { code?: string, constraint?: string }
        retry = failure?.code === '23505' &&
          ['waitlist_referral_code_unique', 'waitlist_signups_pkey'].includes(failure.constraint ?? '') && attempt < 2
        if (!retry) throw error
      } finally {
        client.release()
      }
      if (!retry) break
    }
    throw new Error('The waitlist signup could not be saved.')
  }

  return {
    add,
    async displayCount() {
      const result = await database.query<{ count: string }>('SELECT analytics.waitlist_display_count()::text AS count')
      return Number(result.rows[0]?.count ?? 0)
    },
    async referral(code) {
      const result = await database.query<ProgressRow>(STATUS_QUERY, [code])
      return result.rows[0] ? status(result.rows[0]) : null
    },
  }
}
