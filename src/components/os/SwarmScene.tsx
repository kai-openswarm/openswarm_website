import { useRef, type CSSProperties } from 'react'
import { Cursor, Desktop, Glyph, Mark, Stage, clamp, easeInOut, easeOut, ep, inOut, lerp, path, rise, seg, typed, useTimeline } from './kit'
import { B, type Brand } from '@/lib/brands'

/*
  Problem Validator as a coded scene for the "A swarm for the big jobs" card. An ask is typed
  and launched, the panel folds into a Planner node, six source agents branch off it and search
  at the same time, every find travels back up its line into one running total, then the best
  quotes rise in a results card, which folds back into the empty panel for the loop. Everything
  on screen is a pure function of the clock t.
*/

const W = 520
const H = 325
const LOOP = 11.4
const REST = 7.3

const QUERY = 'Founders who can’t find people with the problem they’re solving'

/* ---------- timing (seconds) ---------- */

const TYPE_A = 0.1
const TYPE_B = 1.3
const CLICK = 1.55
const MORPH_A = 1.85
const MORPH_B = 2.5
const LINE_A = 2.3
const LINE_STEP = 0.08
const LINE_DUR = 0.55
const CHIP_LAG = 0.36
const TRAVEL = 0.6
const DIM_A = 7.45
const CARD_A = 7.55
const ROW_A = 7.8
const ROW_STEP = 0.11
const OUT_A = 10.7
const OUT_B = 11.2

/* ---------- layout (stage px) ---------- */

type Rect = { x: number; y: number; w: number; h: number; r: number }
const PANEL: Rect = { x: 80, y: 56, w: 360, h: 206, r: 16 }
const PILL: Rect = { x: 208, y: 18, w: 104, h: 36, r: 18 }
const CARD: Rect = { x: 15, y: 64, w: 490, h: 222, r: 16 }
const CHIP_W = 158
const CHIP_H = 52
const ROW_Y = [96, 157, 218]
const LEFT_X = 14
const RIGHT_X = W - 14 - CHIP_W
const COUNTER_Y = 272

const lerpRect = (a: Rect, b: Rect, p: number): Rect => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p), r: lerp(a.r, b.r, p) })
const WHITE_SHADOW = '0 20px 44px -22px rgba(50,20,60,0.6), 0 0 0 1px rgba(60,30,70,0.06)'

type Agent = { label: string; brand: Brand; side: -1 | 1; row: number; n: number; first: number; last: number }

/* line order: left and right alternate from the top, so the swarm fans out evenly */
const AGENTS: Agent[] = [
  { label: 'r/startups', brand: B.reddit, side: -1, row: 0, n: 9, first: 3.62, last: 6.3 },
  { label: 'X', brand: B.x, side: 1, row: 0, n: 11, first: 3.55, last: 6.45 },
  { label: 'r/SaaS', brand: B.reddit, side: -1, row: 1, n: 6, first: 3.9, last: 6.15 },
  { label: 'Product Hunt', brand: B.producthunt, side: 1, row: 1, n: 3, first: 4.5, last: 5.95 },
  { label: 'Hacker News', brand: B.ycombinator, side: -1, row: 2, n: 5, first: 4.1, last: 6.25 },
  { label: 'LinkedIn', brand: B.linkedin, side: 1, row: 2, n: 4, first: 4.3, last: 6.35 },
]

const QUOTES = [
  { brand: B.reddit, src: 'r/startups, 2 days ago', text: 'Spent three weeks trying to find people to interview.' },
  { brand: B.x, src: 'X, 5 hours ago', text: 'Every founder group I post in ignores me.' },
  { brand: B.ycombinator, src: 'Hacker News, 1 week ago', text: 'I need ten users with this exact problem, not a survey.' },
]

/* ---------- curves from the planner to each agent ---------- */

type Pt = [number, number]
type Curve = [Pt, Pt, Pt, Pt]

const CURVES: Curve[] = AGENTS.map((a) => {
  const yc = ROW_Y[a.row]
  // the line to the top chip leaves the pill furthest out, so the six lines nest without crossing
  const sx = 260 + a.side * (30 - a.row * 11)
  const ex = a.side < 0 ? LEFT_X + CHIP_W : RIGHT_X
  const y0 = PILL.y + PILL.h - 4
  return [
    [sx, y0],
    [sx, lerp(y0, yc, 0.8)],
    [ex - a.side * 44, yc],
    [ex, yc],
  ]
})

