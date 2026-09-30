import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeEmail } from '../src/lib/email.ts'

test('email identities trim and ignore case while retaining provider-specific dots and plus tags', () => {
  for (const input of ['alex@example.com', 'Alex@EXAMPLE.COM', '  Alex@Example.com  ']) {
    assert.equal(normalizeEmail(input), 'alex@example.com')
  }
  for (const input of ['first.last+waitlist@example.com', "o'connor@example.com", 'person@sub.example.com', 'person@xn--bcher-kva.example.com']) {
    assert.equal(normalizeEmail(input), input)
    assert.equal(normalizeEmail(normalizeEmail(input)!), input)
  }
  assert.notEqual(normalizeEmail('first.last@example.com'), normalizeEmail('firstlast@example.com'))
  assert.notEqual(normalizeEmail('alex+invite@example.com'), normalizeEmail('alex@example.com'))
})

test('rejects incomplete, malformed, control, whitespace and unsupported email input', () => {
  for (const input of [
    '', ' ', 'alex', '@example.com', 'alex@', 'alex@@example.com', 'alex@example.com@',
    'alex example@example.com', 'alex@exam ple.com', 'alex@example.com\n', '\talex@example.com',
    'alex\u0000@example.com', 'alex\u007f@example.com', 'alex\u00a0@example.com',
    '.alex@example.com', 'alex.@example.com', 'a..b@example.com',
    'alex@localhost', 'alex@example', 'alex@.example.com', 'alex@example..com',
    'alex@-example.com', 'alex@example-.com', 'alex@exam_ple.com', 'alex@example.com.',
    'alex@example.c', 'alex@example.123', 'alex@127.0.0.1', 'alex@[127.0.0.1]',
    'Display Name <alex@example.com>', '"alex"@example.com', 'áléx@example.com', 'alex@éxample.com',
    `${'a'.repeat(65)}@example.com`, `alex@${'a'.repeat(64)}.example.com`,
    `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(59)}.com`,
  ]) assert.equal(normalizeEmail(input), null, JSON.stringify(input))
})

test('supports the accepted mailbox and total-address length boundaries', () => {
  assert.equal(normalizeEmail(`${'a'.repeat(64)}@example.com`), `${'a'.repeat(64)}@example.com`)
  const boundary = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`
  assert.equal(boundary.length, 254)
  assert.equal(normalizeEmail(boundary), boundary)
})
