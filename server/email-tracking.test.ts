import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import {
  createClickHandler, createOpenHandler, createResendWebhookHandler, readTrackingToken, trackingToken, trackingUrls,
  verifyResendSignature, type EmailEvent,
} from './email-tracking.ts'
import { createEmailOutbox } from './email-outbox.ts'
import { createPostgresWaitlistStore } from './postgres-waitlist.ts'
import { applyMigrations, connectAsApiRole, withTestDatabase } from './test-database.ts'
import { renderWaitlistEmail } from './waitlist-email.ts'

const SECRET = 's'.repeat(40)
const CODE = 'c'.repeat(32)
const JOB = '11111111-2222-4333-8444-555555555555'
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'

async function serve(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
  const server = createServer((request, response) => void handler(request, response))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

test('tracking tokens round-trip and reject tampering', () => {
  const token = trackingToken({ kind: 'welcome', jobId: JOB, referralCode: CODE }, SECRET)
  assert.deepEqual(readTrackingToken(token, SECRET), { kind: 'welcome', jobId: JOB, referralCode: CODE })
  assert.deepEqual(readTrackingToken(trackingToken({ kind: 'test', jobId: null, referralCode: CODE }, SECRET), SECRET), { kind: 'test', jobId: null, referralCode: CODE })
  assert.equal(readTrackingToken(token, 'x'.repeat(40)), null)
  const forged = `${Buffer.from(`welcome:${JOB}:${'d'.repeat(32)}`).toString('base64url')}.${token.split('.')[1]}`
  assert.equal(readTrackingToken(forged, SECRET), null)
  assert.equal(readTrackingToken('garbage', SECRET), null)
})

test('tracked emails wrap only the button and add a pixel; the invite link stays clean', () => {
  const email = { kind: 'welcome' as const, jobId: JOB, referralCode: CODE }
  const tracking = trackingUrls('https://openswarm.com', email, SECRET)
  const { html } = renderWaitlistEmail({ kind: 'welcome', referralCode: CODE, publicUrl: 'https://openswarm.com', unsubscribeUrl: 'https://openswarm.com/api/waitlist/unsubscribe?token=x', tracking })
  assert.ok(html.includes(tracking.action.replaceAll('&', '&amp;')))
  assert.ok(html.includes(`src="${tracking.pixel}"`))
  assert.ok(html.includes(`href="https://openswarm.com/?ref=${CODE}"`), 'the visible invite link is not wrapped')
  assert.ok(!html.includes('mailto:'), 'the share draft is opened by the click page instead')
})

test('the open pixel always answers with an image and flags automated fetches', async (t) => {
  const events: EmailEvent[] = []
  const origin = await serve(t, createOpenHandler({ secret: SECRET, publicUrl: 'https://openswarm.com', record: async (e) => { events.push(e) } }))
  const token = trackingToken({ kind: 'welcome', jobId: JOB, referralCode: CODE }, SECRET)
  const human = await fetch(`${origin}/api/email/open?t=${token}`, { headers: { 'User-Agent': BROWSER } })
  assert.equal(human.headers.get('content-type'), 'image/gif')
  assert.equal(Buffer.from(await human.arrayBuffer()).subarray(0, 6).toString(), 'GIF89a')
  await fetch(`${origin}/api/email/open?t=${token}`, { headers: { 'User-Agent': 'Googlebot/2.1' } })
  const invalid = await fetch(`${origin}/api/email/open?t=bad`)
  assert.equal(invalid.status, 200, 'bad tokens still get an image')
  assert.deepEqual(events.map((e) => [e.type, e.job_id, e.automated]), [['open', JOB, false], ['open', JOB, true]])
})

test('clicks are recorded, then explore redirects with campaign tags and share opens a draft page', async (t) => {
  const events: EmailEvent[] = []
  const origin = await serve(t, createClickHandler({ secret: SECRET, publicUrl: 'https://openswarm.com', record: async (e) => { events.push(e) } }))
  const priority = trackingUrls('https://openswarm.com', { kind: 'priority', jobId: JOB, referralCode: CODE }, SECRET).action
  const explore = await fetch(priority.replace('https://openswarm.com', origin), { redirect: 'manual', headers: { 'User-Agent': BROWSER } })
  assert.equal(explore.status, 302)
  assert.equal(explore.headers.get('location'), 'https://openswarm.com/?utm_source=waitlist-email&utm_medium=email&utm_campaign=priority#product')
  const welcome = trackingUrls('https://openswarm.com', { kind: 'test', jobId: null, referralCode: CODE }, SECRET).action
  const share = await fetch(welcome.replace('https://openswarm.com', origin), { headers: { 'User-Agent': BROWSER } })
  const page = await share.text()
  assert.ok(page.includes('mailto:?subject=Join%20me%20on%20Open%20Swarm'))
  assert.ok(page.includes(`https://openswarm.com/?ref=${CODE}`))
  const bad = await fetch(`${origin}/api/email/click?t=bad&l=explore`, { redirect: 'manual' })
  assert.equal(bad.headers.get('location'), 'https://openswarm.com/', 'no open redirect')
  assert.deepEqual(events.map((e) => [e.type, e.link, e.job_id ?? e.kind]), [['click', 'explore', JOB], ['click', 'share', 'test']])
})

function signed(body: string, id = 'msg_1', timestamp = Math.floor(Date.now() / 1000)) {
  const secret = `whsec_${Buffer.from('webhook-secret-bytes').toString('base64')}`
  const signature = createHmac('sha256', Buffer.from('webhook-secret-bytes')).update(`${id}.${timestamp}.${body}`).digest('base64')
  return { secret, headers: { 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${signature}`, 'Content-Type': 'application/json' } }
}

test('Resend webhooks are verified, mapped to the queued email and de-duplicated by event id', async (t) => {
  const body = JSON.stringify({ type: 'email.bounced', created_at: '2026-09-30T20:00:00Z', data: { email_id: 're_42', bounce: { type: 'Permanent', subType: 'General' } } })
  const { secret, headers } = signed(body)
  assert.equal(verifyResendSignature(body, { id: headers['svix-id'], timestamp: headers['svix-timestamp'], signature: headers['svix-signature'] }, secret), true)
  assert.equal(verifyResendSignature(`${body} `, { id: headers['svix-id'], timestamp: headers['svix-timestamp'], signature: headers['svix-signature'] }, secret), false)
  const stale = signed(body, 'msg_2', Math.floor(Date.now() / 1000) - 3600)
  assert.equal(verifyResendSignature(body, { id: 'msg_2', timestamp: stale.headers['svix-timestamp'], signature: stale.headers['svix-signature'] }, secret), false)

  const events: EmailEvent[] = []
  const origin = await serve(t, createResendWebhookHandler({ secret, record: async (e) => { events.push(e) } }))
  assert.equal((await fetch(`${origin}/x`, { method: 'POST', headers: { ...headers, 'svix-signature': 'v1,AAAA' }, body })).status, 401)
  assert.equal((await fetch(`${origin}/x`, { method: 'POST', headers, body })).status, 200)
  const sent = JSON.stringify({ type: 'email.sent', data: { email_id: 're_42' } })
  assert.equal((await fetch(`${origin}/x`, { method: 'POST', headers: signed(sent, 'msg_3').headers, body: sent })).status, 200)
  assert.deepEqual(events, [{ provider_id: 'resend:re_42', type: 'bounced', source: 'resend', provider_event_id: 'msg_1', occurred_at: '2026-09-30T20:00:00Z', detail: 'Permanent: General' }])
})

test('email engagement on a real database: opens, clicks, bounces and rates per email', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to a PostgreSQL server where the test may create databases.',
}, async () => {
  await withTestDatabase(async (database) => {
    await applyMigrations(database)
    const api = await connectAsApiRole(database)
    const store = createPostgresWaitlistStore(api)
    const emailEvents = { welcome: true, priority: true }
    await store.add('one@example.com', 'hero', undefined, { emailEvents })
    await store.add('two@example.com', 'hero', undefined, { emailEvents })
    const ids: string[] = []
    await createEmailOutbox(api).drain({
      limit: 5,
      render: ({ id, email, kind }) => { ids.push(id); return { from: 'noreply@example.com', to: [email], subject: kind, html: 'x', text: 'x' } },
      send: async (_payload, key) => ({ id: key.endsWith(ids[0]) ? 'resend:re_1' : 'smtp:<2@x>' }),
    })
    const record = (event: object) => api.query('SELECT analytics.record_email_event($1::jsonb) AS ok', [JSON.stringify(event)]).then((r) => r.rows[0].ok)
    assert.equal(await record({ job_id: ids[0], type: 'open', source: 'site' }), true)
    assert.equal(await record({ job_id: ids[0], type: 'open', source: 'site', automated: true }), true)
    assert.equal(await record({ job_id: ids[0], type: 'click', link: 'share', source: 'site' }), true)
    assert.equal(await record({ job_id: ids[1], type: 'open', source: 'site' }), true)
    assert.equal(await record({ provider_id: 'resend:re_1', type: 'delivered', source: 'resend', provider_event_id: 'e1' }), true)
    assert.equal(await record({ provider_id: 'resend:re_1', type: 'delivered', source: 'resend', provider_event_id: 'e1' }), false, 'webhook retries are ignored')
    assert.equal(await record({ provider_id: 'resend:unknown', type: 'bounced', source: 'resend', provider_event_id: 'e2' }), false)
    assert.equal(await record({ job_id: '99999999-9999-4999-8999-999999999999', type: 'open', source: 'site' }), false)
    await assert.rejects(api.query('SELECT * FROM analytics.email_events'), /permission denied/)

    const client = await database.connect()
    await client.query('BEGIN')
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ email: 'alex@openswarm.com' })])
    await client.query('SET LOCAL ROLE authenticated')
    const from = new Date(Date.now() - 86_400_000).toISOString()
    const to = new Date(Date.now() + 60_000).toISOString()
    const report = (await client.query('SELECT public.admin_email_engagement($1, $2) AS r', [from, to])).rows[0].r
    await client.query('ROLLBACK')
    client.release()
    const welcome = report.kinds.find((k: { kind: string }) => k.kind === 'welcome')
    assert.equal(welcome.sent, 2)
    assert.equal(welcome.opened, 2)
    assert.equal(welcome.clicked, 1)
    assert.equal(welcome.automated, 1)
    assert.equal(welcome.delivered, 1)
    assert.equal(Number(welcome.click_rate), 0.5)
    assert.deepEqual(report.links, [{ kind: 'welcome', link: 'share', clicks: 1, people: 1 }])
    await api.end()
  })
})
