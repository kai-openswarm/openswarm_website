import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import type { Pool, PoolClient } from 'pg'
import { createEmailOutbox, type EmailPayload } from './email-outbox.ts'

type Step = { contains: string, rows?: unknown[], rowCount?: number, error?: Error, inspect?: (values?: unknown[]) => void }
function fixture(steps: Step[]) {
  const calls: { text: string, values?: unknown[] }[] = []
  let released = 0
  const query = async (text: string, values?: unknown[]) => {
    calls.push({ text, values })
    const step = steps.shift()
    assert.ok(step, `Unexpected query: ${text}`)
    assert.ok(text.includes(step.contains), `Expected ${step.contains}, got ${text}`)
    step.inspect?.(values)
    if (step.error) throw step.error
    return { rows: step.rows ?? [], rowCount: step.rowCount ?? step.rows?.length ?? 0 }
  }
  const client = { query, release: () => { released++ } } as unknown as PoolClient
  const database = { query, connect: async () => client } as unknown as Pick<Pool, 'query' | 'connect'>
  return { database, calls, remaining: () => steps.length, released: () => released }
}
const id = '11111111-1111-4111-8111-111111111111'
const code = 'a'.repeat(32)
const payload: EmailPayload = { from: 'Open Swarm <hello@example.com>', to: ['friend@example.com'], subject: 'You’re on the list', html: '<p>You’re in.</p>', text: 'You’re in.' }
const serialized = JSON.stringify(payload)
const hash = createHash('sha256').update(serialized).digest('hex')
const job = { id, kind: 'welcome', referral_code: code, email: payload.to[0], created_at: '2026-09-30T12:00:00Z', payload: null, payload_hash: null, attempt_count: 0 }
const clean: Step[] = [{ contains: "failure_code = 'unsubscribed'" }, { contains: "failure_code = 'retry_window_exhausted'" }]

test('a lost provider response retries the exact persisted payload and idempotency key', async () => {
  const db = fixture([
    ...clean,
    { contains: 'SKIP LOCKED', rows: [job] },
    { contains: 'payload = COALESCE', rows: [{ payload: serialized, payload_hash: hash, attempt_count: 1 }], inspect: (values) => {
      assert.equal(values?.[2], serialized)
      assert.equal(values?.[3], hash)
    } },
    { contains: 'RETURNING status', rows: [{ status: 'pending' }], inspect: (values) => {
      assert.equal(values?.[2], false)
      assert.equal(values?.[3], 'delivery_uncertain')
    } },
    ...clean,
    { contains: 'SKIP LOCKED', rows: [{ ...job, payload: serialized, payload_hash: hash, attempt_count: 1 }] },
    { contains: 'payload = COALESCE', rows: [{ payload: serialized, payload_hash: hash, attempt_count: 2 }] },
    { contains: "status = 'sent'", rowCount: 1 },
  ])
  const outbox = createEmailOutbox(db.database)
  const requests: { payload: EmailPayload, key: string }[] = []
  const first = await outbox.drain({ limit: 1, render: () => payload, send: async (body, key) => {
    assert.equal(db.calls.length, 4, 'provider is contacted only after the durable payload write')
    requests.push({ payload: body, key })
    throw new Error('timeout after provider acceptance')
  } })
  assert.equal(first.retried, 1)
  const second = await outbox.drain({ limit: 1, render: () => { throw new Error('retry must not rerender with changed settings') }, send: async (body, key) => {
    requests.push({ payload: body, key })
    return { id: 'provider-id' }
  } })
  assert.equal(second.sent, 1)
  assert.deepEqual(requests[0], requests[1])
  assert.equal(requests[0].key, `waitlist/${id}`)
  assert.equal(db.remaining(), 0)
})

test('a worker that loses its lease or is suppressed cannot contact the provider', async () => {
  const db = fixture([...clean,
    { contains: 'SKIP LOCKED', rows: [job] },
    { contains: 'payload = COALESCE', rows: [] },
  ])
  let sent = false
  const result = await createEmailOutbox(db.database).drain({ limit: 1, render: () => payload, send: async () => { sent = true; return { id: 'unexpected' } } })
  assert.equal(sent, false)
  assert.equal(result.cancelled, 1)
  assert.match(db.calls[3].text, /lease_token = \$2/)
  assert.match(db.calls[3].text, /lease_expires_at > clock_timestamp/)
  assert.match(db.calls[3].text, /email_opted_out_at IS NULL/)
})

test('permanent provider rejections and the eighth attempt stop automatic retries', async () => {
  for (const permanent of [true, false]) {
    const db = fixture([...clean,
      { contains: 'SKIP LOCKED', rows: [job] },
      { contains: 'payload = COALESCE', rows: [{ payload: serialized, payload_hash: hash, attempt_count: permanent ? 1 : 8 }] },
      { contains: 'RETURNING status', rows: [{ status: 'failed' }], inspect: (values) => assert.equal(values?.[2], true) },
    ])
    const result = await createEmailOutbox(db.database).drain({ limit: 1, render: () => payload, send: async () => { throw Object.assign(new Error('provider failure'), { retryable: !permanent }) } })
    assert.equal(result.failed, 1)
    assert.equal(result.retried, 0)
  }
})

test('stored payload corruption or a renderer targeting a different recipient fails closed', async () => {
  for (const input of [{ ...job, payload: serialized, payload_hash: 'invalid' }, job]) {
    const db = fixture([...clean,
      { contains: 'SKIP LOCKED', rows: [input] },
      { contains: "failure_code = 'invalid_payload'", rowCount: 1 },
    ])
    const result = await createEmailOutbox(db.database).drain({ limit: 1,
      render: () => ({ ...payload, to: ['unrelated@example.com'] }),
      send: async () => { assert.fail('invalid payload must never be sent') },
    })
    assert.equal(result.failed, 1)
  }
})

test('expired retry windows are closed before claiming more work', async () => {
  const db = fixture([
    { contains: "failure_code = 'unsubscribed'", rowCount: 2 },
    { contains: "interval '23 hours'", rowCount: 1 },
    { contains: 'SKIP LOCKED', rows: [] },
  ])
  const result = await createEmailOutbox(db.database).drain({ render: () => payload, send: async () => { assert.fail('no eligible work') } })
  assert.deepEqual(result, { sent: 0, retried: 0, failed: 1, cancelled: 2 })
})

test('unsubscribe stores suppression and cancels queued work in one transaction', async () => {
  const db = fixture([
    { contains: 'BEGIN' },
    { contains: 'email_opted_out_at = COALESCE', inspect: (values) => assert.deepEqual(values, [code]) },
    { contains: "status = 'cancelled'", rowCount: 2 },
    { contains: 'COMMIT' },
  ])
  await createEmailOutbox(db.database).unsubscribe(code)
  assert.equal(db.released(), 1)
  assert.ok(db.calls.every(({ text }) => !text.includes('DELETE')))
  assert.equal(db.remaining(), 0)
})

test('unsubscribe rolls back suppression if pending work cannot be cancelled', async () => {
  const failure = new Error('database failure')
  const db = fixture([
    { contains: 'BEGIN' },
    { contains: 'UPDATE waitlist_signups' },
    { contains: 'UPDATE waitlist_email_outbox', error: failure },
    { contains: 'ROLLBACK' },
  ])
  await assert.rejects(createEmailOutbox(db.database).unsubscribe(code), failure)
  assert.equal(db.released(), 1)
})
