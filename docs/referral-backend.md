# Local waitlist referrals

The waitlist now collects email addresses. Three unique referred signups earn priority early-access eligibility. Notification delivery is not connected; signup and referral progress are persisted.

Vite development and preview use the existing private `.data/waitlist.json` file. New entries contain `email`; previous phone entries, dates, sources, referral codes, attributions and additional metadata remain intact. No real signup file was read or changed while implementing or testing this update.

## API contract

`POST /api/waitlist` accepts JSON:

```json
{
  "email": "alex@example.com",
  "source": "hero",
  "referralCode": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

`source` and `referralCode` are optional. The referral code must contain exactly 32 URL-safe characters (`A–Z`, `a–z`, `0–9`, `_`, `-`). The shared [email normalizer](../src/lib/email.ts) trims and lowercases addresses while retaining dots and plus tags. New signups return HTTP 201; repeated normalized addresses return HTTP 200. Requests containing a `phone` property return HTTP 400, including requests that also contain an email.

Both successful signup responses and `GET /api/waitlist/referral?code=<code>` return:

```json
{
  "ok": true,
  "referral": {
    "code": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "count": 0,
    "goal": 3,
    "priorityAccess": false
  }
}
```

Unknown or malformed lookup codes return 404. Responses never contain an email address, phone number, source, signup date, or file path. All responses use `Cache-Control: no-store`. Unknown but correctly shaped incoming invitation codes do not prevent signup; they receive no attribution. Malformed supplied codes return 400.

## Attribution and persistence

- Codes contain 192 random bits, independent of contact details and signup order. Collisions are checked before use.
- A valid existing inviter is credited only when a new normalized email joins. A repeated signup retains its original source, date, code and inviter; it cannot become a self-referral.
- Existing phone referral links remain valid. Counts include attributed legacy phone entries and new email entries together. `priorityAccess` becomes true at three attributed records and survives server restarts.
- Legacy phone entries without a share code remain unchanged. Email signup does not infer or merge a phone identity, because the service cannot verify that they belong to the same person.
- Queued atomic writes preserve concurrent signups in one server process. Files retain private mode 0600; Vite blocks direct, encoded, transformed and absolute access to `.data`.
- Duplicate identities/codes or malformed data produce a generic 503 instead of overwriting the store. Email and phone identities use separate namespaces in a mixed local store.

The browser stores only share codes for recovery and attribution, never contact details. These public codes expose referral progress and are not authentication tokens.

## Scope and verification

The local JSON store supports one process. The [hosted PostgreSQL implementation](production-waitlist.md) supports shared durable storage and must receive both SQL migrations before the email API is deployed. Static assets alone do not provide signup endpoints.

Email addresses are format-validated but unverified. Distinct normalized addresses count as signups, not verified people; provider-specific aliases remain distinct. Notification delivery, ownership verification and account activation are separate services.

`node --experimental-strip-types --test server/*.test.ts` covers email validation, canonical deduplication, durable writes, mixed legacy/email attribution, exactly-three unlock, restart persistence, concurrency, corrupt-store recovery, rollback, hosted handler privacy and Vite data protection. All local test data uses temporary files and reserved example addresses/numbers. The PostgreSQL integration test is opt-in and uses a new isolated schema.
