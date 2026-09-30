import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import { createUnsubscribeHandler, createUnsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from './email-unsubscribe.ts'

const secret = 'unsubscribe-secret-'.repeat(3)
const code = 'a'.repeat(32)

async function setup(t: TestContext, unsubscribe: (code: string) => Promise<void>) {
  const handler = createUnsubscribeHandler({ secret, unsubscribe })
  const server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections() })
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/waitlist/unsubscribe`
}

test('unsubscribe requires a domain-separated signature and rejects referral codes or tampering', () => {
  const token = createUnsubscribeToken(code, secret)
  assert.equal(verifyUnsubscribeToken(token, secret), code)
  for (const candidate of [code, '', `${'b'.repeat(32)}.${token.split('.')[1]}`, `${token}extra`, token.replace('.', '<')]) {
    assert.equal(verifyUnsubscribeToken(candidate, secret), null)
  }
  assert.equal(verifyUnsubscribeToken(token, 'other-secret'.repeat(4)), null)
  assert.equal(verifyUnsubscribeToken(token, 'short'), null)
  const url = new URL(unsubscribeUrl('https://example.com', code, secret))
  assert.equal(url.pathname, '/api/waitlist/unsubscribe')
  assert.equal(url.searchParams.get('token'), token)
})

test('GET is read-only and POST supports browser confirmation and one-click email clients', async (t) => {
  let mutations = 0
  const url = await setup(t, async (received) => { assert.equal(received, code); mutations++ })
  const signed = `${url}?token=${createUnsubscribeToken(code, secret)}`
  const preview = await fetch(signed)
  assert.equal(preview.status, 200)
  assert.equal(mutations, 0)
  assert.match(await preview.text(), /method="post"/)
  assert.equal(preview.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(preview.headers.get('cache-control'), 'no-store')
  const oneClick = await fetch(signed, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  })
  assert.equal(oneClick.status, 200)
  assert.equal(mutations, 1)
  const repeat = await fetch(signed, { method: 'POST' })
  assert.equal(repeat.status, 200)
  assert.equal(mutations, 2)
  assert.equal((await fetch(`${url}?token=${code}`, { method: 'POST' })).status, 400)
  assert.equal(mutations, 2)
  assert.equal((await fetch(signed, { method: 'PUT' })).status, 405)
})

test('unsubscribe storage errors expose no internal details and can be retried', async (t) => {
  const url = await setup(t, async () => { throw new Error('recipient@example.com database-secret') })
  const response = await fetch(`${url}?token=${createUnsubscribeToken(code, secret)}`, { method: 'POST' })
  assert.equal(response.status, 503)
  const body = await response.text()
  assert.match(body, /Please try again/)
  assert.doesNotMatch(body, /database-secret|recipient@example/)
})
