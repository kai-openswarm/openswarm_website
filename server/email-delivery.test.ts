import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDeliveryTransport, createResendTransport, createSmtpTransport, EmailDeliveryError, emailPublicUrl, readEmailDeliveryConfig, smtpFromEnv } from './email-delivery.ts'
import type { EmailPayload } from './email-outbox.ts'

const valid: NodeJS.ProcessEnv = {
  SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '587', SMTP_USER: 'noreply@example.com', SMTP_PASSWORD: 'abcd efgh ijkl mnop',
  WAITLIST_EMAIL_SECRET: 'secret'.repeat(8), CRON_SECRET: 'worker'.repeat(8),
  VERCEL_PROJECT_PRODUCTION_URL: 'openswarmwebsite.vercel.app',
}
const payload: EmailPayload = {
  from: 'Open Swarm <noreply@example.com>', to: ['recipient@example.com'],
  subject: 'You’re on the list.', html: '<p>Welcome.</p>', text: 'Welcome.',
  reply_to: 'team@example.com', headers: { 'List-Unsubscribe': '<https://example.com/unsubscribe>' },
}

test('delivery needs SMTP credentials and a public HTTPS URL; the cron secret is optional', () => {
  assert.deepEqual(readEmailDeliveryConfig({}), { state: 'disabled' })
  assert.deepEqual(readEmailDeliveryConfig({ ...valid, SMTP_PASSWORD: '' }), { state: 'disabled' })
  const ready = readEmailDeliveryConfig(valid)
  assert.equal(ready.state, 'ready')
  if (ready.state !== 'ready') return
  assert.deepEqual(ready.config.smtp, { host: 'smtp.gmail.com', port: 587, user: 'noreply@example.com', password: 'abcdefghijklmnop' })
  assert.equal(ready.config.publicUrl, 'https://openswarmwebsite.vercel.app')
  assert.equal(readEmailDeliveryConfig({ ...valid, CRON_SECRET: 'short' }).state, 'invalid')
  assert.equal(readEmailDeliveryConfig({ ...valid, CRON_SECRET: undefined }).state, 'ready')
  assert.equal(readEmailDeliveryConfig({ ...valid, VERCEL_PROJECT_PRODUCTION_URL: undefined }).state, 'invalid')
})

test('email links prefer an explicit URL, then Vercel’s production domain, and never plain HTTP', () => {
  assert.equal(emailPublicUrl({ WAITLIST_EMAIL_PUBLIC_URL: 'https://openswarm.com/', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }), 'https://openswarm.com')
  assert.equal(emailPublicUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'openswarm.com' }), 'https://openswarm.com')
  assert.equal(emailPublicUrl({ WAITLIST_EMAIL_PUBLIC_URL: 'http://openswarm.com' }), null)
  assert.equal(smtpFromEnv({ SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASSWORD: 'p', SMTP_PORT: 'nope' })?.port, 587)
})

test('SMTP receives the exact payload with the sender split into name and address', async () => {
  const sent: Record<string, unknown>[] = []
  let closed = 0
  const send = createSmtpTransport({ host: 'h', port: 587, user: 'u', password: 'p' }, () => ({
    async sendMail(message) { sent.push(message); return { messageId: '<id@example.com>' } },
    close() { closed++ },
  }))
  assert.deepEqual(await send(payload), { id: '<id@example.com>' })
  assert.deepEqual(sent[0].from, { name: 'Open Swarm', address: 'noreply@example.com' })
  assert.deepEqual(sent[0].to, ['recipient@example.com'])
  assert.equal(sent[0].replyTo, 'team@example.com')
  assert.equal(sent[0].html, '<p>Welcome.</p>')
  assert.deepEqual(sent[0].headers, payload.headers)
  assert.equal(closed, 1)
})

