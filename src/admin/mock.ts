// Development fixtures. Generates a few months of plausible sessions once, then
// answers every admin_* call by aggregating them the same way the SQL does, so
// filters, ranges and comparisons behave like the real thing.
// Only imported dynamically behind import.meta.env.DEV (see api.ts).
import type { AdminApi } from './api'
import { ApiError } from './api'
import type {
  AdminSettings, Annotation, AuditEntry, BreakdownRow, Bucket, Dimension, EmailReport, Engagement, ExportRow, FilterClause, Filters, Funnel,
  Kpis, Overview, Performance, RangeQuery, Realtime, RealtimeEvent, Referrals, SectionKey, SettingValues, SignupRow, TimeseriesPoint, VitalRow, WelcomeEmail,
} from './types'
import { NONE } from './types'
import { fromWire, matchesClause } from './filters'
import { DOMAIN_RE } from './validation'

// ---------------------------------------------------------------------------
// Random helpers
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rand = () => number

function pick<T>(rand: Rand, items: readonly (readonly [T, number])[]): T {
  let total = 0
  for (const [, w] of items) total += w
  let r = rand() * total
  for (const [v, w] of items) {
    r -= w
    if (r <= 0) return v
  }
  return items[items.length - 1][0]
}

function chance(rand: Rand, p: number) {
  return rand() < p
}

function logNormal(rand: Rand, median: number, spread: number) {
  // Box-Muller
  const u = Math.max(rand(), 1e-9)
  const v = rand()
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  return median * Math.exp(z * spread)
}

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
function code(rand: Rand, len = 32) {
  let s = ''
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)]
  return s
}

