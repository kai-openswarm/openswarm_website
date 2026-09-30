# Hosted waitlist backend

The production API stores email signups in PostgreSQL while retaining legacy phone signups and their referral links. The code and migrations are prepared; **no live database was provisioned, connected, migrated or deployed for this update**. Local development continues to use the private JSON store.

## Entry points and configuration

| Item | Purpose |
| --- | --- |
| `api/waitlist.ts` | Vercel Node handler for `POST /api/waitlist` |
| `api/waitlist/referral.ts` | Vercel Node handler for `GET /api/waitlist/referral?code=…` |
| `server/production-waitlist.ts` | Shared connection pool, hosted request adapter and safe failure handling |
| `server/postgres-waitlist.ts` | PostgreSQL implementation of the email waitlist store |
| `sql/001_waitlist.sql` | Original table, referral constraints and private RLS configuration |
| `sql/002_email_waitlist.sql` | Additive email migration that retains legacy contacts and attribution |
| `DATABASE_URL` | Required server-only PostgreSQL URL with the provider's TLS settings |
| `VITE_PUBLIC_SITE_URL` | Optional public frontend origin for share links |
| `TEST_DATABASE_URL` | Optional isolated database for the real PostgreSQL integration test |

The adapter accepts raw Node request streams and Vercel's pre-parsed JSON while applying the same email validation, 4KB limit and public response contract. Missing configuration, unavailable storage or an unapplied migration returns a generic HTTP 503. The hosted handler never falls back to local JSON or reports signup success before a database commit.

## Migration and launch order

1. Review both migrations against the intended database. Apply them deliberately with the provider's SQL console or a trusted PostgreSQL client. On a fresh database, apply **001 then 002**:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/001_waitlist.sql
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/002_email_waitlist.sql
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/003_analytics.sql
   ```

   `003_analytics.sql` adds the consent record and network hash to signups, the private `analytics` schema, and the admin dashboard functions. The signup API requires it: new signups record attribution in the same transaction. See [analytics](analytics.md).

   If 001 is already applied, apply 002 before deploying the email API. Both migrations support reapplication. Requests and deploy scripts never apply them automatically.

2. Migration 002 adds a nullable email column, preserves unique phone values, and moves the primary key to the existing unique referral code so new entries can omit a phone. A check requires exactly one contact type. Canonical emails are unique; referral foreign keys, first-attribution data, timestamps, source values, code uniqueness, no-self-referral checks and RLS stay intact. No record is deleted or matched across contact types. The original phone API can still insert valid legacy rows during the migration-first deployment transition.
3. Set the hosting project's server-only `DATABASE_URL`; never prefix credentials with `VITE_`. Use the provider's pooled/TLS connection string where applicable. The server uses the table owner or an explicitly configured private server role and matching RLS policy; browser/anonymous credentials must not access this table.
4. Deploy the repository root, including `api/`, `server/`, `sql/` and dependencies. The [preview deployment script](deploy-preview.md) stages the full project and checks both Node functions. Deploying `dist/` alone omits the API.
5. Set `VITE_PUBLIC_SITE_URL` if invite links need a canonical origin, then rebuild the frontend.
6. Before opening public collection, verify a reserved email signup, a case/space variant, an invitation from a legacy code, exactly-three progress and an old phone request returning 400. Remove only known test records through the database administrator afterward.

Private local `.data/waitlist.json` records remain untouched. Moving them to production requires a deliberate import retaining codes and inviter relationships. This implementation does not silently import or upload local contacts.

## Transaction and referral behavior

The API accepts `email`, optional `source` and optional `referralCode`; requests containing `phone` receive HTTP 400. Both stores call the shared [email normalizer](../src/lib/email.ts), so case and outer spaces cannot create extra identities. Dots and plus tags remain intact.

New PostgreSQL inserts use `ON CONFLICT (email) DO NOTHING`. The following READ COMMITTED statement sees a concurrent winning row without changing its source, code or inviter. Unknown invitation codes join without attribution. Each transaction uses one checked-out client and releases it after commit or rollback. Rare referral-code collisions retry a fresh transaction and code, up to a bounded limit.

Progress counts attributed rows by referral code, including both old phone records and email records. Three unique attributed records set `priorityAccess: true`. Responses contain only code, count, goal and eligibility; contacts, database errors and credentials never appear in public responses.

This records eligibility only. Email delivery, ownership verification and product account activation are not connected. A new email cannot be automatically linked to an old phone signup without proving that they identify the same person.

## Tests and verification limits

```sh
node --experimental-strip-types --test server/*.test.ts
```

The current isolated suite passes **29 tests**, with one live PostgreSQL test explicitly skipped. It covers email normalization, legacy phone validation, local durability and mixed-contact referral persistence, concurrency, privacy, SQL parameter binding, transaction rollback/release, duplicate handling, code collision recovery and hosted error behavior.

An isolated temporary PGlite audit executed the actual 001 and 002 migrations with synthetic legacy records. Legacy values, repeat-migration idempotency, mixed-contact exactly-three referral progress, case/space deduplication, immutable attribution, actual share-code collision rollback/retry, plus/dot addresses, RLS and 20 invalid/duplicate/foreign-key constraint cases passed. The package and in-memory database were isolated under `/tmp`; no application dependency, real signup file or live database was used. This embedded engine verifies SQL behavior on one connection, not hosted network/TLS setup or multi-connection concurrency.

The opt-in live PostgreSQL integration suite applies 001, inserts legacy fixtures, applies 002 twice, checks preserved values, mixed-contact referrals, concurrent duplicate emails and RLS, then removes only its UUID-named schema. Use an isolated test database with schema-creation permission. That suite was not run for this update, so hosted network/TLS and real multi-connection behavior remain unverified against a live PostgreSQL instance.
