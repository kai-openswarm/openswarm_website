import type { ReactNode } from 'react'
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Annotation, Bucket } from './types'
import { fmtCompact, fmtInt, fmtPct } from './format'
import { ANNOTATION_COLOR_VARS, SERIES, annotationSpans, bucketTick, bucketTitle, parseLocal, type AnnotationSpan } from './chartUtil'

const axisTick = { fill: 'var(--ink-3)', fontSize: 11 }

function TipBox({ title, rows }: { title: ReactNode; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-md border border-line-strong bg-panel px-2.5 py-2 text-[12px] shadow-lg">
      <div className="mb-1 font-medium text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 text-ink-2">
          <span className="flex items-center gap-1.5">
            {r.color && <span className="size-2 rounded-full" style={{ background: r.color }} aria-hidden />}
            {r.label}
          </span>
          <span className="font-medium text-ink num">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

function annotationMarks(spans: AnnotationSpan[], categories: string[]) {
  return spans.map(({ a, i1, i2 }) => {
    const color = ANNOTATION_COLOR_VARS[a.color] ?? 'var(--ink-3)'
    const title = `${a.title} (${a.starts_on}${a.ends_on && a.ends_on !== a.starts_on ? ` – ${a.ends_on}` : ''})`
    if (i1 === i2) {
      return (
        <ReferenceLine
          key={`ann-${a.id}`}
          x={categories[i1]}
          ifOverflow="extendDomain"
          shape={(props: { x1?: number; x2?: number; y1?: number; y2?: number }) => (
            <g>
              <title>{title}</title>
              <line x1={props.x1} x2={props.x2} y1={props.y1} y2={props.y2} stroke={color} strokeWidth={1.5} strokeDasharray="3 3" />
              <line x1={props.x1} x2={props.x2} y1={props.y1} y2={props.y2} stroke="transparent" strokeWidth={10} />
              <circle cx={props.x1} cy={(props.y1 ?? 0) + 4} r={4} fill={color} />
            </g>
          )}
        />
      )
    }
    return (
      <ReferenceArea
        key={`ann-${a.id}`}
        x1={categories[i1]}
        x2={categories[i2]}
        ifOverflow="extendDomain"
        shape={(props: { x?: number; y?: number; width?: number; height?: number }) => (
          <g>
            <title>{title}</title>
            <rect x={props.x} y={props.y} width={props.width} height={props.height} fill={color} fillOpacity={0.1} />
            <rect x={props.x} y={props.y} width={props.width} height={3} fill={color} />
          </g>
        )}
      />
    )
  })
}

export function AnnotationLegend({ spans }: { spans: AnnotationSpan[] }) {
  if (!spans.length) return null
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-2" aria-label="Annotations">
      {spans.map(({ a }) => (
        <li key={a.id} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: ANNOTATION_COLOR_VARS[a.color] }} aria-hidden />
          <span className="text-ink-3 num">{a.starts_on.slice(5)}{a.ends_on && a.ends_on !== a.starts_on ? `–${a.ends_on.slice(5)}` : ''}</span>
          {a.title}
        </li>
      ))}
    </ul>
  )
}

export interface SeriesPoint {
  t: string
  value: number
  /** Comparison value for the bucket at the same index, if any. */
  compare?: number | null
  compareT?: string | null
}

