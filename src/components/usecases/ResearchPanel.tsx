import { useRef, type CSSProperties } from 'react'
import { clamp, ep, inOut, lerp, popIn, rise, seg } from '../os/kit'
import { AppIcon } from '../ui/AppIcon'
import { B, type Brand } from '@/lib/brands'
import { cn } from '@/lib/utils'
import { Ask, Glass, PanelRoot, type PanelProps } from './shared'
import { usePanelTimeline } from './usePanelTimeline'

/*
  Research: the swarm reads a month of papers and writes the brief as it goes. Sources stream
  into a list and get a read tick while the counter climbs to 34; a Notion page types itself,
  and every point ends with citation markers that light up the paper they came from. On a
  phone the source list folds into a row of chips above the page.
*/

const LOOP = 16
const REST = 12
/** the work fades out over [OUT, OUT + 0.7] and the loop starts clean */
const OUT = 15.2

/* reading: the counter runs 0 to TOTAL over [C0, C1]; card n is read when it reaches n */
const TOTAL = 34
const C0 = 0.5
const C1 = 6.3
const READ = 0.7
const readAt = (n: number) => C0 + ((C1 - C0) * n) / TOTAL
const arriveAt = (n: number) => readAt(n) - READ

type Src = { n: number; brand: Brand; title: string; meta: string }
const SOURCES: Src[] = [
  { n: 3, brand: B.arxiv, title: 'Read the tree, not pixels', meta: 'arXiv, Sep 4' },
  { n: 7, brand: B.scholar, title: 'Plan twice, click once', meta: 'Workshop paper, Sep 8' },
  { n: 12, brand: B.arxiv, title: 'Why web agents stall', meta: 'arXiv, Sep 11' },
  { n: 18, brand: B.chrome, title: 'Pop ups and other traps', meta: 'Lab blog, Sep 15' },
  { n: 24, brand: B.scholar, title: 'Agents on live websites', meta: 'Preprint, Sep 19' },
  { n: 31, brand: B.arxiv, title: 'A harder web benchmark', meta: 'arXiv, Sep 23' },
]

/* writing */
const TITLE = 'Browser agents, September brief'
const TITLE_AT: [number, number] = [2.2, 3.0]
const PARA = 'Browser agents got much more reliable this month, mostly by reading pages better.'
const PARA_AT: [number, number] = [3.15, 5.0]
const TYPE = 0.75
type Point = { text: string; cites: number[]; a: number }
const POINTS: Point[] = [
  { text: 'Agents that read the page structure beat screenshot agents on long forms.', cites: [3], a: 5.65 },
  { text: 'Planning two steps ahead cut failed runs by about a third.', cites: [7, 12], a: 6.6 },
  { text: 'Most failures still come from pop ups, logins and slow pages.', cites: [18], a: 7.55 },
  { text: 'Older benchmarks are nearly solved, so new ones test live sites.', cites: [24, 31], a: 8.5 },
]
/** when citation marker n appears in the page */
const CITE: Record<number, number> = {}
POINTS.forEach((p) => p.cites.forEach((n, k) => (CITE[n] = p.a + TYPE + 0.1 + k * 0.14)))
const SAVED = 9.9

const WORDS = [TITLE, PARA, ...POINTS.map((p) => p.text)]

const BLUE = '#2383e2'
const GREEN = '#1f9d55'
const blue = (a: number) => `rgba(35,131,226,${a})`

export function ResearchPanel({ prompt, previewTime }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const t = usePanelTimeline(LOOP, ref, REST, previewTime)
  const live = 1 - ep(t, OUT, OUT + 0.7)
  const count = Math.min(TOTAL, Math.floor(TOTAL * seg(t, C0, C1)))
  const fill = seg(t, C0, C1)

  return (
    <PanelRoot
      ref={ref}
      label="An agent reads 34 recent papers on browser agents from arXiv and Google Scholar, then writes a cited two-page brief in Notion."
    >
      <div className="@container flex h-full flex-col">
        <Ask text={prompt} />
        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2.5 @min-[480px]:grid @min-[480px]:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] @min-[480px]:gap-3">
          <SourceList t={t} live={live} count={count} fill={fill} />
          <SourceStrip t={t} live={live} count={count} fill={fill} />
          <Doc t={t} live={live} />
        </div>
      </div>
    </PanelRoot>
  )
}

