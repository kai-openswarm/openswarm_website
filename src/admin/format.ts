import type { Dimension } from './types'
import { NONE } from './types'

const intFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const compactFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const pctFmt = new Intl.NumberFormat(undefined, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })
const decFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtInt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : intFmt.format(n))
export const fmtCompact = (n: number) => (Math.abs(n) >= 10_000 ? compactFmt.format(n) : intFmt.format(n))
/** 0..1 fraction to "12.3%". */
export const fmtPct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : pctFmt.format(n))
export const fmtDec = (n: number) => decFmt.format(n)

/** Seconds to "1m 23s" / "45s" / "1h 2m". */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

const dateTimeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const timeSecFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })

export const fmtDateTime = (iso: string | Date) => dateTimeFmt.format(new Date(iso))
export const fmtDate = (iso: string | Date) => dateFmt.format(new Date(iso))
export const fmtTime = (iso: string | Date) => timeFmt.format(new Date(iso))
export const fmtTimeSec = (iso: string | Date) => timeSecFmt.format(new Date(iso))

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
export function fmtAgo(iso: string, now = Date.now()): string {
  const diff = (Date.parse(iso) - now) / 1000
  const a = Math.abs(diff)
  if (a < 45) return 'just now'
  if (a < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (a < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86400), 'day')
}

let regionNames: Intl.DisplayNames | null = null
try {
  regionNames = new Intl.DisplayNames(undefined, { type: 'region' })
} catch {
  regionNames = null
}

export function countryName(code: string | null | undefined): string {
  if (!code || code === NONE) return 'Unknown'
  try {
    return regionNames?.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

export function flag(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)))
}

export const DIMENSION_LABELS: Record<Dimension, string> = {
  channel: 'Channel', source: 'Source', referrer_domain: 'Referrer', utm_source: 'UTM source', utm_medium: 'UTM medium',
  utm_campaign: 'UTM campaign', utm_term: 'UTM term', utm_content: 'UTM content', click_id: 'Click ID', country: 'Country',
  region: 'Region', city: 'City', device_type: 'Device', browser: 'Browser', os: 'OS', language: 'Language',
  timezone: 'Time zone', screen: 'Screen', entry_path: 'Entry page', exit_path: 'Exit page', is_new_visitor: 'New vs returning',
  has_invite: 'Invite link',
}

/** Human label for a breakdown/filter value. */
export function dimValue(dim: Dimension, value: string | null | undefined): string {
  if (value == null || value === NONE) {
    if (dim === 'referrer_domain') return '(no referrer)'
    return '(none)'
  }
  if (dim === 'is_new_visitor') return value === 'true' ? 'New' : 'Returning'
  if (dim === 'has_invite') return value === 'true' ? 'With invite' : 'Without invite'
  if (dim === 'country') return countryName(value)
  if (dim === 'device_type') return capitalize(value)
  return value
}

export function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

const EVENT_NAMES: Record<string, string> = {
  pageview: 'Viewed page',
  engagement: 'Engagement time',
  scroll: 'Scrolled',
  section_view: 'Reached section',
  click: 'Clicked',
  outbound: 'Opened external link',
  tab: 'Switched tab',
  waitlist_view: 'Saw signup form',
  waitlist_start: 'Started signup',
  waitlist_submit: 'Submitted number',
  waitlist_success: 'Joined waitlist',
  waitlist_error: 'Signup error',
  waitlist_fail: 'Signup failed',
  referral_open: 'Opened invite panel',
  referral_copy: 'Copied invite link',
  referral_share: 'Shared invite link',
  vital: 'Web vital',
  error: 'JavaScript error',
}

export const eventName = (name: string) => EVENT_NAMES[name] ?? name

export const SECTION_LABELS: Record<string, string> = {
  top: 'Hero / top', intro: 'Intro', capabilities: 'Capabilities', 'use-cases': 'Use cases', marketplace: 'Marketplace', closing: 'Footer',
}

/** Short detail for an event in the live feed. */
export function eventDetail(name: string, props: Record<string, unknown>): string {
  const str = (k: string) => (typeof props[k] === 'string' || typeof props[k] === 'number' ? String(props[k]) : '')
  switch (name) {
    case 'section_view': return SECTION_LABELS[str('section')] ?? str('section')
    case 'scroll': return str('depth') ? `${str('depth')}%` : ''
    case 'click': return str('target')
    case 'outbound': return str('href').replace(/^https?:\/\//, '')
    case 'tab': return [str('group'), str('tab')].filter(Boolean).join(': ')
    case 'waitlist_view':
    case 'waitlist_start':
    case 'waitlist_submit':
    case 'waitlist_success':
      return str('placement') || str('source')
    case 'waitlist_error':
    case 'waitlist_fail':
      return str('code') || str('status')
    default: return ''
  }
}
