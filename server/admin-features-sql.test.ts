import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Pool } from 'pg'
import type { IngestBatch } from './analytics.ts'
import { createEmailOutbox } from './email-outbox.ts'
import { createPostgresAnalyticsStore } from './postgres-analytics.ts'
import { createPostgresWaitlistStore } from './postgres-waitlist.ts'
import { parseSignupConfig } from './signup-config.ts'
import { applyMigrations, connectAsApiRole, withTestDatabase } from './test-database.ts'

const skip = !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to a PostgreSQL server where the test may create databases.'
const ADMIN = 'eric@openswarm.com'

async function asAdmin<T>(database: Pool, sql: string, values: unknown[] = []): Promise<T> {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ email: ADMIN, role: 'authenticated' })])
    await client.query('SET LOCAL ROLE authenticated')
    const result = await client.query(sql, values)
    await client.query('COMMIT')
    return result.rows[0] ? Object.values(result.rows[0])[0] as T : undefined as T
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function batch(visitor: string, session: string, meta: Partial<IngestBatch['meta']>, events: [string, Record<string, string | number | boolean>?][]): IngestBatch {
  const now = Date.now()
  return {
    visitor_id: visitor, session_id: session, now: new Date(now).toISOString(), internal: false,
    meta: { entry_path: '/', referrer: null, referrer_domain: null, channel: 'Direct', source: '(direct)', utm_source: null, utm_medium: null,
      utm_campaign: null, utm_term: null, utm_content: null, click_id: null, has_invite: false, country: 'US', region: null, city: null,
      browser: 'Chrome', browser_version: '140', os: 'macOS', os_version: null, device_type: 'desktop', screen: null, viewport: null,
      language: null, timezone: null, ...meta },
    events: events.map(([name, props], index) => ({ name, path: '/', at: new Date(now - 1000 + index).toISOString(), props: props ?? {} })),
  }
}

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`

test('email signup settings, filter operators, comparisons, referrals loop, annotations and email report', { skip }, async () => {
  await withTestDatabase(async (database) => {
    await applyMigrations(database)
    const api = await connectAsApiRole(database)
    const analytics = createPostgresAnalyticsStore(api)
    const waitlist = createPostgresWaitlistStore(api)
    const from = new Date(Date.now() - 86_400_000).toISOString()
    const to = new Date(Date.now() + 60_000).toISOString()

    // Inviter joins from X, opens the card, copies the link; two friends arrive on the link, one joins.
    await analytics.ingest(batch(uuid(1), uuid(101), { channel: 'Organic Social', source: 'x.com', country: 'US' }, [['pageview']]))
    const inviter = await waitlist.add('inviter@example.com', 'hero', undefined, { visitorId: uuid(1), sessionId: uuid(101) })
    await analytics.ingest(batch(uuid(1), uuid(101), {}, [['referral_open'], ['referral_copy', { channel: 'copy' }]]))
    await analytics.ingest(batch(uuid(2), uuid(102), { channel: 'Invite link', source: 'invite', has_invite: true, country: 'CA' }, [['pageview'], ['invite_visit', { code: inviter.referral.code }]]))
    await analytics.ingest(batch(uuid(3), uuid(103), { channel: 'Invite link', source: 'invite', has_invite: true, country: 'GB', device_type: 'mobile' }, [['pageview'], ['invite_visit', { code: inviter.referral.code }]]))
    await waitlist.add('friend@example.org', 'hero', inviter.referral.code, { visitorId: uuid(2), sessionId: uuid(102) })

    // Filter operators.
    const overview = (filters: object) => asAdmin<{ current: { visitors: number } }>(database, 'SELECT public.admin_overview($1, $2, $3)', [from, to, JSON.stringify(filters)])
    assert.equal((await overview({ country: { op: 'is', values: ['US', 'CA'] } })).current.visitors, 2)
    assert.equal((await overview({ country: { op: 'is_not', values: ['US'] } })).current.visitors, 2)
    assert.equal((await overview({ channel: { op: 'contains', values: ['invite'] } })).current.visitors, 2)
    assert.equal((await overview({ channel: { op: 'not_contains', values: ['social'] }, device_type: 'mobile' })).current.visitors, 1)
    assert.equal((await overview({ source: { op: 'contains', values: ['%'] } })).current.visitors, 0, 'LIKE wildcards are literal')
    await assert.rejects(overview({ country: { op: 'regex', values: ['.*'] } }), /Unsupported filter operator/)
    await assert.rejects(overview({ country: { op: 'is', values: [] } }), /1 to 50 values/)

    // Explicit comparison range and heartbeat.
    const lastYear = await asAdmin<{ compare_from: string, previous: { visitors: number }, last_signup_at: string, last_referral_at: string }>(
      database, 'SELECT public.admin_overview($1, $2, $3, $4, $5)',
      [from, to, '{}', new Date(Date.parse(from) - 365 * 86_400_000).toISOString(), new Date(Date.parse(to) - 365 * 86_400_000).toISOString()])
    assert.equal(lastYear.previous.visitors, 0)
    assert.ok(lastYear.last_signup_at && lastYear.last_referral_at)

    // Realtime today counters.
    const realtime = await asAdmin<{ today: { signups: number, referred_signups: number } }>(database, 'SELECT public.admin_realtime($1)', ['America/New_York'])
    assert.deepEqual([realtime.today.signups, realtime.today.referred_signups], [2, 1])

    // Referral loop: 2 cohort members, 1 invitee; the inviter's link had 2 visitors.
    const referrals = await asAdmin<Record<string, unknown>>(database, 'SELECT public.admin_referrals($1, $2)', [from, to])
    assert.equal(Number(referrals.classic_k), 0.5)
    assert.equal(Number(referrals.invite_visits_per_signup), 1)
    assert.equal(Number(referrals.invite_conversion), 0.5)
    assert.equal(Number(referrals.referral_rate), 0.5)
    assert.equal(Number(referrals.referred_share), 0.5)
    assert.deepEqual((referrals.loop_funnel as { people: number }[]).map((step) => step.people), [2, 1, 1, 1, 1, 0])
    assert.deepEqual(referrals.shares_by_channel, [{ channel: 'copy', shares: 1 }])

    // Annotations.
    const id = await asAdmin<number>(database, 'SELECT public.admin_add_annotation($1, $2, $3, $4)', [from.slice(0, 10), null, 'Launch post on X', 'orange'])
    await assert.rejects(asAdmin(database, 'SELECT public.admin_add_annotation($1, $2, $3, $4)', [from.slice(0, 10), null, 'x'.repeat(61), 'blue']), /check/)
    assert.equal((await asAdmin<unknown[]>(database, 'SELECT public.admin_annotations($1, $2)', [from, to])).length, 1)
    await asAdmin(database, 'SELECT public.admin_delete_annotation($1)', [id])
    assert.equal((await asAdmin<unknown[]>(database, 'SELECT public.admin_annotations($1, $2)', [from, to])).length, 0)

    // Email signup settings: validation, and the API role reads them through signup_config().
    const update = (key: string, value: unknown) => asAdmin(database, 'SELECT public.admin_update_setting($1, $2::jsonb)', [key, JSON.stringify(value)])
    await update('signups_open', false)
    await update('blocked_email_domains', ['spam.example'])
    await update('signup_limit_per_hour', 3)
    await assert.rejects(update('blocked_email_domains', ['Not A Domain']), /lowercase domain/)
    await assert.rejects(update('signup_limit_per_day', 0), /between 1 and 10000/)
    const welcome = { enabled: true, from_name: 'OpenSwarm', from_email: 'hello@openswarm.com', reply_to: '', subject: 'Welcome', body: 'Hi {{invite_link}}', postal_address: '' }
    await assert.rejects(update('welcome_email', welcome), /postal address/)
    await update('welcome_email', { ...welcome, postal_address: '1 Main St' })
    const config = parseSignupConfig((await api.query('SELECT analytics.signup_config() AS c')).rows[0].c)
    assert.equal(config.signups_open, false)
    assert.deepEqual(config.blocked_email_domains, ['spam.example'])
    assert.equal(config.signup_limit_per_hour, 3)
    assert.equal(config.welcome_email.enabled, true)

    // Queue, test log and unsubscribe through the API role, then the report.
    const friend = (await api.query("SELECT referral_code FROM waitlist_signups WHERE email = 'friend@example.org'")).rows[0].referral_code
    for (const code of [inviter.referral.code, friend]) {
      await api.query("INSERT INTO waitlist_email_outbox (id, referral_code, kind) VALUES (gen_random_uuid(), $1, 'welcome')", [code])
    }
    await api.query('SELECT analytics.log_email($1, $2, $3, $4, $5)', [inviter.referral.code, 'test', 'sent', 'smtp-1', 'welcome'])
    assert.equal((await api.query('SELECT analytics.unsubscribe($1) AS ok', [inviter.referral.code])).rows[0].ok, true)
    assert.equal((await api.query('SELECT analytics.unsubscribe($1) AS ok', ['z'.repeat(32)])).rows[0].ok, false)
    const optOut = (await database.query('SELECT email_opted_out_at IS NOT NULL AS out FROM waitlist_signups WHERE referral_code = $1', [inviter.referral.code])).rows[0]
    assert.equal(optOut.out, true, 'unsubscribe records the queue’s opt-out')
    const report = await asAdmin<Record<string, unknown>>(database, 'SELECT public.admin_email_report($1, $2)', [from, to])
    assert.deepEqual(report.welcome, { sent: 0, failed: 0, pending: 1, cancelled: 1, skipped: 0 }, 'unsubscribing cancels queued email')
    assert.deepEqual(report.tests, { sent: 1, failed: 0 })
    assert.equal(report.pending_all_time, 1)
    assert.equal(report.unsubscribed, 1)
    assert.deepEqual(report.domains, [{ domain: 'example.com', signups: 1 }, { domain: 'example.org', signups: 1 }])
    // The website role can queue with the inviter lock, drain the queue and record opt-outs.
    const queued = await waitlist.add('queued@example.net', 'hero', friend, { emailEvents: { welcome: true, priority: true } })
    assert.equal(queued.added, true)
    const drained = await createEmailOutbox(api).drain({
      limit: 5,
      render: ({ email, kind }) => ({ from: 'OpenSwarm <noreply@example.com>', to: [email], subject: kind, html: '<p>Hi</p>', text: 'Hi' }),
      send: async (_payload, key) => ({ id: `smtp-${key}` }),
    })
    assert.equal(drained.sent, 2, 'the friend’s and the new signup’s welcome emails')
    await createEmailOutbox(api).unsubscribe(queued.referral.code)
    await assert.rejects(api.query('SELECT * FROM analytics.settings'), /permission denied/)
    await assert.rejects(api.query("UPDATE waitlist_signups SET source = 'x'"), /permission denied/)
    await api.end()
  })
})

test('signups keep ad click ids and experiment variants; admin_experiments compares variants', { skip }, async () => {
  await withTestDatabase(async (database) => {
    await applyMigrations(database)
    const api = await connectAsApiRole(database)
    const analytics = createPostgresAnalyticsStore(api)
    const waitlist = createPostgresWaitlistStore(api)
    const from = new Date(Date.now() - 86_400_000).toISOString()
    const to = new Date(Date.now() + 60_000).toISOString()

    // Three visitors on the "agents" ad link (one joins), two on control by random split (none join), one internal.
    for (const n of [1, 2, 3]) {
      await analytics.ingest(batch(uuid(n), uuid(100 + n), { channel: 'Paid Social', source: 'meta', click_id: 'meta' },
        [['pageview'], ['experiment', { exp: 'hero', variant: 'agents', assigned: 'forced' }]]))
    }
    for (const n of [4, 5]) {
      await analytics.ingest(batch(uuid(n), uuid(100 + n), {}, [['pageview'], ['experiment', { exp: 'hero', variant: 'control', assigned: 'random' }]]))
    }
    await analytics.ingest({ ...batch(uuid(6), uuid(106), {}, [['pageview'], ['experiment', { exp: 'hero', variant: 'control', assigned: 'random' }]]), internal: true })
    const joined = await waitlist.add('ad@example.com', 'hero', undefined, {
      visitorId: uuid(1), sessionId: uuid(101),
      clickIds: { fbclid: 'IwAR0abc', fbc: 'fb.1.1.IwAR0abc', bogus: 'x' } as Record<string, string>,
      experiments: { hero: 'agents', 'Bad Key': 'x' } as Record<string, string>,
    })
    await waitlist.add('plain@example.com', 'hero')

    const stored = await database.query('SELECT click_ids, experiments FROM analytics.signup_attribution WHERE referral_code = $1', [joined.referral.code])
    assert.deepEqual(stored.rows[0], { click_ids: { fbclid: 'IwAR0abc', fbc: 'fb.1.1.IwAR0abc' }, experiments: { hero: 'agents' } })

    const rows = await asAdmin<{ exp: string, variant: string, visitors: number, from_ads: number, signups: number }[]>(
      database, 'SELECT public.admin_experiments($1, $2)', [from, to])
    assert.deepEqual(rows.map((r) => [r.exp, r.variant, Number(r.visitors), Number(r.from_ads), Number(r.signups)]),
      [['hero', 'agents', 3, 3, 1], ['hero', 'control', 2, 0, 0]])

    const client = await database.connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ email: 'intruder@example.com', role: 'authenticated' })])
      await client.query('SET LOCAL ROLE authenticated')
      await assert.rejects(client.query('SELECT public.admin_experiments($1, $2)', [from, to]), /Admin access required/)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
