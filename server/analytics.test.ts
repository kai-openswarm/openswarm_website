import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import { classifyTraffic, createCollectHandler, parseClientBatch, parseUserAgent, type AnalyticsStore, type IngestBatch } from './analytics.ts'

const VID = '3f0c9a52-8a1e-4c3b-9d7e-1b2c3d4e5f60'
const SID = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'

test('channels follow UTM tags, click ids, invites and referrer domains', () => {
  const site = 'openswarm.com'
  const channel = (landing: string, referrer?: string) => classifyTraffic(landing, referrer, site).channel
  assert.equal(channel('https://openswarm.com/'), 'Direct')
  assert.equal(channel('https://openswarm.com/', 'https://openswarm.com/#top'), 'Direct')
  assert.equal(channel('https://openswarm.com/', 'https://www.google.com/'), 'Organic Search')
  assert.equal(channel('https://openswarm.com/', 'https://t.co/abc'), 'Organic Social')
  assert.equal(channel('https://openswarm.com/', 'https://chatgpt.com/'), 'AI Assistants')
  assert.equal(channel('https://openswarm.com/', 'https://gemini.google.com/app'), 'AI Assistants')
  assert.equal(channel('https://openswarm.com/', 'https://someblog.dev/post'), 'Referral')
  assert.equal(channel('https://openswarm.com/?utm_source=newsletter&utm_medium=email'), 'Email')
  assert.equal(channel('https://openswarm.com/?utm_source=x&utm_medium=cpc'), 'Paid Social')
  assert.equal(channel('https://openswarm.com/?gclid=abc'), 'Paid Search')
  assert.equal(channel('https://openswarm.com/?twclid=abc'), 'Paid Social')
  assert.equal(channel(`https://openswarm.com/?ref=${'a'.repeat(32)}`), 'Invite link')
  assert.equal(channel('https://openswarm.com/?utm_source=podcast'), 'Other Campaigns')

  const result = classifyTraffic('https://openswarm.com/?utm_source=X&utm_campaign=Launch%20Week', 'https://t.co/xyz?secret=1', site)
  assert.equal(result.source, 'x')
  assert.equal(result.utm_campaign, 'launch week')
  assert.equal(result.referrer_domain, 'x.com')
  assert.equal(result.referrer, 'https://t.co/xyz', 'referrer query strings are dropped')
})

test('user agents resolve to browser, OS and device type', () => {
  assert.deepEqual(parseUserAgent(CHROME), { browser: 'Chrome', browser_version: '140', os: 'macOS', os_version: 'Catalina', device_type: 'desktop' })
  const phone = parseUserAgent(IPHONE)
  assert.equal(phone.os, 'iOS')
  assert.equal(phone.device_type, 'mobile')
  assert.equal(parseUserAgent(undefined).browser, null)
})

test('batches keep known events, typed props and server-relative timestamps', () => {
  const now = Date.parse('2026-09-30T12:00:00Z')
  const batch = parseClientBatch({
    vid: VID.toUpperCase(), sid: SID, sent: 5_000,
    meta: { url: 'https://openswarm.com/', ref: '', screen: '1440x900', viewport: 'bad', lang: 'en-US', tz: 'America/Los_Angeles' },
    events: [
      { n: 'pageview', t: 4_000, p: '/?phone=secret#x' },
      { n: 'scroll', t: 5_000, d: { depth: 50 } },
      { n: 'scroll', t: 5_000, d: { depth: 33 } },
      { n: 'engagement', t: 5_000, d: { ms: 99_999_999 } },
      { n: 'unknown', t: 5_000 },
      { n: 'click', t: 5_000, d: { target: 'x'.repeat(500), 'Bad-Key': 1, nested: { a: 1 } } },
    ],
  }, now)
  assert.equal(batch.visitorId, VID)
  assert.equal(batch.screen, '1440x900')
  assert.equal(batch.viewport, null)
  assert.deepEqual(batch.events.map((event) => event.name), ['pageview', 'scroll', 'engagement', 'click'])
  assert.equal(batch.events[0].path, '/', 'query strings never reach storage')
  assert.equal(batch.events[0].at, new Date(now - 1_000).toISOString())
  assert.equal(batch.events[2].props.ms, 1_800_000)
  assert.equal((batch.events[3].props.target as string).length, 200)
  assert.deepEqual(Object.keys(batch.events[3].props), ['target'])
  assert.throws(() => parseClientBatch({ vid: 'nope', sid: SID }))
})

