import { useRef, type CSSProperties, type ReactNode } from 'react'
import { clamp, easeOut, ep, inOut, lerp, popIn, rise, seg } from '../os/kit'
import { AppIcon } from '../ui/AppIcon'
import { B } from '@/lib/brands'
import { cn } from '@/lib/utils'
import { Ask, Glass, PanelRoot, type PanelProps } from './shared'
import { usePanelTimeline } from './usePanelTimeline'

/*
  Operations: the Friday reconciliation. The schedule fires, a reading line runs down a
  two-sided ledger (Stripe payouts against QuickBooks invoices), each payout gets its
  invoice and a check, the three that don't line up turn red and drop into a review tray,
  and the tray is written to a Google Sheets log before a summary goes out by Gmail.
  Everything is a pure function of the scene clock, so ?t= freezes any moment.
*/

const LOOP = 16
const REST = 12.5
const TOTAL = 212
const ROW_H = 28

type Flag = 'amount' | 'missing' | 'refund'
type Row = { po: string; amt: string; inv?: string; qb?: string; flag?: Flag }

const ROWS: Row[] = [
  { po: 'po_4Hq1', amt: '$2,180.00', inv: 'INV-2031' },
  { po: 'po_4Hr7', amt: '$940.00', inv: 'INV-2032' },
  { po: 'po_4Ht2', amt: '$4,015.50', inv: 'INV-2033' },
  { po: 'po_4Hx3', amt: '$1,240.00', inv: 'INV-2034', qb: '$1,204.00', flag: 'amount' },
  { po: 'po_4Hz8', amt: '$615.25', inv: 'INV-2035' },
  { po: 'po_4J2c', amt: '$3,070.00', inv: 'INV-2036' },
  { po: 'po_4J5k', amt: '$288.40', inv: 'INV-2037' },
  { po: 'po_4J9s', amt: '$860.00', flag: 'missing' },
  { po: 'po_4JBd', amt: '$2,412.75', inv: 'INV-2038' },
  { po: 'po_4JDf', amt: '$730.00', inv: 'INV-2039' },
  { po: 'po_4JGh', amt: '$5,260.00', inv: 'INV-2040' },
  { po: 're_4JMp', amt: '-$86.00', flag: 'refund' },
  { po: 'po_4JPr', amt: '$3,344.00', inv: 'INV-2041' },
  { po: 'po_4JSv', amt: '$1,576.00', inv: 'INV-2042' },
]
const N = ROWS.length

/* ---------- timeline ---------- */

const FIRE = 0.3 // the Friday 5:00 PM trigger
const SCAN = 1.25 // the reading line starts moving
const SPEED = 3 // ledger rows per second while moving
const HOLD = 0.42 // pause on each row that doesn't line up
// The reading line runs in legs and stops on each mismatch. It starts a little above the first
// row so row 0 resolves under it like every other row, and ends a little past the last one.
const LEGS: [number, number][] = [
  [-0.7, 3],
  [3, 7],
  [7, 11],
  [11, 13.3],
]
const C0 = LEGS[0][0]
const C_END = LEGS[LEGS.length - 1][1]
const SEGS = (() => {
  const out: { a: number; b: number; c0: number; c1: number }[] = []
  let at = SCAN
  for (const [c0, c1] of LEGS) {
    const d = (c1 - c0) / SPEED
    out.push({ a: at, b: at + d, c0, c1 })
    at += d + HOLD
  }
  return out
})()
const SCAN_END = SEGS[SEGS.length - 1].b
const LOG = SCAN_END + 0.6 // the tray is written to Sheets
const MAIL = LOG + 1.05 // the Gmail summary
const FADE = 15.2 // the finished run fades out
const BACK = 15.6 // and the opening frame fades back in

/** The three that don't line up, in the order the reading line reaches them. */
const EXC = [
  // amt is what is at stake: the gap on a short invoice, the whole payout when nothing matches
  { row: 3, ref: 'po_4Hx3', reason: 'Payout $1,240.00, invoice $1,204.00', amt: '$36.00', sheet: 41, at: SEGS[0].b },
  { row: 7, ref: 'po_4J9s', reason: 'No invoice found', amt: '$860.00', sheet: 42, at: SEGS[1].b },
  { row: 11, ref: 're_4JMp', reason: 'Refund not recorded', amt: '-$86.00', sheet: 43, at: SEGS[2].b },
]

/** Constant speed with soft starts and stops (a trapezoid velocity profile). */
function trap(p: number, a = 0.25) {
  const v = 1 / (1 - a)
  if (p <= 0) return 0
  if (p >= 1) return 1
  if (p < a) return (0.5 * v * p * p) / a
  if (p > 1 - a) {
    const q = 1 - p
    return 1 - (0.5 * v * q * q) / a
  }
  return 0.5 * v * a + v * (p - a)
}