const D = CURVES.map((c) => `M${c[0]} C${c[1]} ${c[2]} ${c[3]}`)

function bez(c: Curve, s: number): Pt {
  const u = 1 - s
  const a = u * u * u
  const b = 3 * u * u * s
  const d = 3 * u * s * s
  const e = s * s * s
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]]
}

/* ---------- finds: when each agent finds a person (deterministic) ---------- */

const hash = (n: number) => {
  const v = Math.sin(n * 12.9898 + 4.1414) * 43758.5453
  return v - Math.floor(v)
}

const FINDS: number[][] = AGENTS.map((a, i) =>
  Array.from({ length: a.n }, (_, k) => {
    const u = a.n === 1 ? 0 : k / (a.n - 1)
    const jitter = k === 0 || k === a.n - 1 ? 0 : (hash(i * 31 + k * 7) - 0.5) * 0.08
    return a.first + (a.last - a.first) * Math.pow(u, 0.9) + jitter
  }),
)
const ALL = FINDS.flatMap((f, a) => f.map((e) => ({ a, e })))
const ARRIVALS = ALL.map((f) => f.e + TRAVEL)

const countAt = (times: number[], t: number) => times.filter((e) => e <= t).length

/** a soft pulse that rises and settles (peak 1 at dt = tau), so nothing snaps on a new event */
const pulse = (dt: number, tau: number) => (dt <= 0 ? 0 : (dt / tau) * Math.exp(1 - dt / tau))
/** overlapping pulses add up instead of restarting, so a busy stream becomes a steady glow */
const glow = (times: number[], t: number, tau: number, gain = 1) => clamp(gain * times.reduce((s, e) => s + pulse(t - e, tau), 0))

