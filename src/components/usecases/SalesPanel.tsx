import { useRef, type CSSProperties } from 'react'
import { clamp, easeOut, ep, inOut, lerp, popIn, rise, seg, typed } from '../os/kit'
import { AppIcon } from '../ui/AppIcon'
import { B, type Brand } from '@/lib/brands'
import { cn } from '@/lib/utils'
import { Ask, Glass, PanelRoot, Spinner, type PanelProps } from './shared'
import { usePanelTimeline } from './usePanelTimeline'

/*
  Sales and outreach: a lead list that turns into outreach. Series A fintech companies land in
  the list one by one (the round from Crunchbase, then synced to HubSpot) while the counter runs
  to 50, then a Gmail draft slides up over the list and a first email types itself, quoting the
  founder's round and product. Every row picks up a Gmail mark as its draft is written, and the
  run ends on "50 drafts ready for review". A pure function of the clock t, 16 s loop.
  Company and founder names are invented, and none of them is reused in another panel.
*/

const LOOP = 16
const REST = 12
const TOTAL = 50

type Lead = { co: string; who: string; amt: string; color: string }
const LEADS: Lead[] = [
  { co: 'Mintgrove', who: 'Nora B., CEO', amt: '$14M', color: '#0f766e' },
  { co: 'Tallowpay', who: 'Dev P., CEO', amt: '$9M', color: '#4f46e5' },
  {
    co: 'Clearquay',
    who: 'Elif A., Founder',
    amt: '$18M',
    color: '#0284c7',
  },
  { co: 'Oxbow Ledger', who: 'Omar K., CEO', amt: '$11M', color: '#27272a' },
  {
    co: 'Fernbank',
    who: 'Hugo L., CEO',
    amt: '$22M',
    color: '#15803d',
  },
  {
    co: 'Hollowell Pay',
    who: 'Marcus T., Founder',
    amt: '$12M',
    color: '#9333ea',
  },
]

/* ---------- timing (seconds) ---------- */
const rowIn = (i: number) => 0.8 + i * 0.45
const CHIP_AT = 0.45 // Crunchbase round lands this long after the row
const HS_AT = 1.15 // then the lead is in HubSpot
const COUNT = [0.8, 4.6] as const
const DRAFT_IN = 4.8
const TO_AT = 5.45
const SUBJ = [5.75, 6.35] as const
const BODY_T = [6.5, 9.0] as const
const DRAFTS = [5.9, 9.3] as const
const DONE = 9.35
const DRAFT_OUT = 14.3 // the draft slides back down first, showing the whole list drafted for a beat
const OUT = 15.35 // then the list fades, and the placeholders come back just before t wraps
/** when each row's draft is written: the one being typed lands last, the rest in parallel */
const drafted = (i: number) => (i === 0 ? 9.05 : 6.9 + (i - 1) * 0.42)
/** a label hand-over in two beats, the old word out first and then the new one in, so two words never overlap */
const handOut = (x: number) => 1 - clamp(x * 2.2)
const handIn = (x: number) => easeOut(seg(x, 0.45, 1))

const SUBJECT = 'Congrats on the Series A' // short enough not to truncate on a small phone
const BODY: { s: string; m?: boolean }[] = [
  { s: 'Hi Nora, congrats on the ' },
  { s: '$14M Series A', m: true },
  { s: '. ' },
  { s: "Mintgrove's treasury API for community banks", m: true },
  { s: ' caught my eye. Open to a quick call next week?' },
]
const BODY_LEN = BODY.reduce((n, b) => n + b.s.length, 0)

/* ---------- small pieces ---------- */

function Logo({ b, s = 12, className, style }: { b: Brand; s?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={s} height={s} className={cn('shrink-0', className)} style={style}>
      <path d={b.path} fill={`#${b.hex}`} />
    </svg>
  )
}

