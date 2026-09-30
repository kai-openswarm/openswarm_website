import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import type { Pool } from 'pg'
import { createTestEmailHandler } from './admin-api.ts'
import type { sendWelcomeEmail } from './email.ts'
import { DEFAULT_SIGNUP_CONFIG } from './signup-config.ts'

const CODE = 'k'.repeat(32)

async function serve(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
  const server = createServer((request, response) => void handler(request, response))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/test-email`
}

function deps(onWaitlist: boolean) {
  const logged: unknown[][] = []
  const database = {
    async query(text: string, values: unknown[]) {
      if (text.includes('is_admin_email')) return { rows: [{ allowed: true }] }
      if (text.includes('FROM waitlist_signups')) return { rows: onWaitlist ? [{ referral_code: CODE }] : [] }
      if (text.includes('log_email')) logged.push(values)
      return { rows: [] }
    },
  } as unknown as Pick<Pool, 'query'>
  const fetchUser = (async () => new Response(JSON.stringify({ email: 'Kai@OpenSwarm.com' }), { status: 200 })) as typeof fetch
  return { deps: { database, supabaseUrl: 'https://example.supabase.co', anonKey: 'anon', serviceKey: 'service', fetch: fetchUser }, logged }
}

const template = { ...DEFAULT_SIGNUP_CONFIG.welcome_email, from_email: 'noreply@openswarm.com', subject: 'Welcome' }

async function run(t: TestContext, onWaitlist: boolean) {
  const sent: { subject: string, body: string, to: string, invite: string, unsubscribe: string }[] = []
  const send = (async (tpl, to, invite, unsubscribe) => {
    sent.push({ subject: tpl.subject, body: tpl.body, to, invite, unsubscribe })
    return { status: 'sent', providerId: 'id-1' }
  }) as typeof sendWelcomeEmail
  const { deps: d, logged } = deps(onWaitlist)
  const url = await serve(t, createTestEmailHandler(d, send))
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token', Host: 'openswarmwebsite.vercel.app' },
    body: JSON.stringify({ welcome_email: template }),
  })
  return { response, body: await response.json() as Record<string, unknown>, sent, logged }
}

test('test emails use the admin’s own invite link when they are on the waitlist', async (t) => {
  const { response, body, sent, logged } = await run(t, true)
  assert.equal(response.status, 200)
  assert.equal(body.realLinks, true)
  assert.equal(sent[0].to, 'kai@openswarm.com')
  assert.equal(sent[0].subject, '[Test] Welcome')
  assert.ok(sent[0].invite.endsWith(`/?ref=${CODE}`))
  assert.ok(sent[0].unsubscribe.includes(`c=${CODE}`))
  assert.ok(!sent[0].body.includes('samples'))
  assert.equal(logged[0][0], CODE, 'the log entry points at the admin’s signup')
})

test('test emails say when links are samples because the admin is not on the waitlist', async (t) => {
  const { body, sent, logged } = await run(t, false)
  assert.equal(body.realLinks, false)
  assert.ok(sent[0].invite.endsWith(`/?ref=${'x'.repeat(32)}`))
  assert.ok(sent[0].body.includes('are samples'))
  assert.equal(logged[0][0], null)
})
