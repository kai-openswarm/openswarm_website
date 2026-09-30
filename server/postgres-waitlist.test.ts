import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Pool, PoolClient } from 'pg'
import { createPostgresWaitlistStore } from './postgres-waitlist.ts'
import { createEmailOutbox } from './email-outbox.ts'
import { BASE_MIGRATIONS, LATER_MIGRATIONS, applyFiles, withTestDatabase } from './test-database.ts'

type Call = { text: string, values: unknown[] | undefined }
type Step = { contains: string, rows?: unknown[], error?: Error }

function scriptedDatabase(steps: Step[]) {
  const calls: Call[] = []
  let releases = 0
  const query = async (text: string, values?: unknown[]) => {
    calls.push({ text, values })
    const step = steps.shift()
    assert.ok(step, `Unexpected query: ${text}`)
    assert.ok(text.includes(step.contains), `Expected query containing ${step.contains}`)
    if (step.error) throw step.error
    return { rows: step.rows ?? [], rowCount: step.rows?.length ?? 0 }
  }
  const client = { query, release() { releases++ } } as unknown as PoolClient
  const database = { connect: async () => client, query } as unknown as Pick<Pool, 'connect' | 'query'>
  return { database, calls, remaining: () => steps.length, releases: () => releases }
}

test('SQL signup commits parameterized canonical values before returning referral progress', async () => {
  const code = 'a'.repeat(32)
  const inviter = 'b'.repeat(32)
  const fixture = scriptedDatabase([
    { contains: 'BEGIN ISOLATION LEVEL READ COMMITTED' },
    { contains: 'ON CONFLICT (email) DO NOTHING', rows: [{ referral_code: code }] },
    { contains: 'analytics.attribute_signup' },
    { contains: 'COUNT(invitee.referral_code)', rows: [{ referral_code: code, count: 0 }] },
    { contains: 'COMMIT' },
  ])
  const store = createPostgresWaitlistStore(fixture.database, () => code)
  const source = "hero'; DROP TABLE waitlist_signups; --"
  assert.deepEqual(await store.add(' Alex@Example.com ', source, inviter), {
    added: true, referral: { code, count: 0, goal: 3, priorityAccess: false },
  })
  assert.deepEqual(fixture.calls[1].values, ['alex@example.com', source, code, inviter, null, null])
  assert.ok(!fixture.calls[1].text.includes(source))
  assert.ok(!fixture.calls[1].text.includes('alex@example.com'))
  assert.ok(fixture.calls[1].text.includes('inviter.email IS DISTINCT FROM $1'))
  assert.equal(fixture.releases(), 1)
  assert.equal(fixture.remaining(), 0)
})

test('a concurrent duplicate reads the committed winner without changing its code or attribution', async () => {
  const code = 'a'.repeat(32)
  const fixture = scriptedDatabase([
    { contains: 'BEGIN ISOLATION LEVEL READ COMMITTED' },
    { contains: 'ON CONFLICT (email) DO NOTHING', rows: [] },
    { contains: 'SELECT referral_code FROM waitlist_signups WHERE email', rows: [{ referral_code: code }] },
    { contains: 'COUNT(invitee.referral_code)', rows: [{ referral_code: code, count: 3 }] },
    { contains: 'COMMIT' },
  ])
  const store = createPostgresWaitlistStore(fixture.database)
  assert.deepEqual(await store.add('alex@example.com', 'another source', 'c'.repeat(32)), {
    added: false, referral: { code, count: 3, goal: 3, priorityAccess: true },
  })
  assert.ok(fixture.calls.every(({ text }) => !text.includes('UPDATE')))
  assert.equal(fixture.releases(), 1)
})

test('failed writes roll back and release the checked-out connection without returning success', async () => {
  const failure = new Error('database unavailable')
  const fixture = scriptedDatabase([
    { contains: 'BEGIN' },
    { contains: 'INSERT INTO', error: failure },
    { contains: 'ROLLBACK' },
  ])
  await assert.rejects(createPostgresWaitlistStore(fixture.database).add('alex@example.com', 'hero'), failure)
  assert.equal(fixture.releases(), 1)
  assert.ok(fixture.calls.every(({ text }) => text !== 'COMMIT'))
})

