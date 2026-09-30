export type Referral = {
  code: string
  count: number
  goal: 3
  priorityAccess: boolean
}

const codePattern = /^[A-Za-z0-9_-]{32}$/
const ownCodeKey = 'openswarm:referral-code'
const incomingCodeKey = 'openswarm:invited-by'

export function parseReferral(result: unknown): Referral | null {
  if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true || !('referral' in result)) return null
  const referral = result.referral
  if (!referral || typeof referral !== 'object') return null
  if (!('code' in referral) || typeof referral.code !== 'string' || !codePattern.test(referral.code)) return null
  if (!('count' in referral) || typeof referral.count !== 'number' || !Number.isSafeInteger(referral.count) || referral.count < 0) return null
  if (!('goal' in referral) || referral.goal !== 3 || !('priorityAccess' in referral) || typeof referral.priorityAccess !== 'boolean') return null
  return { code: referral.code, count: referral.count, goal: 3, priorityAccess: referral.priorityAccess }
}

export function saveReferralCode(code: string) {
  if (!codePattern.test(code)) return
  try { localStorage.setItem(ownCodeKey, code) } catch { /* Sharing still works for this visit. */ }
}

export function savedReferralCode(): string | null {
  try {
    const code = localStorage.getItem(ownCodeKey)
    return code && codePattern.test(code) ? code : null
  } catch { return null }
}

/** Never clear a newer code saved by another tab while this request was pending. */
export function clearSavedReferralCode(expectedCode: string) {
  try {
    if (localStorage.getItem(ownCodeKey) === expectedCode) localStorage.removeItem(ownCodeKey)
  } catch { /* The current dialog still recovers if browser storage is unavailable. */ }
}

/** Capture attribution before anchors or other navigation change the URL. Never stores a phone. */
export function incomingReferralCode(): string | undefined {
  const incoming = new URLSearchParams(window.location.search).get('ref')
  if (incoming && codePattern.test(incoming)) {
    try { sessionStorage.setItem(incomingCodeKey, incoming) } catch { /* URL remains the fallback. */ }
    return incoming
  }
  try {
    const saved = sessionStorage.getItem(incomingCodeKey)
    return saved && codePattern.test(saved) ? saved : undefined
  } catch { return undefined }
}

export function referralLink(code: string, publicSiteUrl = import.meta.env.VITE_PUBLIC_SITE_URL, baseUrl = import.meta.env.BASE_URL) {
  let origin = 'https://openswarm.com'
  try {
    const configured = new URL(publicSiteUrl || origin)
    const host = configured.hostname.toLowerCase().replace(/\.$/, '')
    const localHost = host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '0.0.0.0' || /^127\./.test(host)
    if (['https:', 'http:'].includes(configured.protocol) && !localHost && !configured.username && !configured.password) origin = configured.origin
  } catch { /* Invalid overrides use the public OpenSwarm origin. */ }
  const url = new URL(origin)
  try {
    // Keep the configured deployment path, never a preview origin or tracking query.
    url.pathname = new URL(baseUrl || '/', origin).pathname
  } catch { url.pathname = '/' }
  url.searchParams.set('ref', code)
  return url.toString()
}
