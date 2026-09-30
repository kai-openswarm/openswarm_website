import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderWaitlistEmail } from './waitlist-email.ts'

const options = {
  kind: 'welcome' as const,
  referralCode: 'preview_' + '0'.repeat(24),
  publicUrl: 'https://example.com/launch/',
  unsubscribeUrl: 'https://example.com/launch/api/waitlist/unsubscribe?token=signed-preview',
}

test('welcome HTML and plain text preserve the personal invite and real next step', () => {
  const email = renderWaitlistEmail(options)
  const link = `https://example.com/launch/?ref=${options.referralCode}`
  assert.match(email.subject, /Open Swarm waitlist/)
  assert.ok(email.html.includes(link))
  assert.ok(email.text.includes(link))
  assert.match(email.html, /mailto:\?subject=Join%20me%20on%20Open%20Swarm/)
  assert.match(email.html, /when early access opens/)
  assert.match(email.text, /When 3 friends join/)
  assert.ok(email.html.includes('src="https://example.com/launch/media/logo-256.png"'))
  assert.ok(email.html.includes('src="https://example.com/launch/media/email/invitations.jpg"'))
  assert.ok(email.html.includes('href="' + options.unsubscribeUrl + '"'))
  assert.ok(email.text.includes(options.unsubscribeUrl))
  assert.doesNotMatch(email.html, /<script|<iframe|<form|backdrop-filter|data:image|first.?name/i)
  assert.ok(Buffer.byteLength(email.html) < 25_000)
})

test('priority confirms eligibility without claiming the product is already accessible', () => {
  const email = renderWaitlistEmail({ ...options, kind:'priority' })
  assert.match(email.subject, /priority early access/)
  assert.match(email.text, /Three friends joined/)
  assert.match(email.text, /Access arrives in a separate invitation/)
  assert.match(email.html, /href="https:\/\/example.com\/launch\/#product"/)
  assert.doesNotMatch(email.html, /mailto:|Invite 3 friends|Download now|account is ready/i)
})

test('dynamic footer data is escaped and unsafe or inconsistent links fail before rendering', () => {
  const email = renderWaitlistEmail({ ...options, postalAddress:'A & B <script>alert("x")</script>' })
  assert.ok(email.html.includes('A &amp; B &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'))
  assert.doesNotMatch(email.html, /<script/)
  for (const publicUrl of ['javascript:alert(1)','http://example.com','https://user:secret@example.com']) {
    assert.throws(()=>renderWaitlistEmail({...options,publicUrl}))
  }
  assert.throws(()=>renderWaitlistEmail({...options,unsubscribeUrl:'https://elsewhere.test/unsubscribe'}))
  assert.throws(()=>renderWaitlistEmail({...options,referralCode:'not-a-valid-token'}))
})
