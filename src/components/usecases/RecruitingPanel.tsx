import { useRef, type CSSProperties } from 'react'
import { clamp, easeInOut, ep, lerp, popIn, seg } from '../os/kit'
import { AppIcon } from '../ui/AppIcon'
import { B } from '@/lib/brands'
import { cn } from '@/lib/utils'
import { Ask, Glass, PanelRoot, Spinner, type PanelProps } from './shared'
import { usePanelTimeline } from './usePanelTimeline'

/*
  Recruiting, shown as a hiring pipeline. Applicants from Greenhouse are read one at a time;
  the ones who fit move to Screened, get their work checked on LinkedIn and a score, and the
  best slide on to the Shortlist, which stays in score order. Then the top ten land on next
  week's calendar as intro calls and Gmail sends the invites.

  A wide panel shows a three-column board; a narrow one (phones) shows the same flow as a
  stacked funnel with avatars. Both read the same model, and everything is a pure function of
  the clock t, so ?t= freezes any moment.
*/

const LOOP = 16
const REST = 12 // reduced motion: the finished board and calendar
const OUT = 15.3 // the finished work fades from here
const DIP = 15.6 // counters and status lines swap back to their t=0 values here, while faded

const MOVE = 0.55 // one column to the next
const SHIFT = 0.4 // a column closing up a gap
const HOLD = 0.9 // time in Screened before a top candidate moves on

const CAL0 = 6.7 // first intro call lands on the calendar
const CAL_STEP = 0.24
const TOAST = 9.35

const PITCH = 48 // board row pitch (card 42 + gap 6)
const LANE = 52 // funnel lane height
const DOT = 40 // funnel avatar pitch

/** soft avatar colours: [fill, ink] */
const TONES: [string, string][] = [
  ['#dfe9fd', '#2a56c6'],
  ['#ebe4fd', '#6a3fcf'],
  ['#fbe3ee', '#b3336a'],
  ['#daf2e4', '#1f7a47'],
  ['#d8efef', '#17706c'],
  ['#e8e9ee', '#4c5566'],
  ['#fde4e3', '#b23b3b'],
  ['#e2e6fd', '#3e47c0'],
]

type Cand = { name: string; ini: string; line: string; tone: number; r: number; score?: number; short?: boolean }

/**
  The applicants we get to see, in the order the agent reads them. `r` is when it finishes one.
  The shortlisted ones come first and in score order, so every move is a clean slide: each
  lands in an empty Screened column, and the Shortlist fills top down already ranked.
*/
const CANDS: Cand[] = [
  { name: 'Priya S.', ini: 'PS', line: 'Design systems', tone: 2, r: 1.2, score: 96, short: true },
  { name: 'Tom B.', ini: 'TB', line: 'Print, 1 yr', tone: 5, r: 2.2 },
  { name: 'Aisha N.', ini: 'AN', line: 'Product, 5 yrs', tone: 0, r: 2.78, score: 94, short: true },
  { name: 'Ines K.', ini: 'IK', line: 'Packaging, 2 yrs', tone: 6, r: 3.78 },
  { name: 'Ana T.', ini: 'AT', line: 'iOS apps, 4 yrs', tone: 1, r: 4.36, score: 92, short: true },
  { name: 'Jonah P.', ini: 'JP', line: '8 case studies', tone: 3, r: 5.26, score: 84 },
  { name: 'Leo M.', ini: 'LM', line: 'Motion, 3 yrs', tone: 4, r: 5.96, score: 88 },
]

