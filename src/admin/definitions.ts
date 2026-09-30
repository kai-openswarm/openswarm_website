// Metric definitions shown in info tooltips (R10), from
// docs/admin-analytics-requirements.md §3. Keep them in sync with the SQL.

export const DEFS = {
  visitors: 'Unique visitors: a first-party browser id that stays the same across days. Clearing site data or switching browsers counts as a new visitor.',
  currentVisitors: 'Visitors with any activity in the last 5 minutes. Refreshes every 30 seconds.',
  sessions: 'A visit. It ends after 30 minutes without activity; there is no split at midnight.',
  pageviews: 'Page loads, including loads of the privacy and terms pages.',
  engaged: 'An engaged session lasts 10+ seconds of active time, scrolls 50%+, views 2+ pages, clicks something tracked, or signs up.',
  bounce: 'Bounce rate = 1 − engaged sessions ÷ sessions. Lower is better. (Tools that count "one page viewed" show close to 100% on a one-page site.)',
  avgEngagement: 'Average active time per session. Time in a hidden or background tab is not counted.',
  signups: 'New unique email addresses that joined the waitlist. Repeat submissions of an address already on the list are not counted.',
  conversion: 'Conversion rate = visitors who joined ÷ visitors. On the chart it is approximated per bucket as signups ÷ visitors.',
  referredSignups: 'Signups that arrived through someone’s invite link.',
  referredShare: 'Referred share = referred signups ÷ all signups in the range. (Some tools call this "K".)',
  classicK: 'K = invite-link visitors per signup × invite conversion. Computed for the cohort that joined in this range, counting everyone they have brought in since. K above 1 means each signup brings in more than one more.',
  inviteVisitsPerSignup: 'Distinct visitors who arrived on a cohort member’s invite link ÷ cohort size.',
  inviteConversion: 'Cohort invitees who joined ÷ visitors on cohort invite links (capped at 100%).',
  referralRate: 'Share of the cohort with at least one invitee who joined.',
  invitesPerReferrer: 'Invitees who joined ÷ cohort members who brought at least one.',
  activeReferrers: 'People whose invite link brought at least one signup in this range.',
  priorityUnlocked: 'All time: people with 3 or more successful invites.',
  displayCount: 'The public counter on the site: the baseline in Settings plus real signups.',
  engagedRate: 'Engaged sessions ÷ sessions in this group.',
  convRateRow: 'Visitors in this group who joined ÷ visitors in this group.',
  rowSignups: 'Sessions in this group that ended in a new signup.',
} as const

export const DATA_CAVEATS = [
  'Visitors who opt out or block scripts are not counted.',
  'Location comes from IP and is approximate.',
  'Bots are excluded; internal traffic is excluded unless turned on in Settings.',
  'Raw sessions are kept for 13 months; signup attribution is kept.',
]
