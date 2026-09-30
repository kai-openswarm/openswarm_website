import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import { createUnsubscribeHandler, renderWelcome, sendWelcomeEmail, smtpFromEnv, unsubscribeToken, unsubscribeUrl } from './email.ts'
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

test('welcome emails carry the invite link, unsubscribe link, postal address and one-click headers', async () => {
  const template = { ...DEFAULT_SIGNUP_CONFIG.welcome_email, enabled: true, from_email: 'hello@openswarm.com', body: 'Hi <there>\n\nInvite: {{invite_link}}', postal_address: '1 Main St, San Francisco, CA' }
  const unsubscribe = unsubscribeUrl('https://openswarm.com', CODE, 'secret')
  const { text, html } = renderWelcome(template, `https://openswarm.com/?ref=${CODE}`, unsubscribe)
  assert.ok(text.includes(`Invite: https://openswarm.com/?ref=${CODE}`))
  assert.ok(text.includes(unsubscribe) && text.includes('1 Main St'))
  assert.ok(html.includes('Hi &lt;there&gt;'), 'template text is escaped in HTML')

  const requests: { url: string, body: Record<string, unknown> }[] = []
  const fakeFetch = (async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ id: 'em_123' }), { status: 200 })
  }) as typeof fetch
  assert.deepEqual(await sendWelcomeEmail(template, 'alex@example.com', 'https://x', unsubscribe, 'key', fakeFetch, { smtp: null }), { status: 'sent', providerId: 'em_123' })
  assert.equal(requests[0].url, 'https://api.resend.com/emails')
  assert.equal(requests[0].body.from, 'Open Swarm <hello@openswarm.com>')
  assert.deepEqual((requests[0].body.headers as Record<string, string>)['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
  assert.equal((await sendWelcomeEmail(template, 'a@b.co', 'x', 'y', undefined, fakeFetch, { smtp: null })).status, 'skipped')
})

test('welcome emails go through SMTP when it is configured, ahead of Resend', async () => {
  const template = { ...DEFAULT_SIGNUP_CONFIG.welcome_email, enabled: true, from_email: 'noreply@openswarm.com', reply_to: 'team@openswarm.com', postal_address: '1 Main St' }
  assert.equal(smtpFromEnv({}), null)
  assert.equal(smtpFromEnv({ SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'noreply@openswarm.com' }), null, 'a password is required')
  const smtp = smtpFromEnv({ SMTP_HOST: ' smtp.gmail.com ', SMTP_USER: 'noreply@openswarm.com', SMTP_PASSWORD: 'abcd efgh ijkl mnop' })
  assert.deepEqual(smtp, { host: 'smtp.gmail.com', port: 587, user: 'noreply@openswarm.com', password: 'abcdefghijklmnop' })

  const mails: Record<string, unknown>[] = []
  const used: unknown[] = []
  const createTransport = (config: unknown) => {
    used.push(config)
    return { async sendMail(message: Record<string, unknown>) { mails.push(message); return { messageId: '<m1@openswarm.com>' } } }
  }
  const neverFetch = (async () => { throw new Error('Resend must not be called') }) as unknown as typeof fetch
  assert.deepEqual(
    await sendWelcomeEmail(template, 'alex@example.com', 'https://x', 'https://u', 'key', neverFetch, { smtp, createTransport }),
    { status: 'sent', providerId: '<m1@openswarm.com>' },
  )
  assert.deepEqual(used, [smtp])
  assert.deepEqual(mails[0].from, { name: 'Open Swarm', address: 'noreply@openswarm.com' })
  assert.equal(mails[0].to, 'alex@example.com')
  assert.equal(mails[0].replyTo, 'team@openswarm.com')
  assert.equal((mails[0].headers as Record<string, string>)['List-Unsubscribe'], '<https://u>')

  let closed = 0
  const failing = () => ({
    async sendMail(): Promise<never> { throw new Error('550 5.1.1 <alex@example.com>: Recipient address rejected') },
    close() { closed += 1 },
  })
  assert.deepEqual(
    await sendWelcomeEmail(template, 'alex@example.com', 'https://x', 'https://u', undefined, neverFetch, { smtp, createTransport: failing }),
    { status: 'failed', detail: 'SMTP: 550 5.1.1 <[address]>: Recipient address rejected' },
    'recipient addresses never reach the email log',
  )
  assert.equal(closed, 1)

  const hanging = () => ({ sendMail: () => new Promise<never>(() => {}) })
  assert.deepEqual(
    await sendWelcomeEmail(template, 'alex@example.com', 'https://x', 'https://u', undefined, neverFetch, { smtp, createTransport: hanging, deadlineMs: 20 }),
    { status: 'failed', detail: 'SMTP: timed out after 20 ms' },
  )
})

test('unsubscribe links need a valid token, confirm on GET and unsubscribe on POST', async (t) => {
  const unsubscribed: string[] = []
  const origin = await serve(t, createUnsubscribeHandler(async (code) => { unsubscribed.push(code); return true }, 'secret'))
  const token = unsubscribeToken(CODE, 'secret')
  assert.equal((await fetch(`${origin}/api/unsubscribe?c=${CODE}&t=wrong`)).status, 400)
  const confirm = await fetch(`${origin}/api/unsubscribe?c=${CODE}&t=${token}`)
  assert.equal(confirm.status, 200)
  assert.ok((await confirm.text()).includes('<form method="post">'))
  assert.deepEqual(unsubscribed, [], 'following the link alone never unsubscribes')
  const oneClick = await fetch(`${origin}/api/unsubscribe?c=${CODE}&t=${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click',
  })
  assert.equal(oneClick.status, 200)
  assert.deepEqual(unsubscribed, [CODE])
})
