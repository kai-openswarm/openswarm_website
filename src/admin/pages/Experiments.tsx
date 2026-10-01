import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { EXPERIMENTS } from '@/lib/experiments'
import { useApi, useQuery, useView } from '../hooks'
import { fmtInt, fmtPct } from '../format'
import type { ExperimentRow } from '../types'
import { Badge, Button, DataTable, EmptyState, Field, Panel, QueryView, SkeletonRows, inputClass, type Column } from '../ui'

const SITE = 'https://www.openswarm.com/'
const Z95 = 1.96

/** 95% Wilson interval for a rate; stays sensible with few visitors. */
export function wilson(k: number, n: number): [number, number] {
  if (n <= 0) return [0, 0]
  const p = k / n
  const d = 1 + (Z95 * Z95) / n
  const centre = p + (Z95 * Z95) / (2 * n)
  const margin = Z95 * Math.sqrt((p * (1 - p)) / n + (Z95 * Z95) / (4 * n * n))
  return [Math.max(0, (centre - margin) / d), Math.min(1, (centre + margin) / d)]
}

function normalCdf(z: number) {
  // Abramowitz and Stegun 7.1.26.
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(z * z) / 2)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

/** Chance the variant's true signup rate is higher than the control's (normal approximation). */
export function chanceBetter(k: number, n: number, k0: number, n0: number) {
  if (n <= 0 || n0 <= 0) return null
  const p = k / n
  const p0 = k0 / n0
  const se = Math.sqrt((p * (1 - p)) / n + (p0 * (1 - p0)) / n0)
  if (se === 0) return p === p0 ? 0.5 : p > p0 ? 1 : 0
  return normalCdf((p - p0) / se)
}

/** Visitors each variant needs to detect a 30% relative lift at 95% confidence and 80% power. */
export function visitorsNeeded(rate: number) {
  if (rate <= 0 || rate >= 1) return null
  const delta = rate * 0.3
  return Math.ceil((2 * (Z95 + 0.84) ** 2 * rate * (1 - rate)) / (delta * delta))
}

type Row = ExperimentRow & { rate: number, ci: [number, number], better: number | null, lift: number | null, verdict: string, tone: 'neutral' | 'good' | 'poor' | 'warn' }

function analyse(rows: ExperimentRow[]): Row[] {
  const control = rows.find((r) => r.variant === 'control')
  return rows.map((r) => {
    const rate = r.visitors ? r.signups / r.visitors : 0
    const isControl = r.variant === 'control'
    const better = !isControl && control ? chanceBetter(r.signups, r.visitors, control.signups, control.visitors) : null
    const controlRate = control && control.visitors ? control.signups / control.visitors : 0
    const lift = !isControl && controlRate > 0 ? rate / controlRate - 1 : null
    let verdict = 'Baseline'
    let tone: Row['tone'] = 'neutral'
    if (!isControl) {
      if (!control || control.visitors < 100 || r.visitors < 100 || r.signups + control.signups < 20) {
        verdict = 'Too early'
        tone = 'warn'
      } else if (better !== null && better >= 0.95) {
        verdict = 'Likely better'
        tone = 'good'
      } else if (better !== null && better <= 0.05) {
        verdict = 'Likely worse'
        tone = 'poor'
      } else {
        verdict = 'No clear difference'
      }
    }
    return { ...r, rate, ci: wilson(r.signups, r.visitors), better, lift, verdict, tone }
  })
}

const COLUMNS: Column<Row>[] = [
  { key: 'variant', label: 'Variant', render: (r) => <span className="font-medium">{r.variant}</span>, sort: (r) => r.variant },
  { key: 'visitors', label: 'Visitors', align: 'right', render: (r) => fmtInt(r.visitors), sort: (r) => r.visitors, info: 'Visitors who saw this variant, excluding the team and bots.' },
  { key: 'from_ads', label: 'From links', align: 'right', render: (r) => fmtInt(r.from_ads), sort: (r) => r.from_ads, info: 'Visitors who arrived on a link that picked this variant, such as an ad.' },
  { key: 'signups', label: 'Signups', align: 'right', render: (r) => fmtInt(r.signups), sort: (r) => r.signups },
  {
    key: 'rate', label: 'Signup rate', align: 'right', sort: (r) => r.rate, info: 'Signups ÷ visitors, with the 95% range the true rate likely falls in.',
    render: (r) => <span className="num">{fmtPct(r.rate)} <span className="text-ink-3">({fmtPct(r.ci[0])}–{fmtPct(r.ci[1])})</span></span>,
  },
  { key: 'lift', label: 'vs control', align: 'right', sort: (r) => r.lift ?? 0, render: (r) => (r.lift === null ? '—' : `${r.lift >= 0 ? '+' : ''}${fmtPct(r.lift)}`) },
  { key: 'better', label: 'Chance better', align: 'right', sort: (r) => r.better ?? 0, render: (r) => fmtPct(r.better), info: 'How likely this variant’s true signup rate beats the control’s.' },
  { key: 'verdict', label: 'Verdict', render: (r) => <Badge tone={r.tone}>{r.verdict}</Badge>, sort: (r) => r.verdict },
]