/** Where the reading line is, in rows (fractional). */
function cursorAt(w: number) {
  if (w <= SEGS[0].a) return C0
  for (const s of SEGS) {
    if (w < s.a) return s.c0 // holding on a mismatch
    if (w <= s.b) return lerp(s.c0, s.c1, trap(seg(w, s.a, s.b)))
  }
  return C_END
}

/* ---------- colours ---------- */

const GREEN = '#218358'
const GREEN_BG = '#e6f6eb'
const RED = '#ce2c31'
const RED_BG = '#feebec'

/* ---------- small pieces ---------- */

function Check({ size = 10, color = GREEN }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden>
      <path d="M3.2 8.4l3 3 6.6-6.8" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Bang({ size = 10 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden>
      <path d="M8 3.2v6" stroke={RED} strokeWidth={2.2} strokeLinecap="round" />
      <circle cx="8" cy="12.6" r="1.25" fill={RED} />
    </svg>
  )
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={13} height={13} fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="11" rx="2.2" stroke="#0a0a0a" strokeWidth={1.4} />
      <path d="M2.6 6.6h10.8M5.4 1.8v2.4M10.6 1.8v2.4" stroke="#0a0a0a" strokeWidth={1.4} strokeLinecap="round" />
      <circle cx="10.6" cy="10.4" r="1.2" fill="#0a0a0a" />
    </svg>
  )
}

/** A spinner turned by the scene clock rather than a CSS animation, so frozen frames stay frozen. */
function ClockSpinner({ t }: { t: number }) {
  return (
    <span
      className="block h-3 w-3 rounded-full border-[1.5px] border-black/15 border-t-black"
      style={{ transform: `rotate(${(t * 400) % 360}deg)` }}
    />
  )
}

function Chip({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span
      className={cn(
        'relative inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-white/80 px-2.5 text-[12px] text-ink shadow-[0_0_0_1px_rgba(10,30,60,0.07),0_2px_6px_-3px_rgba(10,30,60,0.2)] backdrop-blur-md',
        className,
      )}
      style={style}
    >
      {children}
    </span>
  )
}

/* ---------- the schedule strip ---------- */

function Schedule({ w, alpha }: { w: number; alpha: number }) {
  const ping = seg(w, FIRE, FIRE + 1)
  // the run is only done once the summary has gone out; the two never share the spot
  const running = inOut(w, FIRE + 0.15, MAIL + 0.35, 0.25)
  const done = ep(w, MAIL + 0.6, MAIL + 0.95)
  return (
    <div className="mt-2.5 flex h-[26px] items-center gap-1.5">
      <Chip>
        {ping > 0 && ping < 1 && (
          <span
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{ boxShadow: `0 0 0 ${easeOut(ping) * 7}px rgba(10,10,10,${0.13 * (1 - ping)})` }}
          />
        )}
        <CalendarGlyph />
        Every Friday, 5:00 PM
      </Chip>
      <Chip className="text-ink-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#30a46c' }} />
        {/* the job runs on Fridays and the page's today is Saturday, Sep 26 */}
        Last run: Fri
      </Chip>
      <div className="relative ml-auto hidden h-[26px] w-[76px] @min-[480px]:block" style={{ opacity: alpha }}>
        {running > 0 && (
          <span className="absolute inset-y-0 right-0 flex items-center gap-1.5 text-[12px] text-ink-2" style={{ opacity: running }}>
            <ClockSpinner t={w} />
            Running
          </span>
        )}
        {done > 0 && (
          <span className="absolute inset-y-0 right-0 flex items-center gap-1.5 text-[12px] font-medium text-ink" style={rise(done, 4, 0)}>
            <span className="flex h-4 w-4 items-center justify-center rounded-full" style={{ background: GREEN_BG }}>
              <Check size={10} />
            </span>
            Done
          </span>
        )}
      </div>
    </div>
  )
}

/* ---------- the ledger ---------- */

