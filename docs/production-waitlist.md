# Hosted waitlist backend

The repository now includes a production API backed by PostgreSQL. The code and migration are prepared; **no database has been provisioned, connected, migrated or deployed** in this workspace. Local development still uses the existing private JSON store.

## Entry points and configuration

| Item | Purpose |
| --- | --- |
| `api/waitlist.ts` | Vercel Node handler for `POST /api/waitlist` |
| `api/waitlist/referral.ts` | Vercel Node handler for `GET /api/waitlist/referral?code=…` |
| `server/production-waitlist.ts` | Small shared connection pool, hosted request adapter and safe failure handling |
| `server/postgres-waitlist.ts` | Host-neutral PostgreSQL implementation of the existing waitlist store contract |
| `sql/001_waitlist.sql` | Explicit database migration; never executed by an incoming signup request |
| `DATABASE_URL` | Required server-only PostgreSQL connection URL, including the provider's TLS settings |
| `VITE_PUBLIC_SITE_URL` | Optional public frontend origin for share links; use the deployed website's URL |
| `TEST_DATABASE_URL` | Optional isolated database used only by the real PostgreSQL integration test |

Vercel's Node runtime supports function files in `api/` and its request/response handler shape. The adapter handles both a raw Node request stream and Vercel's pre-parsed JSON body, while applying the same input validation, 4KB limit and response contract. [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js)

Missing `DATABASE_URL`, an unavailable database, or an unapplied migration returns a generic HTTP 503. The hosted handler **does not fall back to local JSON storage** and never reports success before PostgreSQL commits the signup.

## Migration and launch steps

1. Choose/create a PostgreSQL database in the intended hosting account. For an existing database, review the table name and migration before applying it.
2. Apply `sql/001_waitlist.sql` deliberately using the provider's SQL console or a trusted PostgreSQL client. For example, with the secret supplied through the environment:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/001_waitlist.sql
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/002_analytics.sql
   ```

   `002_analytics.sql` adds the consent record and network hash to signups, the private `analytics` schema, and the admin dashboard functions. The signup API requires it: new signups record attribution in the same transaction. See [analytics](analytics.md).

3. Set the hosting project's server-only `DATABASE_URL`. Do not prefix this secret with `VITE_`. Use the provider's recommended pooled/TLS connection string where applicable; the code does not disable certificate verification.
4. The migration creates a private table with row-level security and no public policy. The server connection should use the table owner, or an explicitly configured server role with a matching private RLS policy. A browser/anonymous key is not a database credential for this API.
5. Deploy the **repository root**, including `api/`, `server/` and dependencies. For a dedicated noindex preview project, the updated `scripts/deploy-preview.sh` stages the full project, checks target database configuration, verifies both built Node API functions and deploys the complete prebuilt artifact. See [deploy-preview.md](deploy-preview.md). Do not deploy a copy of `dist/` alone.
6. Set `VITE_PUBLIC_SITE_URL` to the intended public origin if share links should use a canonical domain, then rebuild the frontend.
7. Verify a reserved test signup, repeated equivalent formatting, an invite signup, and referral progress against the deployed endpoint before collecting public signups. Remove only those known test entries afterward through the database administrator.

Existing `.data/waitlist.json` records remain untouched and private. If those local records should move to production, import them deliberately before launch while retaining their referral codes and original inviter relationships. The static build must never contain the local signup file. No silent upload or automatic import is performed by this code.

## Transaction and referral behavior

The schema enforces unique normalized E.164 phones and unique random 32-character share codes, validates basic field shape, and links each inviter through a foreign key. New inserts use `ON CONFLICT (phone) DO NOTHING`; subsequent reads use the same transaction's next READ COMMITTED statement to see a concurrent winner. An existing phone keeps its original source, code and inviter. Unknown invite codes join without attribution, and self-referrals cannot be stored.

Every signup transaction uses one checked-out PostgreSQL client from beginning through commit/rollback, following node-postgres transaction guidance. Connections are released even when a request fails. [node-postgres transactions](https://node-postgres.com/features/transactions)

Referral counts come from durable attributed rows. Three unique referred phone numbers set `priorityAccess: true` in both signup and progress responses. The API exposes only code, count, goal and eligibility, never phone numbers or database errors. Codes use 192 random bits. Rare share-code collisions retry with a fresh transaction/code, with a bounded retry limit.

The implementation records priority eligibility; it does not send SMS, verify number ownership or provision early-access accounts. Those services have not been connected.

## Tests and limits of verification

```sh
node --experimental-strip-types --test server/*.test.ts
```

Current result: **27 passing tests and one explicitly skipped live PostgreSQL test**. Tests cover country-selected US/international normalization, local durability and privacy, referral deduplication, SQL parameter binding, transaction rollback/release, duplicate winner handling, collision retries, hosted parsed request bodies, body limits, safe errors, and missing database configuration. TypeScript covers production server/API files; a separate standalone TypeScript check covers the test files.

There is no local `postgres`, `psql`, or Docker executable and no `TEST_DATABASE_URL` in this environment. An additional temporary PGlite audit exercised the actual migration/SQL against embedded PostgreSQL: migration idempotency, signup/deduplication, first attribution, exactly-three referral unlock, share-code collision recovery, database constraints, RLS and on-disk restart persistence all passed. That engine has one connection; it does not validate hosted network/TLS setup or concurrent PostgreSQL connections. No PGlite dependency was added to the app.

The opt-in live integration suite creates a unique temporary schema in the supplied test database, applies the migration twice, checks concurrent duplicates and referral attribution, checks RLS, then removes only that test schema. It must use an isolated test database with schema-creation permission.

No live credentials were read into tool output, and no external data or service was changed.