function Check({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn('shrink-0', className)}>
      <path d="M4 8.4l2.6 2.6L12 5.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Row({ lead, i, t, out }: { lead: Lead; i: number; t: number; out: number }) {
  const at = rowIn(i)
  const p = ep(t, at, at + 0.5)
  // the sixth row only fits on the wider panel
  const vis = i === 5 ? 'hidden @min-[480px]:block' : 'block'
  const shown = p * out
  // a faint placeholder holds each slot until its lead lands, and comes back once the row has gone
  const sk = t >= OUT ? ep(t, OUT + 0.4, LOOP - 0.02) : clamp(1 - p * 2.5)
  const skeleton = sk > 0 && (
    <div className="absolute inset-0 flex items-center gap-2.5 px-2" style={{ opacity: sk * (1 - i * 0.13) }}>
      <span className="h-7 w-7 shrink-0 rounded-[8px] bg-black/[0.035]" />
      <span className="h-2 w-[26%] max-w-[120px] rounded-full bg-black/[0.045]" />
    </div>
  )
  if (shown <= 0) return <div className={cn(vis, 'relative h-[42px]')}>{skeleton}</div>

  const chip = ep(t, at + CHIP_AT, at + CHIP_AT + 0.3)
  const hs = ep(t, at + HS_AT, at + HS_AT + 0.3)
  const gT = seg(t, drafted(i), drafted(i) + 0.45)
  const gm = easeOut(gT)
  // the row being written is tinted while its draft is open
  const hl = i === 0 ? ep(t, DRAFT_IN + 0.1, DRAFT_IN + 0.6) * (1 - ep(t, DRAFT_OUT, DRAFT_OUT + 0.5)) : 0
  // the row whose email is being typed says so until its draft lands
  const wT = i === 0 ? seg(t, TO_AT, TO_AT + 0.45) : 0
  const lHub = hs * handOut(wT) * handOut(gT)
  const lWr = handIn(wT) * handOut(gT)
  const lDr = handIn(gT)

  return (
    <div className={cn(vis, 'relative h-[42px]')}>
      {skeleton}
      <div
        className="absolute inset-0 flex items-center gap-2.5 rounded-[9px] px-2"
        style={{
          ...rise(p, 8, 0),
          opacity: shown,
          background: hl > 0 ? `rgba(79,70,229,${0.07 * hl})` : undefined,
        }}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[13px] font-semibold text-white" style={{ background: lead.color }}>
          {lead.co[0]}
        </span>
        <div className="min-w-0 flex-1 leading-[1.25]">
          <div className="truncate text-[13px] font-medium text-ink">{lead.co}</div>
          <div className="truncate text-[12px] text-ink-3">{lead.who}</div>
        </div>

        {/* round, from Crunchbase: a skeleton until it lands */}
        <div className="grid w-[62px] shrink-0 items-center @min-[480px]:w-[124px]">
          {chip < 1 && <span className="col-start-1 row-start-1 h-2 w-[80%] rounded-full bg-black/[0.06]" style={{ opacity: 1 - chip }} />}
          {chip > 0 && (
            <span
              className="col-start-1 row-start-1 inline-flex h-[22px] w-fit items-center gap-1.5 rounded-full bg-white px-2 text-[12px] shadow-[0_0_0_1px_rgba(0,0,0,0.07)]"
              style={{
                opacity: chip,
                transform: `translateX(${(1 - chip) * 6}px)`,
              }}
            >
              <Logo b={B.crunchbase} s={11} />
              <span className="hidden text-ink-2 @min-[480px]:inline">Series A</span>
              <span className="font-medium text-ink tabular-nums">{lead.amt}</span>
            </span>
          )}
        </div>

        {/* status: adding, then in HubSpot, then its Gmail draft */}
        <div className="flex w-[40px] shrink-0 items-center gap-2 @min-[480px]:w-[124px]">
          <span className="relative h-[18px] w-[40px] shrink-0">
            {hs < 1 && t > at + 0.2 && (
              <span className="absolute left-[2px] top-[2px]" style={{ opacity: 1 - hs }}>
                <Spinner t={t} />
              </span>
            )}
            {hs > 0 && (
              <span className="absolute left-0 top-0 flex" style={popIn(hs)}>
                <AppIcon brand={B.hubspot} size={18} />
              </span>
            )}
            {gm > 0 && (
              <span className="absolute left-[22px] top-0 flex" style={popIn(gm)}>
                <AppIcon brand={B.gmail} size={18} />
              </span>
            )}
          </span>
          {/* the label sits right after the HubSpot mark, and steps aside when the Gmail mark joins it */}
          <span className="hidden text-[12px] @min-[480px]:grid" style={{ transform: `translateX(${-22 * (1 - gm)}px)` }}>
            {lHub > 0 && (
              <span className="col-start-1 row-start-1 whitespace-nowrap text-ink-2" style={{ opacity: lHub }}>
                In HubSpot
              </span>
            )}
            {lWr > 0 && (
              <span className="col-start-1 row-start-1 whitespace-nowrap text-[#4f46e5]" style={{ opacity: lWr }}>
                Writing
              </span>
            )}
            {lDr > 0 && (
              <span className="col-start-1 row-start-1 whitespace-nowrap font-medium text-[#15803d]" style={{ opacity: lDr }}>
                Draft ready
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

/** The email body, typed across plain and highlighted parts, with its full size reserved. */
function Body({ t }: { t: number }) {
  const p = seg(t, BODY_T[0], BODY_T[1])
  const n = Math.round(BODY_LEN * p)
  const typing = t > BODY_T[0] - 0.1 && t < BODY_T[1] + 0.35
  let acc = 0
  return (
    <p className="min-h-0 flex-1 overflow-hidden py-1.5 text-[13px] leading-[1.55] text-ink">
      {BODY.map((b, k) => {
        const start = acc
        acc += b.s.length
        const shown = clamp(n - start, 0, b.s.length)
        const caretHere = typing && n >= start && (n < acc || k === BODY.length - 1)
        const endT = lerp(BODY_T[0], BODY_T[1], acc / BODY_LEN)
        const mk = b.m ? ep(t, endT + 0.05, endT + 0.45) : 0
        return (
          <span
            key={k}
            className={cn(b.m && '-mx-[2px] rounded-[3px] px-[2px] [box-decoration-break:clone]')}
            style={mk > 0 ? { background: `rgba(79,70,229,${0.13 * mk})` } : undefined}
          >
            {b.s.slice(0, shown)}
            {caretHere && (
              <span className="relative inline-block h-[1em] w-0 align-[-2px]">
                <span className="absolute left-0 top-0 h-full w-[1.5px] bg-ink" />
              </span>
            )}
            <span className="invisible">{b.s.slice(shown)}</span>
          </span>
        )
      })}
    </p>
  )
}

const easeIn = (x: number) => x * x * x

function Draft({ t }: { t: number }) {
  // a solid sheet that rises from behind the bottom edge of the list (the card clips it), so
  // the rows never show through it; it leaves the same way
  const p = ep(t, DRAFT_IN, DRAFT_IN + 0.8)
  const q = easeIn(seg(t, DRAFT_OUT, DRAFT_OUT + 0.55))
  if (p <= 0 || q >= 1) return null
  const to = ep(t, TO_AT, TO_AT + 0.35)
  const subj = seg(t, SUBJ[0], SUBJ[1])
  const pillIn = ep(t, DRAFTS[0] - 0.2, DRAFTS[0] + 0.15)
  const done = ep(t, DONE, DONE + 0.35)
  const doneT = seg(t, DONE, DONE + 0.5)
  const n = Math.max(1, Math.round(lerp(1, TOTAL, seg(t, DRAFTS[0], DRAFTS[1]))))
  const subjShown = typed(SUBJECT, subj)

  // its top sits on a row edge (header 74 px, rows 42 px): one row stays in view on a phone, two
  // while the prompt still wraps to two lines (below about 570 px), three on the full desktop panel
  return (
    <div
      className="absolute inset-x-2 bottom-2 top-[120px] flex flex-col overflow-hidden rounded-[12px] bg-white @min-[480px]:top-[160px] @min-[580px]:top-[202px] shadow-[0_0_0_1px_rgba(10,30,60,0.08),0_20px_44px_-18px_rgba(10,30,60,0.42)]"
      style={{
        transform: `translateY(${(1 - p + q) * 270}px)`,
      }}
    >
      <div className="flex h-[30px] shrink-0 items-center gap-2 bg-[#f2f6fc] px-3">
        <Logo b={B.gmail} s={14} />
        <span className="text-[13px] font-medium text-ink">Draft</span>
        <span className="truncate text-[12px] text-ink-3">for Mintgrove</span>
        {done > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[12px] text-ink-3" style={{ opacity: done }}>
            <Check className="h-3.5 w-3.5 text-[#15803d]" />
            Saved
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-3">
        <div className="flex h-[30px] shrink-0 items-center gap-2 border-b border-black/[0.06]">
          <span className="w-[52px] shrink-0 text-[12px] text-ink-3">To</span>
          {to > 0 && (
            <span className="inline-flex h-[22px] min-w-0 items-center gap-1.5 rounded-full bg-black/[0.045] pl-[3px] pr-2" style={popIn(to)}>
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[11px] font-semibold leading-none text-white" style={{ background: LEADS[0].color }}>
                N
              </span>
              <span className="truncate text-[12px] text-ink">Nora B., Mintgrove</span>
            </span>
          )}
        </div>
        <div className="flex h-[30px] shrink-0 items-center gap-2 border-b border-black/[0.06]">
          <span className="w-[52px] shrink-0 text-[12px] text-ink-3">Subject</span>
          <span className="min-w-0 truncate text-[13px] font-medium text-ink">
            {subjShown}
            <span className="invisible">{SUBJECT.slice(subjShown.length)}</span>
          </span>
        </div>
        <Body t={t} />
      </div>
      <div className="flex h-[38px] shrink-0 items-center gap-2 border-t border-black/[0.06] px-3">
        {pillIn > 0 && (
          <span className="relative grid h-[26px] items-center rounded-full px-2.5 text-[12px]" style={{ opacity: pillIn }}>
            <span className="absolute inset-0 rounded-full bg-black/[0.045]" style={{ opacity: 1 - done }} />
            {done > 0 && <span className="absolute inset-0 rounded-full bg-[#e8f6ed] shadow-[inset_0_0_0_1px_rgba(22,163,74,0.2)]" style={{ opacity: done }} />}
            <span
              className={cn('relative col-start-1 row-start-1 flex items-center justify-center gap-1.5 whitespace-nowrap text-ink-2', doneT >= 0.46 && 'invisible')}
              style={{ opacity: handOut(doneT) }}
            >
              <Spinner t={t} className="h-3 w-3" />
              <span className="tabular-nums">
                Drafting {n} of {TOTAL}
              </span>
            </span>
            <span
              className={cn('relative col-start-1 row-start-1 flex items-center justify-center gap-1.5 whitespace-nowrap font-medium text-[#15803d]', doneT <= 0.45 && 'invisible')}
              style={{ opacity: handIn(doneT) }}
            >
              <Check className="h-3.5 w-3.5" />
              <span>{TOTAL} drafts ready for review</span>
            </span>
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[12px] text-ink-3">
          <span className="hidden @min-[480px]:inline">Personalized from</span>
          <Logo b={B.crunchbase} s={13} />
          <Logo b={B.linkedin} s={13} />
        </span>
      </div>
    </div>
  )
}

export function SalesPanel({ prompt, previewTime }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const t = usePanelTimeline(LOOP, ref, REST, previewTime)

  // the work fades out together at the end of the loop, so t=0 and t=LOOP match
  const out = 1 - ep(t, OUT, OUT + 0.45)
  const cp = seg(t, COUNT[0], COUNT[1])
  const shownRows = LEADS.filter((_, i) => t >= rowIn(i)).length
  const count = Math.max(shownRows, Math.round(TOTAL * cp))
  const found = ep(t, COUNT[1], COUNT[1] + 0.4)
  const counterIn = ep(t, 0.1, 0.5) * out
  const more = ep(t, rowIn(5) + 0.3, rowIn(5) + 0.7) * out

  // what the swarm is doing right now
  // one line at a time: each fades out before the next comes in
  const nA = inOut(t, 0.1, 4.45, 0.35) * out
  const nB = inOut(t, 4.8, 9.25, 0.35) * out
  const nC = ep(t, 9.6, 10.0) * out
  const bar = `rgb(${Math.round(lerp(10, 22, found))},${Math.round(lerp(10, 163, found))},${Math.round(lerp(10, 74, found))})`

  return (
    <PanelRoot
      ref={ref}
      label="A list of Series A fintech startups in New York fills in, each lead is saved to HubSpot, then a personalized first email to each founder is drafted in Gmail, ending with 50 drafts ready for review."
    >
      <div className="@container flex h-full flex-col">
        <Ask text={prompt} />
        <Glass className="relative mt-3 min-h-0 flex-1 overflow-hidden">
          {/* header: what the list is, how many leads so far, and what the swarm is doing */}
          <div className="relative h-[70px] px-4 pt-3.5">
            <div className="flex items-baseline justify-between gap-3">
              {/* a narrow panel says NYC, so the key fact never truncates */}
              <span className="truncate text-[13px] font-medium text-ink">
                Series A fintech, <span className="@max-[300px]:hidden">New York</span>
                <span className="hidden @max-[300px]:inline">NYC</span>
              </span>
              <span className="shrink-0 whitespace-nowrap" style={{ opacity: counterIn }}>
                <span className="text-[15px] font-medium text-ink tabular-nums">{count}</span>
                <span className="text-[12px] text-ink-3"> / {TOTAL} leads</span>
              </span>
            </div>
            <div className="mt-1 grid h-[18px] text-[12px] text-ink-3">
              {nA > 0 && (
                <span className="col-start-1 row-start-1 flex items-center gap-1.5 whitespace-nowrap" style={{ opacity: nA }}>
                  <Logo b={B.linkedin} s={12} />
                  <Logo b={B.crunchbase} s={12} />
                  Searching LinkedIn and Crunchbase
                </span>
              )}
              {nB > 0 && (
                <span
                  className="col-start-1 row-start-1 flex items-center gap-1.5 whitespace-nowrap"
                  style={{
                    opacity: nB,
                    transform: `translateY(${(1 - ep(t, 4.8, 5.15)) * 4}px)`,
                  }}
                >
                  <Logo b={B.gmail} s={12} />
                  Writing a first email to each founder
                </span>
              )}
              {nC > 0 && (
                <span
                  className="col-start-1 row-start-1 flex items-center gap-1.5 whitespace-nowrap"
                  style={{
                    opacity: nC,
                    transform: `translateY(${(1 - ep(t, 9.6, 10.0)) * 4}px)`,
                  }}
                >
                  <Check className="h-3.5 w-3.5 text-[#15803d]" />
                  Done. Nothing is sent until you approve.
                </span>
              )}
            </div>
            <div className="absolute inset-x-4 bottom-0 h-[2px] overflow-hidden rounded-full bg-black/[0.06]">
              {cp > 0 && out > 0 && (
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${cp * 100}%`,
                    background: bar,
                    opacity: out,
                  }}
                />
              )}
            </div>
          </div>

          <div className="px-2 pt-1">
            {LEADS.map((l, i) => (
              <Row key={l.co} lead={l} i={i} t={t} out={out} />
            ))}
            {more > 0 && (
              <div className="flex h-[40px] items-center gap-2.5 px-2" style={{ opacity: more }}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-black/[0.045] text-[12px] font-medium text-ink-2 tabular-nums">
                  <span className="@min-[480px]:hidden">+{count - 5}</span>
                  <span className="hidden @min-[480px]:inline">+{count - 6}</span>
                </span>
                <span className="text-[12px] text-ink-3">more founders found</span>
              </div>
            )}
          </div>

          <Draft t={t} />
        </Glass>
      </div>
    </PanelRoot>
  )
}