function LedgerRow({ r, i, c, w, alpha }: { r: Row; i: number; c: number; w: number; alpha: number }) {
  const exc = EXC.find((e) => e.row === i)
  // matched rows resolve as the reading line passes over them; mismatches on the pause
  const link = exc ? ep(w, exc.at - 0.1, exc.at + 0.3) : easeOut(clamp((c - (i - 0.6)) / 0.7))
  const node = exc ? seg(w, exc.at + 0.05, exc.at + 0.4) : clamp((c - (i - 0.3)) / 0.55)
  const tint = exc ? ep(w, exc.at + 0.05, exc.at + 0.45) : 0
  const dashed = r.flag === 'missing' || r.flag === 'refund'
  return (
    <div
      className="absolute inset-x-1.5 grid h-[28px] grid-cols-[minmax(0,172px)_minmax(30px,1fr)_minmax(0,172px)] items-center rounded-[7px] px-1.5"
      style={{ top: i * ROW_H, opacity: alpha, background: tint > 0 ? `rgba(229,72,77,${0.085 * tint})` : undefined }}
    >
      <div className="flex min-w-0 items-center justify-between gap-1.5 @min-[320px]:gap-2">
        <span className="whitespace-nowrap font-mono text-[12px] tracking-[-0.02em] text-ink-3">{r.po}</span>
        <span className="whitespace-nowrap text-[13px] tabular-nums text-ink">{r.amt}</span>
      </div>

      <div className="relative mx-1.5 h-full">
        {link > 0 && (
          <span
            className="absolute inset-x-0 top-1/2 h-px origin-left"
            style={{
              transform: `scaleX(${link})`,
              background: !exc
                ? 'rgba(10,10,10,0.2)'
                : dashed
                  ? `repeating-linear-gradient(90deg, rgba(229,72,77,0.55) 0 3px, transparent 3px 6px)`
                  : 'rgba(229,72,77,0.5)',
            }}
          />
        )}
        {node > 0 && (
          <span
            className="absolute left-1/2 top-1/2 -ml-2 -mt-2 flex h-4 w-4 items-center justify-center rounded-full"
            style={{ ...popIn(node), background: exc ? RED_BG : GREEN_BG, boxShadow: `0 0 0 1px ${exc ? 'rgba(229,72,77,0.25)' : 'rgba(48,164,108,0.25)'}` }}
          >
            {exc ? <Bang /> : <Check />}
          </span>
        )}
      </div>

      <div className="relative flex h-full min-w-0 items-center overflow-hidden">
        {link < 1 && (
          <span className="absolute inset-y-0 left-0 right-0 flex items-center justify-between gap-2" style={{ opacity: 1 - link }}>
            <span className="h-[6px] w-[52px] rounded-full bg-black/[0.07]" />
            {/* stands in for the invoice number, so it steps aside with it on the narrowest panels */}
            <span className="hidden h-[6px] w-[40px] rounded-full bg-black/[0.05] @min-[330px]:block" />
          </span>
        )}
        {link > 0 &&
          (dashed ? (
            <span
              className="whitespace-nowrap rounded-[5px] px-1.5 py-[1px] text-[12px] font-medium"
              style={{ opacity: link, transform: `translateX(${(1 - link) * 6}px)`, color: RED, boxShadow: 'inset 0 0 0 1px rgba(229,72,77,0.35)' }}
            >
              {r.flag === 'missing' ? 'No invoice found' : 'Not recorded'}
            </span>
          ) : (
            <span className="flex w-full items-center justify-between gap-2" style={{ opacity: link, transform: `translateX(${(1 - link) * 6}px)` }}>
              <span className="whitespace-nowrap text-[13px] tabular-nums" style={{ color: exc ? RED : '#0a0a0a', fontWeight: exc ? 500 : 400 }}>
                {r.qb ?? r.amt}
              </span>
              {/* the invoice number steps aside on the narrowest panels, the amount is what matters */}
              <span className="hidden whitespace-nowrap font-mono text-[12px] tracking-[-0.02em] text-ink-3 @min-[330px]:inline">{r.inv}</span>
            </span>
          ))}
      </div>
    </div>
  )
}