/* ---------- colour ---------- */

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
function mix(a: string, b: string, p: number) {
  const x = hex(a)
  const y = hex(b)
  const c = x.map((v, i) => Math.round(lerp(v, y[i], clamp(p))))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/* ---------- pieces ---------- */

function Spinner({ t }: { t: number }) {
  return (
    <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden className="shrink-0" style={{ transform: `rotate(${(t * 420) % 360}deg)` }}>
      <circle cx="6" cy="6" r="4.4" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={1.7} />
      <path d="M6 1.6a4.4 4.4 0 0 1 4.4 4.4" fill="none" stroke="#b58cff" strokeWidth={1.7} strokeLinecap="round" />
    </svg>
  )
}

function Check({ size = 12, bg = '#2f9e6e' }: { size?: number; bg?: string }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden>
      <circle cx="6" cy="6" r="6" fill={bg} />
      <path d="M3.4 6.2 5.2 8l3.4-3.8" fill="none" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The white Problem Validator panel, laid out at its full size. */
function PanelBody({ text, placeholder, caret, btn, press }: { text: string; placeholder: boolean; caret: boolean; btn: number; press: number }) {
  return (
    <div className="flex flex-col p-[18px]" style={{ width: PANEL.w, height: PANEL.h }}>
      <div className="flex items-center gap-[9px]">
        <span className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-white" style={{ background: 'linear-gradient(160deg,#b58cff,#7b4dea)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)' }}>
          <Glyph d="M9 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12.7 12.7 16.5 16.5" size={15} />
        </span>
        <span className="text-[15px] font-semibold text-[#1f1b22]">Problem Validator</span>
        <span className="ml-auto text-[12px] text-[#8a8290]">New hunt</span>
      </div>
      <div className="mt-[14px] text-[12px] font-medium text-[#8a8290]">What problem are you validating?</div>
      <div className="mt-[7px] h-[62px] rounded-[10px] bg-[#f5f2f7] px-[12px] py-[9px] text-[14px] leading-[20px] text-[#1f1b22] shadow-[inset_0_0_0_1px_rgba(60,30,70,0.08)]">
        {placeholder ? <span className="text-[#a39aa8]">Describe the problem you want to validate</span> : text}
        {caret && <span className="ml-px inline-block h-[17px] w-[1.5px] translate-y-[3px] bg-[#8b5cf6]" />}
      </div>
      <div className="mt-auto flex items-center">
        <span className="flex">
          {[B.reddit, B.x, B.ycombinator, B.producthunt, B.linkedin].map((b, i) => (
            <span key={b.title} className="flex rounded-[8px] bg-white p-[2px]" style={{ marginLeft: i ? -7 : 0 }}>
              <Mark brand={b} size={22} fill />
            </span>
          ))}
        </span>
        <span className="ml-[8px] text-[12px] text-[#8a8290]">6 sources</span>
        <span
          className="ml-auto flex h-[34px] items-center gap-[7px] rounded-[10px] px-[14px] text-[13px] font-semibold text-white"
          style={{ background: mix('#231e26', '#7b4dea', btn), transform: `scale(${1 - 0.05 * press})`, boxShadow: '0 6px 14px -8px rgba(40,20,50,0.7)' }}
        >
          Launch hunt
          <svg viewBox="0 0 12 12" width={11} height={11} aria-hidden>
            <path d="M2.5 6h7M6.5 3l3 3-3 3" fill="none" stroke="#c9b3ff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </div>
  )
}

function PillBody({ dot, ring, done, style }: { dot: number; ring: number; done: number; style?: CSSProperties }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-[8px]" style={style}>
      <span
        className="h-[8px] w-[8px] rounded-full"
        style={{ background: mix('#a78bfa', '#34c08a', done), opacity: dot, boxShadow: `0 0 0 ${2 + 4 * ring}px rgba(167,139,250,${0.4 * ring})` }}
      />
      <span className="text-[14px] font-semibold text-white">Planner</span>
    </div>
  )
}

/** The results card body, laid out at its full size. */
function CardBody({ t }: { t: number }) {
  return (
    <div style={{ width: CARD.w, height: CARD.h }}>
      <div className="flex h-[48px] items-center px-[20px]">
        <span className="text-[16px] font-semibold text-[#1f1b22]">People with this problem</span>
        <span className="ml-auto rounded-full bg-[#8b5cf6]/12 px-[10px] py-[3px] text-[13px] font-semibold text-[#6d3fd9]">38 found</span>
      </div>
      {QUOTES.map((q, i) => {
        const p = ep(t, ROW_A + i * ROW_STEP, ROW_A + i * ROW_STEP + 0.5)
        return (
          <div key={q.src} className="flex h-[58px] items-center border-t border-black/[0.06] px-[20px]">
            {p > 0 && (
              <div className="flex min-w-0 flex-1 items-center gap-[12px]" style={rise(p, 8, 0)}>
                <Mark brand={q.brand} size={30} />
                <div className="min-w-0">
                  <div className="text-[12px] leading-[16px] text-[#8a8290]">{q.src}</div>
                  <div className="truncate text-[15px] font-medium leading-[21px] text-[#1f1b22]">“{q.text}”</div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Chip({ a, t, appear, count, first, last, bump }: { a: Agent; t: number; appear: number; count: number; first: number; last: number; bump: number }) {
  const e = easeOut(appear)
  const searching = 1 - seg(t, first - 0.02, first + 0.12)
  const found = seg(t, first, first + 0.18)
  const done = seg(t, last + 0.1, last + 0.35)
  const style: CSSProperties = {
    left: a.side < 0 ? LEFT_X : RIGHT_X,
    top: ROW_Y[a.row] - CHIP_H / 2,
    width: CHIP_W,
    height: CHIP_H,
    opacity: clamp(appear * 1.6),
    transform: `scale(${(0.86 + 0.14 * e) * (1 + 0.03 * bump)})`,
    transformOrigin: a.side < 0 ? '100% 50%' : '0% 50%',
    boxShadow: `0 14px 26px -16px rgba(40,20,50,0.75), inset 0 0 0 1px rgba(255,255,255,0.06), 0 0 0 ${1.5 * bump}px rgba(167,139,250,${0.55 * bump})`,
  }
  return (
    <div className="absolute flex items-center gap-[10px] rounded-[14px] bg-[#3f353f] pl-[12px] pr-[10px]" style={style}>
      <Mark brand={a.brand} size={28} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold leading-[19px] text-white">{a.label}</span>
        <span className="relative h-[17px] text-[12.5px] leading-[17px]">
          {searching > 0 && (
            <span className="absolute inset-0 flex items-center gap-[5px] whitespace-nowrap text-white/60" style={{ opacity: searching }}>
              <Spinner t={t} />
              searching
            </span>
          )}
          {found > 0 && (
            <span className="absolute inset-0 flex items-center gap-[5px] whitespace-nowrap" style={{ opacity: found }}>
              <span className="relative h-[12px] w-[12px] shrink-0">
                {done < 1 && <span className="absolute left-[2px] top-[2px] h-[8px] w-[8px] rounded-full bg-[#b58cff]" style={{ opacity: (1 - done) * (0.55 + 0.45 * bump) }} />}
                {done > 0 && (
                  <span className="absolute inset-0" style={{ opacity: done, transform: `scale(${0.6 + 0.4 * easeOut(done)})` }}>
                    <Check />
                  </span>
                )}
              </span>
              <span className="font-semibold tabular-nums text-white">{count}</span>
              <span className="text-white/60">found</span>
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

/* ---------- scene ---------- */

export function SwarmScene() {
  const ref = useRef<HTMLDivElement>(null)
  const t = useTimeline(LOOP, ref, REST)

  // opening panel
  const typeP = seg(t, TYPE_A, TYPE_B)
  const caret = t > 0.06 && t < MORPH_A && (t < TYPE_B + 0.05 || Math.floor((t - TYPE_B) / 0.32) % 2 === 1)
  const btn = ep(t, CLICK, CLICK + 0.2)
  const press = inOut(t, CLICK - 0.04, CLICK + 0.1, 0.1)

  // the panel morphs into the planner pill: it shrinks toward the top, turns dark, and its
  // content hands over from the form to the Planner label
  const m = easeInOut(seg(t, MORPH_A, MORPH_B))
  const node = lerpRect(PANEL, PILL, m)
  const darken = seg(m, 0.28, 0.72)
  const panelO = 1 - seg(m, 0.08, 0.45)
  const pillO = seg(m, 0.62, 1)
  const nodeEnd = easeInOut(seg(t, OUT_A, OUT_A + 0.35))
  const nodeO = 1 - nodeEnd

  // search
  const arrived = ARRIVALS.filter((e) => e <= t)
  const total = arrived.length
  const ring = glow(arrived, t, 0.06, 0.8)
  const breathe = inOut(t, 3.2, 7.0, 0.3) * 0.35 * (0.5 + 0.5 * Math.sin(t * 6))
  const allDone = ep(t, 7.1, 7.35)

  // results: the swarm fades back while the card rises over it
  const dim = ep(t, DIM_A, DIM_A + 0.5)
  const graphO = 1 - dim
  const cardP = ep(t, CARD_A, CARD_A + 0.55)
  const counterP = seg(t, 3.0, 3.45)

  // the ending: the card folds back into the empty opening panel
  const q = easeInOut(seg(t, OUT_A, OUT_B))
  const box = lerpRect(CARD, PANEL, q)
  const cardO = 1 - seg(q, 0, 0.42)
  const backO = seg(q, 0.5, 1)

  // pointer
  const [cx, cy] = path(t, [
    [0.45, 470, 300],
    [1.42, 366, 229],
    [1.75, 366, 229],
    [2.25, 392, 262],
  ])
  const cursorO = ep(t, 0.45, 0.75) * (1 - ep(t, MORPH_A + 0.05, MORPH_A + 0.35))

  return (
    <Stage w={W} h={H} stageRef={ref} label="OpenSwarm's Problem Validator sends one agent each to Reddit, X, Hacker News, Product Hunt and LinkedIn, then gathers 38 people who have the problem.">
      <Desktop wallpaper>
        {/* the swarm: lines, finds in flight, agent chips and the running total */}
        {graphO > 0.005 && t > LINE_A && (
          <div className="absolute inset-0" style={{ opacity: graphO, transform: `scale(${1 - 0.04 * dim})`, transformOrigin: '260px 50px' }}>
            <svg className="absolute inset-0" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
              {D.map((d, i) => {
                const p = ep(t, LINE_A + i * LINE_STEP, LINE_A + i * LINE_STEP + LINE_DUR)
                if (p <= 0) return null
                return <path key={i} d={d} pathLength={1} fill="none" stroke="#8b5cf6" strokeOpacity={0.45} strokeWidth={1.8} strokeLinecap="round" strokeDasharray="1 1" strokeDashoffset={1 - p} />
              })}
              {ALL.map((f, i) => {
                const k = (t - f.e) / TRAVEL
                if (k <= 0 || k >= 1) return null
                const [x, y] = bez(CURVES[f.a], 1 - easeInOut(k))
                const o = Math.min(1, k / 0.1, (1 - k) / 0.12)
                return (
                  <g key={i} opacity={o}>
                    <circle cx={x} cy={y} r={7} fill="#8b5cf6" fillOpacity={0.18} />
                    <circle cx={x} cy={y} r={3.6} fill="#8b5cf6" stroke="#fff" strokeWidth={1.3} />
                  </g>
                )
              })}
            </svg>

            {AGENTS.map((a, i) => {
              const s = LINE_A + i * LINE_STEP + CHIP_LAG
              const ap = seg(t, s, s + 0.45)
              if (ap <= 0) return null
              const f = FINDS[i]
              return <Chip key={a.label} a={a} t={t} appear={ap} count={countAt(f, t)} first={f[0]} last={f[f.length - 1]} bump={glow(f, t, 0.07)} />
            })}

            {counterP > 0 && (
              <div
                className="absolute flex h-[44px] w-[196px] items-center justify-center gap-[8px] rounded-full bg-white/90 shadow-[0_14px_28px_-16px_rgba(50,20,60,0.55),0_0_0_1px_rgba(60,30,70,0.06)]"
                style={{ left: 260 - 98, top: COUNTER_Y - 22, opacity: clamp(counterP * 1.6), transform: `translateY(${(1 - easeOut(counterP)) * 8}px) scale(${0.9 + 0.1 * easeOut(counterP)})` }}
              >
                <span className="w-[38px] text-right text-[28px] font-bold leading-none tabular-nums text-[#6d3fd9]">{total}</span>
                <span className="w-[104px] text-[15px] font-medium text-[#3a323a]">{total === 1 ? 'person found' : 'people found'}</span>
              </div>
            )}
          </div>
        )}

        {/* one node: the Problem Validator panel, then (folded) the Planner pill */}
        {nodeO > 0.005 && (
          <div
            className="absolute overflow-hidden"
            style={{
              left: node.x,
              top: node.y,
              width: node.w,
              height: node.h,
              borderRadius: node.r,
              background: mix('#ffffff', '#2a252c', darken),
              boxShadow: `0 ${lerp(20, 10, m)}px ${lerp(44, 22, m)}px ${lerp(-22, -10, m)}px rgba(50,20,60,${lerp(0.6, 0.7, m)}), 0 0 0 1px rgba(60,30,70,0.06), inset 0 0 0 1px rgba(255,255,255,${0.06 * darken})`,
              opacity: nodeO,
              transform: nodeEnd > 0 ? `scale(${1 - 0.08 * nodeEnd})` : undefined,
            }}
          >
            {panelO > 0 && (
              <div className="absolute left-0 top-0 origin-top-left" style={{ opacity: panelO, transform: `scale(${node.w / PANEL.w})` }}>
                <PanelBody text={typed(QUERY, typeP)} placeholder={typeP <= 0} caret={caret} btn={btn} press={press} />
              </div>
            )}
            {pillO > 0 && <PillBody dot={1 - breathe} ring={ring} done={allDone} style={{ opacity: pillO, transform: `scale(${0.9 + 0.1 * easeOut(pillO)})` }} />}
          </div>
        )}

        {/* results card, which folds back into the empty opening panel at the end */}
        {cardP > 0 && (
          <div
            className="absolute overflow-hidden bg-white"
            style={{
              left: box.x,
              top: box.y,
              width: box.w,
              height: box.h,
              borderRadius: box.r,
              boxShadow: WHITE_SHADOW,
              ...(cardP < 1 ? rise(cardP, 24, 0.03) : null),
              transformOrigin: '50% 100%',
            }}
          >
            {cardO > 0 && (
              <div className="absolute" style={{ left: (box.w - CARD.w) / 2, top: (box.h - CARD.h) / 2, opacity: cardO }}>
                <CardBody t={t} />
              </div>
            )}
            {backO > 0 && (
              <div className="absolute" style={{ left: (box.w - PANEL.w) / 2, top: (box.h - PANEL.h) / 2, opacity: backO }}>
                <PanelBody text="" placeholder caret={false} btn={0} press={0} />
              </div>
            )}
          </div>
        )}

        {cursorO > 0.01 && <Cursor x={cx} y={cy} click={seg(t, CLICK, CLICK + 0.45)} style={{ opacity: cursorO }} />}
      </Desktop>
    </Stage>
  )
}