function uuid(rand: Rand) {
  const h = () => Math.floor(rand() * 16).toString(16)
  let s = ''
  for (let i = 0; i < 32; i++) s += h()
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20)}`
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

interface Geo {
  country: string
  weight: number
  lang: string
  regions: { region: string; tz: string; cities: string[]; weight: number }[]
  dial: string
}

const GEOS: Geo[] = [
  { country: 'US', weight: 52, lang: 'en-US', dial: '+1', regions: [
    { region: 'California', tz: 'America/Los_Angeles', cities: ['San Francisco', 'Los Angeles', 'San Jose', 'Oakland', 'San Diego'], weight: 30 },
    { region: 'New York', tz: 'America/New_York', cities: ['New York', 'Brooklyn'], weight: 16 },
    { region: 'Texas', tz: 'America/Chicago', cities: ['Austin', 'Houston', 'Dallas'], weight: 12 },
    { region: 'Washington', tz: 'America/Los_Angeles', cities: ['Seattle', 'Bellevue'], weight: 8 },
    { region: 'Massachusetts', tz: 'America/New_York', cities: ['Boston', 'Cambridge'], weight: 6 },
    { region: 'Illinois', tz: 'America/Chicago', cities: ['Chicago'], weight: 5 },
    { region: 'Florida', tz: 'America/New_York', cities: ['Miami', 'Orlando'], weight: 5 },
    { region: 'Colorado', tz: 'America/Denver', cities: ['Denver', 'Boulder'], weight: 4 },
  ] },
  { country: 'GB', weight: 7, lang: 'en-GB', dial: '+44', regions: [
    { region: 'England', tz: 'Europe/London', cities: ['London', 'Manchester', 'Bristol'], weight: 1 },
  ] },
  { country: 'CA', weight: 6, lang: 'en-CA', dial: '+1', regions: [
    { region: 'Ontario', tz: 'America/Toronto', cities: ['Toronto', 'Ottawa'], weight: 6 },
    { region: 'British Columbia', tz: 'America/Vancouver', cities: ['Vancouver'], weight: 3 },
    { region: 'Quebec', tz: 'America/Toronto', cities: ['Montreal'], weight: 2 },
  ] },
  { country: 'IN', weight: 6, lang: 'en-IN', dial: '+91', regions: [
    { region: 'Karnataka', tz: 'Asia/Kolkata', cities: ['Bengaluru'], weight: 3 },
    { region: 'Maharashtra', tz: 'Asia/Kolkata', cities: ['Mumbai', 'Pune'], weight: 2 },
  ] },
  { country: 'DE', weight: 4, lang: 'de-DE', dial: '+49', regions: [
    { region: 'Berlin', tz: 'Europe/Berlin', cities: ['Berlin'], weight: 2 },
    { region: 'Bavaria', tz: 'Europe/Berlin', cities: ['Munich'], weight: 1 },
  ] },
  { country: 'AU', weight: 3, lang: 'en-AU', dial: '+61', regions: [
    { region: 'New South Wales', tz: 'Australia/Sydney', cities: ['Sydney'], weight: 2 },
    { region: 'Victoria', tz: 'Australia/Melbourne', cities: ['Melbourne'], weight: 1 },
  ] },
  { country: 'FR', weight: 2.5, lang: 'fr-FR', dial: '+33', regions: [
    { region: 'Île-de-France', tz: 'Europe/Paris', cities: ['Paris'], weight: 1 },
  ] },
  { country: 'BR', weight: 2.5, lang: 'pt-BR', dial: '+55', regions: [
    { region: 'São Paulo', tz: 'America/Sao_Paulo', cities: ['São Paulo'], weight: 1 },
  ] },
  { country: 'NL', weight: 2, lang: 'nl-NL', dial: '+31', regions: [
    { region: 'North Holland', tz: 'Europe/Amsterdam', cities: ['Amsterdam'], weight: 1 },
  ] },
  { country: 'JP', weight: 1.5, lang: 'ja-JP', dial: '+81', regions: [
    { region: 'Tokyo', tz: 'Asia/Tokyo', cities: ['Tokyo'], weight: 1 },
  ] },
  { country: 'SG', weight: 1, lang: 'en-SG', dial: '+65', regions: [
    { region: 'Singapore', tz: 'Asia/Singapore', cities: ['Singapore'], weight: 1 },
  ] },
  { country: 'ES', weight: 1, lang: 'es-ES', dial: '+34', regions: [
    { region: 'Madrid', tz: 'Europe/Madrid', cities: ['Madrid'], weight: 1 },
  ] },
  { country: 'SE', weight: 0.8, lang: 'sv-SE', dial: '+46', regions: [
    { region: 'Stockholm', tz: 'Europe/Stockholm', cities: ['Stockholm'], weight: 1 },
  ] },
  { country: 'MX', weight: 0.8, lang: 'es-MX', dial: '+52', regions: [
    { region: 'Mexico City', tz: 'America/Mexico_City', cities: ['Mexico City'], weight: 1 },
  ] },
]

type Channel = 'Direct' | 'Organic Search' | 'Organic Social' | 'Paid Social' | 'Referral' | 'Invite link' | 'AI Assistants' | 'Email'

const CHANNELS: (readonly [Channel, number])[] = [
  ['Direct', 24], ['Organic Search', 17], ['Organic Social', 16], ['Paid Social', 10],
  ['Invite link', 10], ['Referral', 8], ['AI Assistants', 8], ['Email', 5],
]

interface Traffic {
  channel: Channel
  source: string
  referrer_domain: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  click_id: string | null
  has_invite: boolean
}

function traffic(rand: Rand, channel: Channel): Traffic {
  const t: Traffic = {
    channel, source: '(direct)', referrer_domain: null, utm_source: null, utm_medium: null, utm_campaign: null,
    utm_term: null, utm_content: null, click_id: null, has_invite: false,
  }
  switch (channel) {
    case 'Direct':
      break
    case 'Organic Search': {
      const [src, dom] = pick(rand, [[['google', 'www.google.com'], 82], [['bing', 'www.bing.com'], 8], [['duckduckgo', 'duckduckgo.com'], 7], [['brave', 'search.brave.com'], 3]] as const)
      t.source = src
      t.referrer_domain = dom
      break
    }
    case 'Organic Social': {
      const [src, dom] = pick(rand, [[['x.com', 't.co'], 40], [['reddit', 'www.reddit.com'], 22], [['linkedin', 'www.linkedin.com'], 18], [['youtube', 'www.youtube.com'], 12], [['threads', 'www.threads.net'], 5], [['instagram', 'l.instagram.com'], 3]] as const)
      t.source = src
      t.referrer_domain = dom
      break
    }
    case 'Paid Social': {
      const [src, dom] = pick(rand, [[['x.com', 't.co'], 55], [['meta', 'l.facebook.com'], 30], [['linkedin', 'www.linkedin.com'], 15]] as const)
      t.source = src
      t.referrer_domain = dom
      t.utm_source = src === 'x.com' ? 'x' : src
      t.utm_medium = 'paid_social'
      t.utm_campaign = pick(rand, [['launch_sept', 5], ['jarvis_video', 3], ['retarget_q3', 2]] as const)
      t.utm_content = pick(rand, [['video_30s', 4], ['static_octopus', 3], ['carousel_apps', 2]] as const)
      t.utm_term = chance(rand, 0.3) ? pick(rand, [['ai desktop', 2], ['ai agents mac', 1]] as const) : null
      t.click_id = src === 'meta' ? `fbclid.${code(rand, 12)}` : `twclid.${code(rand, 12)}`
      break
    }
    case 'Referral': {
      const [src, dom] = pick(rand, [[['producthunt.com', 'www.producthunt.com'], 40], [['news.ycombinator.com', 'news.ycombinator.com'], 30], [['github.com', 'github.com'], 15], [['betalist.com', 'betalist.com'], 10], [['theresanaiforthat.com', 'theresanaiforthat.com'], 5]] as const)
      t.source = src
      t.referrer_domain = dom
      break
    }
    case 'Invite link':
      t.source = 'invite'
      t.has_invite = true
      t.referrer_domain = chance(rand, 0.4) ? pick(rand, [['t.co', 3], ['www.whatsapp.com', 2], ['www.linkedin.com', 1]] as const) : null
      break
    case 'AI Assistants': {
      const [src, dom] = pick(rand, [[['chatgpt', 'chatgpt.com'], 55], [['perplexity', 'www.perplexity.ai'], 20], [['claude', 'claude.ai'], 15], [['gemini', 'gemini.google.com'], 10]] as const)
      t.source = src
      t.referrer_domain = dom
      break
    }
    case 'Email':
      t.source = 'newsletter'
      t.utm_source = 'newsletter'
      t.utm_medium = 'email'
      t.utm_campaign = pick(rand, [['waitlist_update_1', 3], ['waitlist_update_2', 2], ['founder_note', 1]] as const)
      t.utm_content = pick(rand, [['header_cta', 2], ['footer_link', 1]] as const)
      break
  }
  return t
}

interface Profile {
  id: string
  country: string
  region: string
  city: string
  timezone: string
  language: string
  device_type: 'desktop' | 'mobile' | 'tablet'
  browser: string
  os: string
  screen: string
}

function profile(rand: Rand): Profile {
  const geo = pick(rand, GEOS.map((g) => [g, g.weight] as const))
  const reg = pick(rand, geo.regions.map((r) => [r, r.weight] as const))
  const device_type = pick(rand, [['desktop', 58], ['mobile', 38], ['tablet', 4]] as const)
  let browser: string
  let os: string
  let screen: string
  if (device_type === 'desktop') {
    os = pick(rand, [['macOS', 62], ['Windows', 30], ['Linux', 8]] as const)
    browser = os === 'macOS'
      ? pick(rand, [['Chrome', 52], ['Safari', 30], ['Arc', 8], ['Firefox', 5], ['Edge', 5]] as const)
      : pick(rand, [['Chrome', 68], ['Edge', 18], ['Firefox', 12], ['Brave', 2]] as const)
    screen = pick(rand, [['1512x982', 24], ['1440x900', 20], ['1920x1080', 24], ['1728x1117', 12], ['2560x1440', 10], ['1366x768', 5], ['3440x1440', 5]] as const)
  } else if (device_type === 'mobile') {
    os = pick(rand, [['iOS', 66], ['Android', 34]] as const)
    browser = os === 'iOS'
      ? pick(rand, [['Mobile Safari', 82], ['Chrome Mobile', 12], ['Instagram', 3], ['X', 3]] as const)
      : pick(rand, [['Chrome Mobile', 82], ['Samsung Internet', 14], ['Firefox Mobile', 4]] as const)
    screen = pick(rand, [['390x844', 26], ['393x852', 24], ['430x932', 16], ['412x915', 14], ['360x800', 10], ['375x667', 10]] as const)
  } else {
    os = pick(rand, [['iPadOS', 80], ['Android', 20]] as const)
    browser = os === 'iPadOS' ? 'Mobile Safari' : 'Chrome Mobile'
    screen = pick(rand, [['820x1180', 40], ['1024x1366', 30], ['800x1280', 30]] as const)
  }
  return {
    id: uuid(rand), country: geo.country, region: reg.region,
    city: reg.cities[Math.floor(rand() * reg.cities.length)], timezone: reg.tz, language: geo.lang,
    device_type, browser, os, screen,
  }
}

const SECTIONS: SectionKey[] = ['top', 'intro', 'capabilities', 'use-cases', 'marketplace', 'closing']
const PLACEMENTS = [
  ['hero', 52], ['nav', 16], ['closing', 20], ['marketplace:lead-finder', 4], ['marketplace:problem-validator', 3],
  ['marketplace:post-harvester', 3], ['marketplace:social-footprint-finder', 2],
] as const
const TABS = [['use-cases: Sales', 30], ['use-cases: Research', 26], ['use-cases: Content', 20], ['use-cases: Operations', 14], ['use-cases: Personal', 10], ['capabilities: Browser', 12], ['capabilities: Files', 8]] as const
const CLICKS = [['hero:join', 30], ['nav:join', 16], ['hero:watch-demo', 14], ['nav:marketplace', 10], ['closing:join', 12], ['marketplace:lead-finder', 6], ['marketplace:problem-validator', 4], ['nav:logo', 4], ['footer:privacy', 2], ['footer:terms', 1]] as const
const OUTBOUND = [['https://x.com/openswarm', 40], ['https://github.com/openswarm', 25], ['https://discord.gg/openswarm', 20], ['https://www.producthunt.com/posts/open-swarm', 10], ['https://www.youtube.com/@openswarm', 5]] as const
const ERROR_REASONS = [['invalid_email', 45], ['empty', 14], ['429', 16], ['400', 8], ['500', 5], ['503', 3]] as const

const FIRST = ['alex', 'sam', 'jordan', 'maya', 'priya', 'chen', 'lucas', 'emma', 'noah', 'olivia', 'ravi', 'sofia', 'liam', 'ava', 'kenji', 'lea', 'omar', 'zoe', 'dan', 'nina']
const LAST = ['kim', 'patel', 'garcia', 'nguyen', 'smith', 'mueller', 'rossi', 'tanaka', 'silva', 'cohen', 'brown', 'lee', 'martin', 'singh', 'wang']
const DOMAINS = [['gmail.com', 55], ['icloud.com', 12], ['outlook.com', 8], ['yahoo.com', 5], ['proton.me', 4], ['hey.com', 2], ['stripe.com', 1], ['acme.io', 1], ['berkeley.edu', 2]] as const

function email(rand: Rand) {
  const f = FIRST[Math.floor(rand() * FIRST.length)]
  const l = LAST[Math.floor(rand() * LAST.length)]
  const local = pick(rand, [[`${f}.${l}`, 4], [`${f}${l}`, 3], [`${f}${Math.floor(rand() * 999)}`, 3], [`${f[0]}${l}`, 2]] as const)
  return `${local}${Math.floor(rand() * 90) + 10}@${pick(rand, DOMAINS)}`
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

interface MockSession {
  id: string
  visitor_id: string
  started_at: number
  active_ms: number
  pageviews: number
  max_scroll: number
  section: number
  engaged: boolean
  converted: boolean
  is_internal: boolean
  saw_form: boolean
  started: boolean
  submitted: boolean
  shared: boolean
  error: string | null
  placement: string
  tabs: string[]
  clicks: string[]
  outbound: string[]
  dims: Record<Dimension, string | null>
}

interface MockSignup {
  email: string | null
  /** Legacy signups from before the switch to email. */
  phone: string | null
  code: string
  created_at: number
  placement: string
  referred_by: string | null
  network_hash: string
  consent_version: string | null
  session: MockSession | null
  unsubscribed_at: number | null
  /** Opened the invite card after joining. */
  opened: boolean
  shares: { at: number; channel: string }[]
  /** Distinct visitors who arrived on this person's invite link. */
  invite_visitors: number
  welcome: { status: 'sent' | 'failed' | 'skipped'; detail: string | null } | null
}

const DAY = 86_400_000
const HISTORY_DAYS = 200

function buildDataset() {
  const rand = mulberry32(20260930)
  const now = Date.now()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const start = today.getTime() - (HISTORY_DAYS - 1) * DAY

  const sessions: MockSession[] = []
  const signups: MockSignup[] = []
  const profiles: Profile[] = []
  const referrers: MockSignup[] = []

  // US-afternoon heavy hour-of-day weights (local hours of the viewing browser).
  const hourWeights = Array.from({ length: 24 }, (_, h) => [h, 1 + 4 * Math.exp(-((h - 14) ** 2) / 30) + (h < 6 ? -0.5 : 0)] as const)

  for (let d = 0; d < HISTORY_DAYS; d++) {
    const dayStart = start + d * DAY
    const date = new Date(dayStart)
    const weekday = date.getDay()
    const growth = 30 + 330 * (1 / (1 + Math.exp(-(d - 130) / 18)))
    const weekly = weekday === 0 || weekday === 6 ? 0.72 : 1
    // Launch spikes: a Product Hunt day and a viral post.
    const spike = d === HISTORY_DAYS - 24 ? 3.2 : d === HISTORY_DAYS - 23 ? 1.8 : d === HISTORY_DAYS - 9 ? 2.1 : 1
    const n = Math.round(growth * weekly * spike * (0.85 + rand() * 0.3))

    for (let i = 0; i < n; i++) {
      const hour = pick(rand, hourWeights)
      const started_at = dayStart + hour * 3_600_000 + Math.floor(rand() * 3_600_000)
      if (started_at > now) continue

      let channel = pick(rand, CHANNELS)
      if (spike > 1 && chance(rand, 0.45)) channel = d === HISTORY_DAYS - 9 ? 'Organic Social' : 'Referral'
      const tr = traffic(rand, channel)
      if (spike > 1 && channel === 'Referral' && d !== HISTORY_DAYS - 9) {
        tr.source = 'producthunt.com'
        tr.referrer_domain = 'www.producthunt.com'
      }

      const returning = profiles.length > 50 && chance(rand, 0.22)
      const p = returning ? profiles[profiles.length - 1 - Math.floor(rand() * Math.min(profiles.length, 800))] : profile(rand)
      if (!returning) profiles.push(p)

      const mobile = p.device_type !== 'desktop'
      const engaged = chance(rand, (mobile ? 0.5 : 0.62) + (returning ? 0.1 : 0) + (channel === 'Invite link' ? 0.12 : 0))
      const pageviews = engaged && chance(rand, 0.18) ? 2 + Math.floor(rand() * 2) : 1
      const active_ms = Math.round(engaged ? logNormal(rand, 42_000, 0.8) : logNormal(rand, 3_500, 0.6))
      const max_scroll = engaged
        ? pick(rand, [[50, 15], [75, 25], [90, 25], [100, 35]] as const)
        : pick(rand, [[0, 40], [25, 45], [50, 15]] as const)
      const section = engaged
        ? Math.min(5, 1 + Math.floor(rand() * 5) + (max_scroll >= 90 ? 1 : 0))
        : max_scroll >= 25 ? 1 : 0

      const saw_form = chance(rand, 0.78)
      const startP = channel === 'Invite link' ? 0.26 : channel === 'Email' ? 0.2 : channel === 'Paid Social' ? 0.08 : 0.12
      const started = saw_form && engaged && chance(rand, startP * 1.6)
      const submitted = started && chance(rand, 0.72)
      const converted = submitted && chance(rand, 0.84)
      const error = submitted && !converted ? pick(rand, ERROR_REASONS) : started && chance(rand, 0.1) ? 'invalid_email' : null
      const shared = converted && chance(rand, 0.34)
      const placement = pick(rand, PLACEMENTS)

      const tabs: string[] = []
      const clicks: string[] = []
      const outbound: string[] = []
      if (section >= 3 && chance(rand, 0.45)) {
        const k = 1 + Math.floor(rand() * 3)
        for (let j = 0; j < k; j++) tabs.push(pick(rand, TABS))
      }
      if (engaged) {
        const k = Math.floor(rand() * 3)
        for (let j = 0; j < k; j++) clicks.push(pick(rand, CLICKS))
        if (chance(rand, 0.06)) outbound.push(pick(rand, OUTBOUND))
      }

      const entry = chance(rand, 0.985) ? '/' : pick(rand, [['/privacy/', 2], ['/terms/', 1]] as const)
      const exit = pageviews > 1 && chance(rand, 0.3) ? pick(rand, [['/privacy/', 2], ['/terms/', 1]] as const) : entry
      const is_internal = chance(rand, 0.012)

      const s: MockSession = {
        id: uuid(rand), visitor_id: p.id, started_at, active_ms, pageviews, max_scroll, section, engaged: engaged || converted,
        converted, is_internal, saw_form: saw_form || started, started, submitted, shared, error, placement, tabs, clicks, outbound,
        dims: {
          channel: tr.channel, source: tr.source, referrer_domain: tr.referrer_domain, utm_source: tr.utm_source,
          utm_medium: tr.utm_medium, utm_campaign: tr.utm_campaign, utm_term: tr.utm_term, utm_content: tr.utm_content,
          click_id: tr.click_id, country: p.country, region: p.region, city: p.city, device_type: p.device_type,
          browser: p.browser, os: p.os, language: p.language, timezone: p.timezone, screen: p.screen,
          entry_path: entry, exit_path: exit, is_new_visitor: returning ? 'false' : 'true', has_invite: tr.has_invite ? 'true' : 'false',
        },
      }
      sessions.push(s)

      if (converted && !is_internal) {
        let referred_by: string | null = null
        if (tr.has_invite && referrers.length > 0) {
          // A few enthusiastic referrers account for many invites.
          const pool = chance(rand, 0.35) ? referrers.slice(0, 12) : referrers
          referred_by = pool[Math.floor(rand() * pool.length)].code
        }
        // A few legacy phone signups remain from before the switch to email.
        const legacy = chance(rand, 0.03)
        const geo = GEOS.find((g) => g.country === p.country)
        const phone = legacy ? `${geo?.dial ?? '+1'}${geo?.dial === '+1' ? pick(rand, [['415', 3], ['212', 2], ['512', 1], ['206', 1], ['617', 1], ['647', 1]] as const) : ''}${String(Math.floor(1_000_000 + rand() * 8_999_999))}` : null
        const signup: MockSignup = {
          email: legacy ? null : email(rand), phone, code: code(rand), created_at: started_at + Math.round(active_ms * 0.7), placement,
          referred_by, network_hash: code(rand, 22), consent_version: legacy ? null : 'email-2026-09-30', session: s,
          unsubscribed_at: null, opened: false, shares: [], invite_visitors: 0, welcome: null,
        }
        signups.push(signup)
        if (chance(rand, 0.4)) referrers.push(signup)
      }
    }
  }

  // Two referrers whose invitees share networks (self-referral pattern).
  const shady = signups.filter((s) => s.referred_by === null).slice(-40, -38)
  for (const o of shady) {
    for (let j = 0; j < 4; j++) {
      const base = signups[signups.length - 1 - Math.floor(rand() * 200)]
      signups.push({
        ...base, email: email(rand), phone: null, consent_version: 'email-2026-09-30', code: code(rand),
        unsubscribed_at: null, opened: false, shares: [], invite_visitors: 0, welcome: null,
        created_at: Math.min(now - 60_000, o.created_at + (j + 1) * 3_600_000), referred_by: o.code,
        network_hash: j < 3 ? o.network_hash : code(rand, 22), placement: 'hero', session: null,
      })
    }
  }
  signups.sort((a, b) => a.created_at - b.created_at)

  // Referral loop, welcome emails and unsubscribes, from a separate stream so the
  // traffic above stays the same.
  const r2 = mulberry32(77)
  const invitees = countBy(signups.filter((x) => x.referred_by), (x) => x.referred_by ?? '')
  const welcomeSince = now - 21 * DAY
  for (const x of signups) {
    const n = invitees.get(x.code) ?? 0
    x.opened = n > 0 || chance(r2, 0.68)
    const shareCount = n > 0 ? 1 + Math.floor(r2() * 3) : x.opened && chance(r2, 0.4) ? 1 + Math.floor(r2() * 2) : 0
    x.shares = Array.from({ length: shareCount }, () => ({
      at: Math.min(now - 60_000, x.created_at + Math.floor(r2() * 2 * DAY)),
      channel: pick(r2, [['copy', 38], ['native', 26], ['whatsapp', 12], ['x', 10], ['sms', 9], ['email', 5]] as const),
    }))
    x.invite_visitors = shareCount ? n + Math.round(n * (0.8 + r2() * 2.5)) + Math.floor(r2() * 3) : n
    if (chance(r2, 0.018)) x.unsubscribed_at = Math.min(now - 60_000, x.created_at + Math.floor(r2() * 12 * DAY))
    if (x.email && x.created_at >= welcomeSince) {
      const status = pick(r2, [['sent', 94], ['failed', 3], ['skipped', 3]] as const)
      x.welcome = {
        status,
        detail: status === 'failed'
          ? pick(r2, [['Resend 422: The email address is invalid', 2], ['Resend 429: Rate limit exceeded', 1], ['Network timeout after 10s', 1]] as const)
          : status === 'skipped' ? 'welcome email disabled' : null,
      }
    }
  }

  return { sessions, signups }
}

// ---------------------------------------------------------------------------
// Aggregation (mirrors the SQL)
// ---------------------------------------------------------------------------

const r4 = (n: number) => Math.round(n * 10_000) / 10_000
const r1 = (n: number) => Math.round(n * 10) / 10

/** analytics.mask_contact */
function mask(s: { email: string | null; phone: string | null }) {
  if (s.email) return `${s.email[0]}•••@${s.email.split('@')[1]}`
  return `••• ••• ${(s.phone ?? '').slice(-4)}`
}

function localStamp(ms: number) {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function truncLocal(ms: number, bucket: Bucket) {
  const d = new Date(ms)
  d.setMinutes(0, 0, 0)
  if (bucket === 'hour') return d.getTime()
  d.setHours(0)
  if (bucket === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  if (bucket === 'month') d.setDate(1)
  return d.getTime()
}

function addBucket(ms: number, bucket: Bucket) {
  const d = new Date(ms)
  if (bucket === 'hour') d.setHours(d.getHours() + 1)
  else if (bucket === 'day') d.setDate(d.getDate() + 1)
  else if (bucket === 'week') d.setDate(d.getDate() + 7)
  else d.setMonth(d.getMonth() + 1)
  return d.getTime()
}

function countBy<T>(items: T[], key: (t: T) => string) {
  const m = new Map<string, number>()
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1)
  return m
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createMockApi(): AdminApi {
  const data = buildDataset()
  const settings: SettingValues = {
    waitlist_count_baseline: 6327,
    include_internal: false,
    signups_open: true,
    signups_closed_message: 'The waitlist is paused right now. Please check back soon.',
    blocked_email_domains: ['mailinator.com', 'example.com'],
    block_disposable_email: true,
    signup_limit_per_hour: 10,
    signup_limit_per_day: 40,
    welcome_email: {
      enabled: false,
      from_name: 'Open Swarm',
      from_email: '',
      reply_to: '',
      subject: 'You’re on the Open Swarm waitlist',
      body: 'Thanks for joining the Open Swarm waitlist. We’ll email you when early access opens.\n\nWant to move up? Invite 3 friends with your personal link and unlock priority access:\n{{invite_link}}\n\nThe Open Swarm team',
      postal_address: '',
    },
  }
  const dayStr = (daysAgo: number) => localStamp(Date.now() - daysAgo * DAY).slice(0, 10)
  let annotationId = 4
  const annotations: Annotation[] = [
    { id: 1, starts_on: dayStr(24), ends_on: null, title: 'Product Hunt launch', color: 'orange', created_by: 'kai@openswarm.com', created_at: new Date(Date.now() - 24 * DAY).toISOString() },
    { id: 2, starts_on: dayStr(9), ends_on: null, title: 'Viral X post', color: 'blue', created_by: 'alex@openswarm.com', created_at: new Date(Date.now() - 9 * DAY).toISOString() },
    { id: 3, starts_on: dayStr(40), ends_on: dayStr(34), title: 'Paid social test', color: 'purple', created_by: 'haik@openswarm.com', created_at: new Date(Date.now() - 40 * DAY).toISOString() },
    { id: 4, starts_on: dayStr(3), ends_on: null, title: 'Switched signup to email', color: 'green', created_by: 'eric@openswarm.com', created_at: new Date(Date.now() - 3 * DAY).toISOString() },
  ]
  const me = 'you@openswarm.com'
  const admins = [
    { email: 'alex@openswarm.com', added_at: '2026-09-28T16:02:11Z', added_by: 'migration' },
    { email: 'eric@openswarm.com', added_at: '2026-09-28T16:02:11Z', added_by: 'migration' },
    { email: 'haik@openswarm.com', added_at: '2026-09-28T16:02:11Z', added_by: 'migration' },
    { email: 'kai@openswarm.com', added_at: '2026-09-28T16:02:11Z', added_by: 'migration' },
    { email: me, added_at: '2026-09-29T10:14:55Z', added_by: 'kai@openswarm.com' },
  ]
  const audit: AuditEntry[] = [
    { at: new Date(Date.now() - 3 * 3_600_000).toISOString(), actor: 'kai@openswarm.com', action: 'export_signups', detail: { from: '2026-09-01T00:00:00Z', to: '2026-09-30T00:00:00Z', rows: 412 } },
    { at: new Date(Date.now() - 26 * 3_600_000).toISOString(), actor: 'alex@openswarm.com', action: 'reveal_contact', detail: { code: 'k3J9xQ2mTf8LwP0aZr5VbN7cYd1EhUo4' } },
    { at: new Date(Date.now() - 30 * 3_600_000).toISOString(), actor: 'kai@openswarm.com', action: 'add_admin', detail: { email: me } },
    { at: new Date(Date.now() - 50 * 3_600_000).toISOString(), actor: 'haik@openswarm.com', action: 'update_setting', detail: { key: 'waitlist_count_baseline', value: 6327 } },
  ]
  const fail = new URLSearchParams(window.location.search).get('mockerror') === '1'

  async function delay<T>(value: () => T, ms = 180 + Math.random() * 320, canFail = true): Promise<T> {
    await sleep(ms)
    if (fail && canFail) throw new ApiError('Mock failure (mockerror=1).', 'XX000')
    return value()
  }

  function audited(action: string, detail: Record<string, unknown>) {
    audit.unshift({ at: new Date().toISOString(), actor: me, action, detail })
  }

  function filtered(from: string, to: string, filters: Filters) {
    const a = Date.parse(from)
    const b = Date.parse(to)
    const entries = Object.entries(fromWire(filters)) as [Dimension, FilterClause][]
    return data.sessions.filter((s) => {
      if (s.started_at < a || s.started_at >= b) return false
      if (s.is_internal && !settings.include_internal) return false
      for (const [k, c] of entries) if (!matchesClause(s.dims[k], c)) return false
      return true
    })
  }

  function signupsIn(from: string, to: string) {
    const a = Date.parse(from)
    const b = Date.parse(to)
    return data.signups.filter((s) => s.created_at >= a && s.created_at < b)
  }

  function kpis(from: string, to: string, filters: Filters): Kpis {
    const s = filtered(from, to, filters)
    const ids = new Set(s.map((x) => x.id))
    const hasFilters = Object.keys(filters).length > 0
    const sig = signupsIn(from, to).filter((x) => !hasFilters || (x.session && ids.has(x.session.id)))
    const visitors = new Set(s.map((x) => x.visitor_id)).size
    const newVisitors = new Set(s.filter((x) => x.dims.is_new_visitor === 'true').map((x) => x.visitor_id)).size
    const converting = new Set(s.filter((x) => x.converted).map((x) => x.visitor_id)).size
    const pageviews = s.reduce((n, x) => n + x.pageviews, 0)
    const engaged = s.filter((x) => x.engaged).length
    return {
      visitors, new_visitors: newVisitors, returning_visitors: visitors - newVisitors, sessions: s.length, pageviews,
      engaged_sessions: engaged,
      bounce_rate: s.length ? r4(1 - engaged / s.length) : 0,
      avg_engagement_seconds: s.length ? r1(s.reduce((n, x) => n + x.active_ms, 0) / s.length / 1000) : 0,
      pages_per_session: s.length ? Math.round((pageviews / s.length) * 100) / 100 : 0,
      signups: sig.length, referred_signups: sig.filter((x) => x.referred_by).length,
      converting_visitors: converting, conversion_rate: visitors ? r4(converting / visitors) : 0,
    }
  }

  function eventWindow(q: RangeQuery) {
    return filtered(q.from, q.to, q.filters)
  }

  const api: AdminApi = {
    mode: 'mock',
    whoami: () => delay(() => ({ email: me, is_admin: true }), 120, false),

    overview: (q, compare) => delay((): Overview => {
      const len = Date.parse(q.to) - Date.parse(q.from)
      const cFrom = compare?.from ?? new Date(Date.parse(q.from) - len).toISOString()
      const cTo = compare?.to ?? q.from
      const last = data.signups.at(-1)
      const lastRef = [...data.signups].reverse().find((x) => x.referred_by)
      return {
        current: kpis(q.from, q.to, q.filters),
        previous: kpis(cFrom, cTo, q.filters),
        compare_from: cFrom,
        compare_to: cTo,
        all_time_signups: data.signups.length,
        display_count: settings.waitlist_count_baseline + data.signups.length,
        last_signup_at: last ? new Date(last.created_at).toISOString() : null,
        last_referral_at: lastRef ? new Date(lastRef.created_at).toISOString() : null,
      }
    }),

    timeseries: (q, bucket) => delay(() => {
      const s = filtered(q.from, q.to, q.filters)
      const ids = new Set(s.map((x) => x.id))
      const hasFilters = Object.keys(q.filters).length > 0
      const sig = signupsIn(q.from, q.to).filter((x) => !hasFilters || (x.session && ids.has(x.session.id)))
      const points = new Map<number, TimeseriesPoint & { v: Set<string> }>()
      const end = truncLocal(Date.parse(q.to) - 1, bucket)
      for (let t = truncLocal(Date.parse(q.from), bucket); t <= end; t = addBucket(t, bucket)) {
        points.set(t, { t: localStamp(t), visitors: 0, sessions: 0, pageviews: 0, engaged: 0, signups: 0, v: new Set() })
      }
      for (const x of s) {
        const p = points.get(truncLocal(x.started_at, bucket))
        if (!p) continue
        p.v.add(x.visitor_id)
        p.sessions++
        p.pageviews += x.pageviews
        if (x.engaged) p.engaged++
      }
      for (const x of sig) {
        const p = points.get(truncLocal(x.created_at, bucket))
        if (p) p.signups++
      }
      return [...points.values()].map(({ v, ...p }) => ({ ...p, visitors: v.size }))
    }),

    breakdown: (q, dimension, limit = 50) => delay(() => {
      const groups = new Map<string, typeof data.sessions>()
      for (const x of filtered(q.from, q.to, q.filters)) {
        const k = x.dims[dimension] ?? NONE
        const g = groups.get(k)
        if (g) g.push(x)
        else groups.set(k, [x])
      }
      const rows: BreakdownRow[] = [...groups.entries()].map(([value, g]) => {
        const visitors = new Set(g.map((x) => x.visitor_id)).size
        return {
          value, visitors, sessions: g.length, pageviews: g.reduce((n, x) => n + x.pageviews, 0),
          engaged_rate: r4(g.filter((x) => x.engaged).length / g.length),
          avg_engagement_seconds: r1(g.reduce((n, x) => n + x.active_ms, 0) / g.length / 1000),
          signups: g.filter((x) => x.converted).length,
          conversion_rate: r4(new Set(g.filter((x) => x.converted).map((x) => x.visitor_id)).size / visitors),
        }
      })
      rows.sort((a, b) => b.sessions - a.sessions || a.value.localeCompare(b.value))
      return rows.slice(0, Math.min(Math.max(limit, 1), 500))
    }),

    funnel: (q) => delay((): Funnel => {
      const s = eventWindow(q)
      const errors = countBy(s.filter((x) => x.error), (x) => x.error ?? '')
      const bySource = new Map<string, { submitted: number; joined: number }>()
      for (const x of s.filter((x) => x.submitted)) {
        const r = bySource.get(x.placement) ?? { submitted: 0, joined: 0 }
        r.submitted++
        if (x.converted) r.joined++
        bySource.set(x.placement, r)
      }
      return {
        steps: [
          { key: 'visited', label: 'Visited', sessions: s.length },
          { key: 'saw_form', label: 'Saw the signup form', sessions: s.filter((x) => x.saw_form).length },
          { key: 'started', label: 'Started entering a number', sessions: s.filter((x) => x.started).length },
          { key: 'submitted', label: 'Submitted', sessions: s.filter((x) => x.submitted).length },
          { key: 'joined', label: 'Joined (new signup)', sessions: s.filter((x) => x.converted).length },
          { key: 'shared', label: 'Shared an invite', sessions: s.filter((x) => x.shared).length },
        ],
        errors: [...errors.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
        by_source: [...bySource.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.submitted - a.submitted),
      }
    }),

    engagement: (q) => delay((): Engagement => {
      const s = eventWindow(q)
      const n = Math.max(s.length, 1)
      const agg = (key: (x: MockSession) => string[]) => {
        const m = new Map<string, { count: number; sessions: Set<string> }>()
        for (const x of s) for (const k of key(x)) {
          const r = m.get(k) ?? { count: 0, sessions: new Set<string>() }
          r.count++
          r.sessions.add(x.id)
          m.set(k, r)
        }
        return [...m.entries()].map(([k, v]) => ({ k, count: v.count, sessions: v.sessions.size })).sort((a, b) => b.count - a.count)
      }
      const pv = s.reduce((t, x) => t + x.pageviews, 0)
      const sessionsWith = (f: (x: MockSession) => boolean) => s.filter(f).length
      const events = [
        { name: 'pageview', count: pv, sessions: s.length },
        { name: 'engagement', count: Math.round(s.length * 1.9), sessions: s.length },
        { name: 'scroll', count: s.reduce((t, x) => t + Math.floor(x.max_scroll / 25), 0), sessions: sessionsWith((x) => x.max_scroll > 0) },
        { name: 'section_view', count: s.reduce((t, x) => t + x.section + 1, 0), sessions: s.length },
        { name: 'vital', count: Math.round(s.length * 3.6), sessions: Math.round(s.length * 0.93) },
        { name: 'waitlist_view', count: sessionsWith((x) => x.saw_form), sessions: sessionsWith((x) => x.saw_form) },
        { name: 'click', count: s.reduce((t, x) => t + x.clicks.length, 0), sessions: sessionsWith((x) => x.clicks.length > 0) },
        { name: 'tab', count: s.reduce((t, x) => t + x.tabs.length, 0), sessions: sessionsWith((x) => x.tabs.length > 0) },
        { name: 'waitlist_start', count: sessionsWith((x) => x.started), sessions: sessionsWith((x) => x.started) },
        { name: 'waitlist_submit', count: sessionsWith((x) => x.submitted), sessions: sessionsWith((x) => x.submitted) },
        { name: 'waitlist_success', count: sessionsWith((x) => x.converted), sessions: sessionsWith((x) => x.converted) },
        { name: 'referral_open', count: sessionsWith((x) => x.converted), sessions: sessionsWith((x) => x.converted) },
        { name: 'referral_copy', count: sessionsWith((x) => x.shared), sessions: sessionsWith((x) => x.shared) },
        { name: 'waitlist_error', count: sessionsWith((x) => x.error !== null), sessions: sessionsWith((x) => x.error !== null) },
        { name: 'outbound', count: s.reduce((t, x) => t + x.outbound.length, 0), sessions: sessionsWith((x) => x.outbound.length > 0) },
        { name: 'error', count: Math.round(s.length * 0.011), sessions: Math.round(s.length * 0.009) },
      ].filter((e) => e.count > 0).sort((a, b) => b.count - a.count)
      return {
        total_sessions: s.length,
        sections: SECTIONS.map((section, i) => {
          const c = s.filter((x) => x.section >= i).length
          return { section, ord: i + 1, sessions: c, rate: r4(c / n) }
        }),
        scroll: [25, 50, 75, 90, 100].map((depth) => {
          const c = s.filter((x) => x.max_scroll >= depth).length
          return { depth, sessions: c, rate: r4(c / n) }
        }),
        tabs: agg((x) => x.tabs).map(({ k, ...v }) => ({ tab: k, ...v })),
        clicks: agg((x) => x.clicks).map(({ k, ...v }) => ({ target: k, ...v })),
        outbound: agg((x) => x.outbound).map(({ k, ...v }) => ({ href: k, ...v })),
        events,
      }
    }),

    realtime: () => delay((): Realtime => {
      const midnight = new Date()
      midnight.setHours(0, 0, 0, 0)
      const now = Date.now()
      const minute = Math.floor(now / 60_000)
      const rand = mulberry32(minute)
      const pool = data.sessions.slice(-600)
      const per_minute = Array.from({ length: 30 }, (_, i) => {
        const t = (minute - 29 + i) * 60_000
        const wobble = mulberry32(minute - 29 + i)()
        return { t: new Date(t).toISOString(), visitors: Math.max(0, Math.round(6 + 5 * Math.sin((minute - 29 + i) / 5) + wobble * 6)) }
      })
      const activeN = 8 + Math.floor(rand() * 14)
      const active = Array.from({ length: activeN }, () => pool[Math.floor(rand() * pool.length)])
      const tally = (key: (x: MockSession) => string) =>
        [...countBy(active, key).entries()].map(([k, v]) => ({ k, visitors: v })).sort((a, b) => b.visitors - a.visitors)
      const names = [['pageview', 30], ['section_view', 28], ['scroll', 18], ['click', 12], ['tab', 6], ['waitlist_view', 10], ['waitlist_start', 4], ['waitlist_submit', 2], ['waitlist_success', 2], ['referral_copy', 1], ['outbound', 2]] as const
      const recent: RealtimeEvent[] = Array.from({ length: 40 }, () => {
        const x = active[Math.floor(rand() * active.length)]
        const name = pick(rand, names)
        const props: Record<string, unknown> = {}
        if (name === 'section_view') props.section = SECTIONS[Math.floor(rand() * SECTIONS.length)]
        if (name === 'scroll') props.depth = pick(rand, [[25, 1], [50, 1], [75, 1], [100, 1]] as const)
        if (name === 'click') props.target = pick(rand, CLICKS)
        if (name === 'tab') { const [group, tab] = pick(rand, TABS).split(': '); props.group = group; props.tab = tab }
        if (name.startsWith('waitlist')) props.placement = x.placement
        if (name === 'waitlist_success') props.added = true
        if (name === 'outbound') props.href = pick(rand, OUTBOUND)
        return {
          occurred_at: new Date(now - Math.floor(rand() * 30 * 60_000)).toISOString(), name, path: '/', props,
          country: x.dims.country, city: x.dims.city, device_type: x.dims.device_type, browser: x.dims.browser, source: x.dims.source ?? '(direct)',
        }
      }).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      return {
        active_visitors: activeN,
        active_sessions: activeN + Math.floor(rand() * 3),
        per_minute,
        countries: tally((x) => x.dims.country ?? NONE).map(({ k, visitors }) => ({ country: k, visitors })),
        sources: tally((x) => x.dims.source ?? NONE).map(({ k, visitors }) => ({ source: k, visitors })),
        devices: tally((x) => x.dims.device_type ?? NONE).map(({ k, visitors }) => ({ device_type: k, visitors })),
        sections: tally((x) => SECTIONS[Math.min(5, Math.floor(rand() * (x.section + 1)))]).map(({ k, visitors }) => ({ section: k, visitors })),
        today: {
          since: midnight.toISOString(),
          signups: data.signups.filter((x) => x.created_at >= midnight.getTime()).length,
          referred_signups: data.signups.filter((x) => x.created_at >= midnight.getTime() && x.referred_by).length,
          visitors: new Set(data.sessions.filter((x) => x.started_at >= midnight.getTime() && !x.is_internal).map((x) => x.visitor_id)).size,
        },
        recent,
      }
    }, 250),

    signups: (r, search, limit, offset) => delay(() => {
      const q = search.trim()
      const digits = q.replace(/\D/g, '')
      const rows = signupsIn(r.from, r.to).filter((s) => {
        if (!q) return true
        const d = s.session?.dims
        const has = (v: string | null | undefined) => !!v && v.toLowerCase().includes(q.toLowerCase())
        return has(s.email) || (digits.length >= 3 && !!s.phone?.includes(digits)) || has(s.placement) || has(d?.utm_campaign) || has(d?.utm_source) ||
          (d?.country ?? '').toLowerCase() === q.toLowerCase() || s.code === q
      }).reverse()
      return { total: rows.length, rows: rows.slice(offset, offset + limit).map((s) => toRow(s)) }
    }),

    revealContact: (c) => delay(() => {
      const s = data.signups.find((x) => x.code === c)
      if (!s) throw new ApiError('Signup not found.', 'P0002')
      audited('reveal_contact', { code: c })
      return s.email ?? s.phone ?? ''
    }),

    exportSignups: (r) => delay((): ExportRow[] => {
      const rows = signupsIn(r.from, r.to).map((s) => {
        const d = s.session?.dims
        return {
          email: s.email, phone: s.phone, created_at: new Date(s.created_at).toISOString(), placement: s.placement, referral_code: s.code,
          referred_by: s.referred_by, consent_version: s.consent_version, consented_at: s.consent_version ? new Date(s.created_at).toISOString() : null,
          invites: invitesOf(s), channel: d?.channel ?? null, traffic_source: d?.source ?? null, utm_source: d?.utm_source ?? null,
          utm_medium: d?.utm_medium ?? null, utm_campaign: d?.utm_campaign ?? null, utm_term: d?.utm_term ?? null,
          utm_content: d?.utm_content ?? null, referrer_domain: d?.referrer_domain ?? null, landing_path: d?.entry_path ?? null,
          country: d?.country ?? null, region: d?.region ?? null, city: d?.city ?? null, device_type: d?.device_type ?? null,
          browser: d?.browser ?? null, os: d?.os ?? null, seconds_to_signup: s.session ? Math.round((s.created_at - s.session.started_at) / 1000) : null,
          sessions_before: s.session ? 1 : null,
        }
      })
      audited('export_signups', { from: r.from, to: r.to, rows: rows.length })
      return rows
    }, 600),

    deleteSignup: (c) => delay(() => {
      const i = data.signups.findIndex((x) => x.code === c)
      if (i < 0) throw new ApiError('Signup not found.', 'P0002')
      const [s] = data.signups.splice(i, 1)
      for (const o of data.signups) if (o.referred_by === c) o.referred_by = null
      if (s.session) {
        const vid = s.session.visitor_id
        data.sessions = data.sessions.filter((x) => x.visitor_id !== vid)
      }
      audited('delete_signup', { code: c, masked: mask(s) })
    }),

    referrals: (r) => delay((): Referrals => {
      const a = Date.parse(r.from)
      const b = Date.parse(r.to)
      const byCode = new Map<string, MockSignup[]>()
      for (const s of data.signups) if (s.referred_by) {
        const l = byCode.get(s.referred_by) ?? []
        l.push(s)
        byCode.set(s.referred_by, l)
      }
      const period = signupsIn(r.from, r.to)
      const referred = period.filter((s) => s.referred_by)
      const inv = data.signups.map((o) => {
        const list = byCode.get(o.code) ?? []
        return { o, invites: list.length, inRange: list.filter((i) => i.created_at >= a && i.created_at < b).length, list }
      })
      const dist = [0, 0, 0, 0]
      for (const x of inv) dist[Math.min(x.invites, 3)]++
      // Cohort: people who joined in the range, and everyone they have brought in since.
      const cohort = period.map((o) => ({ o, invitees: (byCode.get(o.code) ?? []).length }))
      const size = cohort.length
      const cohortInvitees = cohort.reduce((t, x) => t + x.invitees, 0)
      const referrersN = cohort.filter((x) => x.invitees > 0).length
      const visitors = cohort.reduce((t, x) => t + x.o.invite_visitors, 0)
      const shares = data.signups.flatMap((x) => x.shares).filter((x) => x.at >= a && x.at < b)
      const byDay = new Map<string, number>()
      for (const x of shares) {
        const k = `${localStamp(x.at).slice(0, 10)}|${x.channel}`
        byDay.set(k, (byDay.get(k) ?? 0) + 1)
      }
      const share = period.length ? r4(referred.length / period.length) : 0
      return {
        signups: period.length,
        referred_signups: referred.length,
        referred_share: share,
        k_factor: share,
        classic_k: size ? r4(cohortInvitees / size) : 0,
        invite_visits_per_signup: size ? r4(visitors / size) : 0,
        invite_conversion: visitors ? r4(Math.min(1, cohortInvitees / visitors)) : 0,
        referral_rate: size ? r4(referrersN / size) : 0,
        invites_per_active_referrer: referrersN ? Math.round((cohortInvitees / referrersN) * 100) / 100 : 0,
        loop_funnel: [
          { key: 'joined', label: 'Joined in this range', people: size },
          { key: 'opened', label: 'Opened their invite card', people: cohort.filter((x) => x.o.opened).length },
          { key: 'shared', label: 'Shared or copied their link', people: cohort.filter((x) => x.o.shares.length > 0).length },
          { key: 'visited', label: 'Link brought a visitor', people: cohort.filter((x) => x.o.invite_visitors > 0).length },
          { key: 'converted', label: 'Brought at least one signup', people: referrersN },
          { key: 'priority', label: 'Unlocked priority (3+)', people: cohort.filter((x) => x.invitees >= 3).length },
        ],
        shares_by_channel: [...countBy(shares, (x) => x.channel).entries()].map(([channel, n]) => ({ channel, shares: n })).sort((p, q) => q.shares - p.shares),
        shares_by_day: [...byDay.entries()].map(([k, n]) => {
          const [day, channel] = k.split('|')
          return { day, channel, shares: n }
        }).sort((p, q) => p.day.localeCompare(q.day) || p.channel.localeCompare(q.channel)),
        active_referrers: new Set(referred.map((s) => s.referred_by)).size,
        priority_unlocked: inv.filter((x) => x.invites >= 3).length,
        distribution: (['0', '1', '2', '3+'] as const).map((bucket, i) => ({ bucket, people: dist[i] })),
        leaderboard: inv.filter((x) => x.invites > 0).sort((p, q) => q.invites - p.invites || p.o.created_at - q.o.created_at).slice(0, 25).map((x) => ({
          code: x.o.code, contact_masked: mask(x.o), joined_at: new Date(x.o.created_at).toISOString(), invites: x.invites,
          invites_in_range: x.inRange, priority: x.invites >= 3, channel: x.o.session?.dims.channel ?? null, country: x.o.session?.dims.country ?? null,
        })),
        suspicious: inv.map((x) => ({
          code: x.o.code, contact_masked: mask(x.o), invites: x.invites,
          shared: x.list.filter((i) => i.network_hash === x.o.network_hash || x.list.some((j) => j !== i && j.network_hash === i.network_hash)).length,
        })).filter((x) => x.shared >= 2).sort((p, q) => q.shared - p.shared).slice(0, 25),
      }
    }),

    performance: (q) => delay((): Performance => {
      const s = eventWindow(q)
      const devices = countBy(s, (x) => x.dims.device_type ?? NONE)
      const spec: Record<string, { base: Record<string, number>; good: number; poor: number }> = {
        CLS: { base: { desktop: 0.04, mobile: 0.11, tablet: 0.07 }, good: 0.1, poor: 0.25 },
        FCP: { base: { desktop: 1080, mobile: 1920, tablet: 1500 }, good: 1800, poor: 3000 },
        INP: { base: { desktop: 112, mobile: 248, tablet: 176 }, good: 200, poor: 500 },
        LCP: { base: { desktop: 1640, mobile: 2860, tablet: 2240 }, good: 2500, poor: 4000 },
        TTFB: { base: { desktop: 380, mobile: 640, tablet: 520 }, good: 800, poor: 1800 },
      }
      const vitals: VitalRow[] = []
      for (const [metric, m] of Object.entries(spec)) {
        const rows: VitalRow[] = []
        for (const [device, n] of [...devices.entries()].sort()) {
          const p75 = m.base[device] ?? m.base.desktop
          const ratio = p75 / m.good
          const good = Math.max(0.3, Math.min(0.95, 1.18 - ratio * 0.55))
          const poor = Math.max(0.01, Math.min(0.3, (ratio - 0.6) * 0.14))
          const samples = Math.round(n * (metric === 'INP' ? 0.55 : 0.92))
          rows.push({ metric, device_type: device, samples, p75: metric === 'CLS' ? p75 : Math.round(p75), good: r4(good), needs_improvement: r4(1 - good - poor), poor: r4(poor) })
        }
        const total = rows.reduce((t, x) => t + x.samples, 0) || 1
        const w = (k: 'p75' | 'good' | 'poor') => rows.reduce((t, x) => t + x[k] * x.samples, 0) / total
        if (rows.length) {
          const good = r4(w('good'))
          const poor = r4(w('poor'))
          vitals.push({ metric, device_type: null, samples: total, p75: metric === 'CLS' ? Math.round(w('p75') * 1000) / 1000 : Math.round(w('p75')), good, needs_improvement: r4(1 - good - poor), poor })
        }
        vitals.push(...rows)
      }
      const scale = s.length / 1000
      const errs = [
        ['ResizeObserver loop completed with undelivered notifications.', 'window.onerror', 3.1],
        ["Cannot read properties of null (reading 'getBoundingClientRect')", '/assets/index.js:1:48211', 1.4],
        ['Failed to fetch', 'unhandledrejection', 0.9],
        ['Script error.', null, 0.5],
        ['Load failed', 'unhandledrejection', 0.35],
      ] as const
      return {
        vitals,
        errors: errs.map(([message, source, rate], i) => ({
          message, source, count: Math.round(rate * scale * 2), sessions: Math.round(rate * scale * 1.6),
          last_seen: new Date(Math.min(Date.now(), Date.parse(q.to)) - (i + 1) * 3_700_000).toISOString(),
        })).filter((e) => e.count > 0),
      }
    }),

    settings: () => delay((): AdminSettings => ({
      me, admins: [...admins].sort((a, b) => a.email.localeCompare(b.email)), settings: { ...settings },
      display_count: settings.waitlist_count_baseline + data.signups.length, audit: audit.slice(0, 50),
    })),

    updateSetting: (key, value) => delay(() => {
      // Mirrors admin_update_setting's validation.
      const bad = (m: string) => new ApiError(m, '22023')
      const v: unknown = value
      switch (key) {
        case 'waitlist_count_baseline':
        case 'signup_limit_per_hour':
        case 'signup_limit_per_day':
          if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw bad(`${key} must be a whole number.`)
          if (key !== 'waitlist_count_baseline' && (v < 1 || v > 10000)) throw bad('Signup limits must be between 1 and 10000.')
          break
        case 'include_internal':
        case 'signups_open':
        case 'block_disposable_email':
          if (typeof v !== 'boolean') throw bad(`${key} must be true or false.`)
          break
        case 'signups_closed_message':
          if (typeof v !== 'string' || v.trim().length < 1 || v.trim().length > 200) throw bad('The closed message must be 1 to 200 characters.')
          break
        case 'blocked_email_domains':
          if (!Array.isArray(v) || v.length > 500 || v.some((d) => typeof d !== 'string' || !DOMAIN_RE.test(d))) throw bad('Blocked domains must be up to 500 lowercase domain names, such as example.com.')
          break
        case 'welcome_email': {
          const w = v as WelcomeEmail
          if (w.enabled && (!w.from_email || !w.postal_address.trim())) throw bad('Set a from address and a postal address before turning the welcome email on.')
          break
        }
        default:
          throw bad(`Unknown setting: ${String(key)}`)
      }
      ;(settings as unknown as Record<string, unknown>)[key] = structuredClone(v)
      audited('update_setting', { key, value: v })
    }),

    removeAdmin: (email) => delay(() => {
      const e = email.trim().toLowerCase()
      if (e === me) throw new ApiError('You cannot remove your own access.', '22023')
      const i = admins.findIndex((a) => a.email === e)
      if (i >= 0) admins.splice(i, 1)
      audited('remove_admin', { email: e })
    }),

    inviteAdmin: (email) => delay(() => {
      const e = email.trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new ApiError('Enter a valid email address.', '400')
      if (!admins.some((a) => a.email === e)) admins.push({ email: e, added_at: new Date().toISOString(), added_by: me })
      audited('add_admin', { email: e })
    }, 700),

    testEmail: (w) => delay(() => {
      if (new URLSearchParams(window.location.search).get('mockresend') === '0') {
        throw new ApiError('Email sending is not configured: set SMTP_HOST, SMTP_USER and SMTP_PASSWORD, or RESEND_API_KEY.', '503')
      }
      if (!w.from_email) throw new ApiError('Set a from address first.', '400')
    }, 900),

    annotations: (r) => delay(() => {
      const from = localStamp(Date.parse(r.from)).slice(0, 10)
      const to = localStamp(Date.parse(r.to)).slice(0, 10)
      return annotations.filter((x) => x.starts_on <= to && (x.ends_on ?? x.starts_on) >= from).sort((x, y) => x.starts_on.localeCompare(y.starts_on))
    }),

    addAnnotation: (x) => delay(() => {
      const title = x.title.trim()
      if (title.length < 1 || title.length > 60) throw new ApiError('Titles are 1 to 60 characters.', '23514')
      if (x.ends_on && x.ends_on < x.starts_on) throw new ApiError('The end date must be on or after the start date.', '23514')
      const id = ++annotationId
      annotations.push({ id, ...x, title, created_by: me, created_at: new Date().toISOString() })
      audited('add_annotation', { id, title })
      return id
    }),

    deleteAnnotation: (id) => delay(() => {
      const i = annotations.findIndex((x) => x.id === id)
      if (i >= 0) annotations.splice(i, 1)
      audited('delete_annotation', { id })
    }),

    emailReport: (r) => delay((): EmailReport => {
      const a = Date.parse(r.from)
      const b = Date.parse(r.to)
      const inRange = signupsIn(r.from, r.to)
      const welcome = inRange.filter((x) => x.welcome)
      return {
        welcome: {
          sent: welcome.filter((x) => x.welcome?.status === 'sent').length,
          failed: welcome.filter((x) => x.welcome?.status === 'failed').length,
          skipped: welcome.filter((x) => x.welcome?.status === 'skipped').length,
        },
        recent_failures: welcome.filter((x) => x.welcome?.status === 'failed').reverse().slice(0, 20)
          .map((x) => ({ created_at: new Date(x.created_at + 4000).toISOString(), kind: 'welcome' as const, detail: x.welcome?.detail ?? null })),
        unsubscribed: data.signups.filter((x) => x.unsubscribed_at !== null && x.unsubscribed_at >= a && x.unsubscribed_at < b).length,
        unsubscribed_all_time: data.signups.filter((x) => x.unsubscribed_at !== null).length,
        domains: [...countBy(inRange.filter((x) => x.email), (x) => x.email!.split('@')[1]).entries()]
          .map(([domain, signups]) => ({ domain, signups }))
          .sort((x, y) => y.signups - x.signups || x.domain.localeCompare(y.domain))
          .slice(0, 25),
      }
    }),
  }

  function invitesOf(s: MockSignup) {
    return data.signups.filter((i) => i.referred_by === s.code && i.code !== s.code).length
  }

  function toRow(s: MockSignup): SignupRow {
    const d = s.session?.dims
    return {
      code: s.code, contact_masked: mask(s), contact_type: s.email ? 'email' : 'phone', created_at: new Date(s.created_at).toISOString(), placement: s.placement,
      was_invited: s.referred_by !== null, invites: invitesOf(s), channel: d?.channel ?? null, traffic_source: d?.source ?? null,
      utm_source: d?.utm_source ?? null, utm_medium: d?.utm_medium ?? null, utm_campaign: d?.utm_campaign ?? null,
      referrer_domain: d?.referrer_domain ?? null, country: d?.country ?? null, region: d?.region ?? null, city: d?.city ?? null,
      device_type: d?.device_type ?? null, browser: d?.browser ?? null, os: d?.os ?? null,
      seconds_to_signup: s.session ? Math.round((s.created_at - s.session.started_at) / 1000) : null,
      sessions_before: s.session ? (s.session.dims.is_new_visitor === 'true' ? 1 : 2) : null,
      consent_version: s.consent_version, consented_at: s.consent_version ? new Date(s.created_at).toISOString() : null,
    }
  }

  return api
}