function Ledger({ w, alpha }: { w: number; alpha: number }) {
  const c = cursorAt(w)
  const cb = clamp(c, 0, N - 1)
  const prog = clamp((c - C0) / (C_END - C0))
  const flagged = EXC.filter((e) => w >= e.at + 0.1).length
  // only ever counts up: the flagged three are never part of it
  const matched = Math.round((TOTAL - EXC.length) * prog)
  const band = ep(w, SCAN - 0.55, SCAN - 0.15) * (1 - ep(w, SCAN_END + 0.1, SCAN_END + 0.5))
  const first = Math.max(0, Math.floor(cb) - 3)
  const last = Math.min(N - 1, Math.floor(cb) + 4)
  const flagOn = ep(w, EXC[0].at + 0.1, EXC[0].at + 0.4)
  const finished = ep(w, SCAN_END + 0.2, SCAN_END + 0.6)

  return (
    <Glass className="mt-2 overflow-hidden">
      <div className="flex h-[34px] items-center justify-between gap-2 px-3">
        {/* on the narrowest phones the logos name the apps and the words shorten */}
        <span className="flex items-center gap-2 whitespace-nowrap text-[12.5px] font-medium text-ink">
          <AppIcon brand={B.stripe} size={20} />
          <span className="@max-[305px]:hidden">Stripe payouts</span>
          <span className="hidden @max-[305px]:inline">Payouts</span>
        </span>
        <span className="flex items-center gap-2 whitespace-nowrap text-[12.5px] font-medium text-ink">
          <span className="@max-[305px]:hidden">QuickBooks invoices</span>
          <span className="hidden @max-[305px]:inline">Invoices</span>
          <AppIcon brand={B.quickbooks} size={20} />
        </span>
      </div>

      <div className="relative h-[2px] bg-black/[0.05]">
        <span className="absolute inset-0 origin-left bg-ink/55" style={{ transform: `scaleX(${prog})`, opacity: alpha }} />
        {finished > 0 && <span className="absolute inset-0 bg-[#30a46c]" style={{ opacity: finished * 0.75 * alpha }} />}
      </div>

      {/* 3 rows on a phone, 4 on a wider panel. --m is how far the list may scroll before the
          reading line walks down the last rows instead. */}
      <div className="relative h-[86px] overflow-hidden [--m:11] @min-[480px]:h-[114px] @min-[480px]:[--m:10]" style={{ '--c': cb } as CSSProperties}>
        {band > 0 && (
          <span
            className="absolute inset-x-1.5 h-[28px] rounded-[7px] bg-black/[0.045] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]"
            style={{ top: `calc(1px + (var(--c) - min(max(var(--c) - 1, 0), var(--m))) * ${ROW_H}px)`, opacity: band * alpha }}
          />
        )}
        <div className="absolute inset-x-0 top-px" style={{ transform: `translateY(calc(min(max(var(--c) - 1, 0), var(--m)) * ${-ROW_H}px))` }}>
          {ROWS.slice(first, last + 1).map((r, k) => (
            <LedgerRow key={first + k} r={r} i={first + k} c={c} w={w} alpha={alpha} />
          ))}
        </div>
      </div>

      <div className="flex h-[32px] items-center justify-between border-t border-black/[0.06] px-3 text-[12.5px]">
        <span className="text-ink-2" style={{ opacity: alpha }}>
          Matched{' '}
          {/* a fixed-width counter, so "of 212" never moves while the number ticks up */}
          <span className="mx-0.5 inline-block w-[calc(3ch+10px)] rounded-[5px] bg-black/[0.045] py-px text-center font-medium tabular-nums text-ink">{matched}</span> of {TOTAL}
        </span>
        <span
          className="flex items-center gap-1.5 rounded-full px-2 py-[2px] tabular-nums"
          style={{
            opacity: alpha,
            color: flagOn > 0.5 ? RED : 'var(--ink-3)',
            background: `rgba(229,72,77,${0.1 * flagOn})`,
            fontWeight: flagOn > 0.5 ? 500 : 400,
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: flagOn > 0 ? `rgba(229,72,77,${0.35 + 0.65 * flagOn})` : 'rgba(0,0,0,0.2)' }} />
          {flagged} flagged
        </span>
      </div>
    </Glass>
  )
}

/* ---------- the review tray, which becomes the Sheets log ---------- */

