import { useRef, type CSSProperties, type ReactNode } from 'react'
import { B } from '@/lib/brands'
import { Desktop, Glyph, Mark, Stage, clamp, easeInOut, ep, lerp, popIn, rise, seg, typed, useTimeline } from './kit'

/*
  Browsing in parallel. One ask ("Best food in Berkeley") becomes six browser windows that
  fly out of the agent, each types its own search, loads a result page and reads it, then
  the windows fold back into the agent and a Top 5 card rises in the middle. Pure function
  of t; at the end the pill glides back to the centre and the opening card opens under it
  again, so the last frame is the first frame.
*/

const W = 520
const H = 325
const LOOP = 11
const REST = 6.9

type Brand = { path: string; hex: string; title: string }
type Site = {
  q: string
  url: string
  brand: Brand
  name: string
  r: number
  n: string
  pages: number
  table: [string, string]
  food: [string, string]
}

const SITES: Site[] = [
  { q: 'pizza berkeley', url: 'reddit.com', brand: B.reddit, name: 'Cheese Board Pizza', r: 4.8, n: '2.1k', pages: 12, table: ['#f8ead6', '#efd7b4'], food: ['#f6cf4d', '#d9473b'] },
  { q: 'tacos near campus', url: 'google.com/maps', brand: B.gmaps, name: 'Comal', r: 4.7, n: '1.4k', pages: 9, table: ['#dcf3e5', '#aedfc3'], food: ['#9fd35e', '#e2b64a'] },
  { q: 'izakaya berkeley', url: 'yelp.com', brand: B.yelp, name: 'Ippuku', r: 4.6, n: '980', pages: 14, table: ['#4a3d4c', '#2e2631'], food: ['#f3a7a0', '#b8483e'] },
  { q: 'chinese berkeley', url: 'instagram.com', brand: B.instagram, name: 'Great China', r: 4.6, n: '1.8k', pages: 11, table: ['#fbdfe4', '#f3b3bf'], food: ['#fff7e8', '#c9423f'] },
  { q: 'dinner berkeley', url: 'youtube.com', brand: B.youtube, name: 'Chez Panisse', r: 4.5, n: '3.2k', pages: 8, table: ['#e7e4f8', '#c8c1ee'], food: ['#86b86b', '#f2e4c6'] },
  { q: 'late night food', url: 'google.com', brand: B.chrome, name: 'Top Dog', r: 4.4, n: '760', pages: 10, table: ['#2f2757', '#4b3b8c'], food: ['#f7d774', '#b84a62'] },
]

const TOP5 = [
  { name: 'Cheese Board Pizza', kind: 'Pizza', r: 4.8, brand: B.reddit },
  { name: 'Comal', kind: 'Mexican', r: 4.7, brand: B.gmaps },
  { name: 'Ippuku', kind: 'Izakaya', r: 4.6, brand: B.yelp },
  { name: 'Great China', kind: 'Chinese', r: 4.6, brand: B.instagram },
  { name: 'Chez Panisse', kind: 'Californian', r: 4.5, brand: B.youtube },
]

/* window grid: 3 x 2, each 156 x 124 (26 px title bar, 98 px page) */
const WW = 156
const WH = 124
const slot = (i: number) => ({ x: 14 + (i % 3) * (WW + 12), y: 50 + Math.floor(i / 3) * (WH + 12) })

/* where the agent pill sits: centred in the opening card, then parked top left */
const PILL_OPEN = { x: 110, y: 98 }
const PILL_PARK = { x: 14, y: 12 }
const SPAWN = { x: 128, y: 26 } // windows fly out of (and back into) the parked pill

/* per window timing (seconds). The farthest windows fly out first, so the later, smaller
   ones open near the pill instead of crossing over windows already in place. */
const FLY_ORDER = [5, 4, 1, 3, 2, 0] // rank of each window in the fly-out
const JIT = [0.05, 0.2, 0, 0.18, 0.1, 0.02]
const LOAD = [0.6, 0.5, 0.85, 0.55, 0.75, 0.65]
const DONE = [5.25, 6.05, 5.6, 6.35, 5.15, 5.85]
/* the fold back: the grid zooms into the pill as one piece, nearest window first. With one
   uniform scale per window and the nearest leading, no window ever crosses another. */
const FOLD = 7.0
const FOLD_ORDER = [0, 1, 4, 2, 3, 5]
const TIMES = SITES.map((s, i) => {
  const fly = 1.3 + FLY_ORDER[i] * 0.07
  const type = fly + 0.88 + JIT[i]
  const typeEnd = type + s.q.length * 0.045
  const load = typeEnd + 0.18
  const loadEnd = load + LOAD[i]
  return { fly, type, typeEnd, load, loadEnd, done: DONE[i], back: FOLD + FOLD_ORDER[i] * 0.025 }
})

