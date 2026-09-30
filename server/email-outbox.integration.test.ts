import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import type { Pool } from 'pg'
import { createEmailOutbox, type EmailMessage, type EmailPayload } from './email-outbox.ts'
import { createPostgresWaitlistStore } from './postgres-waitlist.ts'
import { BASE_MIGRATIONS, applyFiles, withTestDatabase } from './test-database.ts'

// Runs every migration on a throwaway database; signups made before 006 are "historical".
test('real PostgreSQL: atomic queue events, durable retries, fencing and suppression', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to a PostgreSQL server where the test may create databases.',
}, async () => withTestDatabase(async (pool) => {
  const pg = { exec: (sql: string) => pool.query(sql) }
  const query = (sql: string, values?: unknown[]) => pool.query(sql, values)
  const database = pool as Pick<Pool, 'query' | 'connect'>
  const render = ({ email, kind }: EmailMessage): EmailPayload => ({ from: 'Open Swarm <hello@example.com>', to: [email], subject: kind, html: '<p>You’re in.</p>', text: 'You’re in.' })
  await applyFiles(pool, [...BASE_MIGRATIONS, '../sql/002_email_waitlist.sql', '../sql/003_analytics.sql', '../sql/004_api_role.sql', '../sql/005_admin_features.sql'])
  const disabled = createPostgresWaitlistStore(database)
  const historical = await disabled.add('historical@example.com', 'test')
  await disabled.add('historical1@example.com', 'test', historical.referral.code)
  await disabled.add('historical2@example.com', 'test', historical.referral.code)
  await disabled.add('historical3@example.com', 'test', historical.referral.code)
  await query(`INSERT INTO waitlist_signups (phone, source, referral_code) VALUES ('+12025550123', 'legacy', $1)`, ['l'.repeat(32)])
  await applyFiles(pool, ['../sql/006_waitlist_email_delivery.sql', '../sql/007_email_admin.sql'])
  assert.equal((await query('SELECT * FROM waitlist_email_outbox')).rows.length, 0, 'migration does not backfill')

  const queueing = createPostgresWaitlistStore(database)
  const emailEvents = { welcome: true, priority: true }
  const store = { ...queueing, add: (email: string, source: string, code?: string) => queueing.add(email, source, code, { emailEvents }) }
  const owner = await store.add('owner@example.com', 'test')
  for (const email of ['first@example.com', 'second@example.com', 'third@example.com', 'fourth@example.com']) {
    await store.add(email, 'test', owner.referral.code)
    await store.add(email, 'duplicate', owner.referral.code)
  }
  await store.add('historical4@example.com', 'test', historical.referral.code)
  for (let n = 0; n < 3; n++) await store.add(`legacy${n}@example.com`, 'test', 'l'.repeat(32))
  let events = (await query('SELECT kind, referral_code FROM waitlist_email_outbox')).rows
  assert.equal(events.filter((row: { kind: string }) => row.kind === 'welcome').length, 9)
  assert.deepEqual(events.filter((row: { kind: string }) => row.kind === 'priority'), [{ kind: 'priority', referral_code: owner.referral.code }])

  // If the queue cannot accept an event, the new signup is rolled back too.
  await pg.exec(`CREATE FUNCTION reject_test_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$;
    CREATE TRIGGER reject_test_email BEFORE INSERT ON waitlist_email_outbox FOR EACH ROW EXECUTE FUNCTION reject_test_email();`)
  await assert.rejects(store.add('rollback@example.com', 'test'))
  assert.equal((await query("SELECT * FROM waitlist_signups WHERE email = 'rollback@example.com'")).rows.length, 0)
  await pg.exec('DROP TRIGGER reject_test_email ON waitlist_email_outbox; DROP FUNCTION reject_test_email();')

  const outbox = createEmailOutbox(database)
  let original: { body: EmailPayload, key: string } | undefined
  let result = await outbox.drain({ limit: 1, render, send: async (body, key) => { original = { body, key }; throw new Error('response lost') } })
  assert.equal(result.retried, 1)
  const eventId = original!.key.slice('waitlist/'.length)
  const saved = (await query('SELECT * FROM waitlist_email_outbox WHERE id = $1', [eventId])).rows[0]
  assert.equal(saved.status, 'pending')
  assert.equal(saved.attempt_count, 1)
  assert.equal(saved.payload, JSON.stringify(original!.body))
  await assert.rejects(query('UPDATE waitlist_email_outbox SET payload = $2 WHERE id = $1', [eventId, '{}']), /immutable/)
  await query("UPDATE waitlist_email_outbox SET next_attempt_at = now() + interval '1 day' WHERE id <> $1", [eventId])
  await query('UPDATE waitlist_email_outbox SET next_attempt_at = now() WHERE id = $1', [eventId])
  result = await outbox.drain({ limit: 1, render: () => { throw new Error('must reuse persisted payload') }, send: async (body, key) => {
    assert.deepEqual({ body, key }, original)
    return { id: 'provider-one' }
  } })
  assert.equal(result.sent, 1)

  // A process dying after persistence leaves a lease. Reclaim the same event
  // after expiry; a delayed old worker cannot overwrite the new lease/result.
  const pending = (await query("SELECT * FROM waitlist_email_outbox WHERE status = 'pending' LIMIT 1")).rows[0]
  const signup = (await query('SELECT email FROM waitlist_signups WHERE referral_code = $1', [pending.referral_code])).rows[0]
  const staleBody = JSON.stringify(render({ email: signup.email, kind: pending.kind, referralCode: pending.referral_code, createdAt: '' }))
  const staleLease = '11111111-1111-4111-8111-111111111111'
  await query(`UPDATE waitlist_email_outbox SET status = 'processing', lease_token = $2,
    lease_expires_at = now() - interval '1 second', payload = $3, payload_hash = $4,
    first_attempt_at = now(), attempt_count = 1 WHERE id = $1`, [pending.id, staleLease, staleBody, createHash('sha256').update(staleBody).digest('hex')])
  result = await outbox.drain({ limit: 1, render: () => { throw new Error('must reuse persisted payload') }, send: async (_body, key) => {
    assert.equal(key, `waitlist/${pending.id}`)
    const staleWrite = await query("UPDATE waitlist_email_outbox SET failure_code = 'stale' WHERE id = $1 AND lease_token = $2", [pending.id, staleLease])
    assert.equal(staleWrite.rowCount, 0)
    return { id: 'provider-two' }
  } })
  assert.equal(result.sent, 1)

  // Never retry after provider idempotency expires, even if the prior result is unknown.
  const expiring = (await query("SELECT * FROM waitlist_email_outbox WHERE status = 'pending' LIMIT 1")).rows[0]
  await query("UPDATE waitlist_email_outbox SET first_attempt_at = now() - interval '23 hours', attempt_count = 1 WHERE id = $1", [expiring.id])
  result = await outbox.drain({ limit: 1, render, send: async () => { assert.fail('only exhausted or future jobs remain') } })
  assert.equal(result.failed, 1)
  assert.equal((await query('SELECT status FROM waitlist_email_outbox WHERE id = $1', [expiring.id])).rows[0].status, 'failed')

  await outbox.unsubscribe(owner.referral.code)
  await outbox.unsubscribe(owner.referral.code)
  assert.equal((await store.referral(owner.referral.code))?.count, 4, 'suppression preserves referral attribution')
  assert.ok((await query('SELECT email_opted_out_at FROM waitlist_signups WHERE referral_code = $1', [owner.referral.code])).rows[0].email_opted_out_at)
  const queuedBefore = (await query('SELECT COUNT(*)::integer AS count FROM waitlist_email_outbox')).rows[0].count
  await store.add('owner@example.com', 'again')
  assert.equal((await query('SELECT COUNT(*)::integer AS count FROM waitlist_email_outbox')).rows[0].count, queuedBefore, 'duplicate does not resubscribe or resend')
  events = (await query('SELECT status FROM waitlist_email_outbox WHERE referral_code = $1', [owner.referral.code])).rows
  assert.ok(events.every((row: { status: string }) => ['sent', 'cancelled', 'failed'].includes(row.status)))
  const suppressed = await store.add('suppressed@example.com', 'test')
  await store.add('suppressed-friend1@example.com', 'test', suppressed.referral.code)
  await store.add('suppressed-friend2@example.com', 'test', suppressed.referral.code)
  await outbox.unsubscribe(suppressed.referral.code)
  await store.add('suppressed-friend3@example.com', 'test', suppressed.referral.code)
  const suppressedEvents = (await query('SELECT kind, status FROM waitlist_email_outbox WHERE referral_code = $1', [suppressed.referral.code])).rows
  assert.deepEqual(suppressedEvents, [{ kind: 'welcome', status: 'cancelled' }], 'opted-out inviters do not receive priority mail')
  assert.equal((await store.referral(suppressed.referral.code))?.priorityAccess, true)
  const rls = (await query("SELECT relrowsecurity FROM pg_class WHERE oid = 'waitlist_email_outbox'::regclass")).rows[0]
  assert.equal(rls.relrowsecurity, true)
}))
