import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { metaLeadPayload, readMetaConfig, sendMetaLead } from './meta-capi.ts'
import { DEFAULT_SIGNUP_CONFIG } from './signup-config.ts'
import { createWaitlistMiddleware, parseExperiments, parseSignupAds, type SignupAds, type SignupContext, type WaitlistStore } from './waitlist.ts'
import { parseClientBatch } from './analytics.ts'

const request = (headers: Record<string, string> = {}) => ({ headers }) as unknown as IncomingMessage
const EVENT_ID = '5f0c3c1e-8a3b-4c1d-9e2f-1a2b3c4d5e6f'

test('signup ad details keep only known click ids, and nothing under Global Privacy Control', () => {
  const ads = parseSignupAds({
    eventId: EVENT_ID, page: 'https://www.openswarm.com/?h=agents#x', fbclid: 'IwAR0abc', fbc: 'fb.1.1700000000000.IwAR0abc',
    twclid: '2-abc', clicked_at: '2026-09-30T10:00:00Z', email: 'leak@example.com', gclid: 'bad value!',
  }, request())
  assert.deepEqual(ads, {
    eventId: EVENT_ID, page: 'https://www.openswarm.com/',
    clickIds: { fbclid: 'IwAR0abc', fbc: 'fb.1.1700000000000.IwAR0abc', twclid: '2-abc', clicked_at: '2026-09-30T10:00:00.000Z' },
  })
  assert.equal(parseSignupAds({ eventId: EVENT_ID, fbclid: 'x' }, request({ 'sec-gpc': '1' })), undefined)
  assert.equal(parseSignupAds({ eventId: 'no' }, request()), undefined)
  assert.equal(parseSignupAds({ eventId: EVENT_ID, page: 'http://evil.example/' }, request())?.page, undefined)
  assert.deepEqual(parseExperiments({ hero: 'agents', Bad: 'x', pricing: 'BAD VALUE' }), { hero: 'agents' })
  assert.equal(parseExperiments('hero'), undefined)
})

test('experiment events need a valid experiment and variant', () => {
  const batch = parseClientBatch({
    vid: EVENT_ID, sid: EVENT_ID, events: [
      { n: 'experiment', d: { exp: 'hero', variant: 'agents', assigned: 'forced' } },
      { n: 'experiment', d: { exp: 'hero' } },
      { n: 'experiment', d: { exp: 'Hero!', variant: 'x' } },
    ],
  })
  assert.deepEqual(batch.events.map((e) => e.props), [{ exp: 'hero', variant: 'agents', assigned: 'forced' }])
})

test('the Meta Conversions API stays off without both a pixel id and a token', () => {
  assert.equal(readMetaConfig({}), null)
  assert.equal(readMetaConfig({ VITE_META_PIXEL_ID: '123456789012345' }), null)
  assert.equal(readMetaConfig({ META_PIXEL_ID: 'abc', META_CAPI_TOKEN: 't' }), null)
  assert.deepEqual(readMetaConfig({ VITE_META_PIXEL_ID: '123456789012345', META_CAPI_TOKEN: ' tok ' }), { pixelId: '123456789012345', token: 'tok' })
})

test('Meta leads hash the email and visitor id and keep the token out of the URL', async () => {
  const config = { pixelId: '123456789012345', token: 'secret-token', testEventCode: 'TEST1' }
  const payload = metaLeadPayload({ eventId: EVENT_ID, email: ' Person@Example.com ', visitorId: 'v1', ip: '203.0.113.9', fbc: 'fb.1.1.abc', now: 1_700_000_000_000 }, config)
  const event = payload.data[0]
  assert.equal(event.event_name, 'Lead')
  assert.equal(event.event_id, EVENT_ID)
  assert.equal(event.event_time, 1_700_000_000)
  assert.deepEqual(event.user_data.em, [createHash('sha256').update('person@example.com').digest('hex')])
  assert.deepEqual(event.user_data.external_id, [createHash('sha256').update('v1').digest('hex')])
  assert.equal(JSON.stringify(payload).includes('Person@Example.com'), false)
  assert.equal(payload.test_event_code, 'TEST1')

  const calls: { url: string, body: string }[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) })
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
  assert.equal(await sendMetaLead({ eventId: EVENT_ID, email: 'a@example.com' }, config, fetcher), true)
  assert.equal(calls[0].url, 'https://graph.facebook.com/v23.0/123456789012345/events')
  assert.match(calls[0].body, /"access_token":"secret-token"/)
  const failing = (async () => { throw new Error('offline') }) as unknown as typeof fetch
  assert.equal(await sendMetaLead({ eventId: EVENT_ID, email: 'a@example.com' }, config, failing), false)
})

async function serve(t: TestContext, seen: { context?: SignupContext, ads?: SignupAds, after: number }) {
  const store: WaitlistStore = {
    async add(_email, _source, _code, context) {
      seen.context = context
      return { added: true, referral: { code: 'a'.repeat(32), count: 0, goal: 3, priorityAccess: false } }
    },
    async referral() { return null },
  }
  const middleware = createWaitlistMiddleware(store, {
    config: async () => DEFAULT_SIGNUP_CONFIG,
    async afterSignup({ ads }) { seen.ads = ads; seen.after++ },
  })
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end() }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() }))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/waitlist`
}

test('signups pass ad details and experiments through, and drop ad details under Global Privacy Control', async (t) => {
  const seen: { context?: SignupContext, ads?: SignupAds, after: number } = { after: 0 }
  const url = await serve(t, seen)
  const body = { email: 'new@example.com', experiments: { hero: 'agents' }, ads: { eventId: EVENT_ID, fbclid: 'IwAR0abc' } }
  let response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal(response.status, 201)
  assert.deepEqual(seen.context?.clickIds, { fbclid: 'IwAR0abc' })
  assert.deepEqual(seen.context?.experiments, { hero: 'agents' })
  assert.equal(seen.ads?.eventId, EVENT_ID)

  response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-GPC': '1' }, body: JSON.stringify(body) })
  assert.equal(response.status, 201)
  assert.equal(seen.context?.clickIds, undefined)
  assert.equal(seen.ads, undefined)
  assert.deepEqual(seen.context?.experiments, { hero: 'agents' }, 'experiment variants are not ad data and are always kept')
  assert.equal(seen.after, 2)
})