test('rare share-code collisions retry a fresh transaction and a new random code', async () => {
  const code = 'b'.repeat(32)
  const collision = Object.assign(new Error('code conflict'), { code: '23505', constraint: 'waitlist_signups_pkey' })
  const fixture = scriptedDatabase([
    { contains: 'BEGIN' },
    { contains: 'INSERT INTO', error: collision },
    { contains: 'ROLLBACK' },
    { contains: 'BEGIN' },
    { contains: 'INSERT INTO', rows: [{ referral_code: code }] },
    { contains: 'analytics.attribute_signup' },
    { contains: 'COUNT(invitee.referral_code)', rows: [{ referral_code: code, count: 0 }] },
    { contains: 'COMMIT' },
  ])
  const codes = ['a'.repeat(32), code]
  const result = await createPostgresWaitlistStore(fixture.database, () => codes.shift()!).add('alex@example.com', 'hero')
  assert.equal(result.referral.code, code)
  assert.equal(fixture.releases(), 2)
  assert.notEqual(fixture.calls[1].values?.[2], fixture.calls[4].values?.[2])
})

test('public referral lookup returns only progress or null', async () => {
  const code = 'a'.repeat(32)
  const fixture = scriptedDatabase([
    { contains: 'WHERE owner.referral_code = $1', rows: [{ referral_code: code, count: 4 }] },
    { contains: 'WHERE owner.referral_code = $1', rows: [] },
  ])
  const store = createPostgresWaitlistStore(fixture.database)
  assert.deepEqual(await store.referral(code), { code, count: 4, goal: 3, priorityAccess: true })
  assert.equal(await store.referral('missing'), null)
})

// Both waitlist emails switched on in the dashboard.
const emailEvents = { welcome: true, priority: true }

test('enabled delivery locks the inviter before signup and queues both events in its transaction', async () => {
  const code = 'a'.repeat(32)
  const inviter = 'b'.repeat(32)
  const fixture = scriptedDatabase([
    { contains: 'BEGIN' },
    { contains: 'FOR UPDATE', rows: [{ referral_code: inviter }] },
    { contains: 'ON CONFLICT (email) DO NOTHING', rows: [{ referral_code: code, referred_by: inviter }] },
    { contains: 'analytics.attribute_signup' },
    { contains: "referral_code, 'welcome'" },
    { contains: "inviter.referral_code, 'priority'" },
    { contains: 'COUNT(invitee.referral_code)', rows: [{ referral_code: code, count: 0 }] },
    { contains: 'COMMIT' },
  ])
  await createPostgresWaitlistStore(fixture.database, () => code).add('friend@example.com', 'hero', inviter, { emailEvents })
  assert.deepEqual(fixture.calls[1].values, [inviter, 'friend@example.com'])
  assert.equal(fixture.calls[4].values?.[1], code)
  assert.equal(fixture.calls[5].values?.[1], inviter)
  assert.match(fixture.calls[5].text, /= 3/)
  assert.match(fixture.calls[5].text, /inviter.email IS NOT NULL/)
  assert.equal(fixture.remaining(), 0)
})

test('enabled delivery does not enqueue duplicate signups', async () => {
  const code = 'a'.repeat(32)
  const fixture = scriptedDatabase([
    { contains: 'BEGIN' },
    { contains: 'ON CONFLICT (email) DO NOTHING', rows: [] },
    { contains: 'SELECT referral_code FROM waitlist_signups WHERE email', rows: [{ referral_code: code }] },
    { contains: 'COUNT(invitee.referral_code)', rows: [{ referral_code: code, count: 3 }] },
    { contains: 'COMMIT' },
  ])
  const result = await createPostgresWaitlistStore(fixture.database, () => code).add('existing@example.com', 'hero', undefined, { emailEvents })
  assert.equal(result.added, false)
  assert.ok(fixture.calls.every(({ text }) => !text.includes('waitlist_email_outbox')))
})

test('an outbox failure rolls back the signup instead of losing its confirmation event', async () => {
  const code = 'a'.repeat(32)
  const failure = new Error('queue unavailable')
  const fixture = scriptedDatabase([
    { contains: 'BEGIN' },
    { contains: 'ON CONFLICT (email) DO NOTHING', rows: [{ referral_code: code, referred_by: null }] },
    { contains: 'analytics.attribute_signup' },
    { contains: 'INSERT INTO waitlist_email_outbox', error: failure },
    { contains: 'ROLLBACK' },
  ])
  await assert.rejects(createPostgresWaitlistStore(fixture.database, () => code).add('new@example.com', 'hero', undefined, { emailEvents }), failure)
  assert.ok(fixture.calls.every(({ text }) => text !== 'COMMIT'))
  assert.equal(fixture.releases(), 1)
})

