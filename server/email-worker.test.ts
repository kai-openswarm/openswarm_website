import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import { createEmailWorkerHandler, createProductionWaitlistHandler } from './production-waitlist.ts'
import type { EmailDeliverySetup } from './email-delivery.ts'
import { DEFAULT_SIGNUP_CONFIG } from './signup-config.ts'

const secret = 'protected-worker-secret-'.repeat(3)
const setup: EmailDeliverySetup = {
  state: 'ready', config: { smtp: { host: 'smtp.example.com', port: 587, user: 'noreply@example.com', password: 'fake' }, publicUrl: 'https://example.com', secret, cronSecret: secret },
}

async function serve(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
  const server = createServer((request, response) => { void handler(request, response) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections() })
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/waitlist`
}

test('worker requires strong constant-time Bearer authentication before any delivery', async (t) => {
  let calls = 0
  const url = await serve(t, createEmailWorkerHandler({ secret, setup, drain: async () => { calls++; return { sent: 1 } } }))
  for (const authorization of ['', 'Bearer wrong', `bearer ${secret}`]) {
    const response = await fetch(url, { headers: { authorization } })
    assert.equal(response.status, 401)
    assert.equal(calls, 0)
  }
  for (const method of ['GET', 'POST']) {
    const response = await fetch(url, { method, headers: { authorization: `Bearer ${secret}` } })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, result: { sent: 1 } })
  }
  assert.equal(calls, 2)
  assert.equal((await fetch(url, { method: 'DELETE', headers: { authorization: `Bearer ${secret}` } })).status, 405)
})

test('missing setup and failures return safe unavailable responses', async (t) => {
  for (const options of [
    { secret: undefined, setup },
    { secret, setup: { state: 'disabled' } as const },
    { secret, setup: { state: 'invalid' } as const },
    { secret, setup, drain: async () => { throw new Error('private-key recipient@example.com') } },
  ]) {
    const url = await serve(t, createEmailWorkerHandler(options))
    const response = await fetch(url, { headers: { authorization: `Bearer ${secret}` } })
    assert.equal(response.status, 503)
    assert.doesNotMatch(await response.text(), /private-key|recipient@example/)
  }
})

test('post-response scheduling runs only for a new saved signup and cannot break its response', async (t) => {
  let schedulingCalls = 0
  let added = true
  const referral = { code: 'a'.repeat(32), count: 0, goal: 3 as const, priorityAccess: false }
  const url = await serve(t, createProductionWaitlistHandler({
    async add() { return { added, referral } },
    async referral() { return referral },
  }, {
    config: async () => DEFAULT_SIGNUP_CONFIG,
    async afterSignup() { schedulingCalls++; throw new Error('worker setup failure') },
  }))
  const post = () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'person@example.com' }) })
  const response = await post()
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), { ok: true, referral })
  assert.equal(schedulingCalls, 1)
  added = false
  assert.equal((await post()).status, 200)
  assert.equal(schedulingCalls, 1)
  assert.equal((await fetch(`${url}/referral?code=${referral.code}`)).status, 200)
  assert.equal(schedulingCalls, 1)
})
