import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import { createProductionWaitlistHandler } from './production-waitlist.ts'
import { DEFAULT_SIGNUP_CONFIG, cachedSignupConfig, emailDomainRejected, parseSignupConfig, type SignupConfig } from './signup-config.ts'
import type { WaitlistStore } from './waitlist.ts'

const CODE = 'a'.repeat(32)
const referral = { code: CODE, count: 0, goal: 3 as const, priorityAccess: false }

async function serve(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
  const server = createServer((request, response) => void handler(request, response))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function store(added: string[] = []): WaitlistStore {
  return {
    async add(email) { added.push(email); return { added: true, referral } },
    async referral() { return referral },
    async displayCount() { return 6400 },
  }
}

const post = (origin: string, email: string) => fetch(`${origin}/api/waitlist`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
})

test('settings parse with safe fallbacks for missing or malformed values', () => {
  assert.deepEqual(parseSignupConfig(null), DEFAULT_SIGNUP_CONFIG)
  const config = parseSignupConfig({ signups_open: false, blocked_email_domains: ['Example.com', 7], signup_limit_per_hour: -3, welcome_email: { enabled: true, from_email: 'hi@openswarm.com' } })
  assert.equal(config.signups_open, false)
  assert.deepEqual(config.blocked_email_domains, ['example.com'])
  assert.equal(config.signup_limit_per_hour, 10)
  assert.equal(config.welcome_email.enabled, true)
  assert.equal(config.welcome_email.subject, DEFAULT_SIGNUP_CONFIG.welcome_email.subject)
  assert.deepEqual(config.priority_email, DEFAULT_SIGNUP_CONFIG.priority_email)
  assert.equal(parseSignupConfig({ priority_email: { enabled: true, subject: 'Priority!' } }).priority_email.subject, 'Priority!')
})

test('blocked and disposable domains are rejected, including subdomains', () => {
  const config: SignupConfig = { ...DEFAULT_SIGNUP_CONFIG, blocked_email_domains: ['spam.example'] }
  assert.equal(emailDomainRejected('a@spam.example', config), true)
  assert.equal(emailDomainRejected('a@mail.spam.example', config), true)
  assert.equal(emailDomainRejected('a@notspam.example', config), false)
  assert.equal(emailDomainRejected('a@mailinator.com', config), true)
  assert.equal(emailDomainRejected('a@mailinator.com', { ...config, block_disposable_email: false }), false)
  assert.equal(emailDomainRejected('a@gmail.com', config), false)
})

test('settings are cached and fall back to the last good copy', async () => {
  let calls = 0
  let fail = false
  const load = cachedSignupConfig(async () => { calls++; if (fail) throw new Error('down'); return { signups_open: false } }, 0)
  assert.equal((await load()).signups_open, false)
  fail = true
  assert.equal((await load()).signups_open, false, 'a failed reload keeps the last good settings')
  assert.equal(calls, 2)
})

test('paused signups return the admin message and never store the email', async (t) => {
  const added: string[] = []
  const origin = await serve(t, createProductionWaitlistHandler(store(added), {
    config: async () => ({ ...DEFAULT_SIGNUP_CONFIG, signups_open: false, signups_closed_message: 'Back on Monday.' }),
  }))
  const response = await post(origin, 'alex@example.com')
  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { ok: false, closed: true, error: 'Back on Monday.' })
  assert.deepEqual(added, [])
  const stats = await (await fetch(`${origin}/api/stats`)).json()
  assert.deepEqual(stats, { ok: true, count: 6400, signupsOpen: false, closedMessage: 'Back on Monday.' })
})

test('blocked domains are refused, and new signups run the welcome step without failing the signup', async (t) => {
  const added: string[] = []
  const welcomed: string[] = []
  const origin = await serve(t, createProductionWaitlistHandler(store(added), {
    config: async () => DEFAULT_SIGNUP_CONFIG,
    async afterSignup({ email }) { welcomed.push(email); throw new Error('provider down') },
  }))
  assert.equal((await post(origin, 'someone@mailinator.com')).status, 400)
  const response = await post(origin, 'alex@example.com')
  assert.equal(response.status, 201, 'a welcome email failure does not fail the signup')
  assert.deepEqual(added, ['alex@example.com'])
  assert.deepEqual(welcomed, ['alex@example.com'])
})
