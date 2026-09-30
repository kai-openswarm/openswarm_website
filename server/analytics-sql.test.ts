import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Pool } from 'pg'
import type { IngestBatch, SessionMeta } from './analytics.ts'
import { createPostgresAnalyticsStore } from './postgres-analytics.ts'
import { createPostgresWaitlistStore } from './postgres-waitlist.ts'
import { applyMigrations, withTestDatabase } from './test-database.ts'

const skip = !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to a PostgreSQL server where the test may create databases.'

const meta = (overrides: Partial<SessionMeta> = {}): SessionMeta => ({
  entry_path: '/', referrer: null, referrer_domain: null, channel: 'Direct', source: '(direct)',
  utm_source: null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null, click_id: null,
  has_invite: false, country: 'US', region: 'CA', city: 'San Francisco', browser: 'Chrome', browser_version: '140',
  os: 'macOS', os_version: '15', device_type: 'desktop', screen: '1440x900', viewport: '1440x800', language: 'en-US',
  timezone: 'America/Los_Angeles', ...overrides,
})

function batch(visitor: string, session: string, events: [string, Record<string, unknown>?][], overrides: Partial<SessionMeta> = {}, internal = false): IngestBatch {
  const now = new Date()
  return {
    visitor_id: visitor, session_id: session, now: now.toISOString(), internal, meta: meta(overrides),
    events: events.map(([name, props], index) => ({ name, path: '/', at: new Date(now.getTime() - 1000 + index).toISOString(), props: (props ?? {}) as IngestBatch['events'][number]['props'] })),
  }
}

/** Runs one admin RPC as a Supabase `authenticated` user with the given email claim. */
async function asUser<T>(database: Pool, email: string | null, sql: string, values: unknown[] = []): Promise<T> {
  const client = await database.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(email ? { email, role: 'authenticated' } : { role: 'anon' })])
    await client.query(email ? 'SET LOCAL ROLE authenticated' : 'SET LOCAL ROLE anon')
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

const V1 = '11111111-1111-4111-8111-111111111111'
const V2 = '22222222-2222-4222-8222-222222222222'
const V3 = '33333333-3333-4333-8333-333333333333'
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const S1B = 'abababab-abab-4bab-8bab-abababababab'
const S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const S3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

