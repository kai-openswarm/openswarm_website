import type { Bucket } from './types'

/** Categorical palette in fixed order (CSS variables, light/dark aware). */
export const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)']

/** Parses the timeseries "t" (local wall time, no offset) as a local Date. */
export function parseLocal(t: string): Date {
  const [d, time = '00:00:00'] = t.split('T')
  const [y, m, day] = d.split('-').map(Number)
  const [h, mi, s] = time.split(':').map(Number)
  return new Date(y, m - 1, day, h || 0, mi || 0, s || 0)
}

const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' })
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })
const fullHourFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const fullDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

export function bucketTick(d: Date, bucket: Bucket, multiDay: boolean) {
  if (bucket === 'hour') return multiDay && d.getHours() === 0 ? dayFmt.format(d) : hourFmt.format(d)
  if (bucket === 'month') return monthFmt.format(d)
  return dayFmt.format(d)
}

export function bucketTitle(d: Date, bucket: Bucket) {
  if (bucket === 'hour') return fullHourFmt.format(d)
  if (bucket === 'week') return `Week of ${fullDayFmt.format(d)}`
  if (bucket === 'month') return monthFmt.format(d)
  return fullDayFmt.format(d)
}

