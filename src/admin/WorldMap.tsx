import { useMemo, useRef, useState } from 'react'
import { countryName, flag, fmtInt, fmtPct } from './format'
import { WORLD_PATHS, WORLD_VIEWBOX } from './worldPaths'

const STEPS = 5
/** One hue, light to dark: each step mixes more of the accent into the empty-country fill. */
const STEP_FILL = [28, 46, 64, 82, 100].map((pct) => `color-mix(in oklab, var(--accent) ${pct}%, var(--grid))`)
const EMPTY_FILL = 'var(--grid)'

/** Log scale, so one large country does not flatten every other country into the lightest step. */
function stepFor(value: number, max: number): number {
  if (value <= 0 || max <= 0) return -1
  if (max === 1) return STEPS - 1
  return Math.min(STEPS - 1, Math.max(0, Math.ceil((Math.log1p(value) / Math.log1p(max)) * STEPS) - 1))
}

const DRAWN = new Set(WORLD_PATHS.map(([code]) => code).filter(Boolean))

export interface MapDatum {
  /** ISO 3166-1 alpha-2 country code. */
  code: string
  value: number
}

/**
 * World map shaded by a count per country. Hover for the number, click to select a country.
 * The map is one image to assistive technology and has no tab stops: keyboard and screen-reader
 * users get the same numbers and the same filter action from the country table on the page.
 */
export default function WorldMap({ data, valueLabel = 'Visitors', onSelect }: {
  data: MapDatum[]
  valueLabel?: string
  onSelect?: (code: string) => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ code: string; x: number; y: number; width: number } | null>(null)
  const { byCode, max, total, offMap } = useMemo(() => {
    const byCode = new Map<string, number>()
    for (const d of data) if (/^[A-Za-z]{2}$/.test(d.code)) byCode.set(d.code.toUpperCase(), d.value)
    const values = [...byCode.values()]
    return {
      byCode,
      max: Math.max(0, ...values),
      total: data.reduce((t, d) => t + d.value, 0),
      // Countries with visitors that are too small to draw at this scale.
      offMap: [...byCode].filter(([code, v]) => v > 0 && !DRAWN.has(code)).sort((a, b) => b[1] - a[1]),
    }
  }, [data])

  const move = (code: string, e: { clientX: number; clientY: number }) => {
    const r = wrap.current?.getBoundingClientRect()
    if (r) setTip({ code, x: e.clientX - r.left, y: e.clientY - r.top, width: r.width })
  }
  const tipValue = tip ? byCode.get(tip.code) ?? 0 : 0

  return (
    <div>
      <div ref={wrap} className="relative" onMouseLeave={() => setTip(null)}>
        <svg
          viewBox={`0 0 ${WORLD_VIEWBOX.width} ${WORLD_VIEWBOX.height}`}
          className="block h-auto w-full"
          role="img"
          aria-label={`World map of ${valueLabel.toLowerCase()} by country. The table below has the same numbers.`}
        >
          {WORLD_PATHS.map(([code, d], i) => {
            const v = code ? byCode.get(code) ?? 0 : 0
            const step = stepFor(v, max)
            const clickable = Boolean(onSelect && code && v > 0)
            return (
              <path
                key={code || `t${i}`}
                d={d}
                fill={step < 0 ? EMPTY_FILL : STEP_FILL[step]}
                stroke="var(--panel)"
                strokeWidth={0.6}
                vectorEffect="non-scaling-stroke"
                className={clickable ? 'cursor-pointer hover:brightness-110' : undefined}
                onMouseMove={code ? (e) => move(code, e) : undefined}
                onMouseEnter={code ? (e) => move(code, e) : () => setTip(null)}
                onClick={clickable ? () => onSelect?.(code) : undefined}
              />
            )
          })}
        </svg>
        {tip && (
          <div
            className="pointer-events-none absolute z-10 w-max max-w-[220px] rounded-md border border-line-strong bg-panel px-2.5 py-2 text-[12px] shadow-lg"
            style={{
              left: Math.max(0, Math.min(tip.x + 12, tip.width - 180)),
              top: Math.max(tip.y - 52, 0),
            }}
          >
            <div className="mb-1 font-medium text-ink">{flag(tip.code)} {countryName(tip.code)}</div>
            <div className="flex items-center justify-between gap-4 text-ink-2">
              <span>{valueLabel}</span>
              <span className="font-medium text-ink num">
                {fmtInt(tipValue)}{tipValue > 0 && total > 0 ? ` (${fmtPct(tipValue / total)})` : ''}
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px] text-ink-3">
        <div className="flex items-center gap-2">
          <span className="num">1</span>
          <span className="flex gap-0.5" aria-hidden>
            {STEP_FILL.map((f) => <span key={f} className="h-2.5 w-6 rounded-sm" style={{ background: f }} />)}
          </span>
          <span className="num">{fmtInt(Math.max(max, 1))} {valueLabel.toLowerCase()}</span>
          <span className="ml-2 flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: EMPTY_FILL }} aria-hidden /> None
          </span>
        </div>
        {offMap.length > 0 && (
          <div>
            Too small to draw:{' '}
            {offMap.map(([code, v], i) => (
              <span key={code}>
                {i > 0 && ', '}
                {onSelect ? (
                  <button type="button" className="text-ink-2 hover:text-ink hover:underline" onClick={() => onSelect(code)}>
                    {countryName(code)} <span className="num">({fmtInt(v)})</span>
                  </button>
                ) : (
                  <span className="text-ink-2">{countryName(code)} <span className="num">({fmtInt(v)})</span></span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
