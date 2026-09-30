import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizePhone, type CountryCode } from '../src/lib/phone.ts'

test('US national, country-prefixed and familiar formatted numbers normalize to the same E.164 value', () => {
  for (const input of [
    '4155551234',
    '14155551234',
    '1 415 555 1234',
    '(415) 555-1234',
    '415.555.1234',
    '  415 555 1234  ',
    '(415) 555\u20111234',
    '1\u00a0(415)\u00a0555-1234',
    '+14155551234',
    '+1 (415) 555-1234',
  ]) {
    assert.equal(normalizePhone(input), '+14155551234', input)
  }
})

test('explicit international country codes are preserved rather than defaulting to US', () => {
  const cases = [
    ['+44 20 7946 0018', '+442079460018'],
    ['+33 1 42 68 53 00', '+33142685300'],
    ['+61 2 9374 4000', '+61293744000'],
    ['+81 3 1234 5678', '+81312345678'],
  ]
  for (const [input, expected] of cases) assert.equal(normalizePhone(input), expected)
})

test('country selection parses national numbers and removes the appropriate trunk prefix', () => {
  const cases: [CountryCode, string, string][] = [
    ['GB', '02079460958', '+442079460958'],
    ['GB', '(020) 7946 0958', '+442079460958'],
    ['FR', '0612345678', '+33612345678'],
    ['FR', '06 12 34 56 78', '+33612345678'],
    ['DE', '030901820', '+4930901820'],
    ['DE', '(030) 9018-20', '+4930901820'],
    ['AU', '02 9374 4000', '+61293744000'],
  ]
  for (const [country, input, expected] of cases) {
    assert.equal(normalizePhone(input, country), expected, `${country}: ${input}`)
    assert.equal(normalizePhone(expected, country), expected, 'Canonical forms stay idempotent')
  }
  // A selected country changes the interpretation; the implicit US default does not guess it.
  assert.equal(normalizePhone('02079460958'), null)
  assert.equal(normalizePhone('0612345678'), null)
})

test('an explicit international prefix overrides every selected country', () => {
  for (const country of ['US', 'GB', 'FR', 'DE'] as const) {
    assert.equal(normalizePhone('+1 (415) 555-1234', country), '+14155551234')
    assert.equal(normalizePhone('+44 20 7946 0958', country), '+442079460958')
    assert.equal(normalizePhone('+33 6 12 34 56 78', country), '+33612345678')
  }
})

test('selected-country parsing still rejects incomplete and non-phone content', () => {
  for (const country of ['GB', 'FR', 'DE'] as const) {
    for (const input of ['012', '00000000000', 'Call 02079460958', '0612345678 ext 2', '++33612345678', '06/12/34/56/78']) {
      assert.equal(normalizePhone(input, country), null, `${country}: ${input}`)
    }
  }
})

test('rejects incomplete, invalid, ambiguous international and non-phone input', () => {
  for (const input of [
    '', ' ', '+', '+12', '5551234', '415555123', '41555512345',
    '0000000000', '1234567890', '1111111111',
    '442079460018', '02079460018', '011442079460018',
    '+999123456789', '++14155551234', '415+5551234',
    'Call 4155551234', '4155551234 ext 12', '+1 (415) 555-1234#12',
    '415/555/1234', '+1' + '2'.repeat(39),
  ]) assert.equal(normalizePhone(input), null, input)
})