test('real PostgreSQL migration, concurrent dedupe and first-referral attribution', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to a PostgreSQL server where the test may create databases.',
}, async () => {
  await withTestDatabase(async (database) => {
    await applyFiles(database, BASE_MIGRATIONS)
    const legacyCode = 'l'.repeat(32)
    const legacyInviteeCode = 'm'.repeat(32)
    await database.query(`
      INSERT INTO waitlist_signups (phone, source, referral_code, referred_by, created_at)
      VALUES ($1, 'legacy', $2, NULL, '2026-09-20T12:00:00Z'), ($3, 'legacy', $4, $2, '2026-09-21T12:00:00Z')
    `, ['+12025550123', legacyCode, '+12025550124', legacyInviteeCode])
    const legacyRows = (await database.query('SELECT phone, source, referral_code, referred_by, created_at FROM waitlist_signups ORDER BY phone')).rows
    // The email, analytics and delivery migrations keep legacy phone signups intact.
    await applyFiles(database, LATER_MIGRATIONS)
    const queueing = createPostgresWaitlistStore(database)
    const emailEvents = { welcome: true, priority: true }
    const store = { ...queueing, add: (email: string, source: string, code?: string) => queueing.add(email, source, code, { emailEvents }) }
    assert.deepEqual((await database.query('SELECT phone, source, referral_code, referred_by, created_at FROM waitlist_signups WHERE phone IS NOT NULL ORDER BY phone')).rows, legacyRows)
    assert.deepEqual(await store.referral(legacyCode), { code: legacyCode, count: 1, goal: 3, priorityAccess: false })
    await store.add('legacy-invite1@example.com', 'test', legacyCode)
    assert.equal((await store.referral(legacyCode))?.priorityAccess, false)
    await store.add('legacy-invite2@example.com', 'test', legacyCode)
    await store.add(' LEGACY-INVITE2@Example.com ', 'changed', legacyCode)
    assert.deepEqual(await store.referral(legacyCode), { code: legacyCode, count: 3, goal: 3, priorityAccess: true })
    const inviter = (await store.add('alex@example.com', 'test')).referral
    const other = (await store.add('other@example.com', 'test')).referral
    const emails = ['friend1@example.com', 'friend2@example.com', 'friend3@example.com']
    const signups = await Promise.all([...emails, ...emails, ...emails].map((email) => store.add(email, 'test', inviter.code)))
    assert.equal(signups.filter(({ added }) => added).length, 3)
    for (const email of emails) await store.add(email, 'changed source', other.code)
    await store.add('alex@example.com', 'test', inviter.code)
    assert.deepEqual(await store.referral(inviter.code), { ...inviter, count: 3, priorityAccess: true })
    assert.equal((await store.referral(other.code))?.count, 0)
    await store.add('unknown@example.com', 'test', 'z'.repeat(32))
    const rows = await database.query('SELECT email, referred_by, source FROM waitlist_signups ORDER BY email')
    assert.equal(rows.rows.length, 10)
    assert.equal(rows.rows.filter((row) => row.referred_by === inviter.code).length, 3)
    assert.ok(rows.rows.filter((row) => row.email).every((row) => row.source === 'test'))
    assert.equal(rows.rows.find((row) => row.email === 'unknown@example.com').referred_by, null)
    const queued = (await database.query('SELECT kind, referral_code FROM waitlist_email_outbox')).rows
    assert.equal(queued.filter((row) => row.kind === 'welcome').length, 8)
    assert.deepEqual(queued.filter((row) => row.kind === 'priority'), [{ kind: 'priority', referral_code: inviter.code }])
    assert.ok(queued.every((row) => row.referral_code !== legacyCode && row.referral_code !== legacyInviteeCode))
    const outbox = createEmailOutbox(database)
    const deliveredKeys: string[] = []
    let releaseFirstPair: () => void
    const firstPairStarted = new Promise<void>((resolve) => { releaseFirstPair = resolve })
    const worker = {
      limit: 5,
      render: ({ email }: { email: string }) => ({ from: 'Open Swarm <hello@example.com>', to: [email], subject: 'Test', html: '<p>Test</p>', text: 'Test' }),
      send: async (_payload: unknown, key: string) => {
        deliveredKeys.push(key)
        if (deliveredKeys.length === 2) releaseFirstPair()
        await firstPairStarted
        return { id: `provider-${key}` }
      },
    }
    const drains = await Promise.all([outbox.drain(worker), outbox.drain(worker)])
    assert.equal(drains.reduce((sum, result) => sum + result.sent, 0), 9)
    assert.equal(new Set(deliveredKeys).size, 9, 'concurrent workers claim distinct events')
    const rls = await database.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.waitlist_signups'::regclass")
    assert.equal(rls.rows[0].relrowsecurity, true)
  })
})
