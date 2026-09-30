import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Pool, type PoolClient } from 'pg'
import { createPostgresWaitlistStore } from './postgres-waitlist.ts'
import { applyMigrations, withTestDatabase } from './test-database.ts'

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
    { contains: 'ON CONFLICT (phone) DO NOTHING', rows: [{ referral_code: code }] },
    { contains: 'analytics.attribute_signup' },
    { contains: 'COUNT(invitee.phone)', rows: [{ referral_code: code, count: 0 }] },
    { contains: 'COMMIT' },
  ])
  const store = createPostgresWaitlistStore(fixture.database, () => code)
  const source = "hero'; DROP TABLE waitlist_signups; --"
  assert.deepEqual(await store.add('+12025550123', source, inviter), {
    added: true, referral: { code, count: 0, goal: 3, priorityAccess: false },
  })
  assert.deepEqual(fixture.calls[1].values, ['+12025550123', source, code, inviter, null, null])
  assert.ok(!fixture.calls[1].text.includes(source))
  assert.ok(!fixture.calls[1].text.includes('+12025550123'))
  assert.equal(fixture.releases(), 1)
  assert.equal(fixture.remaining(), 0)
})

test('a concurrent duplicate reads the committed winner without changing its code or attribution', async () => {
  const code = 'a'.repeat(32)
  const fixture = scriptedDatabase([
    { contains: 'BEGIN ISOLATION LEVEL READ COMMITTED' },
    { contains: 'ON CONFLICT (phone) DO NOTHING', rows: [] },
    { contains: 'SELECT referral_code FROM waitlist_signups WHERE phone', rows: [{ referral_code: code }] },
    { contains: 'COUNT(invitee.phone)', rows: [{ referral_code: code, count: 3 }] },
    { contains: 'COMMIT' },
  ])
  const store = createPostgresWaitlistStore(fixture.database)
  assert.deepEqual(await store.add('+12025550123', 'another source', 'c'.repeat(32)), {
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
  await assert.rejects(createPostgresWaitlistStore(fixture.database).add('+12025550123', 'hero'), failure)
  assert.equal(fixture.releases(), 1)
  assert.ok(fixture.calls.every(({ text }) => text !== 'COMMIT'))
})

test('rare share-code collisions retry a fresh transaction and a new random code', async () => {
  const code = 'b'.repeat(32)
  const collision = Object.assign(new Error('code conflict'), { code: '23505', constraint: 'waitlist_referral_code_unique' })
  const fixture = scriptedDatabase([
    { contains: 'BEGIN' },
    { contains: 'INSERT INTO', error: collision },
    { contains: 'ROLLBACK' },
    { contains: 'BEGIN' },
    { contains: 'INSERT INTO', rows: [{ referral_code: code }] },
    { contains: 'analytics.attribute_signup' },
    { contains: 'COUNT(invitee.phone)', rows: [{ referral_code: code, count: 0 }] },
    { contains: 'COMMIT' },
  ])
  const codes = ['a'.repeat(32), code]
  const result = await createPostgresWaitlistStore(fixture.database, () => codes.shift()!).add('+12025550123', 'hero')
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

test('real PostgreSQL migration, concurrent dedupe and first-referral attribution', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to a PostgreSQL server where the test may create databases.',
}, async () => {
  await withTestDatabase(async (database) => {
    // Migrations are idempotent; applying them twice must not fail.
    await applyMigrations(database)
    const store = createPostgresWaitlistStore(database)
    const inviter = (await store.add('+12025550123', 'test')).referral
    const other = (await store.add('+12025550124', 'test')).referral
    const phones = ['+12025550125', '+12025550126', '+12025550127']
    const signups = await Promise.all([...phones, ...phones, ...phones].map((phone) => store.add(phone, 'test', inviter.code)))
    assert.equal(signups.filter(({ added }) => added).length, 3)
    for (const phone of phones) await store.add(phone, 'changed source', other.code)
    await store.add('+12025550123', 'test', inviter.code)
    assert.deepEqual(await store.referral(inviter.code), { ...inviter, count: 3, priorityAccess: true })
    assert.equal((await store.referral(other.code))?.count, 0)
    await store.add('+12025550128', 'test', 'z'.repeat(32))
    const rows = await database.query('SELECT phone, referred_by, source FROM waitlist_signups ORDER BY phone')
    assert.equal(rows.rows.length, 6)
    assert.equal(rows.rows.filter((row) => row.referred_by === inviter.code).length, 3)
    assert.ok(rows.rows.every((row) => row.source === 'test'))
    assert.equal(rows.rows.at(-1).referred_by, null)
    const rls = await database.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.waitlist_signups'::regclass")
    assert.equal(rls.rows[0].relrowsecurity, true)
  })
})
