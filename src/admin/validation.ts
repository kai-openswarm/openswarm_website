// Client-side mirrors of admin_update_setting's checks (sql/005_admin_features.sql).

export const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/
export const SETTING_EMAIL_RE = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/
export const MAX_BLOCKED_DOMAINS = 500

/** Lowercases and strips "@", "http(s)://", "www." and paths, so pasted values work. */
export function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^.*@/, '').replace(/^www\./, '').replace(/\/.*$/, '')
}

/** Big mailbox providers: blocking one would block a large share of real people. */
export const MAJOR_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'icloud.com', 'me.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'aol.com', 'proton.me', 'protonmail.com',
])
