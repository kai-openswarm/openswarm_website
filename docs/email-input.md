# Email waitlist input

New waitlist signups use email. The form and server share `normalizeEmail(input: string): string | null` from `src/lib/email.ts`; the database store also normalizes direct calls.

- Outer spaces are trimmed and the entire address is lowercased for case-insensitive identity.
- Dots and plus tags remain intact; provider-specific alias rewriting is deliberately avoided.
- Input must be an ordinary unquoted ASCII email address with a dotted domain. Embedded whitespace, controls (including leading/trailing tabs or line breaks), repeated `@`, malformed domain labels, leading/trailing/consecutive local-part dots, and invalid lengths are rejected.
- The total limit is 254 characters, the local-part limit is 64, domain labels are at most 63 characters, and the domain must have an alphabetic or punycode top-level label. ASCII punycode domain forms are accepted; Unicode mailbox/domain input and domain literals are not.
- Validation checks format only. It does not confirm mailbox ownership or delivery.

`POST /api/waitlist` accepts `{ "email": "alex@example.com", "source": "hero" }` with an optional 32-character `referralCode`. A stale request containing `phone` returns 400 even if it also supplies an email. Successful public responses contain referral metadata only.

Legacy phone records remain private and intact, and their referral links/counts continue to work. They are not automatically merged into email signups. The original phone normalizer remains only to validate those local records; no new phone collection path is exposed.

See [local referral behavior](referral-backend.md) and [hosted migration order](production-waitlist.md). Tests use reserved `example.com` addresses and temporary storage; they do not write the real local signup file.