/** The ten intro calls, in the order they get booked: day 0..4 (Mon..Fri), row 0..2. */
const CALLS = [
  { ini: 'PS', name: 'Priya S.', tone: 2, day: 0, row: 0 },
  { ini: 'AN', name: 'Aisha N.', tone: 0, day: 1, row: 1 },
  { ini: 'AT', name: 'Ana T.', tone: 1, day: 2, row: 1 },
  { ini: 'BC', name: 'Ben C.', tone: 4, day: 3, row: 0 },
  { ini: 'KN', name: 'Kira N.', tone: 7, day: 4, row: 0 },
  { ini: 'DF', name: 'Diego F.', tone: 3, day: 0, row: 2 },
  { ini: 'HY', name: 'Hana Y.', tone: 6, day: 1, row: 0 },
  { ini: 'SL', name: 'Sofia L.', tone: 5, day: 2, row: 2 },
  { ini: 'NG', name: 'Noah G.', tone: 0, day: 3, row: 1 },
  { ini: 'EW', name: 'Eli W.', tone: 1, day: 4, row: 2 },
]
const BUSY = [
  { day: 0, row: 1 },
  { day: 2, row: 0 },
  { day: 3, row: 2 },
]
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const HOURS = ['10am', '1pm', '3pm']

/* ---------- the model ---------- */

const passed = (c: Cand) => c.score === undefined
const leaveS = (c: Cand) => c.r + HOLD
/** when the agent has made up its mind (a pass shows its tag a beat before the card goes) */
const decided = (c: Cand) => (passed(c) ? c.r - 0.35 : c.r)
const smooth = (p: number) => p * p * (3 - 2 * p)

/** queue position in Applied: everyone ahead of you who has not left yet */
function slotA(q: number, t: number) {
  let s = 0
  for (let j = 0; j < q; j++) {
    // close up once a departing card is mostly clear of the column
    const a = CANDS[j].r + (passed(CANDS[j]) ? 0.1 : 0.22)
    s += 1 - ep(t, a, a + SHIFT)
  }
  return s
}

/** position in Screened, oldest on top: the earlier arrivals still there */
function slotS(q: number, t: number) {
  let s = 0
  for (let j = 0; j < q; j++) {
    const c = CANDS[j]
    if (passed(c)) continue
    s += c.short ? 1 - ep(t, leaveS(c), leaveS(c) + SHIFT) : 1
  }
  return s
}

/** position in Shortlist, kept in score order: the higher scores that have arrived */
function slotL(q: number, t: number) {
  const me = CANDS[q].score ?? 0
  let s = 0
  CANDS.forEach((c, j) => {
    if (j === q || !c.short || (c.score ?? 0) <= me) return
    // make room a beat before the higher score sets off, so the two cards barely cross
    s += ep(t, leaveS(c) - 0.2, leaveS(c) - 0.2 + SHIFT)
  })
  return s
}

type Placed = {
  c: Cand
  x: number // stage, 0 Applied, 1 Screened, 2 Shortlist (fractional while moving)
  y: number // row within the stage
  dy: number // px, first entrance lift
  o: number
  s: number
  lift: number // 0..1 while travelling between stages
  read: { w: number; o: number } // the reading bar
  chip: { p: number; label: string; tone: 'good' | 'ok' | 'pass' } | null
  under: boolean // still coming up from behind the queue
}

