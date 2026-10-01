/*
  Ad click identifiers (fbclid, twclid, gclid, ...) from the link a visitor arrived on.
  They are kept in this browser for 90 days and sent with a waitlist signup, so the
  signup can be reported to the ad platform that brought the visitor. Nothing is kept or
  sent when the visitor opted out of ad tracking or sends Global Privacy Control.
*/
import { adTrackingAllowed } from './x-pixel'

const KEY = 'openswarm:ad-clicks'
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
const PARAMS = ['fbclid', 'twclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'ttclid', 'rdt_cid', 'li_fat_id'] as const
const VALUE = /^[A-Za-z0-9._~-]{1,500}$/

type Stored = Partial<Record<(typeof PARAMS)[number], string>> & { at?: number }

function read(): Stored {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored
    if (!value || typeof value !== 'object' || typeof value.at !== 'number' || Date.now() - value.at > MAX_AGE_MS) return {}
    return value
  } catch { return {} }
}

/** Saves the click ids in the current URL. A newer ad click replaces the older ones. */
export function captureAdClicks() {
  if (typeof window === 'undefined') return
  if (!adTrackingAllowed()) {
    try { localStorage.removeItem(KEY) } catch { /* Storage can be blocked. */ }
    return
  }
  const params = new URLSearchParams(window.location.search)
  const found: Stored = {}
  for (const name of PARAMS) {
    const value = params.get(name)
    if (value && VALUE.test(value)) found[name] = value
  }
  if (!Object.keys(found).length) return
  try { localStorage.setItem(KEY, JSON.stringify({ ...found, at: Date.now() })) } catch { /* Storage can be blocked. */ }
}

function cookie(name: string) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : undefined
}

/** Click ids for a signup, plus Meta's browser ids. Empty when ad tracking is off. */
export function adClickIds(): Record<string, string> {
  if (typeof window === 'undefined' || !adTrackingAllowed()) return {}
  const { at, ...ids } = read()
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(ids)) if (typeof value === 'string') result[name] = value
  if (at) result.clicked_at = new Date(at).toISOString()
  // Meta's own cookies when its pixel ran; otherwise build the click cookie from fbclid.
  const fbp = cookie('_fbp')
  const fbc = cookie('_fbc') ?? (ids.fbclid && at ? `fb.1.${at}.${ids.fbclid}` : undefined)
  if (fbp && VALUE.test(fbp)) result.fbp = fbp
  if (fbc && VALUE.test(fbc)) result.fbc = fbc
  return result
}
