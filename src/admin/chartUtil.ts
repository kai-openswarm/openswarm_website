import type { Annotation, AnnotationColor, Bucket } from './types'

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



export const ANNOTATION_COLOR_VARS: Record<AnnotationColor, string> = {
  blue: 'var(--c1)', green: 'var(--c6)', orange: 'var(--c2)', red: 'var(--c8)', purple: 'var(--c7)', gray: 'var(--ink-3)',
}

function parseDay(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function nextBucket(d: Date, bucket: Bucket) {
  const x = new Date(d)
  if (bucket === 'hour') x.setHours(x.getHours() + 1)
  else if (bucket === 'day') x.setDate(x.getDate() + 1)
  else if (bucket === 'week') x.setDate(x.getDate() + 7)
  else x.setMonth(x.getMonth() + 1)
  return x
}

export interface AnnotationSpan {
  a: Annotation
  /** Index of the first and last bucket the annotation overlaps. */
  i1: number
  i2: number
}

/** Maps date annotations onto the chart's buckets (bucket starts in local time). */
export function annotationSpans(bucketStarts: Date[], bucket: Bucket, annotations: Annotation[]): AnnotationSpan[] {
  if (!bucketStarts.length) return []
  const ends = bucketStarts.map((b, i) => bucketStarts[i + 1] ?? nextBucket(b, bucket))
  const out: AnnotationSpan[] = []
  for (const a of annotations) {
    const start = parseDay(a.starts_on)
    const last = parseDay(a.ends_on ?? a.starts_on)
    const endExcl = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)
    let i1 = -1
    let i2 = -1
    bucketStarts.forEach((b, i) => {
      if (b < endExcl && ends[i] > start) {
        if (i1 < 0) i1 = i
        i2 = i
      }
    })
    if (i1 >= 0) out.push({ a, i1, i2 })
  }
  return out
}