/* ---------- sources, desktop: a list of cards ---------- */

function SourceList({ t, live, count, fill }: { t: number; live: number; count: number; fill: number }) {
  const num = Math.min(ep(t, 0.1, 0.45), live)
  const more = count - SOURCES.filter((s) => s.n <= count).length
  return (
    <Glass className="hidden min-h-0 flex-col p-3 @min-[480px]:flex">
      <div className="flex items-center gap-2 px-0.5">
        <span className="text-[13px] font-medium text-ink">Sources</span>
        <span className="ml-auto flex items-baseline gap-1.5">
          <span className="text-[11px] text-ink-3">Papers read</span>
          <span className="w-[2ch] text-right text-[15px] font-medium tabular-nums text-ink" style={{ opacity: num }}>
            {count}
          </span>
        </span>
      </div>
      <Bar fill={fill} live={live} className="mt-2.5" />
      <div className="mt-3 flex flex-col gap-[5px]">
        {SOURCES.map((s) => (
          <SourceCard key={s.n} s={s} t={t} live={live} />
        ))}
      </div>
      {more > 0 && (
        <div className="mt-auto flex items-center justify-center gap-2 pt-2 text-[12px] text-ink-3" style={{ opacity: Math.min(ep(t, readAt(12), readAt(12) + 0.4), live) }}>
          <span className="flex items-center gap-1.5">
            {[B.arxiv, B.scholar, B.chrome].map((b) => (
              <AppIcon key={b.title} brand={b} size={14} bare />
            ))}
          </span>
          <span className="tabular-nums">and {more} more read</span>
        </div>
      )}
    </Glass>
  )
}

function SourceCard({ s, t, live }: { s: Src; t: number; live: number }) {
  const a = arriveAt(s.n)
  const p = ep(t, a, a + 0.45)
  const op = Math.min(p, live)
  const r = readAt(s.n)
  const done = ep(t, r, r + 0.3)
  const c = CITE[s.n]
  const hi = inOut(t, c, c + 0.75, 0.3)
  const cited = ep(t, c, c + 0.3)
  return (
    <div
      className="flex items-center gap-2 rounded-[9px] px-2.5 py-[7px]"
      style={{
        opacity: op,
        transform: `translateY(${(1 - p) * 8}px) scale(${0.97 + 0.03 * p + 0.012 * hi})`,
        background: `rgb(${lerp(255, 240, hi)},${lerp(255, 246, hi)},255)`,
        boxShadow: `0 0 0 1px rgba(0,0,0,${0.06 * (1 - hi)}), 0 0 0 ${1.5 * hi}px ${blue(0.75 * hi)}, 0 8px 18px -12px ${blue(0.7 * hi)}`,
      }}
    >
      <AppIcon brand={s.brand} size={26} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium leading-[1.3] text-ink">{s.title}</div>
        <div className="flex items-center gap-1.5 text-[11px] leading-[1.35] text-ink-3">
          <span className="truncate">{s.meta}</span>
          {cited > 0 && (
            <span className="shrink-0 rounded-[4px] px-[3px] font-medium" style={{ color: BLUE, background: blue(0.1), ...popIn(cited) }}>
              [{s.n}]
            </span>
          )}
        </div>
      </div>
      <span className="relative h-4 w-4 shrink-0">
        {done < 1 && op > 0 && <ReadRing p={ep(t, a + 0.15, r)} size={15} className="absolute left-[0.5px] top-[0.5px]" style={{ opacity: 1 - done }} />}
        {done > 0 && <Check soft size={16} className="absolute inset-0" style={popIn(done)} />}
      </span>
    </div>
  )
}

/* ---------- sources, phone: one row of chips ---------- */