const GLOBE = 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM3 10h14M10 3c2 2 2.8 4.4 2.8 7S12 15 10 17M10 3C8 5 7.2 7.4 7.2 10S8 15 10 17'
const SEARCH = 'M9 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12.7 12.7 16.5 16.5'

/* ---------- small local pieces ---------- */

function starPath(cx: number, cy: number, R: number) {
  const r = R * 0.46
  let d = ''
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5
    const rad = k % 2 ? r : R
    d += `${k ? 'L' : 'M'}${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`
  }
  return d + 'Z'
}

function Stars({ r, size = 10 }: { r: number; size?: number }) {
  const gap = 1.6
  const full = Math.round(r)
  const at = (k: number) => starPath(k * (size + gap) + size / 2, size / 2 + 0.4, size / 2)
  const on = Array.from({ length: full }, (_, k) => at(k)).join('')
  const off = Array.from({ length: 5 - full }, (_, k) => at(full + k)).join('')
  return (
    <svg width={5 * size + 4 * gap} height={size + 1} viewBox={`0 0 ${5 * size + 4 * gap} ${size + 1}`} aria-hidden className="shrink-0">
      <path d={on} fill="#f4bf2a" />
      {off && <path d={off} fill="#e2dbe5" />}
    </svg>
  )
}

function Check({ size = 8 }: { size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden>
      <path d="M2.5 6.3 5 8.6l4.6-5" stroke="#fff" strokeWidth={1.9} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Three dots that pulse with a 1 s period, so they are identical at t = 0 and t = LOOP. */
function Dots({ t }: { t: number }) {
  return (
    <span className="inline-flex gap-[4px]">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-[4.5px] w-[4.5px] rounded-full bg-[#b98cf8]" style={{ opacity: 0.3 + 0.7 * Math.max(0, Math.sin(2 * Math.PI * (t - i * 0.16))) }} />
      ))}
    </span>
  )
}

/** The agent's title row: three window dots and the dark title pill with its status. */
function AgentPill({ done, style }: { done: number; style?: CSSProperties }) {
  return (
    <div className="absolute flex items-center gap-[5px]" style={{ transformOrigin: '30% 50%', ...style }}>
      <span className="h-[8px] w-[8px] rounded-full bg-black/15" />
      <span className="h-[8px] w-[8px] rounded-full bg-black/15" />
      <span className="h-[8px] w-[8px] rounded-full bg-black/15" />
      <span className="ml-[3px] flex h-[28px] items-center gap-[9px] demo-title rounded-full pl-[12px] pr-[8px] text-[13.5px] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(40,20,40,0.7)]">
        Best food in Berkeley
        <span className="relative flex h-[18px] w-[54px] items-center justify-end">
          {done < 1 && (
            <span className="absolute right-[3px] text-[11px] font-normal text-white/50" style={{ opacity: 1 - done }}>
              working
            </span>
          )}
          {done > 0 && (
            <span className="absolute right-0 flex h-[18px] items-center gap-[3px] rounded-full bg-[#2f9e6e] pl-[5px] pr-[7px] text-[11px] font-medium text-white" style={popIn(done)}>
              <Check size={8} />
              Done
            </span>
          )}
        </span>
      </span>
    </div>
  )
}

/** A small light browser window like the kit's BrowserWin, with an 11 px address bar. */
function Win({ url, dim, loading, children }: { url: string; dim: boolean; loading: number; children?: ReactNode }) {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-[10px] bg-white shadow-[0_18px_40px_-22px_rgba(50,20,60,0.55),0_0_0_1px_rgba(60,30,70,0.1)]">
      <div className="relative flex h-[26px] items-center bg-[#f3f1f4] px-[9px]">
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#ff5f57]" style={{ boxShadow: '11px 0 0 #febc2e, 22px 0 0 #28c840' }} />
        <span className={`ml-[29px] flex h-[17px] min-w-0 flex-1 items-center truncate rounded-[5px] bg-white px-[7px] text-[11px] ${dim ? 'text-[#aaa2af]' : 'text-[#5f5766]'}`}>{url}</span>
        {loading > 0 && loading < 1.2 && <span className="absolute bottom-0 left-0 h-[2px] bg-[#3b82f6]" style={{ width: `${Math.min(1, loading) * 100}%`, opacity: 1 - clamp((loading - 1) * 5) }} />}
      </div>
      <div className="relative h-[98px]">{children}</div>
    </div>
  )
}

