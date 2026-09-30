import { isDisposableEmailDomain } from 'disposable-email-domains-js'

/** Email signup settings edited in the admin dashboard (analytics.settings). */
/** The welcome email's settings; the sender, reply-to and postal address apply to every waitlist email. */
export type WelcomeEmail = {
  enabled: boolean
  from_name: string
  from_email: string
  reply_to: string
  subject: string
  /** Unused since the branded templates in waitlist-email.ts; kept so older settings still validate. */
  body: string
  postal_address: string
}

/** Sent once when a person's third friend joins. Uses the welcome email's sender settings. */
export type PriorityEmail = {
  enabled: boolean
  subject: string
}

export type SignupConfig = {
  signups_open: boolean
  signups_closed_message: string
  blocked_email_domains: string[]
  block_disposable_email: boolean
  signup_limit_per_hour: number
  signup_limit_per_day: number
  welcome_email: WelcomeEmail
  priority_email: PriorityEmail
}

export const DEFAULT_SIGNUP_CONFIG: SignupConfig = {
  signups_open: true,
  signups_closed_message: 'The waitlist is paused right now. Please check back soon.',
  blocked_email_domains: [],
  block_disposable_email: true,
  signup_limit_per_hour: 10,
  signup_limit_per_day: 40,
  welcome_email: {
    enabled: false,
    from_name: 'Open Swarm',
    from_email: '',
    reply_to: '',
    subject: 'You’re on the Open Swarm waitlist',
    body: 'Thanks for joining the Open Swarm waitlist.\n\n{{invite_link}}',
    postal_address: '',
  },
  priority_email: {
    enabled: false,
    subject: 'You’ve unlocked priority early access',
  },
}

const text = (value: unknown, fallback: string) => typeof value === 'string' ? value : fallback
const positive = (value: unknown, fallback: number) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback

/** Tolerates missing or malformed rows: every field falls back to its default. */
export function parseSignupConfig(raw: unknown): SignupConfig {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const welcome = row.welcome_email && typeof row.welcome_email === 'object' ? row.welcome_email as Record<string, unknown> : {}
  const priority = row.priority_email && typeof row.priority_email === 'object' ? row.priority_email as Record<string, unknown> : {}
  const defaults = DEFAULT_SIGNUP_CONFIG
  return {
    signups_open: typeof row.signups_open === 'boolean' ? row.signups_open : defaults.signups_open,
    signups_closed_message: text(row.signups_closed_message, defaults.signups_closed_message).slice(0, 200) || defaults.signups_closed_message,
    blocked_email_domains: Array.isArray(row.blocked_email_domains)
      ? row.blocked_email_domains.filter((domain): domain is string => typeof domain === 'string').map((domain) => domain.toLowerCase())
      : defaults.blocked_email_domains,
    block_disposable_email: typeof row.block_disposable_email === 'boolean' ? row.block_disposable_email : defaults.block_disposable_email,
    signup_limit_per_hour: positive(row.signup_limit_per_hour, defaults.signup_limit_per_hour),
    signup_limit_per_day: positive(row.signup_limit_per_day, defaults.signup_limit_per_day),
    welcome_email: {
      enabled: welcome.enabled === true,
      from_name: text(welcome.from_name, defaults.welcome_email.from_name),
      from_email: text(welcome.from_email, ''),
      reply_to: text(welcome.reply_to, ''),
      subject: text(welcome.subject, defaults.welcome_email.subject),
      body: text(welcome.body, defaults.welcome_email.body),
      postal_address: text(welcome.postal_address, ''),
    },
    priority_email: {
      enabled: priority.enabled === true,
      subject: text(priority.subject, defaults.priority_email.subject) || defaults.priority_email.subject,
    },
  }
}

/** A blocked domain also blocks its subdomains (blocking example.com blocks mail.example.com). */
export function emailDomainRejected(email: string, config: SignupConfig): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase()
  const parents = domain.split('.').map((_, index, parts) => parts.slice(index).join('.')).slice(0, -1)
  if (parents.some((candidate) => config.blocked_email_domains.includes(candidate))) return true
  return config.block_disposable_email && parents.some((candidate) => isDisposableEmailDomain(candidate))
}

/** Reads settings at most every 30 seconds per function instance. Failures use the last good copy or the defaults. */
export function cachedSignupConfig(load: () => Promise<unknown>, ttlMs = 30_000) {
  let cached: { at: number, config: SignupConfig } | null = null
  return async (): Promise<SignupConfig> => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.config
    try {
      cached = { at: Date.now(), config: parseSignupConfig(await load()) }
      return cached.config
    } catch {
      return cached?.config ?? DEFAULT_SIGNUP_CONFIG
    }
  }
}