test('ingest, signup attribution and the admin API on a real database', { skip }, async () => {
  await withTestDatabase(async (database) => {
    await applyMigrations(database)
    const analytics = createPostgresAnalyticsStore(database)
    const waitlist = createPostgresWaitlistStore(database)

    // Visitor 1 arrives from X, reads, scrolls, submits, and signs up.
    await analytics.ingest(batch(V1, S1, [['pageview'], ['section_view', { section: 'top' }], ['waitlist_view', { placement: 'hero' }]],
      { channel: 'Organic Social', source: 'x.com', referrer_domain: 'x.com', utm_campaign: 'launch' }))
    await analytics.ingest(batch(V1, S1, [['scroll', { depth: 50 }], ['waitlist_start', { placement: 'hero' }], ['waitlist_submit', { placement: 'hero', source: 'hero' }], ['engagement', { ms: 42_000 }]]))
    const signup = await waitlist.add('+12025550123', 'hero', undefined, { visitorId: V1, sessionId: S1, consentVersion: 'sms-2026-09', networkHash: 'n'.repeat(22) })
    assert.equal(signup.added, true)
    await analytics.ingest(batch(V1, S1, [['waitlist_success', { placement: 'hero', added: true }]]))
    // A later return visit is not a new visitor.
    await analytics.ingest(batch(V1, S1B, [['pageview']]))

    // Visitor 2 bounces from Google on mobile; visitor 3 is internal traffic.
    await analytics.ingest(batch(V2, S2, [['pageview'], ['engagement', { ms: 2_000 }]], { channel: 'Organic Search', source: 'google.com', device_type: 'mobile', country: 'CA' }))
    await analytics.ingest(batch(V3, S3, [['pageview']], {}, true))
    // A reused session id from another visitor is ignored.
    await analytics.ingest(batch(V2, S1, [['pageview']]))

    // An invited signup with no analytics ids still gets location fallback.
    await waitlist.add('+12025550124', 'nav', signup.referral.code, { networkHash: 'n'.repeat(22), fallback: { country: 'GB', device_type: 'mobile' } })

    const sessions = await database.query('SELECT id, pageviews, engaged, converted, is_new_visitor, active_ms, max_scroll FROM analytics.sessions ORDER BY id')
    const byId = Object.fromEntries(sessions.rows.map((row) => [row.id, row]))
    assert.equal(byId[S1].pageviews, 1, 'the foreign visitor batch did not touch this session')
    assert.equal(byId[S1].converted, true)
    assert.equal(byId[S1].engaged, true)
    assert.equal(Number(byId[S1].active_ms), 42_000)
    assert.equal(byId[S1].max_scroll, 50)
    assert.equal(byId[S1B].is_new_visitor, false)
    assert.equal(byId[S2].engaged, false)

    const attribution = await database.query('SELECT phone, channel, utm_campaign, country, device_type, sessions_before FROM analytics.signup_attribution ORDER BY phone')
    assert.equal(attribution.rows[0].channel, 'Organic Social')
    assert.equal(attribution.rows[0].utm_campaign, 'launch')
    assert.equal(attribution.rows[1].channel, null)
    assert.equal(attribution.rows[1].country, 'GB')
    const consent = await database.query("SELECT consent_version, consented_at IS NOT NULL AS consented FROM waitlist_signups WHERE phone = '+12025550123'")
    assert.deepEqual(consent.rows[0], { consent_version: 'sms-2026-09', consented: true })

    // Rate limit windows.
    assert.equal(await analytics.hit('k', 60, 2), true)
    assert.equal(await analytics.hit('k', 60, 2), true)
    assert.equal(await analytics.hit('k', 60, 2), false)

    // Access control: anon and non-admins cannot read anything.
    const from = new Date(Date.now() - 86_400_000).toISOString()
    const to = new Date(Date.now() + 60_000).toISOString()
    await assert.rejects(asUser(database, null, 'SELECT count(*) FROM waitlist_signups'), /permission denied/)
    await assert.rejects(asUser(database, null, 'SELECT count(*) FROM analytics.sessions'), /permission denied/)
    await assert.rejects(asUser(database, null, 'SELECT public.admin_overview($1, $2)', [from, to]), /permission denied/)
    await assert.rejects(asUser(database, 'intruder@example.com', 'SELECT public.admin_overview($1, $2)', [from, to]), /Admin access required/)
    const who = await asUser<{ is_admin: boolean }>(database, 'intruder@example.com', 'SELECT public.admin_whoami()')
    assert.equal(who.is_admin, false)

    const admin = 'Kai@OpenSwarm.com'
    const overview = await asUser<{ current: Record<string, number>, display_count: number }>(database, admin, 'SELECT public.admin_overview($1, $2)', [from, to])
    assert.equal(overview.current.visitors, 2, 'internal traffic is excluded')
    assert.equal(overview.current.sessions, 3)
    assert.equal(overview.current.signups, 2)
    assert.equal(overview.current.referred_signups, 1)
    assert.equal(Number(overview.current.bounce_rate), 0.6667, 'the return visit and the Google visit bounced')
    assert.equal(overview.display_count, 6329)

    const filtered = await asUser<{ current: Record<string, number> }>(database, admin, 'SELECT public.admin_overview($1, $2, $3)', [from, to, JSON.stringify({ device_type: 'mobile' })])
    assert.equal(filtered.current.visitors, 1)
    assert.equal(filtered.current.signups, 0)
    await assert.rejects(asUser(database, admin, 'SELECT public.admin_overview($1, $2, $3)', [from, to, JSON.stringify({ 'phone; drop': 'x' })]), /Unsupported filter/)

    const channels = await asUser<{ value: string, sessions: number, signups: number }[]>(database, admin, 'SELECT public.admin_breakdown($1, $2, $3, $4)', [from, to, '{}', 'channel'])
    assert.deepEqual(channels.map((row) => [row.value, row.sessions, row.signups]), [['Direct', 1, 0], ['Organic Search', 1, 0], ['Organic Social', 1, 1]])
    await assert.rejects(asUser(database, admin, 'SELECT public.admin_breakdown($1, $2, $3, $4)', [from, to, '{}', 'phone']), /Unsupported dimension/)

    const series = await asUser<{ sessions: number, signups: number }[]>(database, admin, 'SELECT public.admin_timeseries($1, $2, $3, $4, $5)', [from, to, '{}', 'hour', 'America/Los_Angeles'])
    assert.equal(series.reduce((sum, row) => sum + row.sessions, 0), 3)
    assert.equal(series.reduce((sum, row) => sum + row.signups, 0), 2)
    const unknownZone = await asUser<unknown[]>(database, admin, 'SELECT public.admin_timeseries($1, $2, $3, $4, $5)', [from, to, '{}', 'day', 'Mars/Olympus_Mons'])
    assert.ok(unknownZone.length > 0, 'an unknown browser time zone falls back to UTC')

    const funnel = await asUser<{ steps: { key: string, sessions: number }[] }>(database, admin, 'SELECT public.admin_funnel($1, $2)', [from, to])
    assert.deepEqual(funnel.steps.map((step) => step.sessions), [3, 1, 1, 1, 1, 0])

    const engagement = await asUser<{ sections: { section: string, sessions: number }[] }>(database, admin, 'SELECT public.admin_engagement($1, $2)', [from, to])
    assert.equal(engagement.sections.find((row) => row.section === 'top')?.sessions, 1)

    const realtime = await asUser<{ active_visitors: number }>(database, admin, 'SELECT public.admin_realtime()')
    assert.equal(realtime.active_visitors, 2)

    const signups = await asUser<{ total: number, rows: { code: string, phone_masked: string, invites: number }[] }>(database, admin, 'SELECT public.admin_signups($1, $2)', [from, to])
    assert.equal(signups.total, 2)
    assert.ok(signups.rows.every((row) => !row.phone_masked.includes('555012')), 'phones are masked')
    const inviter = signups.rows.find((row) => row.code === signup.referral.code)!
    assert.equal(inviter.invites, 1)

    const referrals = await asUser<{ k_factor: number, suspicious: unknown[] }>(database, admin, 'SELECT public.admin_referrals($1, $2)', [from, to])
    assert.equal(Number(referrals.k_factor), 0.5)
    assert.equal(referrals.suspicious.length, 0)

    const phone = await asUser<string>(database, admin, 'SELECT public.admin_reveal_phone($1)', [signup.referral.code])
    assert.equal(phone, '+12025550123')
    const exported = await asUser<unknown[]>(database, admin, 'SELECT public.admin_export_signups($1, $2)', [from, to])
    assert.equal(exported.length, 2)

    await asUser(database, admin, 'SELECT public.admin_update_setting($1, $2::jsonb)', ['waitlist_count_baseline', '100'])
    await assert.rejects(asUser(database, admin, 'SELECT public.admin_update_setting($1, $2::jsonb)', ['waitlist_count_baseline', '-1']), /whole number/)
    await assert.rejects(asUser(database, admin, 'SELECT public.admin_remove_admin($1)', ['kai@openswarm.com']), /your own access/)
    const settings = await asUser<{ display_count: number, audit: { action: string }[], admins: unknown[] }>(database, admin, 'SELECT public.admin_settings()')
    assert.equal(settings.display_count, 102)
    assert.equal(settings.admins.length, 4)
    assert.deepEqual(settings.audit.map((entry) => entry.action).sort(), ['export_signups', 'reveal_phone', 'update_setting'])

    // Deleting a person removes their signup, attribution and visit history.
    await asUser(database, admin, 'SELECT public.admin_delete_signup($1)', [signup.referral.code])
    const remaining = await database.query(`SELECT
      (SELECT count(*) FROM waitlist_signups)::int AS signups,
      (SELECT count(*) FROM analytics.signup_attribution)::int AS attribution,
      (SELECT count(*) FROM analytics.sessions WHERE visitor_id = $1)::int AS sessions,
      (SELECT count(*) FROM analytics.events WHERE visitor_id = $1)::int AS events,
      (SELECT referred_by FROM waitlist_signups) AS referred_by`, [V1])
    assert.deepEqual(remaining.rows[0], { signups: 1, attribution: 1, sessions: 0, events: 0, referred_by: null })

    await database.query('SELECT analytics.prune()')
  })
})
