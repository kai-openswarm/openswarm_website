import type { Pool } from 'pg'
import { createDeliveryTransport, type EmailDeliveryConfig } from './email-delivery.ts'
import { createEmailOutbox, type EmailKind, type EmailPayload } from './email-outbox.ts'
import { trackingUrls, type TrackedEmail } from './email-tracking.ts'
import { unsubscribeUrl } from './email-unsubscribe.ts'
import type { SignupConfig } from './signup-config.ts'
import { renderWaitlistEmail } from './waitlist-email.ts'

type Send = (payload: EmailPayload, idempotencyKey: string) => Promise<{ id: string }>

/** Which emails a new signup should queue: sending must be possible and switched on in the dashboard. */
export function emailEvents(config: SignupConfig, deliveryReady: boolean) {
  return {
    welcome: deliveryReady && config.welcome_email.enabled && !!config.welcome_email.from_email,
    priority: deliveryReady && config.priority_email.enabled && !!config.welcome_email.from_email,
  }
}

/** One exact provider payload: Alex's branded template, the dashboard's sender and subject, signed opt-out. */
export function renderWaitlistPayload(
  kind: EmailKind,
  referralCode: string,
  to: string,
  config: SignupConfig,
  delivery: Pick<EmailDeliveryConfig, 'publicUrl' | 'secret'>,
  subjectPrefix = '',
  /** Measure opens and button clicks for this email. Previews are not tracked. */
  track?: TrackedEmail,
): EmailPayload {
  const sender = config.welcome_email
  if (!sender.from_email) throw new Error('No sender address is configured.')
  const optOut = unsubscribeUrl(delivery.publicUrl, referralCode, delivery.secret)
  const rendered = renderWaitlistEmail({
    kind, referralCode, publicUrl: delivery.publicUrl, unsubscribeUrl: optOut,
    postalAddress: sender.postal_address || undefined,
    ...(track ? { tracking: trackingUrls(delivery.publicUrl, track, delivery.secret) } : {}),
  })
  const subject = (kind === 'priority' ? config.priority_email.subject : sender.subject).trim() || rendered.subject
  const name = sender.from_name.replace(/[<>"\r\n]/g, '').trim()
  return {
    from: name ? `${name} <${sender.from_email}>` : sender.from_email,
    to: [to],
    ...(sender.reply_to ? { reply_to: sender.reply_to } : {}),
    subject: `${subjectPrefix}${subject}`,
    html: rendered.html,
    text: rendered.text,
    headers: { 'List-Unsubscribe': `<${optOut}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  }
}

/** Queue draining and one-off sends: SMTP first, Resend as the backup. */
export function createWaitlistMailer(options: {
  database: Pick<Pool, 'query' | 'connect'>
  delivery: EmailDeliveryConfig
  config: () => Promise<SignupConfig>
  send?: Send
}) {
  const send = options.send ?? createDeliveryTransport(options.delivery)
  const outbox = createEmailOutbox(options.database)
  return {
    drain: (limit: number) => outbox.drain({
      limit,
      async render(message) {
        return renderWaitlistPayload(message.kind, message.referralCode, message.email, await options.config(), options.delivery, '',
          { kind: message.kind, jobId: message.id, referralCode: message.referralCode })
      },
      send,
    }),
    unsubscribe: (code: string) => outbox.unsubscribe(code),
    /** Sends a test copy to an admin. The config may be unsaved form values. */
    sendTest: (kind: EmailKind, referralCode: string, to: string, config: SignupConfig) =>
      send(renderWaitlistPayload(kind, referralCode, to, config, options.delivery, '[Test] ', { kind: 'test', jobId: null, referralCode }),
        `test/${kind}/${Date.now()}`),
    preview: (kind: EmailKind, referralCode: string, to: string, config: SignupConfig) =>
      renderWaitlistPayload(kind, referralCode, to, config, options.delivery),
  }
}
