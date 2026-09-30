import { randomBytes } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { ReferralStatus, SignupContext, WaitlistStore } from './waitlist.ts'

type Database = Pick<Pool, 'connect' | 'query'>
type CodeRow = { referral_code: string }
type ProgressRow = CodeRow & { count: number }

const STATUS_QUERY = `
  SELECT owner.referral_code, COUNT(invitee.phone)::integer AS count
  FROM waitlist_signups AS owner
  LEFT JOIN waitlist_signups AS invitee
    ON invitee.referred_by = owner.referral_code AND invitee.phone <> owner.phone
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
  async function add(phone: string, source: string, referralCode?: string, context: SignupContext = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const client: PoolClient = await database.connect()
      let retry = false
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
        const inserted = await client.query<CodeRow>(`
          INSERT INTO waitlist_signups (phone, source, referral_code, referred_by, consent_version, consented_at, network_hash)
          SELECT $1, $2, $3, inviter.referral_code, $5::text, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END, $6
          FROM (SELECT $4::text AS code) AS requested
          LEFT JOIN waitlist_signups AS inviter ON inviter.referral_code = requested.code AND inviter.phone <> $1
          ON CONFLICT (phone) DO NOTHING
          RETURNING referral_code
        `, [phone, source, createCode(), referralCode ?? null, context.consentVersion ?? null, context.networkHash ?? null])
        const added = inserted.rows.length === 1
        if (added) {
          // Copy the visit that produced this signup; ids are optional and unverified hints.
          await client.query('SELECT analytics.attribute_signup($1, $2::uuid, $3::uuid, $4::jsonb)', [
            phone, context.visitorId ?? null, context.sessionId ?? null, JSON.stringify(context.fallback ?? {}),
          ])
        }
        // A concurrent insert may have won the unique phone constraint. A separate
        // READ COMMITTED statement sees that committed row without rewriting its inviter.
        const owner = added ? inserted.rows[0] : (await client.query<CodeRow>(
          'SELECT referral_code FROM waitlist_signups WHERE phone = $1', [phone],
        )).rows[0]
        if (!owner) throw new Error('The waitlist signup could not be read.')
        const progress = (await client.query<ProgressRow>(STATUS_QUERY, [owner.referral_code])).rows[0]
        if (!progress) throw new Error('The waitlist progress could not be read.')
        await client.query('COMMIT')
        return { added, referral: status(progress) }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        const failure = error as { code?: string, constraint?: string }
        retry = failure?.code === '23505' && failure.constraint === 'waitlist_referral_code_unique' && attempt < 2
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