function imageBg(s: Site) {
  const [a, b] = s.food
  // a top-down table: one plate with toppings, one side dish (the block is 156 x 36)
  return [
    `radial-gradient(circle at 78px 15px, ${b} 0 2.5px, transparent 3px)`,
    `radial-gradient(circle at 86.5px 17.5px, ${b} 0 2.3px, transparent 2.8px)`,
    `radial-gradient(circle at 80px 22.5px, ${b} 0 2.1px, transparent 2.6px)`,
    `radial-gradient(circle at 82px 18px, ${a} 0 9.5px, #fff 10px 13.5px, rgba(0,0,0,0.1) 14px 15px, transparent 15.5px)`,
    `radial-gradient(circle at 117px 22px, ${b} 0 4.5px, #fff 5px 7.8px, rgba(0,0,0,0.1) 8.3px 9.1px, transparent 9.6px)`,
    `linear-gradient(135deg, ${s.table[0]}, ${s.table[1]})`,
  ].join(', ')
}

/** One of the six browsers, positioned by its own timeline. */
function Browser({ t, i }: { t: number; i: number }) {
  const s = SITES[i]
  const T = TIMES[i]
  const out = ep(t, T.fly, T.fly + 0.8)
  const back = easeInOut(seg(t, T.back, T.back + 0.6))
  if (out <= 0.001 || back >= 0.999) return null

  const { x, y } = slot(i)
  const cx = x + WW / 2
  const cy = y + WH / 2
  // fly out: from the pill, growing as it travels. Fold back: a uniform zoom into the pill.
  const sc = back > 0 ? lerp(1, 0.08, back) : lerp(0.12, 1, out)
  const k = back > 0 ? 1 - sc : 1 - out
  const box: CSSProperties = {
    left: x,
    top: y,
    width: WW,
    height: WH,
    opacity: back > 0 ? 1 - seg(back, 0.4, 0.92) : clamp(out * 2.2),
    transform: `translate(${(SPAWN.x - cx) * k}px, ${(SPAWN.y - cy) * k}px) scale(${sc})`,
  }

  const typeP = seg(t, T.type, T.typeEnd)
  const loading = t >= T.load ? seg(t, T.load, T.loadEnd) + (t > T.loadEnd ? (t - T.loadEnd) : 0) : 0
  const nav = ep(t, T.loadEnd - 0.05, T.loadEnd + 0.4)
  const searchO = 1 - ep(t, T.loadEnd - 0.1, T.loadEnd + 0.12)
  const readP = seg(t, T.loadEnd + 0.25, T.done)
  const page = Math.max(1, Math.ceil(readP * s.pages))
  const doneP = ep(t, T.done, T.done + 0.4)
  const caretOn = t >= T.type - 0.3 && t < T.load && (t * 2.2) % 1 < 0.6

  return (
    <div className="absolute" style={box}>
      <Win url={t >= T.load ? s.url : 'New tab'} dim={t < T.load} loading={loading}>
        {searchO > 0 && (
          <div className="absolute inset-0 flex flex-col items-center pt-[22px]" style={{ opacity: searchO }}>
            <div className="flex h-[27px] w-[144px] items-center gap-[6px] rounded-full bg-white px-[9px] shadow-[inset_0_0_0_1px_rgba(60,30,70,0.16),0_3px_8px_-5px_rgba(60,30,70,0.35)]">
              <Glyph d={SEARCH} size={12} className="shrink-0 text-[#8d8494]" />
              {typeP > 0 ? (
                <span className="whitespace-nowrap text-[11.5px] font-medium text-[#27212b]">{typed(s.q, typeP)}</span>
              ) : (
                <span className="whitespace-nowrap text-[11.5px] text-[#aaa2af]">Search</span>
              )}
              {caretOn && <span className="-ml-[4px] h-[12px] w-[1.5px] bg-[#8b5cf6]" />}
            </div>
            <div className="mt-[10px] flex gap-[6px]">
              <span className="h-[10px] w-[34px] rounded-[3px] bg-[#f1edf3]" />
              <span className="h-[10px] w-[34px] rounded-[3px] bg-[#f1edf3]" />
            </div>
          </div>
        )}
        {nav > 0 && (
          <div className="absolute inset-0" style={rise(nav, 8, 0)}>
            <div className="relative h-[36px]" style={{ background: imageBg(s) }}>
              <Mark brand={s.brand} size={20} className="absolute left-[6px] top-[6px] shadow-[0_2px_5px_-2px_rgba(0,0,0,0.3)]" />
            </div>
            <div className="px-[9px] pt-[5px]">
              <div className="truncate text-[12.5px] font-semibold leading-[16px] text-[#1f1a22]">{s.name}</div>
              <div className="mt-[4px] flex items-center gap-[5px] text-[11px] leading-none">
                <Stars r={s.r} />
                <span className="font-semibold text-[#3a3340]">{s.r.toFixed(1)}</span>
                <span className="text-[#9a919f]">({s.n})</span>
              </div>
            </div>
            {/* reading footer: a page counter with a violet progress line, then a green check */}
            <div className="absolute inset-x-0 bottom-0 h-[22px] border-t border-[#f0ecf2]" style={{ background: `rgba(47,158,110,${0.1 * doneP})` }}>
              <span className="absolute left-[9px] top-[4px] h-[13px] w-[13px]">
                {doneP < 1 && (
                  <svg viewBox="0 0 14 14" width={13} height={13} aria-hidden className="absolute inset-0" style={{ opacity: 1 - doneP, transform: `rotate(${Math.round(t * 420)}deg)` }}>
                    <circle cx="7" cy="7" r="5.2" fill="none" stroke="#8b5cf6" strokeWidth={1.8} strokeDasharray="21 12" strokeLinecap="round" />
                  </svg>
                )}
                {doneP > 0 && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-[#2f9e6e]" style={popIn(doneP)}>
                    <Check size={8} />
                  </span>
                )}
              </span>
              {doneP < 1 && (
                <span className="absolute left-[28px] top-0 whitespace-nowrap text-[11px] font-medium leading-[21px] text-[#7c5bd6]" style={{ opacity: 1 - clamp(doneP * 2) }}>
                  Reading page {page}
                </span>
              )}
              {doneP > 0 && (
                <span className="absolute left-[28px] top-0 whitespace-nowrap text-[11px] font-semibold leading-[21px] text-[#1f6b4a]" style={{ opacity: clamp(doneP * 2 - 0.4), transform: `translateX(${(1 - doneP) * 4}px)` }}>
                  Read {s.pages} pages
                </span>
              )}
              {readP > 0 && doneP < 1 && <span className="absolute bottom-0 left-0 h-[2.5px] bg-[#8b5cf6]" style={{ width: `${readP * 100}%`, opacity: 1 - doneP }} />}
            </div>
          </div>
        )}
      </Win>
    </div>
  )
}

