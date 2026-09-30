import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import { createProductionWaitlistHandler, handleProductionWaitlist } from './production-waitlist.ts'
import type { WaitlistStore } from './waitlist.ts'

async function setup(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>, parsedBody?: unknown) {
  const server = createServer((request, response) => {
    if (parsedBody !== undefined) Object.assign(request, { body: parsedBody })
    void handler(request, response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      server.closeAllConnections()
    })
  })
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/waitlist`
  return {
    url,
    post: (body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }
}

test('hosted handler accepts runtime-parsed JSON and returns no contacts or database fields', async (t) => {
  const code = 'a'.repeat(32)
  const referral = { code, count: 0, goal: 3 as const, priorityAccess: false }
  const store: WaitlistStore = {
    async add(email, source, inviter) {
      assert.equal(email, 'alex@example.com')
      assert.equal(source, 'hero')
      assert.equal(inviter, undefined)
      return { added: true, referral }
    },
    async referral() { return referral },
  }
  const { post, url } = await setup(t, createProductionWaitlistHandler(store), { email: ' Alex@Example.com ', source: 'hero' })
  const response = await post({})
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { ok: true, referral })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const progress = await fetch(`${url}/referral?code=${code}`)
  assert.equal(progress.status, 200)
  assert.deepEqual(await progress.json(), { ok: true, referral })
})

test('runtime-parsed bodies retain the size limit before calling storage', async (t) => {
  const store: WaitlistStore = {
    async add() { assert.fail('Oversized input must not reach storage') },
    async referral() { return null },
  }
  const { post } = await setup(t, createProductionWaitlistHandler(store), { email: ' Alex@Example.com ', extra: 'x'.repeat(5000) })
  assert.equal((await post({})).status, 413)
})

test('hosted failures expose only a generic retry response', async (t) => {
  const store: WaitlistStore = {
    async add() { throw new Error('example-connection-secret and alex@example.com') },
    async referral() { throw new Error('example-connection-secret') },
  }
  const { post } = await setup(t, createProductionWaitlistHandler(store))
  const response = await post({ email: ' Alex@Example.com ' })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { ok: false, error: 'The waitlist could not be saved. Please try again.' })
})

test('production without DATABASE_URL fails safely rather than claiming a local signup', async (t) => {
  const original = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  try {
    const { post } = await setup(t, handleProductionWaitlist)
    const response = await post({ email: ' Alex@Example.com ' })
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { ok: false, error: 'The waitlist could not be saved. Please try again.' })
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = original
  }
})