function place(c: Cand, q: number, t: number, W: number): Placed {
  const a = slotA(q, t)
  let x = 0
  let y = a > 2 ? 2 + (a - 2) * 0.25 : a
  const first = q < 3 ? ep(t, 0.35 + q * 0.1, 0.8 + q * 0.1) : 1
  // a new card from further down the queue fades in near its row once the gap above has closed
  let o = q < 3 ? first : clamp((2.5 - a) * 2)
  const dy = (1 - first) * 8
  let s = 1
  let lift = 0

  if (passed(c)) {
    const f = ep(t, c.r, c.r + 0.3)
    o *= 1 - f
    s = 1 - 0.05 * f
  } else if (t >= c.r) {
    const p = easeInOut(seg(t, c.r, c.r + MOVE))
    const ss = slotS(q, t)
    x = p
    // the row leads the column a little, so a card finds its row before it arrives
    y = lerp(y, ss, easeInOut(seg(t, c.r, c.r + MOVE * 0.7)))
    lift = Math.sin(Math.PI * p)
    if (c.short && t >= leaveS(c)) {
      const p2 = easeInOut(seg(t, leaveS(c), leaveS(c) + MOVE))
      x = 1 + p2
      y = lerp(ss, slotL(q, t), easeInOut(seg(t, leaveS(c), leaveS(c) + MOVE * 0.7)))
      lift = Math.sin(Math.PI * p2)
    }
  }

  const d = decided(c)
  const read = { w: seg(t, d - 0.45, d), o: Math.min(ep(t, d - 0.45, d - 0.35), 1 - ep(t, d, d + 0.2)) }

  let chip: Placed['chip'] = null
  if (passed(c)) {
    const p = ep(t, d, d + 0.25)
    if (p > 0) chip = { p, label: 'Pass', tone: 'pass' }
  } else {
    const at = c.r + MOVE + 0.05
    const p = ep(t, at, at + 0.3)
    if (p > 0) chip = { p, label: String(c.score), tone: (c.score ?? 0) >= 90 ? 'good' : 'ok' }
  }

  return { c, x, y, dy, o: o * W, s, lift, read, chip, under: a > 2 }
}

/* ---------- small pieces ---------- */

function Avatar({ ini, tone, size, ring = 0 }: { ini: string; tone: number; size: number; ring?: number }) {
  const [bg, fg] = TONES[tone]
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-medium tracking-[-0.01em]"
      style={{ width: size, height: size, background: bg, color: fg, fontSize: 11, boxShadow: ring > 0.01 ? `0 0 0 2px #fff, 0 0 0 3.5px rgba(10,10,10,${0.4 * ring})` : undefined }}
    >
      {ini}
    </span>
  )
}

const CHIP: Record<'good' | 'ok' | 'pass', string> = {
  good: 'bg-[#e3f5ea] text-[#17703f]',
  ok: 'bg-black/[0.05] text-ink-2',
  pass: 'bg-black/[0.04] text-ink-3',
}

function Chip({ chip }: { chip: NonNullable<Placed['chip']> }) {
  return (
    <span className={cn('ml-auto shrink-0 rounded-[5px] px-[5px] text-[11px] font-medium leading-[16px] tabular-nums', CHIP[chip.tone])} style={popIn(chip.p)}>
      {chip.label}
    </span>
  )
}