/** Top right: what the agent is doing, and one dot per browser that turns green when it finishes. */
function Status({ t }: { t: number }) {
  const o = ep(t, 1.55, 1.95) * (1 - ep(t, 8.45, 8.8))
  if (o <= 0) return null
  const label = t < 4.15 ? 'Searching' : t < 6.7 ? 'Reading' : 'Ranking'
  const lo = Math.min(clamp(Math.abs(t - 4.15) / 0.15), clamp(Math.abs(t - 6.7) / 0.15))
  return (
    <div
      className="absolute right-[14px] top-[13px] flex h-[26px] items-center gap-[9px] rounded-full bg-white/70 pl-[11px] pr-[11px] shadow-[0_0_0_1px_rgba(60,30,70,0.08),0_6px_14px_-10px_rgba(60,30,70,0.5)]"
      style={{ ...rise(o, 6, 0) }}
    >
      <span className="w-[62px] text-[11.5px] font-medium text-[#4a3f4d]" style={{ opacity: lo }}>
        {label}
      </span>
      <span className="flex gap-[4px]">
        {TIMES.map((T, i) => {
          const d = ep(t, T.done, T.done + 0.4)
          return (
            <span
              key={i}
              className="h-[7px] w-[7px] rounded-full"
              style={{ background: `color-mix(in srgb, #2f9e6e ${Math.round(d * 100)}%, #d8cde2)`, transform: `scale(${1 + 0.45 * Math.sin(Math.PI * d)})` }}
            />
          )
        })}
      </span>
    </div>
  )
}