function SourceStrip({ t, live, count, fill }: { t: number; live: number; count: number; fill: number }) {
  const num = Math.min(ep(t, 0.1, 0.45), live)
  return (
    <Glass className="relative flex shrink-0 items-center gap-2.5 overflow-hidden px-3 py-2.5 @min-[480px]:hidden">
      <div className="w-[60px] shrink-0 leading-none">
        <div className="text-[18px] font-medium tabular-nums text-ink" style={{ opacity: num }}>
          {count}
        </div>
        <div className="mt-1 text-[11px] leading-[1.2] text-ink-3">papers read</div>
      </div>
      <div className="flex min-w-0 flex-1 justify-end gap-1">
        {SOURCES.map((s) => (
          <Chip key={s.n} s={s} t={t} live={live} />
        ))}
      </div>
      <Bar fill={fill} live={live} className="absolute inset-x-3 bottom-[5px] h-[2px]" />
    </Glass>
  )
}

function Chip({ s, t, live }: { s: Src; t: number; live: number }) {
  const a = arriveAt(s.n)
  const p = ep(t, a, a + 0.4)
  const op = Math.min(p, live)
  const r = readAt(s.n)
  const done = ep(t, r, r + 0.3)
  const c = CITE[s.n]
  const hi = inOut(t, c, c + 0.75, 0.3)
  const cited = ep(t, c, c + 0.3)
  /* logo on top; under it a reading ring that turns into the paper's number once read, grey,
     then blue when the brief cites it. A green dot marks read until the citation takes over. */
  return (
    <span
      className="relative flex h-[40px] min-w-0 max-w-[36px] flex-1 flex-col items-center rounded-[9px] pt-[7px]"
      style={{
        opacity: op,
        transform: `scale(${0.86 + 0.14 * p + 0.04 * hi})`,
        background: `rgb(${lerp(255, 240, hi)},${lerp(255, 246, hi)},255)`,
        boxShadow: `0 0 0 1px rgba(0,0,0,${0.08 * (1 - hi)}), 0 0 0 ${1.5 * hi}px ${blue(0.75 * hi)}`,
      }}
    >
      <AppIcon brand={s.brand} size={15} bare />
      <span className="relative mt-[4px] h-[11px] w-full">
        {done < 1 && op > 0 && (
          <ReadRing p={ep(t, a + 0.15, r)} size={11} className="absolute left-1/2 top-0 -ml-[5.5px]" style={{ opacity: 1 - done }} />
        )}
        {done > 0 && (
          <span
            className="absolute inset-0 text-center text-[11px] font-medium leading-[11px] tabular-nums"
            style={{ opacity: done, color: cited > 0 ? `color-mix(in srgb, ${BLUE} ${cited * 100}%, #8f8f8f)` : '#8f8f8f' }}
          >
            {s.n}
          </span>
        )}
      </span>
      {done > 0 && cited < 1 && (
        <span className="absolute right-[4px] top-[4px] h-[5px] w-[5px] rounded-full" style={{ background: GREEN, opacity: done * (1 - cited) }} />
      )}
    </span>
  )
}

/* ---------- the Notion page ---------- */