function ExperimentTable({ id, rows }: { id: string, rows: ExperimentRow[] }) {
  const analysed = useMemo(() => analyse(rows), [rows])
  const control = rows.find((r) => r.variant === 'control')
  const needed = control && control.visitors ? visitorsNeeded(control.signups / control.visitors) : null
  const experiment = (EXPERIMENTS as Record<string, { split: boolean }>)[id]
  return (
    <Panel
      title={`Experiment: ${id}`}
      subtitle={experiment
        ? experiment.split ? 'Random split is on: visitors without a variant link are spread evenly across variants.' : 'Random split is off: only visitors on a variant link see a variant; everyone else sees control and isn’t counted here.'
        : 'This experiment is no longer in the site code.'}
    >
      <DataTable columns={COLUMNS} rows={analysed} rowKey={(r) => r.variant} defaultSort={{ key: 'variant', dir: 'asc' }} csvName={`experiment-${id}`} caption={`Experiment ${id}`} />
      {needed && (
        <p className="mt-3 text-[12px] text-ink-3">
          At the control’s current signup rate, each variant needs about <span className="font-medium text-ink-2 num">{fmtInt(needed)}</span> visitors to reliably detect a 30% improvement.
          {!experiment?.split && ' Visitors from variant links chose their variant by clicking an ad, so compare them with control traffic from the same campaign before trusting a difference.'}
        </p>
      )}
    </Panel>
  )
}

const SOURCES: Record<string, { utm_source: string, utm_medium: string }> = {
  meta: { utm_source: 'meta', utm_medium: 'paid_social' },
  x: { utm_source: 'x', utm_medium: 'paid_social' },
  reddit: { utm_source: 'reddit', utm_medium: 'paid_social' },
  linkedin: { utm_source: 'linkedin', utm_medium: 'paid_social' },
  google: { utm_source: 'google', utm_medium: 'cpc' },
  newsletter: { utm_source: 'newsletter', utm_medium: 'email' },
}

const slug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)

function LinkBuilder() {
  const variants = Object.entries(EXPERIMENTS.hero.variants)
  const [variant, setVariant] = useState('agents')
  const [source, setSource] = useState('meta')
  const [campaign, setCampaign] = useState('launch')
  const [ad, setAd] = useState('')
  const [copied, setCopied] = useState(false)
  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (variant !== 'control') params.set(EXPERIMENTS.hero.param, variant)
    params.set('utm_source', SOURCES[source].utm_source)
    params.set('utm_medium', SOURCES[source].utm_medium)
    if (slug(campaign)) params.set('utm_campaign', slug(campaign))
    params.set('utm_content', slug(ad) || variant)
    return `${SITE}?${params}`
  }, [variant, source, campaign, ad])
  const copy = (variants.find(([name]) => name === variant)?.[1] ?? {}) as { headline?: string, sub?: string }

  return (
    <Panel title="Ad link builder" subtitle="Each ad gets a link that lands on the headline it promises, tagged so its signups show up by campaign and ad.">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Headline variant">{(id) => (
          <select id={id} className={inputClass} value={variant} onChange={(e) => setVariant(e.target.value)}>
            {variants.map(([name]) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}</Field>
        <Field label="Where the ad runs">{(id) => (
          <select id={id} className={inputClass} value={source} onChange={(e) => setSource(e.target.value)}>
            {Object.keys(SOURCES).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )}</Field>
        <Field label="Campaign">{(id) => <input id={id} className={inputClass} value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="launch" />}</Field>
        <Field label="Ad name (optional)">{(id) => <input id={id} className={inputClass} value={ad} onChange={(e) => setAd(e.target.value)} placeholder={variant} />}</Field>
      </div>
      <div className="mt-3 rounded-md border border-line bg-hover px-3 py-2.5 text-[13px]">
        <p className="text-[12px] text-ink-3">Visitors see</p>
        <p className="mt-0.5 font-medium">{copy.headline}</p>
        {copy.sub && <p className="text-ink-2">{copy.sub}</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-[12.5px] break-all">{url}</code>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />} {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
      <p className="mt-2 text-[12px] text-ink-3">Meta and X add their own click ids to the link; signups keep them so they can be reported back to the platform.</p>
    </Panel>
  )
}

export function ExperimentsPage() {
  const api = useApi()
  const { range } = useView()
  const r = { from: range.fromIso, to: range.toIso }
  const q = useQuery(`experiments|${r.from}|${r.to}`, () => api.experiments(r))
  const groups = useMemo(() => {
    const map = new Map<string, ExperimentRow[]>()
    for (const row of q.data ?? []) map.set(row.exp, [...(map.get(row.exp) ?? []), row])
    return [...map.entries()]
  }, [q.data])

  return (
    <div className="flex flex-col gap-4">
      <QueryView
        q={q}
        isEmpty={(d) => d.length === 0}
        skeleton={<Panel title="Experiments"><SkeletonRows rows={4} /></Panel>}
        empty={(
          <Panel title="Experiments">
            <EmptyState text="No experiment visitors in this range" hint="Visitors are counted once they land on a variant link from the builder below, or while a random split is on." />
          </Panel>
        )}
      >
        {() => <div className="flex flex-col gap-4">{groups.map(([id, rows]) => <ExperimentTable key={id} id={id} rows={rows} />)}</div>}
      </QueryView>
      <LinkBuilder />
    </div>
  )
}