/** The Top 5 card that rises in the centre once the browsers fold away. */
function Results({ t, fade }: { t: number; fade: number }) {
  const p = ep(t, 7.45, 8.05)
  if (p <= 0 || fade >= 1) return null
  return (
    <div
      className="absolute left-[100px] top-[66px] w-[320px] overflow-hidden rounded-[14px] bg-white px-[14px] pb-[8px] pt-[12px] shadow-[0_24px_50px_-24px_rgba(50,20,60,0.6),0_0_0_1px_rgba(60,30,70,0.08)]"
      style={{
        opacity: p * (1 - fade),
        transform: `translateY(${(1 - p) * 16 + fade * 6}px) scale(${(0.95 + 0.05 * p) * (1 - 0.03 * fade)})`,
        transformOrigin: '50% 0%',
      }}
    >
      <div className="flex items-baseline justify-between pb-[8px]">
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-[#1f1a22]">Top 5 in Berkeley</span>
        <span className="text-[11px] text-[#9a919f]">64 pages, 6 sites</span>
      </div>
      {TOP5.map((row, i) => {
        const rp = ep(t, 7.72 + i * 0.09, 8.2 + i * 0.09)
        return (
          <div key={row.name} className="flex h-[34px] items-center gap-[9px] border-t border-[#f0ecf2]" style={rise(rp, 8, 0)}>
            <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${i === 0 ? 'bg-[#8b5cf6] text-white' : 'bg-[#f1ecf6] text-[#7a6d86]'}`}>{i + 1}</span>
            <span className="truncate text-[13px] font-semibold text-[#221c26]">{row.name}</span>
            <span className="text-[11px] text-[#9a919f]">{row.kind}</span>
            <span className="ml-auto flex items-center gap-[3px] text-[12px] font-semibold tabular-nums text-[#3a3340]">
              <svg width={11} height={11} viewBox="0 0 11 11" aria-hidden>
                <path d={starPath(5.5, 5.9, 5.3)} fill="#f4bf2a" />
              </svg>
              {row.r.toFixed(1)}
            </span>
            <Mark brand={row.brand} size={20} />
          </div>
        )
      })}
    </div>
  )
}

/** The compact opening card body: the ask and the first step. */
function OpeningBody({ t, style }: { t: number; style: CSSProperties }) {
  return (
    <div className="absolute w-[300px] rounded-[14px] demo-panel p-[14px]" style={style}>
      <div className="ml-auto w-fit rounded-[10px] demo-inset px-[12px] py-[7px] text-[13px] leading-[1.45] text-white">Find the best food in Berkeley</div>
      <div className="mt-[12px] flex items-center gap-[8px] text-[13px]">
        <Glyph d={GLOBE} size={15} className="text-[#b085f5]" />
        <span className="font-medium text-[#c09cf9]">Opening 6 browsers</span>
        <Dots t={t} />
      </div>
    </div>
  )
}

export function BrowserScene() {
  const ref = useRef<HTMLDivElement>(null)
  const t = useTimeline(LOOP, ref, REST)

  // closing: the Top 5 card settles away, the pill glides back to the centre and the
  // opening card opens under it again, so the last frame is the first frame
  const fadeOut = ep(t, 10.15, 10.45)
  const home = easeInOut(seg(t, 10.25, 10.85))
  const reopen = ep(t, 10.5, 10.95)

  // the agent pill moves from the opening card to the top left, and back at the end
  const move = easeInOut(seg(t, 1.0, 1.55)) * (1 - home)
  const pillPos = { left: lerp(PILL_OPEN.x, PILL_PARK.x, move), top: lerp(PILL_OPEN.y, PILL_PARK.y, move) }
  const pillDone = ep(t, 8.75, 9.1) * (1 - ep(t, 10.3, 10.6))
  // a small swell as the six browsers fold into it
  const swell = 1 + 0.035 * Math.sin(Math.PI * seg(t, 7.3, 7.85))

  // the opening card body folds up into the pill as it leaves, and opens again at the end
  const collapse = easeInOut(seg(t, 0.9, 1.35))
  const bodyO = t < 5 ? 1 - collapse : reopen

  return (
    <Stage w={W} h={H} stageRef={ref} label="An agent asked for the best food in Berkeley opens six browser windows at once, each searches and reads its own pages, then the results fold into a Top 5 list.">
      <Desktop wallpaper>
        {/* the six browsers, under the pill so they fly out from behind it */}
        {t > 1 && t < 8 && SITES.map((_, i) => <Browser key={i} t={t} i={i} />)}

        <Results t={t} fade={fadeOut} />
        <Status t={t} />

        {/* opening card body, hanging under the pill wherever it is */}
        {bodyO > 0.001 && (
          <OpeningBody
            t={t}
            style={{
              left: pillPos.left,
              top: pillPos.top + 38,
              opacity: bodyO,
              transformOrigin: '20% 0%',
              transform: `translateY(${-12 * (1 - bodyO)}px) scale(${0.9 + 0.1 * bodyO})`,
            }}
          />
        )}

        {/* the agent pill: the opening card's title, parked top left while the browsers work */}
        <AgentPill done={pillDone} style={{ ...pillPos, transform: `scale(${swell})` }} />
      </Desktop>
    </Stage>
  )
}
