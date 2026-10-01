# Paid ads: tracking and experiments

Everything here is built and **off until its value is set in Vercel** (openswarm_website → Settings → Environment Variables → Production), followed by a redeploy.

| Variable | What it turns on | Secret? |
|---|---|---|
| `VITE_META_PIXEL_ID` | Meta pixel: page views and a `Lead` for each new signup | No |
| `META_CAPI_TOKEN` | Server-side Meta Conversions API `Lead` (same event id as the pixel, so Meta counts it once) | **Yes** |
| `META_TEST_EVENT_CODE` | Shows server events under Events Manager → Test events. Remove after testing | No |
| `VITE_META_DOMAIN_VERIFICATION` | `<meta name="facebook-domain-verification">` in the page head | No |
| `VITE_X_SIGNUP_EVENT_ID` | X "Sign up" conversion (`tw-rfqm7-…`) for each new signup | No |

## Where the values come from

- **Meta:** Events Manager → create a dataset (pixel) for openswarm.com → its id. Same dataset → Settings → Conversions API → Generate access token. Business Settings → Brand safety → Domains → add openswarm.com → meta-tag method → the `content` value.
- **X:** Ads Manager → Tools → Events manager → pixel `rfqm7` → add event, type **Sign up** → its event id.

## What gets sent

- Only for visitors who have not opted out at /privacy/#your-choices and whose browser does not send Global Privacy Control.
- Ad click ids (`fbclid`, `twclid`, `gclid`, …) from the landing URL are kept in the browser for 90 days, sent with the signup and stored in `analytics.signup_attribution.click_ids`.
- The Conversions API event carries the SHA-256 of the email and of the visitor id, the IP address and user agent, `fbc`/`fbp`, and the page URL. Nothing is stored about the send.

## Experiments

- Variants live in `src/lib/experiments.ts`. `?h=<variant>` forces the hero variant (and sticks for that visitor), which is how each ad lands on the headline it promises. `split: true` turns on a random split for everyone else.
- Each exposure is an `experiment` event; each signup stores its variants in `signup_attribution.experiments`.
- Dashboard → **Experiments** shows visitors, signups, signup rate with a 95% range, lift vs control and a verdict, plus an **Ad link builder** that produces tagged links per variant, platform, campaign and ad.
- With the split off, forced-variant visitors come from ads and control visitors mostly don't, so compare within one campaign before trusting a difference.

## Verifying after the values are set

1. Set `META_TEST_EVENT_CODE`, redeploy, sign up on the live site with a test address from a link containing `?fbclid=test123`.
2. Events Manager → Test events shows a browser `Lead` and a server `Lead` with the same event id (deduplicated).
3. X Ads → Events manager shows the Sign up event within about 30 minutes.
4. Remove `META_TEST_EVENT_CODE`, redeploy, and delete the test signup in the dashboard.
