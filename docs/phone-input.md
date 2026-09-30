# Phone input and storage audit

> Historical audit. New signups now use [email](email-input.md). Phone normalization remains only to validate preserved legacy records.

## Accepted input

The shared phone normalizer previously rejected every value that did not begin with `+`. That prevented familiar US input from reaching the phone-number parser.

The field and API now share these rules:

- A ten-digit national number such as `4155551234` defaults to the US calling plan.
- A leading US country code also works: `14155551234` or `1 (415) 555-1234`.
- Selecting another country enables its national format and trunk prefix. For example, `02079460958` with GB becomes `+442079460958`, `0612345678` with FR becomes `+33612345678`, and `030901820` with DE becomes `+4930901820`.
- Spaces, parentheses, periods and dashes are accepted, including common pasted Unicode dashes.
- Explicit international input such as `+44 20 7946 0018` keeps its supplied country code, even when a different country is selected.
- With the default US selection, seven-digit local numbers and unprefixed international numbers are rejected because they are ambiguous. Other country selections use their own national numbering plan.
- Input must be entirely a phone number. Free text, extensions, extra plus signs, malformed numbers and overly long input are rejected.

`normalizePhone(input, defaultCountry: CountryCode = 'US')` uses the selected country and `extract: false`, then checks `libphonenumber-js`'s `isValid()`. The module also exports the `CountryCode` type for the field's state. All accepted representations become the same canonical E.164 value before storage and deduplication. Referral attribution therefore cannot be multiplied by submitting the same phone with different formatting. The form sends E.164 to the existing API; a new country field in the API contract is not needed.

The relevant library API is documented in the installed package's `README.md`, in the `parsePhoneNumber` options and strictness sections. No new dependency or metadata bundle was added.

## Validation

`node --experimental-strip-types --test server/phone.test.ts server/waitlist.test.ts` passes 18 tests. Coverage checks accepted national formats, country selection, removal of country-specific trunk prefixes, explicit international override, invalid/ambiguous input, HTTP signup acceptance, canonical deduplication, and unchanged referral/self-referral behavior. A selected-GB national number and its explicit `+44` equivalent produce only one API signup and one referral credit. API tests use temporary storage and reserved example numbers, without touching the workspace's local waitlist file.

## Existing storage and deployment

Initial read-only audit, September 29, 2026, before hosted backend preparation:

- The implemented waitlist is a Vite development/preview middleware in `server/waitlist.ts`, configured in `vite.config.ts`. It persists real local records to private `.data/waitlist.json`; it is not an in-memory or pretend success state.
- The JSON store serializes atomic writes within one running process. It does not provide a hosted multi-instance database.
- `npm run build` produces static `dist/` assets. `scripts/deploy-preview.sh` copies only these assets to a Vercel staging directory, so that deployment flow omits the waitlist API entirely.
- The documented preview is `openswarm-launch-preview-aside.vercel.app`. This audit did not deploy to it or verify its remote configuration.
- No root `api/`, `vercel.json`, `.vercel`, `.preview`, or `.git` directory is present in this downloaded workspace. The existing preview script expects a Git checkout, so it also requires adaptation before reuse here.
- No `.env`, `.env.local`, or `.env.production` file is present. No database/provider environment-variable names were present in the running process. Values were not printed or inspected.
- The frontend already supports public `VITE_PUBLIC_SITE_URL` for referral link origins. It has no database connection variable or database driver.

## Concrete production path

Keep the existing Vite frontend and endpoint contract, and add a deployed server API backed by durable storage. Given the existing preview workflow, a Vercel-compatible API plus Postgres is a natural next step, rather than shipping the local JSON file. Vercel's current Vite guide describes adding Nitro for a backend; it is one supported implementation route. [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)

The production schema should enforce a unique canonical phone and unique random referral code, with first-signup referral attribution committed transactionally. A server-only database variable such as `DATABASE_URL` would be introduced by that implementation; it does not exist in this repository today. `VITE_PUBLIC_SITE_URL` can then identify the deployed public site. Database credentials must not use the frontend's `VITE_` prefix.

An alternative is a standalone Node API and database behind the same `/api/waitlist` paths while retaining the static frontend host. Either route requires an actual hosted API/storage connection; changing a frontend URL alone will not create persistence.

The subsequent hosted backend preparation now provides PostgreSQL storage, both Vercel API handlers, and an explicit migration; see [production-waitlist.md](production-waitlist.md) for the current files and remaining connection/deployment steps. No external service was provisioned, linked or deployed during these tasks. Local persistence and the phone fix are complete; production database availability is a separate deployment step.

## Phone component refinement

The field keeps the existing 44px height, 9px corners and overall form width. A segmented, lightly frosted country control replaces the decorative phone icon. A native select offers supported regions and their calling codes, with US first. It keeps the platform's keyboard/type-ahead and mobile picker behavior. The input remains a proper telephone field with autofill and 16px mobile text.

The material borrows restrained depth from the supplied liquid-glass components; the country segment is inset rather than pill-shaped. A fine line expands on focus and stops immediately with reduced motion. A pasted valid international number selects its matching country and formats nationally on blur, avoiding a duplicated dialing prefix. No extra form row or hero spacing was added.

Browser QA: country picker changed US to United Kingdom (+44) and returned focus to the telephone input. Pasting a full reserved US number then blurring selected US and displayed its national formatting; the test value was cleared without submitting. Layout checked at 395px and 320px, including the shortened placeholder. Final production build and scoped lint pass; 27 phone/API/storage tests pass, with the existing hosted PostgreSQL test still awaiting a test database.
