import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import type { Pool } from 'pg'
import { createEmailPreviewHandler, createSendPendingHandler, createTestEmailHandler } from './admin-api.ts'
import type { EmailKind } from './email-outbox.ts'
import { verifyUnsubscribeToken } from './email-unsubscribe.ts'
import { DEFAULT_SIGNUP_CONFIG, type SignupConfig } from './signup-config.ts'
import { emailEvents, renderWaitlistPayload } from './waitlist-mailer.ts'

const CODE = 'k'.repeat(32)
const SECRET = 's'.repeat(40)
const links = { publicUrl: 'https://openswarmwebsite.vercel.app', secret: SECRET }
const sender = { ...DEFAULT_SIGNUP_CONFIG.welcome_email, from_name: 'OpenSwarm', from_email: 'noreply@openswarm.com', postal_address: '1 Main St' }
const config: SignupConfig = { ...DEFAULT_SIGNUP_CONFIG, welcome_email: sender }

async function serve(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
  const server = createServer((request, response) => void handler(request, response))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return (body: unknown) => fetch(`${origin}/api/admin/x`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' }, body: JSON.stringify(body),
  })
}

function deps(onWaitlist: boolean) {
  const logged: unknown[][] = []
  const database = {
    async query(text: string, values: unknown[]) {
      if (text.includes('is_admin_email')) return { rows: [{ allowed: true }] }
      if (text.includes('FROM waitlist_signups')) return { rows: onWaitlist ? [{ referral_code: CODE }] : [] }
      if (text.includes('log_email') || text.includes('audit')) logged.push(values)
      return { rows: [] }
    },
  } as unknown as Pick<Pool, 'query'>
  const fetchUser = (async () => new Response(JSON.stringify({ email: 'Kai@OpenSwarm.com' }), { status: 200 })) as typeof fetch
  return { deps: { database, supabaseUrl: 'https://example.supabase.co', anonKey: 'anon', serviceKey: 'service', fetch: fetchUser }, logged }
}

test('the branded template takes its sender, subjects and postal address from the dashboard', () => {
  const welcome = renderWaitlistPayload('welcome', CODE, 'person@example.com', config, links)
  assert.equal(welcome.from, 'OpenSwarm <noreply@openswarm.com>')
  assert.equal(welcome.subject, sender.subject)
  assert.ok(welcome.html.includes(`https://openswarmwebsite.vercel.app/?ref=${CODE}`))
  assert.ok(welcome.html.includes('1 Main St'))
  const token = new URL(welcome.headers!['List-Unsubscribe'].slice(1, -1)).searchParams.get('token')!
  assert.equal(verifyUnsubscribeToken(token, SECRET), CODE)
  const priority = renderWaitlistPayload('priority', CODE, 'person@example.com',
    { ...config, priority_email: { enabled: true, subject: 'Priority unlocked' } }, links, '[Test] ')
  assert.equal(priority.subject, '[Test] Priority unlocked')
  assert.throws(() => renderWaitlistPayload('welcome', CODE, 'p@example.com', DEFAULT_SIGNUP_CONFIG, links), /sender/)
})

test('emails are queued only when sending is configured and switched on', () => {
  const on = { ...config, welcome_email: { ...sender, enabled: true }, priority_email: { enabled: true, subject: 'P' } }
  assert.deepEqual(emailEvents(on, true), { welcome: true, priority: true })
  assert.deepEqual(emailEvents(on, false), { welcome: false, priority: false })
  assert.deepEqual(emailEvents(config, true), { welcome: false, priority: false })
})

function mailer() {
  const sent: { kind: EmailKind, code: string, to: string, subject: string }[] = []
  return {
    sent,
    mailer: {
      async sendTest(kind: EmailKind, code: string, to: string, formConfig: SignupConfig) {
        sent.push({ kind, code, to, subject: formConfig.priority_email.subject })
        return { id: 'smtp:<1@x>' }
      },
      async drain() { return { sent: 2, retried: 0, failed: 0, cancelled: 0 } },
    },
  }
}

test('test emails use the admin’s own signup and the chosen email kind', async (t) => {
  const { deps: d, logged } = deps(true)
  const { mailer: m, sent } = mailer()
  const post = await serve(t, createTestEmailHandler(d, m))
  const response = await post({ kind: 'priority', welcome_email: sender, priority_email: { enabled: false, subject: 'Unsaved subject' } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, sentTo: 'kai@openswarm.com', kind: 'priority', realLinks: true, via: 'smtp' })
  assert.deepEqual(sent, [{ kind: 'priority', code: CODE, to: 'kai@openswarm.com', subject: 'Unsaved subject' }])
  assert.deepEqual(logged[0].slice(0, 3), [CODE, 'test', 'sent'])
})

test('test emails explain missing SMTP settings and a missing sender', async (t) => {
  const { deps: d } = deps(false)
  const noSmtp = await serve(t, createTestEmailHandler(d, null))
  assert.match((await (await noSmtp({ welcome_email: sender })).json()).error, /SMTP_HOST/)
  const { mailer: m } = mailer()
  const noSender = await serve(t, createTestEmailHandler(d, m))
  assert.equal((await noSender({ welcome_email: { ...sender, from_email: '' } })).status, 400)
})

test('preview renders without sending and send-pending drains the queue with an audit entry', async (t) => {
  const { deps: d, logged } = deps(false)
  const preview = await serve(t, createEmailPreviewHandler(d, () => links))
  const body = await (await preview({ kind: 'welcome', welcome_email: sender })).json() as Record<string, string>
  assert.equal(body.from, 'OpenSwarm <noreply@openswarm.com>')
  assert.ok(body.html.includes('You’re on the list.'))
  const { mailer: m } = mailer()
  const pending = await serve(t, createSendPendingHandler(d, m))
  assert.deepEqual(await (await pending({})).json(), { ok: true, result: { sent: 2, retried: 0, failed: 0, cancelled: 0 } })
  assert.equal(logged.at(-1)?.[1], 'send_pending_emails')
})