function Doc({ t, live }: { t: number; live: number }) {
  const started = Math.min(ep(t, 2.0, 2.4), live)
  const saved = ep(t, SAVED, SAVED + 0.35)
  const gone = ep(t, SAVED, SAVED + 0.18)
  const tag = ep(t, SAVED + 0.16, SAVED + 0.45)
  const wait = Math.min(inOut(t, 0.3, 1.85, 0.3), live)
  const titleP = seg(t, ...TITLE_AT)
  const paraP = seg(t, ...PARA_AT)
  const pointP = POINTS.map((pt) => seg(t, pt.a, pt.a + TYPE))
  const typing = (p: number) => p > 0 && p < 1
  /* the page runs on past what fits in view (it is two pages), so the count follows the typing
     but lands on a two page length rather than the 62 words that show here */
  const shown = WORDS.reduce((sum, w, i) => {
    const p = i === 0 ? titleP : i === 1 ? paraP : pointP[i - 2]
    return sum + (p > 0 ? w.slice(0, Math.round(w.length * p)).split(' ').filter(Boolean).length : 0)
  }, 0)
  const words = (shown * 15).toLocaleString('en-US')

  return (
    <Glass className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white/95">
      <div className="relative flex h-10 shrink-0 items-center gap-2 border-b border-black/[0.06] px-3">
        <AppIcon brand={B.notion} size={22} />
        {/* on a phone the saved pill takes over this bar; on desktop it sits in the footer */}
        <div className="flex min-w-0 flex-1 items-center gap-2 @min-[480px]:opacity-100!" style={{ opacity: 1 - saved * live }}>
          <span className="min-w-0 truncate text-[12px] text-ink-3">
            Research <span className="px-0.5 text-ink-dim">/</span> <span className="text-ink-2">September brief</span>
          </span>
          <span className="relative ml-auto h-4 w-[64px] shrink-0 text-[12px]">
            {/* Writing leaves first, then Saved comes in, so the two words never overlap */}
            {started > 0 && gone < 1 && (
              <span
                className="absolute inset-0 flex items-center justify-end gap-1.5 text-ink-3"
                style={{ opacity: started * (1 - gone), transform: `translateY(${-3 * gone}px)` }}
              >
                <Spin t={t} size={11} />
                Writing
              </span>
            )}
            {tag > 0 && (
              <span
                className="absolute inset-0 flex items-center justify-end text-ink-3"
                style={{ opacity: Math.min(tag, live), transform: `translateY(${3 * (1 - tag)}px)` }}
              >
                Saved
              </span>
            )}
          </span>
        </div>
        {saved > 0 && (
          <div className="absolute inset-y-0 left-[42px] flex items-center @min-[480px]:hidden">
            <SavedPill p={saved} live={live} />
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1 px-4 pt-3 @min-[480px]:pt-3.5">
        {wait > 0 && (
          <div className="absolute inset-x-4 top-3.5" style={{ opacity: wait }}>
            <div className="flex items-center gap-2 text-[12px] text-ink-3">
              <Spin t={t} size={12} />
              Waiting for the first sources
            </div>
            {/* placeholder lines, so the empty page reads as loading rather than blank */}
            <div className="mt-4 flex flex-col gap-2.5">
              {[0.62, 0.94, 0.86, 0.7].map((w, i) => (
                <span key={i} className="h-2 rounded-full bg-black/[0.05]" style={{ width: `${w * 100}%` }} />
              ))}
            </div>
          </div>
        )}
        <div style={{ opacity: live }}>
          <h4 className="text-[16px] font-medium leading-[1.3] tracking-[-0.01em] text-ink @min-[480px]:text-[18px]">
            <Typed text={TITLE} p={titleP} caret={typing(titleP)} />
          </h4>
          <p className="mt-1.5 text-[12.5px] leading-[1.5] text-ink-2 @min-[480px]:text-[13px]">
            <Typed text={PARA} p={paraP} caret={typing(paraP)} />
          </p>
          <h5 className="mt-3.5 hidden text-[13px] font-medium text-ink @min-[480px]:block" style={rise(ep(t, 5.15, 5.55), 4, 0)}>
            Key findings
          </h5>
          <ul className="mt-2.5 flex flex-col gap-1.5 @min-[480px]:mt-2 @min-[480px]:gap-2">
            {/* a small phone runs out of height for the fourth point, so it drops rather than being cut off */}
            {POINTS.map((pt, i) => (
              <Bullet key={i} pt={pt} p={pointP[i]} t={t} className={i === POINTS.length - 1 ? '@max-[310px]:hidden' : undefined} />
            ))}
          </ul>
        </div>
      </div>

      <div className="hidden h-11 shrink-0 items-center justify-between gap-2 border-t border-black/[0.06] px-3 @min-[480px]:flex">
        <span className="text-[11px] tabular-nums text-ink-3" style={{ opacity: started }}>
          {words} words
        </span>
        {saved > 0 && <SavedPill p={saved} live={live} />}
      </div>
    </Glass>
  )
}

function Bullet({ pt, p, t, className }: { pt: Point; p: number; t: number; className?: string }) {
  const show = ep(t, pt.a - 0.1, pt.a + 0.25)
  return (
    <li className={cn('flex gap-2', className)} style={rise(show, 4, 0)}>
      <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-ink" />
      <span className="text-[12.5px] leading-[1.45] text-ink @min-[480px]:text-[13px]">
        <Typed text={pt.text} p={p} caret={p > 0 && p < 1} />
        {pt.cites.map((n) => {
          const c = CITE[n]
          const on = ep(t, c, c + 0.3)
          const hi = inOut(t, c, c + 0.75, 0.3)
          return (
            <span
              key={n}
              className="relative -top-[0.4em] ml-[2px] inline-block rounded-[3px] px-[2px] text-[11px] font-medium leading-none"
              style={{ color: BLUE, opacity: on, background: blue(0.16 * hi), transform: `scale(${0.8 + 0.2 * on})` }}
            >
              [{n}]
            </span>
          )
        })}
      </span>
    </li>
  )
}

/* ---------- small pieces ---------- */

function SavedPill({ p, live }: { p: number; live: number }) {
  return (
    <span
      className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-[#eaf6ef] pl-1.5 pr-2.5 text-[12px] font-medium text-[#17663c]"
      style={{ ...popIn(p), opacity: Math.min(clamp(p * 1.6), live) }}
    >
      <Check size={16} />
      Brief saved to Notion, 2 pages
    </span>
  )
}

/** text typed up to progress p; the rest is laid out invisibly so nothing moves as it types */
function Typed({ text, p, caret }: { text: string; p: number; caret?: boolean }) {
  const n = Math.round(text.length * clamp(p))
  return (
    <>
      {text.slice(0, n)}
      {caret && <span className="inline-block h-[1.05em] w-0 align-[-0.15em] shadow-[0_0_0_0.75px_#0a0a0a]" />}
      <span className="invisible">{text.slice(n)}</span>
    </>
  )
}

/** reading progress; the fill turns green once every paper is read */
function Bar({ fill, live, className }: { fill: number; live: number; className?: string }) {
  const full = ep(fill, 0.98, 1)
  return (
    <div className={cn('h-[2px] overflow-hidden rounded-full bg-black/[0.06]', className)}>
      <div
        className="h-full origin-left rounded-full"
        style={{ transform: `scaleX(${fill})`, opacity: live, background: full > 0 ? `color-mix(in srgb, ${GREEN} ${full * 100}%, #0a0a0a)` : '#0a0a0a' }}
      />
    </div>
  )
}

/** a spinner driven by the clock, so a frozen frame is always the same */
function Spin({ t, size, className, style }: { t: number; size: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      className={cn('block shrink-0 rounded-full border-[1.5px] border-black/15 border-t-black', className)}
      style={{ width: size, height: size, transform: `rotate(${(t * 420) % 360}deg)`, ...style }}
    />
  )
}

/** a green check; `soft` is the quiet tinted one used for "read", the solid one means done */
function Check({ size, soft, className, style }: { size: number; soft?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full', className)}
      style={{ width: size, height: size, background: soft ? '#e3f4ea' : GREEN, ...style }}
    >
      <svg viewBox="0 0 16 16" width={size * 0.62} height={size * 0.62}>
        <path d="M3.5 8.4l2.9 2.9 6.1-6.6" fill="none" stroke={soft ? GREEN : '#fff'} strokeWidth={soft ? 2.2 : 2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

/** how far through a paper the agent is, as a ring that closes */
function ReadRing({ p, size, className, style }: { p: number; size: number; className?: string; style?: CSSProperties }) {
  const r = (size - 2) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} className={cn('block', className)} style={{ transform: 'rotate(-90deg)', ...style }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth={1.75} />
      {p > 0 && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#0a0a0a" strokeWidth={1.75} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p)} />
      )}
    </svg>
  )
}