test('server rejections are permanent; connection, auth and temporary failures retry without leaking detail', async () => {
  const failing = (error: unknown) => createSmtpTransport({ host: 'h', port: 587, user: 'u', password: 'p' }, () => ({
    async sendMail() { throw error },
  }))
  for (const [error, retryable] of [
    [Object.assign(new Error('550 recipient@example.com rejected'), { responseCode: 550 }), false],
    [Object.assign(new Error('451 try later'), { responseCode: 451 }), true],
    [Object.assign(new Error('535 bad credentials'), { responseCode: 535 }), true],
    [Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }), true],
  ] as const) {
    await assert.rejects(failing(error)(payload), (thrown: unknown) => {
      assert.ok(thrown instanceof EmailDeliveryError)
      assert.equal(thrown.retryable, retryable)
      assert.doesNotMatch(thrown.message, /recipient@example|credentials/)
      return true
    })
  }
})

test('Resend is the backup only when SMTP definitely did not take the message', async () => {
  const calls: string[] = []
  const resend = async (_payload: EmailPayload, key: string) => { calls.push(`resend:${key}`); return { id: 're_1' } }
  const smtpFailing = (error: EmailDeliveryError) => async () => { calls.push('smtp'); throw error }
  const notAccepted = new EmailDeliveryError('x', { retryable: true, notAccepted: true })
  const ambiguous = new EmailDeliveryError('x', { retryable: true })

  const fallback = createDeliveryTransport({}, { smtp: smtpFailing(notAccepted), resend })
  assert.deepEqual(await fallback(payload, 'waitlist/1'), { id: 'resend:re_1' })
  assert.deepEqual(calls, ['smtp', 'resend:waitlist/1'], 'the queue key doubles as Resend’s idempotency key')

  calls.length = 0
  await assert.rejects(createDeliveryTransport({}, { smtp: smtpFailing(ambiguous), resend })(payload, 'k'), EmailDeliveryError)
  assert.deepEqual(calls, ['smtp'], 'an ambiguous SMTP failure is retried later, never handed to a second sender')

  const primary = createDeliveryTransport({}, { smtp: async () => ({ id: '<m@x>' }), resend })
  assert.deepEqual(await primary(payload, 'k'), { id: 'smtp:<m@x>' })
  assert.deepEqual(await createDeliveryTransport({}, { resend })(payload, 'k'), { id: 'resend:re_1' }, 'Resend alone when SMTP is not set')
})

test('SMTP connection, login and reply-code failures count as not accepted; timeouts do not', async () => {
  const classify = async (error: unknown) => {
    try {
      await createSmtpTransport({ host: 'h', port: 587, user: 'u', password: 'p' }, () => ({ async sendMail() { throw error } }))(payload)
    } catch (thrown) {
      return (thrown as EmailDeliveryError).notAccepted
    }
  }
  assert.equal(await classify(Object.assign(new Error(), { code: 'ECONNECTION' })), true)
  assert.equal(await classify(Object.assign(new Error(), { code: 'EAUTH', responseCode: 535 })), true)
  assert.equal(await classify(Object.assign(new Error(), { responseCode: 421 })), true)
  assert.equal(await classify(Object.assign(new Error(), { code: 'ETIMEDOUT' })), false)
  assert.equal(await classify(Object.assign(new Error(), { code: 'ESOCKET' })), false)
})

test('the Resend backup sends the exact payload with the idempotency key and hides provider detail', async () => {
  const requests: { headers: Record<string, string>, body: unknown }[] = []
  const ok = createResendTransport('re_key', (async (_url: string, init: RequestInit) => {
    requests.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 })
  }) as typeof fetch)
  assert.deepEqual(await ok(payload, 'waitlist/abc'), { id: 'email_1' })
  assert.equal(requests[0].headers['Idempotency-Key'], 'waitlist/abc')
  assert.deepEqual(requests[0].body, payload)
  const rejected = createResendTransport('re_key', (async () => new Response('{"message":"recipient@example.com invalid"}', { status: 422 })) as typeof fetch)
  await assert.rejects(rejected(payload, 'k'), (error: unknown) => error instanceof EmailDeliveryError && !error.retryable && !/recipient/.test(error.message))
  assert.equal(readEmailDeliveryConfig({ RESEND_API_KEY: 're_x', VERCEL_PROJECT_PRODUCTION_URL: 'openswarm.com' }).state, 'ready')
})