async function serve(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
  const server = createServer((request, response) => void handler(request, response))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return (body: unknown, headers: Record<string, string> = {}) => fetch(`${origin}/api/collect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': CHROME, 'X-Vercel-IP-Country': 'us', 'X-Vercel-IP-City': 'San%20Francisco', ...headers },
    body: JSON.stringify(body),
  })
}

function memoryStore(limit = Infinity) {
  const batches: IngestBatch[] = []
  let hits = 0
  const store: AnalyticsStore = {
    async ingest(batch) { batches.push(batch) },
    async hit() { hits++; return hits <= limit },
  }
  return { store, batches }
}

const validBatch = { vid: VID, sid: SID, sent: Date.now(), meta: { url: 'https://openswarm.com/?utm_source=x', ref: 'https://t.co/a' }, events: [{ n: 'pageview', t: Date.now(), p: '/' }] }

test('collect stores enriched batches and acknowledges with no content', async (t) => {
  const { store, batches } = memoryStore()
  const post = await serve(t, createCollectHandler(store, { secret: 'test' }))
  const response = await post(validBatch)
  assert.equal(response.status, 204)
  assert.equal(batches.length, 1)
  const meta = batches[0].meta
  assert.equal(meta.country, 'US')
  assert.equal(meta.city, 'San Francisco')
  assert.equal(meta.browser, 'Chrome')
  assert.equal(meta.channel, 'Organic Social')
  assert.equal(meta.source, 'x')
  assert.ok(!JSON.stringify(batches[0]).includes('127.0.0.1'), 'IP addresses are never stored')
})

test('collect drops bots and automation, rejects cross-site posts and rate limits', async (t) => {
  const { store, batches } = memoryStore(1)
  const post = await serve(t, createCollectHandler(store, { secret: 'test' }))
  assert.equal((await post(validBatch, { 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' })).status, 204)
  assert.equal((await post({ ...validBatch, wd: true })).status, 204)
  assert.equal(batches.length, 0)
  assert.equal((await post(validBatch, { Origin: 'https://evil.example' })).status, 403)
  assert.equal((await post({ vid: 'x' })).status, 400)
  assert.equal((await post(validBatch)).status, 204)
  assert.equal((await post(validBatch)).status, 429)
  assert.equal(batches.length, 1)
})

test('collect hides storage failures behind a generic response', async (t) => {
  const post = await serve(t, createCollectHandler({
    async ingest() { throw new Error('postgres://user:secret@host') },
    async hit() { return true },
  }, { secret: 'test' }))
  const response = await post(validBatch)
  assert.equal(response.status, 503)
  assert.ok(!(await response.text()).includes('secret'))
})

test('grouped API functions route by the last path segment and 404 unknown actions', async (t) => {
  const { routeByLastSegment } = await import('./http.ts')
  const hits: string[] = []
  const handler = (name: string) => async (_request: IncomingMessage, response: ServerResponse) => { hits.push(name); response.end() }
  const server = createServer((request, response) => void routeByLastSegment(request, response, { open: handler('open'), 'test-email': handler('test-email'), toString: handler('x') }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await fetch(`${origin}/api/email/open?t=abc`)
  await fetch(`${origin}/api/admin/test-email/`)
  assert.equal((await fetch(`${origin}/api/admin/constructor`)).status, 404)
  assert.deepEqual(hits, ['open', 'test-email'])
})
