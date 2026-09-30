import type { ReactNode } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Bucket } from './types'
import { fmtCompact, fmtInt, fmtPct } from './format'
import { SERIES, bucketTick, bucketTitle, parseLocal } from './chartUtil'

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

export function TimeSeriesChart({ data, label, bucket, height = 260, format = fmtInt }: {
  data: { t: string; value: number }[]
  label: string
  bucket: Bucket
  height?: number
  format?: (n: number) => string
}) {
  const points = data.map((p) => ({ ...p, d: parseLocal(p.t) }))
  const multiDay = points.length > 24
  return (
    <div style={{ height }} role="img" aria-label={`${label} over time`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
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
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} allowDecimals={false} tickFormatter={(v: number) => fmtCompact(v)} />
          <Tooltip
            cursor={{ stroke: 'var(--line-strong)' }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof points)[number] | undefined
              if (!active || !p) return null
              return <TipBox title={bucketTitle(p.d, bucket)} rows={[{ label, value: format(p.value), color: 'var(--accent)' }]} />
            }}
          />
          <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} fill="url(#ts-fill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--panel)' }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
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

export function Donut({ items, label, onSelect }: {
  items: { key: string; label: string; value: number }[]
  label: string
  onSelect?: (key: string) => void
}) {
  const total = items.reduce((t, i) => t + i.value, 0)
  // Fixed hue order; beyond eight, fold into Other.
  const shown = items.length > 8 ? [...items.slice(0, 7), { key: '__other', label: 'Other', value: items.slice(7).reduce((t, i) => t + i.value, 0) }] : items
  const color = (i: number, key: string) => (key === '__other' ? 'var(--c-other)' : SERIES[i])
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
                return <TipBox title={p.label} rows={[{ label: 'Visitors', value: `${fmtInt(p.value)} (${fmtPct(total ? p.value / total : 0)})` }]} />
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