export function TimeSeriesChart({ data, label, bucket, height = 260, format = fmtInt, compareLabel, annotations = [] }: {
  data: SeriesPoint[]
  label: string
  bucket: Bucket
  height?: number
  format?: (n: number) => string
  compareLabel?: string | null
  annotations?: Annotation[]
}) {
  const points = data.map((p) => ({ ...p, d: parseLocal(p.t) }))
  const multiDay = points.length > 24
  const hasCompare = points.some((p) => p.compare != null)
  const spans = annotationSpans(points.map((p) => p.d), bucket, annotations)
  const percent = format === fmtPct
  return (
    <div>
      <div style={{ height }} role="img" aria-label={`${label} over time${hasCompare ? `, with ${compareLabel ?? 'comparison'} as a dashed line` : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 10, right: 8, bottom: 0, left: -8 }}>
            <defs>
              <linearGradient id="ts-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="t"
              tickFormatter={(t: string) => bucketTick(parseLocal(t), bucket, multiDay)}
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: 'var(--line-strong)' }}
              minTickGap={24}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={48}
              allowDecimals={percent}
              tickFormatter={(v: number) => (percent ? fmtPct(v) : fmtCompact(v))}
            />
            <Tooltip
              cursor={{ stroke: 'var(--line-strong)' }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof points)[number] | undefined
                if (!active || !p) return null
                const rows = [{ label, value: format(p.value), color: 'var(--accent)' }]
                if (p.compare != null) {
                  rows.push({ label: p.compareT ? bucketTitle(parseLocal(p.compareT), bucket) : (compareLabel ?? 'Comparison'), value: format(p.compare), color: 'var(--ink-3)' })
                }
                return <TipBox title={bucketTitle(p.d, bucket)} rows={rows} />
              }}
            />
            {annotationMarks(spans, points.map((p) => p.t))}
            {hasCompare && (
              <Line type="monotone" dataKey="compare" stroke="var(--ink-3)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={{ r: 3 }} isAnimationActive={false} connectNulls />
            )}
            <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} fill="url(#ts-fill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--panel)' }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {(hasCompare || spans.length > 0) && (
        <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-1">
          <ul className="flex flex-wrap gap-x-3 text-[12px] text-ink-2" aria-label="Legend">
            <li className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-accent" aria-hidden />{label}</li>
            {hasCompare && (
              <li className="inline-flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-dashed border-ink-3" aria-hidden />
                {compareLabel ?? 'Comparison'}
              </li>
            )}
          </ul>
          <AnnotationLegend spans={spans} />
        </div>
      )}
    </div>
  )
}

/** Stacked daily bars with categories in a fixed colour order. */
export function StackedBars({ data, keys, label, colorFor, annotations = [], height = 220 }: {
  data: ({ day: string } & Record<string, number | string>)[]
  keys: string[]
  label: string
  colorFor: (key: string) => string
  annotations?: Annotation[]
  height?: number
}) {
  const days = data.map((d) => d.day)
  const spans = annotationSpans(days.map((d) => parseLocal(d)), 'day', annotations)
  return (
    <div>
      <div style={{ height }} role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 4, bottom: 0, left: -12 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="day" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} minTickGap={20} tickFormatter={(d: string) => bucketTick(parseLocal(d), 'day', false)} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
            <Tooltip
              cursor={{ fill: 'var(--hover)' }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as ({ day: string } & Record<string, number>) | undefined
                if (!active || !p) return null
                return <TipBox title={bucketTitle(parseLocal(p.day), 'day')} rows={keys.filter((k) => p[k]).map((k) => ({ label: k, value: fmtInt(p[k]), color: colorFor(k) }))} />
              }}
            />
            {annotationMarks(spans, days)}
            {keys.map((k, i) => (
              <Bar key={k} dataKey={k} stackId="s" fill={colorFor(k)} stroke="var(--panel)" strokeWidth={1} radius={i === keys.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-1">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-2" aria-label="Legend">
          {keys.map((k) => (
            <li key={k} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: colorFor(k) }} aria-hidden />{k}</li>
          ))}
        </ul>
        <AnnotationLegend spans={spans} />
      </div>
    </div>
  )
}

export function MinuteBars({ data, height = 140 }: { data: { t: string; visitors: number }[]; height?: number }) {
  const tf = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  return (
    <div style={{ height }} role="img" aria-label="Visitors per minute, last 30 minutes">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="t" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} tickFormatter={(t: string) => tf.format(new Date(t))} minTickGap={40} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as { t: string; visitors: number } | undefined
              if (!active || !p) return null
              return <TipBox title={tf.format(new Date(p.t))} rows={[{ label: 'Visitors', value: fmtInt(p.visitors), color: 'var(--accent)' }]} />
            }}
          />
          <Bar dataKey="visitors" fill="var(--accent)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function Donut({ items, label, onSelect, valueLabel = 'Visitors', colorFor }: {
  items: { key: string; label: string; value: number }[]
  label: string
  onSelect?: (key: string) => void
  valueLabel?: string
  /** Fixed colour per key; defaults to the categorical order. */
  colorFor?: (key: string) => string
}) {
  const total = items.reduce((t, i) => t + i.value, 0)
  // Fixed hue order; beyond eight, fold into Other.
  const shown = items.length > 8 ? [...items.slice(0, 7), { key: '__other', label: 'Other', value: items.slice(7).reduce((t, i) => t + i.value, 0) }] : items
  const color = (i: number, key: string) => (key === '__other' ? 'var(--c-other)' : colorFor ? colorFor(key) : SERIES[i])
  return (
    <div className="@container">
    <div className="flex flex-col items-center gap-4 @sm:flex-row">
      <div className="size-36 shrink-0" role="img" aria-label={`${label} share`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={shown} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%" paddingAngle={shown.length > 1 ? 1.5 : 0} stroke="var(--panel)" strokeWidth={1} isAnimationActive={false}>
              {shown.map((it, i) => <Cell key={it.key} fill={color(i, it.key)} />)}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as { label: string; value: number } | undefined
                if (!active || !p) return null
                return <TipBox title={p.label} rows={[{ label: valueLabel, value: `${fmtInt(p.value)} (${fmtPct(total ? p.value / total : 0)})` }]} />
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full min-w-0 space-y-1">
        {shown.map((it, i) => {
          const content = (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: color(i, it.key) }} aria-hidden />
                <span className="truncate">{it.label}</span>
              </span>
              <span className="shrink-0 text-ink-2 num">
                {fmtInt(it.value)} <span className="text-ink-3">· {fmtPct(total ? it.value / total : 0)}</span>
              </span>
            </>
          )
          return (
            <li key={it.key}>
              {onSelect && it.key !== '__other' ? (
                <button type="button" onClick={() => onSelect(it.key)} className="flex h-7 w-full items-center justify-between gap-3 rounded px-2 text-left text-[13px] hover:bg-hover" title={`Filter by ${it.label}`}>
                  {content}
                </button>
              ) : (
                <div className="flex h-7 items-center justify-between gap-3 px-2 text-[13px]">{content}</div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
    </div>
  )
}

export function ColumnChart({ data, label, valueLabel, height = 200 }: { data: { label: string; value: number }[]; label: string; valueLabel: string; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} interval={0} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} width={48} tickFormatter={(v: number) => fmtCompact(v)} />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as { label: string; value: number } | undefined
              if (!active || !p) return null
              return <TipBox title={p.label} rows={[{ label: valueLabel, value: fmtInt(p.value), color: 'var(--accent)' }]} />
            }}
          />
          <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
