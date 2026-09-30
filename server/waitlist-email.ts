/** Original, email-client-safe Open Swarm templates. No browser code or live recipient data. */
export type WaitlistEmailKind = 'welcome' | 'priority'
export type WaitlistEmailOptions = {
  kind: WaitlistEmailKind
  referralCode: string
  publicUrl: string
  unsubscribeUrl: string
  postalAddress?: string
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!)

function httpsUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Email links require a public HTTPS URL.')
  return url
}

export function renderWaitlistEmail(options: WaitlistEmailOptions): { subject: string; html: string; text: string } {
  if (!['welcome', 'priority'].includes(options.kind) || !/^[A-Za-z0-9_-]{32}$/.test(options.referralCode)) {
    throw new Error('Invalid waitlist email event.')
  }
  const site = httpsUrl(options.publicUrl)
  site.search = ''
  site.hash = ''
  if (!site.pathname.endsWith('/')) site.pathname += '/'
  const unsubscribe = httpsUrl(options.unsubscribeUrl)
  if (unsubscribe.origin !== site.origin) throw new Error('Unsubscribe must use the configured site origin.')
  const invite = new URL(site)
  invite.searchParams.set('ref', options.referralCode)
  const product = new URL('#product', site).href
  const logo = new URL('media/logo-256.png', site).href
  const artwork = new URL('media/email/invitations.jpg', site).href
  const priority = options.kind === 'priority'
  const subject = priority ? 'You’ve unlocked priority early access' : 'You’re on the Open Swarm waitlist'
  const preheader = priority ? 'Three friends joined. Your priority status is saved.' : 'Your spot is saved. A little head start is yours to share.'
  const headline = priority ? 'You’ve unlocked priority.' : 'You’re on the list.'
  const opening = priority
    ? 'Three friends joined through your link. You’ve unlocked priority early access to Open Swarm.'
    : 'Thanks for joining Open Swarm. Your spot is saved, and we’ll email you when early access opens.'
  const next = priority
    ? 'Thanks for bringing good people along. We’ll email you when your invitation is ready.'
    : 'We’re building one desktop for your agents, your apps, and the things you want to get done.'
  const referral = 'Know someone who’d like Open Swarm? When 3 friends join through your link, you’ll unlock priority early access.'
  const shareMessage = `I joined the Open Swarm waitlist, an AI desktop where agents work together. Thought you might like it too.\n\nJoin me: ${invite.href}`
  const action = priority ? product : `mailto:?subject=${encodeURIComponent('Join me on Open Swarm')}&body=${encodeURIComponent(shareMessage)}`
  const actionLabel = priority ? 'Explore Open Swarm' : 'Share your invite'
  const font = "'Helvetica Neue','Segoe UI',Helvetica,Arial,sans-serif"
  const button = `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td class="button-cell" bgcolor="#292b27" style="background-color:#292b27;border-radius:6px;text-align:center;"><a class="button" href="${escapeHtml(action)}" style="display:inline-block;border:12px solid #292b27;border-left-width:20px;border-right-width:20px;border-radius:6px;background-color:#292b27;color:#ffffff;font-family:${font};font-size:14px;line-height:20px;font-weight:500;letter-spacing:0.01em;text-decoration:none;text-align:center;mso-padding-alt:0;">${actionLabel}<span aria-hidden="true"> &nbsp;↗</span></a></td></tr></table>`
  const content = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 0;"><tr><td class="rule" style="padding-top:24px;border-top:1px solid #e6e7e3;">
<h2 class="ink" style="margin:0 0 9px;color:#292b27;font-size:17px;line-height:24px;font-weight:500;">${priority ? 'You’re all set.' : 'A little head start.'}</h2>
<p class="muted" style="margin:0 0 20px;color:#62645e;font-size:15px;line-height:24px;font-weight:400;">${priority ? 'Your place on the waitlist is still saved. Access arrives in a separate invitation.' : referral}</p>
${button}
${priority ? '' : `<p class="muted" style="margin:20px 0 5px;color:#70716b;font-size:12px;line-height:19px;letter-spacing:0.015em;">Your personal invite link</p><p style="margin:0;word-break:break-all;overflow-wrap:anywhere;"><a href="${escapeHtml(invite.href)}" class="link" style="color:#525850;font-size:13px;line-height:21px;text-decoration:underline;word-break:break-all;">${escapeHtml(invite.href)}</a></p>`}
</td></tr></table>`
  const footerAddress = options.postalAddress?.trim()
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
@media only screen and (max-width:600px){.outer{padding:16px 10px!important}.content{padding:20px 24px 28px!important}.brand{padding:26px 24px 4px!important}.headline{font-size:26px!important;line-height:33px!important}.footer{padding:22px 18px!important}}
@media (prefers-color-scheme:dark){.body,.outer{background-color:#1b1c1a!important}.card,.brand,.content{background-color:#ffffff!important;border-color:#e6e7e3!important}.ink{color:#464943!important}.headline,.brand-name{color:#292b27!important}.muted{color:#62645e!important}.footer{color:#bec0b6!important}.footer .link{color:#d1d5c8!important}.rule{border-color:#e6e7e3!important}.content .link{color:#525850!important}.button-cell,.button{background-color:#292b27!important;border-color:#292b27!important;color:#ffffff!important}}
</style>
</head>
<body class="body" bgcolor="#f5f5f3" style="margin:0;padding:0;width:100%;background-color:#f5f5f3;font-family:${font};">
<div style="display:none;font-size:1px;line-height:1px;color:#f5f5f3;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}${'&#847; &zwnj; &nbsp;'.repeat(18)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td class="outer" align="center" style="padding:32px 16px;background-color:#f5f5f3;">
<!--[if mso]><table role="presentation" width="560" align="center" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="card" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #e6e7e3;border-radius:8px;border-spacing:0;overflow:hidden;">
<tr><td class="brand" style="padding:30px 40px 4px;background-color:#ffffff;border-radius:8px 8px 0 0;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="26" valign="middle"><img src="${escapeHtml(logo)}" alt="" width="24" height="24" style="display:block;width:24px;height:24px;"></td><td valign="middle" class="brand-name" style="padding-left:7px;color:#292b27;font-size:16px;line-height:24px;font-weight:500;">Open Swarm</td><td class="muted" align="right" valign="middle" style="color:#70716b;font-size:12px;line-height:19px;letter-spacing:0.015em;">${priority ? 'Priority access' : 'Welcome aboard'}</td></tr></table>
</td></tr>
<tr><td bgcolor="#ffffff" style="background-color:#ffffff;line-height:0;"><img src="${escapeHtml(artwork)}" alt="" width="560" height="240" style="display:block;width:100%;max-width:560px;height:auto;"></td></tr>
<tr><td class="content" style="padding:4px 40px 32px;background-color:#ffffff;border-radius:0 0 8px 8px;">
<h1 class="headline" style="margin:0 0 16px;color:#292b27;font-size:28px;line-height:35px;font-weight:400;letter-spacing:-0.015em;">${headline}</h1>
<p class="ink" style="margin:0 0 12px;color:#464943;font-size:15px;line-height:24px;font-weight:400;">${opening}</p>
<p class="muted" style="margin:0;color:#62645e;font-size:15px;line-height:24px;font-weight:400;">${next}</p>
${content}
<p class="ink" style="margin:28px 0 0;color:#464943;font-size:14px;line-height:23px;font-weight:400;">Glad you’re here,<br><span style="font-weight:500;">The Open Swarm team</span></p>
</td></tr></table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;"><tr><td class="footer" align="left" style="padding:22px 40px 4px;color:#70716b;font-size:11px;line-height:18px;letter-spacing:0.015em;">
You’re receiving this because you joined the Open Swarm waitlist.<br>
<a class="link" href="${escapeHtml(unsubscribe.href)}" style="color:#62645e;text-decoration:underline;">Unsubscribe from waitlist emails</a>${footerAddress ? `<br>${escapeHtml(footerAddress)}` : ''}
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`
  const text = priority
    ? `OPEN SWARM\n\nYou’ve unlocked priority early access.\n\n${opening}\n\n${next}\n\nYour place on the waitlist is still saved. Access arrives in a separate invitation.\n\nExplore Open Swarm: ${product}`
    : `OPEN SWARM\n\nYou’re on the list.\n\n${opening}\n\n${next}\n\nA little head start.\n${referral}\n\nCopy this link and send it to a friend:\n${invite.href}`
  return { subject, html, text: `${text}\n\nGlad you’re here,\nThe Open Swarm team\n\nYou’re receiving this because you joined the Open Swarm waitlist.\nUnsubscribe from waitlist emails: ${unsubscribe.href}${footerAddress ? `\n${footerAddress}` : ''}\n` }
}
