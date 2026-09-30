import { BreakdownTabs } from '../Breakdown'

const DIMS = [
  'channel', 'source', 'referrer_domain', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'entry_path',
] as const

export function Traffic() {
  return <BreakdownTabs dims={DIMS} title="Acquisition" />
}