function Tray({ w, alpha }: { w: number; alpha: number }) {
  const sheet = ep(w, LOG, LOG + 0.4)
  const titleOut = ep(w, LOG, LOG + 0.3)
  // the new title starts once the old one has all but gone, so they never ghost over each other
  const titleIn = ep(w, LOG + 0.22, LOG + 0.58)
  const chip = seg(w, LOG + 0.45, LOG + 0.8)
  const empty = 1 - ep(w, EXC[0].at + 0.2, EXC[0].at + 0.45)
  return (
    <Glass className="relative mt-2 h-[112px] shrink-0 overflow-hidden">
      <div className="relative h-[30px]">
        {titleOut < 1 && (
          <span
            className="absolute inset-y-0 left-3 flex items-center gap-2 text-[12.5px] font-medium text-ink"
            style={{ opacity: (1 - titleOut) * alpha, transform: `translateY(${-4 * titleOut}px)` }}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full" style={{ background: RED_BG }}>
              <Bang size={9} />
            </span>
            Flagged for review
          </span>
        )}
        {titleIn > 0 && (
          <span className="absolute inset-y-0 left-3 flex items-center gap-2 text-[12.5px] font-medium text-ink" style={{ ...rise(titleIn, 5, 0), opacity: titleIn * alpha }}>
            <AppIcon brand={B.gsheets} size={18} />
            Payout exceptions
          </span>
        )}
        {chip > 0 && (
          <span
            className="absolute right-2.5 top-1/2 -mt-[10px] flex h-5 items-center gap-1 rounded-full pl-1.5 pr-2 text-[12px] font-medium"
            style={{ ...popIn(chip), opacity: clamp(chip * 1.6) * alpha, background: GREEN_BG, color: GREEN }}
          >
            <Check size={10} />3 rows added
          </span>
        )}
      </div>
      <div className="h-px bg-black/[0.06]" />

      {empty > 0 && (
        <p className="absolute inset-x-0 bottom-0 top-[31px] flex items-center justify-center px-4 text-center text-[12.5px] text-ink-3" style={{ opacity: empty * alpha }}>
          Anything that doesn't line up lands here.
        </p>
      )}

      {EXC.map((e, k) => {
        const p = ep(w, e.at + 0.3, e.at + 0.75)
        if (p <= 0) return null
        const flash = inOut(w, LOG + 0.3 + k * 0.1, LOG + 1.1 + k * 0.1, 0.4)
        return (
          <div
            key={e.ref}
            className={cn('absolute inset-x-0 flex h-[26px] items-center gap-2.5 pr-3', k > 0 && 'border-t border-black/[0.05]')}
            style={{
              top: 31 + k * 26,
              opacity: p * alpha,
              transform: `translateY(${(1 - p) * -8}px)`,
              background: flash > 0 ? `rgba(48,164,108,${0.16 * flash})` : undefined,
            }}
          >
            <span className="relative h-full w-[30px] shrink-0">
              {sheet < 1 && (
                <span className="absolute inset-0 flex items-center justify-center" style={{ opacity: 1 - sheet }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'rgba(229,72,77,0.9)' }} />
                </span>
              )}
              {sheet > 0 && (
                <span
                  className="absolute inset-0 flex items-center justify-center bg-black/[0.035] text-[11px] tabular-nums text-ink-3 shadow-[inset_-1px_0_0_rgba(0,0,0,0.06)]"
                  style={{ opacity: sheet }}
                >
                  {e.sheet}
                </span>
              )}
            </span>
            <span className="hidden w-[56px] shrink-0 font-mono @min-[480px]:block text-[12px] tracking-[-0.02em] text-ink-3">{e.ref}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{e.reason}</span>
            <span className="hidden shrink-0 text-[12.5px] tabular-nums text-ink-2 @min-[480px]:block">{e.amt}</span>
          </div>
        )
      })}
    </Glass>
  )
}

/* ---------- the Gmail summary ---------- */

function Toast({ w, alpha }: { w: number; alpha: number }) {
  const p = ep(w, MAIL, MAIL + 0.5)
  return (
    <div className="relative mt-auto h-[36px] shrink-0">
      {p > 0 && (
        <div
          className="absolute bottom-0 right-0 flex h-[36px] max-w-full items-center gap-2.5 rounded-[10px] bg-white pl-2 pr-3 shadow-[0_0_0_1px_rgba(10,30,60,0.07),0_14px_30px_-16px_rgba(10,30,60,0.45)]"
          style={{ opacity: p * alpha, transform: `translateY(${(1 - p) * 14}px)` }}
        >
          <AppIcon brand={B.gmail} size={22} />
          <span className="whitespace-nowrap text-[13px] font-medium text-ink">Summary sent to finance</span>
          <span className="whitespace-nowrap text-[12px] text-ink-3">Just now</span>
        </div>
      )}
    </div>
  )
}

export function OpsPanel({ prompt, previewTime }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const t = usePanelTimeline(LOOP, ref, REST, previewTime)
  // The run plays on its own clock `w`. At the end it fades out, then the opening frame
  // (w = 0) fades back in, so the last moment of the loop matches the first.
  const w = t < BACK ? t : 0
  const alpha = t < BACK ? 1 - ep(t, FADE, BACK) : ep(t, BACK, BACK + 0.35)
  return (
    <PanelRoot
      ref={ref}
      label="A scheduled Friday run matches Stripe payouts against QuickBooks invoices row by row, flags three that don't line up, logs them to Google Sheets and emails a summary to finance."
    >
      <div className="@container flex h-full flex-col">
        <Ask text={prompt} className="@min-[480px]:max-w-[80%]" />
        <Schedule w={w} alpha={alpha} />
        <Ledger w={w} alpha={alpha} />
        <Tray w={w} alpha={alpha} />
        <Toast w={w} alpha={alpha} />
      </div>
    </PanelRoot>
  )
}