function Check({ size = 14 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-[#1f9d55]" style={{ width: size, height: size }}>
      <svg viewBox="0 0 16 16" width={size * 0.7} height={size * 0.7} fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 8.4l2.9 2.8 6-6.4" />
      </svg>
    </span>
  )
}

/** Status lines that trade places in one spot: each is [opacity, node]. */
function Swap({ items, className }: { items: [number, React.ReactNode][]; className?: string }) {
  return (
    <div className={cn('grid shrink-0 justify-items-end', className)}>
      {items.map(([o, node], i) =>
        o > 0.01 ? (
          <div key={i} className="flex items-center gap-1.5 [grid-area:1/1]" style={{ opacity: o }}>
            {node}
          </div>
        ) : null,
      )}
    </div>
  )
}

/* ---------- the panel ---------- */

export function RecruitingPanel({ prompt, previewTime }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const t = usePanelTimeline(LOOP, ref, REST, previewTime)

  const W = 1 - ep(t, OUT, OUT + 0.5) // the work itself fades out at the end
  const tt = t >= DIP ? 0 : t // counters and status read this, so they come back as at t=0
  const dip = t < OUT ? 1 : t < DIP ? 1 - ep(t, OUT, DIP) : ep(t, DIP, LOOP - 0.1)

  const placed = CANDS.map((c, q) => place(c, q, t, W)).filter((k) => k.o > 0.01)

  const readN = Math.round(120 * smooth(seg(tt, 0.9, 5.96)))
  const screenN = Math.round(24 * smooth(seg(tt, 1.2, 6.45)))
  const shortN = Math.round(10 * smooth(seg(tt, 2.0, 6.5)))
  const bookN = CALLS.filter((_, i) => tt >= CAL0 + i * CAL_STEP + 0.15).length
  const counts = [120, screenN, shortN]

  const allRead = ep(t, 6.35, 6.75) * W

  const pipeStatus: [number, React.ReactNode][] = [
    [(1 - ep(tt, 0.9, 1.2)) * dip, <span className="text-[12px] text-ink-3">120 new</span>],
    [
      Math.min(ep(tt, 0.9, 1.2), 1 - ep(tt, 6.45, 6.65)) * dip,
      <>
        <Spinner t={t} className="h-3 w-3" />
        <span className="text-[12px] tabular-nums text-ink-2">Reading {readN} of 120</span>
      </>,
    ],
    [
      ep(tt, 6.55, 6.85) * dip,
      <>
        <Check />
        <span className="text-[12px] text-ink-2">Top 10 picked</span>
      </>,
    ],
  ]

  const calStatus: [number, React.ReactNode][] = [
    [(1 - ep(tt, CAL0 - 0.2, CAL0 + 0.1)) * dip, <span className="text-[12px] text-ink-3">Next week</span>],
    [
      Math.min(ep(tt, CAL0 - 0.2, CAL0 + 0.1), 1 - ep(tt, TOAST - 0.15, TOAST + 0.05)) * dip,
      <>
        <Spinner t={t} className="h-3 w-3" />
        <span className="text-[12px] tabular-nums text-ink-2">Booking {bookN} of 10</span>
      </>,
    ],
    [
      ep(tt, TOAST, TOAST + 0.35) * dip,
      <span
        className="flex items-center gap-1.5 rounded-full bg-white py-[3px] pl-1.5 pr-2 shadow-[0_0_0_1px_rgba(0,0,0,0.07),0_8px_18px_-10px_rgba(10,30,60,0.45)]"
        style={{ transform: `translateY(${(1 - ep(tt, TOAST, TOAST + 0.35)) * 6}px)` }}
      >
        <AppIcon brand={B.gmail} size={14} bare />
        <span className="text-[12px] font-medium text-ink">10 invites sent</span>
        <Check size={13} />
      </span>,
    ],
  ]

  return (
    <PanelRoot
      ref={ref}
      label="A hiring pipeline: an agent reads 120 Greenhouse applicants, screens 24, checks their work on LinkedIn and scores them, shortlists the top ten, books intro calls for them on next week's calendar and sends the invites from Gmail."
    >
      <div className="@container flex h-full flex-col">
        <Ask text={prompt} />

        {/* the pipeline */}
        <Glass className="mt-2.5 shrink-0 p-3">
          <div className="flex h-[22px] items-center gap-2">
            <AppIcon brand={B.greenhouse} size={22} />
            <span className="truncate text-[13px] font-medium text-ink">Product Designer</span>
            <span className="hidden text-[12px] text-ink-3 @min-[440px]:inline">Greenhouse</span>
            <Swap items={pipeStatus} className="ml-auto" />
          </div>

          {/* wide: a three-column board */}
          <div className="relative mt-2.5 hidden grid-cols-3 gap-2 @min-[560px]:grid">
            {['Applied', 'Screened', 'Shortlist'].map((name, i) => (
              <div key={name} className="rounded-[10px] bg-black/[0.03] p-1.5">
                <div className="flex h-5 items-center justify-between px-1">
                  <span className="text-[12px] text-ink-2">{name}</span>
                  <span className={cn('text-[13px] font-medium tabular-nums', i === 2 && shortN === 10 ? 'text-[#17703f]' : 'text-ink')} style={{ opacity: i === 0 ? 1 : dip }}>
                    {counts[i]}
                  </span>
                </div>
                <div className="relative mx-1 mt-1 h-[2px] overflow-hidden rounded-full bg-black/[0.06]">
                  <div
                    className={cn('absolute inset-y-0 left-0 rounded-full', i === 2 ? 'bg-[#1f9d55]' : 'bg-ink')}
                    style={{ width: `${((i === 0 ? readN : counts[i]) / 120) * 100}%`, opacity: dip }}
                  />
                </div>
                <div className="h-[138px]" style={{ marginTop: 6 }} />
              </div>
            ))}

            {/* the cards, over the columns */}
            <div className="absolute inset-x-1.5 top-[38px] h-[138px]">
              {allRead > 0.01 && (
                <div className="absolute left-0 top-0 flex h-full items-center justify-center gap-1.5" style={{ width: 'calc((100% - 40px) / 3)', opacity: allRead }}>
                  <Check />
                  <span className="text-[12px] text-ink-2">All 120 read</span>
                </div>
              )}
              {placed.map((k) => (
                <div
                  key={k.c.ini}
                  className="absolute left-0 top-0 flex h-[42px] items-center gap-2 overflow-hidden rounded-[9px] bg-white px-2"
                  style={{
                    width: 'calc((100% - 40px) / 3)',
                    transform: `translate(calc(${k.x.toFixed(4)} * (100% + 20px)), ${(k.y * PITCH + k.dy).toFixed(2)}px) scale(${k.s})`,
                    opacity: k.o,
                    zIndex: k.lift > 0.01 ? 3 : k.under ? 0 : 1,
                    boxShadow: `0 0 0 1px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04), 0 ${(12 * k.lift).toFixed(1)}px 24px -12px rgba(10,30,60,${(0.4 * k.lift).toFixed(3)})`,
                  }}
                >
                  <Avatar ini={k.c.ini} tone={k.c.tone} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-[12.5px] font-medium leading-[16px] text-ink">{k.c.name}</span>
                      {k.chip && <Chip chip={k.chip} />}
                    </div>
                    <div className="flex items-center gap-1 text-[12px] leading-[15px] text-ink-3">
                      <AppIcon brand={B.linkedin} size={11} bare />
                      <span className="truncate">{k.c.line}</span>
                    </div>
                  </div>
                  {k.read.o > 0.01 && (
                    <span className="absolute bottom-0 left-0 h-[2px] rounded-full bg-ink/70" style={{ width: `${k.read.w * 100}%`, opacity: k.read.o }} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* narrow: the same flow as a stacked funnel */}
          <div className="relative mt-2 @min-[560px]:hidden" style={{ height: LANE * 3 }}>
            {['Applied', 'Screened', 'Shortlist'].map((name, i) => (
              <div key={name} className={cn('absolute inset-x-0 flex items-center', i > 0 && 'border-t border-black/[0.06]')} style={{ top: i * LANE, height: LANE }}>
                <div className="w-[74px] shrink-0">
                  <div className="text-[12px] leading-[15px] text-ink-2">{name}</div>
                  <div
                    className={cn('text-[17px] font-medium leading-[22px] tracking-[-0.01em] tabular-nums', i === 2 && shortN === 10 ? 'text-[#17703f]' : 'text-ink')}
                    style={{ opacity: i === 0 ? 1 : dip }}
                  >
                    {counts[i]}
                  </div>
                </div>
              </div>
            ))}
            <div className="absolute inset-y-0 left-[78px] right-0">
              {allRead > 0.01 && (
                <div className="absolute left-0 top-0 flex items-center gap-1.5" style={{ height: LANE, opacity: allRead }}>
                  <Check />
                  <span className="text-[12px] text-ink-2">All 120 read</span>
                </div>
              )}
              {placed.map((k) => (
                <div
                  key={k.c.ini}
                  className="absolute left-0 top-0 flex w-[36px] flex-col items-center"
                  style={{
                    transform: `translate(${(k.y * DOT).toFixed(2)}px, ${(k.x * LANE + 4 + k.dy).toFixed(2)}px) scale(${k.s})`,
                    opacity: k.o,
                    zIndex: k.lift > 0.01 ? 3 : k.under ? 0 : 1,
                  }}
                >
                  <Avatar ini={k.c.ini} tone={k.c.tone} size={30} ring={k.read.o} />
                  <span className="mt-[2px] h-[13px]">
                    {k.chip && (
                      <span
                        className={cn('block text-[11px] font-medium leading-[13px] tabular-nums', k.chip.tone === 'good' ? 'text-[#17703f]' : k.chip.tone === 'ok' ? 'text-ink-2' : 'text-ink-3')}
                        style={popIn(k.chip.p)}
                      >
                        {k.chip.label}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Glass>

        {/* the calendar */}
        <Glass className="mt-2.5 flex min-h-0 flex-1 flex-col p-3">
          <div className="flex h-[22px] items-center gap-2">
            <AppIcon brand={B.gcal} size={22} />
            <span className="truncate text-[13px] font-medium text-ink">Intro calls</span>
            <span className="text-[12px] text-ink-3 @max-[300px]:hidden">30 min</span>
            <Swap items={calStatus} className="ml-auto" />
          </div>

          {/* the rows share whatever height is left, so a prompt that wraps to three lines on a small phone never pushes the grid out of its card */}
          <div className="mt-2 grid min-h-0 flex-1 grid-cols-[30px_repeat(5,minmax(0,1fr))] grid-rows-[14px_repeat(3,minmax(0,1fr))] gap-x-1.5 gap-y-[3px]">
            {DAYS.map((d, i) => (
              <span key={d} className="px-0.5 text-[11px] leading-[14px] text-ink-3" style={{ gridColumn: i + 2, gridRow: 1 }}>
                {d}
              </span>
            ))}
            {HOURS.map((h, i) => (
              <span key={h} className="self-center text-[11px] leading-[14px] text-ink-3" style={{ gridColumn: 1, gridRow: i + 2 }}>
                {h}
              </span>
            ))}
            {DAYS.map((d, i) => (
              <span key={`bg-${d}`} className="rounded-[6px] bg-black/[0.03]" style={{ gridColumn: i + 2, gridRow: '2 / 5' }} />
            ))}
            {BUSY.map((b) => (
              <span
                key={`busy-${b.day}`}
                className="flex items-center rounded-[5px] px-1.5 text-[11px] text-ink-3"
                style={{
                  gridColumn: b.day + 2,
                  gridRow: b.row + 2,
                  background: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.045) 0 4px, rgba(0,0,0,0.02) 4px 8px)',
                }}
              >
                Busy
              </span>
            ))}
            {CALLS.map((c, i) => {
              const at = CAL0 + i * CAL_STEP
              const p = ep(t, at, at + 0.35)
              if (p <= 0.001 || W <= 0.01) return null
              const [bg, fg] = TONES[c.tone]
              const pop = popIn(p) as CSSProperties & { opacity: number }
              return (
                <span
                  key={c.ini}
                  className="flex min-w-0 items-center justify-center gap-1.5 rounded-[5px] px-[3px] @min-[480px]:justify-start"
                  style={{ gridColumn: c.day + 2, gridRow: c.row + 2, background: bg, boxShadow: `inset 2px 0 0 ${fg}`, ...pop, opacity: pop.opacity * W }}
                >
                  <span
                    className="flex h-[18px] max-h-full min-w-[18px] shrink-0 items-center justify-center rounded-full bg-white/80 px-[3px] text-[11px] font-medium leading-none @min-[480px]:ml-[2px]"
                    style={{ color: fg }}
                  >
                    {c.ini}
                  </span>
                  {/* first name from 480 px, the full "Priya S." once the cells are wide enough for it */}
                  <span className="hidden truncate text-[12px] font-medium text-ink @min-[480px]:inline">
                    {c.name.split(' ')[0]}
                    <span className="hidden @min-[560px]:inline"> {c.name.split(' ')[1]}</span>
                  </span>
                </span>
              )
            })}
          </div>
        </Glass>
      </div>
    </PanelRoot>
  )
}
