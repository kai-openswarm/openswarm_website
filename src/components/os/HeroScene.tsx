import { useRef, type CSSProperties, type ReactNode } from 'react'
import { B } from '@/lib/brands'
import type { AppAssetId } from '@/lib/app-assets'
import { DemoAppIcon } from './DemoAppIcon'
import {
  Cursor,
  Desktop,
  Glyph,
  Launcher,
  Mark,
  Rail,
  Stage,
  Thinking,
  VoicePill,
  clamp,
  easeInOut,
  easeOut,
  ep,
  inOut,
  lerp,
  path,
  popIn,
  rise,
  seg,
  typed,
  useStageWidth,
  useTimeline,
  type StageView,
} from './kit'

/*
  The hero shot. Three voice asks spawn three agents that work side by side on the canvas,
  each streaming its own steps; then the launcher opens and a Daily Brief app an agent
  built earlier scales in over them. Everything is a pure function of the clock `t`.

  Beats (seconds): 0.25 ask one, 1.75 card one; 2.9 ask two, 4.05 card two; 4.95 ask
  three, 6.3 card three; 8.9 card two finishes; 10.5 launcher; 12.6 Daily Brief;
  16.95 the pointer ticks the first to-do and the counts roll; 19.3 to 19.9 everything
  fades back to the empty canvas.

  On a phone the scene is filmed through a camera (see below) instead of shown whole.
*/

const W = 1280
const H = 731
const LOOP = 20
const REST = 9.7

/* ---------- layout, in stage px ---------- */

const CW = 336 // card width
const CH = 440 // card body height
const CY = 100 // top of the title pill row, high enough that the cards sit mid-window above the frame's cropped bottom
const COLS = [110, 470, 830]
const SPAWN: [number, number] = [640, 64] // the voice pill, where new cards come from
const LIST_H = CH - 74 // the streaming area above the composer
const PAD = 16
const V = LIST_H - PAD - 10 // content height that fits before the card scrolls
const PILL_W = 189 // the voice pill's own width (kit)
const CHECK: [number, number] = [640 + PILL_W / 2 - 24, 12 + 24]
const RAIL_Y = 123
const GRID: [number, number] = [44, 532] // the grid button at the bottom of the rail
const LX = 405
const LY = 142 // centred on the cards, and clear of the card title pills above it
const LW = 470
const LH = 404 // the kit launcher's height with 12 tiles in 4 columns
const TILE0: [number, number] = [LX + 69, LY + 131] // the Daily Brief tile in the launcher
// the Daily Brief window covers the bodies of cards two and three (2px past every edge, so
// no dark hairline or half-cut word peeks out); only their title pills show above it
const BX = COLS[1] - 2
const BY = CY + 38 - 2
const BW = COLS[2] + CW - COLS[1] + 4
const BH = 450
// the first to-do's checkbox, which the pointer ticks during the hold
const CHK: [number, number] = [BX + 34 + 14 + 8, BY + 30 + 18 + 72 + 14 + 62 + 16 + 20 + 8 + 22]
const BS0 = 0.14 // the Daily Brief window starts this small, on its tile

/* ---------- helpers ---------- */

const easeOutQuart = (x: number) => 1 - Math.pow(1 - clamp(x), 4)
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a: string, b: string, p: number) => {
  const A = rgb(a)
  const Bv = rgb(b)
  return `rgb(${A.map((v, i) => Math.round(lerp(v, Bv[i], p))).join(',')})`
}
/** a light band that sweeps across text, for rows that are still running */
const shimmer = (t: number, base: string, hi: string): CSSProperties => ({
  backgroundImage: `linear-gradient(90deg, ${base} 0%, ${base} 38%, ${hi} 50%, ${base} 62%, ${base} 100%)`,
  backgroundSize: '300% 100%',
  backgroundPosition: `${100 - ((t / 1.7) % 1) * 100}% 0`,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
})
/** the stream's edge fade; the top fade grows in only once the card has started to scroll */
const mask = (scroll: number) => {
  const f = 40 * easeOut(clamp(scroll / 40))
  const m = `linear-gradient(to bottom, rgba(0,0,0,0) 0, rgba(0,0,0,0) ${f * 0.22}px, rgba(0,0,0,0.4) ${f * 0.55}px, #000 ${f}px, #000 calc(100% - 10px), rgba(0,0,0,0) 100%)`
  return { WebkitMaskImage: m, maskImage: m }
}

const IC = {
  read: 'M5 3.5h7l3 3v10H5zM12 3.5v3h3',
  list: 'M3.5 5.5h13M3.5 10h13M3.5 14.5h9',
  edit: 'M4 16l1-4 8-8 3 3-8 8zM11.5 5.5l3 3',
  search: 'M9 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12.7 12.7 16.5 16.5',
  globe: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM3 10h14M10 3c2 2 2.8 4.4 2.8 7S12 15 10 17M10 3C8 5 7.2 7.4 7.2 10S8 15 10 17',
  upload: 'M10 13V4M6.5 7.5 10 4l3.5 3.5M4 13v3h12v-3',
  calendar: 'M4 5.5h12v10H4zM4 8.5h12M7 3.5v3M13 3.5v3',
  sparkle: 'M10 3.5l1.5 5 5 1.5-5 1.5-1.5 5-1.5-5-5-1.5 5-1.5z',
  chevron: 'M6.5 8.5 10 12l3.5-3.5',
  refresh: 'M15.5 10a5.5 5.5 0 1 1-1.7-4M15.5 3.5V7H12',
  share: 'M10 12.5V3.5M7 6.5l3-3 3 3M5.5 10v6.5h9V10',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h3.2l1.6 1.8h6.2A1.5 1.5 0 0 1 17 8.3v6.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z',
  inbox: 'M3.5 11.5 5.5 4.5h9l2 7v4h-13zM3.5 11.5h4l1 2h3l1-2h4',
  notes: 'M5 3.5h10v13H5zM7.5 7h5M7.5 10h5M7.5 13h3',
  tag: 'M3.5 10.2V4.5a1 1 0 0 1 1-1h5.7l6.3 6.3-6.7 6.7zM7.3 7.3h.01',
  pin: 'M10 17s-5-4.6-5-8.5a5 5 0 0 1 10 0C15 12.4 10 17 10 17ZM10 10.2a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z',
}

/* ---------- the three voice asks ---------- */

const ASKS = [
  { text: 'Catch me up on my texts and LinkedIn', in: 0.25, type: [0.5, 1.35], done: 1.45, out: 1.65 },
  { text: 'Post the hotkeys videos on X', in: 2.9, type: [3.1, 3.7], done: 3.8, out: 3.95 },
  { text: 'Find one competitor that rivals Open Swarm', in: 4.95, type: [5.15, 5.95], done: 6.05, out: 6.2 },
]

function Voice({ t }: { t: number }) {
  const a = ASKS.find((q) => t >= q.in && t < q.out + 0.4)
  if (!a) return null
  const p = ep(t, a.in, a.in + 0.45) * (1 - ep(t, a.out, a.out + 0.35))
  if (p <= 0) return null
  const rp = seg(t, a.done, a.done + 0.6)
  return (
    <>
      <VoicePill t={t} text={a.text} p={p} textP={seg(t, a.type[0], a.type[1])} done={t >= a.done} className="top-[12px] z-10 -translate-x-1/2" style={{ left: 640 }} />
      {rp > 0 && rp < 1 && (
        <span
          className="absolute z-10 rounded-full border-2 border-[#a78bfa]"
          style={{ left: CHECK[0] - 16, top: CHECK[1] - 16, width: 32, height: 32, opacity: (1 - rp) * p, transform: `scale(${1 + easeOut(rp) * 0.8})` }}
        />
      )}
    </>
  )
}

/* ---------- agent cards ---------- */

type StepDef = { k: 'step'; at: number; icon: string; active: string; verb: string; file?: string; ms?: string; done?: number }
type Item = StepDef | { k: 'text'; at: number; lines: string[] } | { k: 'prompt'; at: number; lines: string[] } | { k: 'custom'; at: number; h: number; id: string }

/** the slot an item takes in the stream, including the 12px gap after it */
const hOf = (it: Item) => (it.k === 'step' ? 32 : it.k === 'text' ? it.lines.length * 21 + 12 : it.k === 'prompt' ? it.lines.length * 20 + 30 : it.h)

const C1: Item[] = [
  { k: 'prompt', at: 1.95, lines: ['Catch me up on my texts and LinkedIn'] },
  { k: 'step', at: 2.3, done: 2.65, icon: IC.read, active: 'Reading', verb: 'Read', file: 'SKILL.md', ms: '0.4s' },
  { k: 'text', at: 2.75, lines: ['Reading the texts and LinkedIn', 'reference files first.'] },
  { k: 'step', at: 3.2, done: 3.55, icon: IC.read, active: 'Reading', verb: 'Read', file: 'imessage.md', ms: '0.2s' },
  { k: 'step', at: 3.65, done: 4.0, icon: IC.read, active: 'Reading', verb: 'Read', file: 'linkedin.md', ms: '0.3s' },
  { k: 'step', at: 4.1, done: 4.4, icon: IC.list, active: 'Listing', verb: 'Listed folder', file: 'messages/', ms: '0.1s' },
  { k: 'step', at: 4.55, done: 6.0, icon: IC.read, active: 'Reading', verb: 'Read', file: 'digest.md', ms: '1.2s' },
  { k: 'text', at: 6.15, lines: ['3 threads need a reply. Maya', 'asked about Thursday.'] },
  { k: 'step', at: 6.8, done: 7.6, icon: IC.globe, active: 'Opening', verb: 'Opened', file: 'linkedin.com', ms: '0.9s' },
  { k: 'text', at: 8.1, lines: ['2 new messages and an intro', 'request from Sam.'] },
  { k: 'step', at: 8.8, done: 15.3, icon: IC.edit, active: 'Writing', verb: 'Wrote', file: 'catchup.md', ms: '6.4s' },
  { k: 'step', at: 15.6, icon: IC.calendar, active: 'Checking', verb: 'Checked', file: 'calendar' },
]

const C2: Item[] = [
  { k: 'prompt', at: 4.25, lines: ['Post the hotkeys videos on X'] },
  { k: 'step', at: 4.6, done: 5.0, icon: IC.read, active: 'Reading', verb: 'Read', file: 'SKILL.md', ms: '0.3s' },
  { k: 'step', at: 5.1, done: 5.6, icon: IC.edit, active: 'Editing text', verb: 'Edited text', file: 'caption.md', ms: '1.1s' },
  { k: 'text', at: 5.75, lines: ['Two clips ready, posting now.'] },
  { k: 'step', at: 6.25, done: 6.9, icon: IC.globe, active: 'Opening', verb: 'Opened', file: 'x.com', ms: '0.8s' },
  { k: 'step', at: 7.1, done: 8.5, icon: IC.upload, active: 'Uploading', verb: 'Uploaded', file: 'clips/', ms: '4.2s' },
  { k: 'text', at: 9.05, lines: ['Posted 2 videos to X.'] },
  { k: 'custom', at: 9.2, h: 96, id: 'thumbs' },
]

const C3: Item[] = [
  { k: 'prompt', at: 6.5, lines: ['Find one competitor that', 'rivals Open Swarm'] },
  { k: 'step', at: 6.85, done: 7.3, icon: IC.globe, active: 'Opening', verb: 'Opened', file: 'google.com', ms: '0.5s' },
  { k: 'custom', at: 7.1, h: 216, id: 'browser' },
  { k: 'custom', at: 8.7, h: 58, id: 'reason' },
  { k: 'text', at: 10.35, lines: ['Found a close match. Comparing', 'features and pricing now.'] },
  { k: 'step', at: 11.0, done: 16.4, icon: IC.globe, active: 'Opening', verb: 'Opened', file: 'producthunt.com', ms: '1.4s' },
  { k: 'step', at: 16.7, icon: IC.read, active: 'Reading', verb: 'Read', file: 'reviews' },
]

function StepText({ s, t, active, o }: { s: StepDef; t: number; active: boolean; o: number }) {
  return (
    <div className="absolute inset-y-0 left-[24px] right-0 flex items-center gap-[9px]" style={{ opacity: o }}>
      <span className="font-medium" style={active ? shimmer(t, '#b58af6', '#f1e8ff') : { color: '#eee8ee' }}>
        {active ? s.active : s.verb}
      </span>
      {s.file && <span className="font-mono text-[12.5px] text-[#a99fa9]">{s.file}</span>}
      {!active && s.ms && <span className="ml-auto font-mono text-[12px] text-[#7d737d]">{s.ms}</span>}
    </div>
  )
}

/**
 * A running row that settles into its finished form: the icon tints from violet to gray
 * while the label dips out and back in (never two labels on top of each other).
 */
function StepLine({ s, t }: { s: StepDef; t: number }) {
  const d = s.done === undefined ? 0 : seg(t, s.done, s.done + 0.32)
  const a = 1 - easeOut(clamp(d * 2))
  const b = easeOut(clamp(d * 2 - 1))
  return (
    <div className="relative h-[20px] whitespace-nowrap text-[13.5px]">
      <span className="absolute left-0 top-[2.5px]" style={{ color: mix('#b085f5', '#a99fa9', easeInOut(d)) }}>
        <Glyph d={s.icon} size={15} />
      </span>
      {a > 0 && <StepText s={s} t={t} active o={a} />}
      {b > 0 && <StepText s={s} t={t} active={false} o={b} />}
    </div>
  )
}

/**
 * The streaming body of a card. Each item takes its slot as it arrives (eased), so rows
 * below glide down and, once the content is taller than the card, everything scrolls up
 * smoothly. Items scrolled fully out of view are not rendered.
 */
function Stream({ t, items, working, thinkFrom, custom }: { t: number; items: Item[]; working: number; thinkFrom: number; custom?: (id: string, t: number) => ReactNode }) {
  let acc = 0
  const tops: number[] = []
  for (const it of items) {
    tops.push(acc)
    acc += hOf(it) * ep(t, it.at, it.at + 0.5)
  }
  const think = ep(t, thinkFrom, thinkFrom + 0.4) * working
  const scroll = Math.max(0, acc + 16 * think - V)
  const nodes: ReactNode[] = []
  items.forEach((it, i) => {
    const p = ep(t, it.at, it.at + 0.45)
    if (p <= 0) return
    const top = PAD + tops[i] - scroll
    if (top + hOf(it) < 0) return
    let body: ReactNode
    if (it.k === 'step') body = <StepLine s={it} t={t} />
    else if (it.k === 'prompt')
      body = (
        <div className="ml-auto w-fit whitespace-nowrap rounded-[10px] demo-inset px-[12px] py-[8px] text-[13.5px] leading-[20px] text-white">
          {it.lines.map((l, j) => (j ? [<br key={j} />, l] : l))}
        </div>
      )
    else if (it.k === 'text')
      body = (
        <p className="whitespace-nowrap text-[13.5px] leading-[21px] text-[#e6dfe6]">
          {it.lines.map((l, j) => (j ? [<br key={j} />, l] : l))}
        </p>
      )
    else body = custom?.(it.id, t)
    nodes.push(
      <div key={i} className="absolute inset-x-[16px]" style={{ top, ...rise(p, 8, 0) }}>
        {body}
      </div>,
    )
  })
  if (think > 0.01)
    nodes.push(
      <div key="think" className="absolute left-[18px] flex h-[16px] items-center" style={{ top: PAD + acc - scroll, opacity: think }}>
        <Thinking t={t} />
      </div>,
    )
  return (
    <div className="absolute inset-0" style={mask(scroll)}>
      {nodes}
    </div>
  )
}

function Composer({ done }: { done: number }) {
  return (
    <div className="absolute inset-x-[10px] bottom-[10px] h-[62px] rounded-[10px] demo-inset px-[12px] pt-[9px]">
      <div className="relative h-[19px] whitespace-nowrap text-[13px] leading-[19px] text-[#cfc6cf]">
        {done < 1 && (
          <span className="absolute left-0 top-0" style={{ opacity: 1 - done }}>
            Agent is working, messages will queue...
          </span>
        )}
        {done > 0 && (
          <span className="absolute left-0 top-0" style={{ opacity: done }}>
            Ask a follow-up...
          </span>
        )}
      </div>
      <div className="mt-[7px] flex h-[20px] items-center gap-[12px] text-[12px] text-[#8e848e]">
        <span>Claude Opus ⌄</span>
        <span>Auto ⌄</span>
        <span className="ml-auto h-[14px] w-[14px] rounded-full border border-[#6d636d]" />
        <span className="text-[15px] leading-none text-[#b3aab3]">+</span>
        <span className="relative flex h-[20px] w-[20px] items-center justify-center rounded-full" style={{ background: mix('#e5484d', '#6d636d', done) }}>
          {done < 1 && <span className="absolute h-[7px] w-[7px] rounded-[1.5px] bg-white" style={{ opacity: 1 - done }} />}
          {done > 0 && (
            <svg className="absolute" viewBox="0 0 10 10" width={9} height={9} style={{ opacity: done }} aria-hidden>
              <path d="M5 8V2M2.5 4.5 5 2l2.5 2.5" stroke="#fff" strokeWidth={1.4} fill="none" strokeLinecap="round" />
            </svg>
          )}
        </span>
      </div>
    </div>
  )
}

/** a dark agent card with its title pill; it grows out of the voice pill that spawned it */
function Card({ x, title, appear, done = 0, covered = false, children }: { x: number; title: string; appear: number; done?: number; covered?: boolean; children: ReactNode }) {
  if (appear <= 0) return null
  const a = easeOut(appear)
  // opaque early, so the dark card never reads as a milky grey while it grows
  return (
    <div
      className="absolute"
      style={{ left: x, top: CY, width: CW, opacity: easeOut(clamp(appear * 2.6)), transform: `scale(${0.9 + 0.1 * a})`, transformOrigin: `${SPAWN[0] - x}px ${SPAWN[1] - CY}px` }}
    >
      <div className="mb-[10px] flex h-[28px] items-center gap-[5px] pl-[2px]">
        <span className="h-[8px] w-[8px] rounded-full bg-black/15" />
        <span className="h-[8px] w-[8px] rounded-full bg-black/15" />
        <span className="h-[8px] w-[8px] rounded-full bg-black/15" />
        <span className="ml-[4px] flex h-[28px] items-center gap-[8px] whitespace-nowrap demo-title rounded-full pl-[12px] pr-[10px] text-[13.5px] font-semibold text-white shadow-[0_4px_12px_-6px_rgba(40,20,40,0.6)]">
          {title}
          <span className="relative h-[18px]" style={{ width: lerp(50, 56, done) }}>
            {done < 1 && (
              <span className="absolute left-0 top-0 text-[12px] font-normal leading-[18px] text-white/50" style={{ opacity: 1 - done }}>
                working
              </span>
            )}
            {done > 0 && (
              <span className="absolute left-0 top-0 flex h-[18px] items-center gap-[3px] rounded-full bg-[#2f9e6e] pl-[5px] pr-[7px] text-[12px] font-medium text-white" style={popIn(done)}>
                <svg viewBox="0 0 10 10" width={9} height={9} aria-hidden>
                  <path d="M2 5.2 4.2 7.3 8 3" stroke="#fff" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Done
              </span>
            )}
          </span>
        </span>
      </div>
      <div className="relative overflow-hidden rounded-[14px] demo-panel" style={{ height: CH }}>
        {!covered && (
          <>
            <div className="absolute inset-x-0 top-0" style={{ height: LIST_H }}>
              {children}
            </div>
            <Composer done={done} />
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- things that live inside the cards ---------- */

const THUMBS = [
  { keys: ['⌘', 'K'], dur: '0:14', bg: 'linear-gradient(140deg,#7c5ae6,#2c1f52)' },
  { keys: ['⌘', 'J'], dur: '0:21', bg: 'linear-gradient(140deg,#d0508f,#3d1f4f)' },
]

function Thumbs({ t }: { t: number }) {
  return (
    <div className="flex gap-[10px]">
      {THUMBS.map((th, i) => {
        const p = ep(t, 9.25 + i * 0.1, 9.7 + i * 0.1)
        if (p <= 0) return null
        return (
          <div key={i} className="relative h-[84px] w-[140px] overflow-hidden rounded-[10px]" style={{ background: th.bg, ...popIn(p) }}>
            <div className="absolute inset-0 flex items-center justify-center gap-[5px] pb-[10px]">
              {th.keys.map((k) => (
                <span key={k} className="flex h-[26px] min-w-[26px] items-center justify-center rounded-[6px] bg-white/90 px-[6px] text-[13px] font-semibold text-[#2a2330] shadow-[0_2px_0_rgba(0,0,0,0.25)]">
                  {k}
                </span>
              ))}
            </div>
            <span className="absolute bottom-[6px] left-[7px] flex h-[18px] items-center gap-[4px] rounded-full bg-black/45 pl-[6px] pr-[7px] text-[12px] leading-none text-white">
              <svg viewBox="0 0 10 10" width={8} height={8} aria-hidden>
                <path d="M3 2v6l5-3z" fill="#fff" />
              </svg>
              {th.dur}
            </span>
            <Mark brand={B.x} size={18} fill className="absolute right-[6px] top-[6px]" />
          </div>
        )
      })}
    </div>
  )
}

const RESULTS = [
  { brand: B.reddit, site: 'reddit.com', title: 'Any good Open Swarm alternatives?' },
  { brand: B.github, site: 'github.com', title: 'awesome-agents: desktop apps' },
  { brand: B.medium, site: 'medium.com', title: 'Five AI desktops, compared' },
]

/** a small browser inside the research card: the query types, the page loads, results land */
function SearchWin({ t }: { t: number }) {
  const load = easeInOut(seg(t, 7.25, 8.15))
  const barO = 1 - ep(t, 8.15, 8.4)
  return (
    <div className="h-[204px] overflow-hidden rounded-[10px] bg-white">
      <div className="relative flex h-[28px] items-center gap-[5px] bg-[#f1eff3] px-[10px]">
        <span className="h-[8px] w-[8px] rounded-full bg-[#ff5f57]" />
        <span className="h-[8px] w-[8px] rounded-full bg-[#febc2e]" />
        <span className="h-[8px] w-[8px] rounded-full bg-[#28c840]" />
        <span className="ml-[6px] h-[18px] min-w-0 flex-1 truncate rounded-[5px] bg-white px-[8px] text-[12px] leading-[18px] text-[#6f6875]">google.com/search?q=open+swarm+rivals</span>
        {barO > 0 && <span className="absolute bottom-0 left-0 h-[2px] bg-[#3b82f6]" style={{ width: `${Math.max(4, load * 100)}%`, opacity: barO }} />}
      </div>
      <div className="px-[12px] pt-[10px]">
        <div className="flex h-[26px] items-center gap-[7px] rounded-full px-[10px] text-[12.5px] text-[#3c3640] shadow-[inset_0_0_0_1px_#e4e0e7]">
          <Glyph d={IC.search} size={13} className="text-[#8a8290]" />
          {typed('open swarm rivals', seg(t, 7.3, 7.8))}
        </div>
        {RESULTS.map((r, i) => {
          const p = ep(t, 8.05 + i * 0.12, 8.5 + i * 0.12)
          if (p <= 0) return null
          return (
            <div key={i} className="mt-[8px]" style={rise(p, 6, 0)}>
              <div className="flex h-[16px] items-center gap-[6px] text-[12px] text-[#6f6875]">
                <Mark brand={r.brand} size={16} fill />
                {r.site}
              </div>
              <div className="mt-[2px] truncate text-[13.5px] font-medium leading-[18px] text-[#1a0dab]">{r.title}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Reason({ t }: { t: number }) {
  const d = seg(t, 10.2, 10.52)
  const a = 1 - easeOut(clamp(d * 2))
  const b = easeOut(clamp(d * 2 - 1))
  return (
    <div>
      <div className="flex h-[20px] items-center gap-[8px] whitespace-nowrap text-[13.5px] font-medium text-[#eee8ee]">
        <Glyph d={IC.sparkle} size={15} className="text-[#b085f5]" />
        Finding a rival to Open Swarm
        <Glyph d={IC.chevron} size={13} className="text-[#8e848e]" />
      </div>
      <div className="relative ml-[7px] mt-[6px] h-[20px] border-l-2 border-white/10 text-[13px] leading-[20px]">
        {a > 0 && (
          <span className="absolute left-[14px] top-0 italic" style={{ ...shimmer(t, '#9d939d', '#f4eff4'), opacity: a }}>
            Reasoning...
          </span>
        )}
        {b > 0 && (
          <span className="absolute left-[14px] top-0 text-[#8e848e]" style={{ opacity: b }}>
            Thought for 3s
          </span>
        )}
      </div>
    </div>
  )
}

const custom2 = (id: string, t: number) => (id === 'thumbs' ? <Thumbs t={t} /> : null)
const custom3 = (id: string, t: number) => (id === 'browser' ? <SearchWin t={t} /> : id === 'reason' ? <Reason t={t} /> : null)

/* ---------- launcher ---------- */

const APPS: { label: string; asset: AppAssetId }[] = [
  { label: 'Daily Brief', asset: 'brief' },
  { label: 'CRM Core', asset: 'crm' },
  { label: 'Akira', asset: 'akira' },
  { label: 'Post Harvester', asset: 'postHarvester' },
  { label: 'Lead Finder', asset: 'leads' },
  { label: 'Problem Validator', asset: 'validator' },
  { label: 'Finder', asset: 'finder' },
  { label: 'Git Graph', asset: 'gitGraph' },
  { label: 'Social Footprint', asset: 'socialFootprint' },
  { label: 'Skill Editor', asset: 'skillEditor' },
  { label: 'Analytics Refresh', asset: 'analytics' },
  { label: 'Style Guide', asset: 'styleGuide' },
]

/* ---------- the Daily Brief app ---------- */

// [count, after the first to-do is ticked, label, colour]
const STATS: [number, number, string, string][] = [
  [5, 4, 'Open', '#1f9e5a'],
  [2, 1, 'Due today', '#d6334a'],
  [0, 1, 'Done', '#1f9e5a'],
]

const TODO = [
  { title: 'Reply to Maya about Thursday', from: 'From your texts', brand: B.imessage, high: true, due: 'Today' },
  { title: 'Accept the intro from Sam', from: 'From LinkedIn', brand: B.linkedin, high: true, due: 'Today' },
  { title: 'Read the competitor notes', from: 'From Competitor research', brand: B.chrome, high: false, due: 'Tomorrow' },
  { title: 'Renew the domain', from: 'From your email', brand: B.gmail, high: false, due: 'Friday' },
]

// the pointer ticks the first to-do during the hold, and the counts roll to match
const TICK = 16.95

/** a number that rolls up to its next value: the old one slides out as the new one slides in */
function Roll({ a, b, p }: { a: number; b: number; p: number }) {
  if (p <= 0 || a === b) return <>{p >= 1 ? b : a}</>
  if (p >= 1) return <>{b}</>
  return (
    <span className="relative block h-[28px] overflow-hidden">
      <span className="absolute left-0 top-0" style={{ opacity: 1 - p, transform: `translateY(${-p * 24}px)` }}>
        {a}
      </span>
      <span className="absolute left-0 top-0" style={{ opacity: p, transform: `translateY(${(1 - p) * 24}px)` }}>
        {b}
      </span>
    </span>
  )
}

function Brief({ t, w }: { t: number; w: number }) {
  // grow out of the launcher tile: pick the origin so the window's centre travels in a
  // straight line from the tile to its resting place
  const ox = (TILE0[0] - BS0 * (BX + BW / 2)) / (1 - BS0) - BX
  const oy = (TILE0[1] - BS0 * (BY + BH / 2)) / (1 - BS0) - BY
  const at = (a: number) => ep(t, a, a + 0.45)
  const count = ep(t, 13.2, 14.1)
  const roll = ep(t, TICK + 0.12, TICK + 0.5)
  const tick = ep(t, TICK, TICK + 0.3)
  return (
    <div
      className="absolute overflow-hidden rounded-[12px] bg-[#f7f6f8] shadow-[0_40px_80px_-30px_rgba(50,20,70,0.6),0_0_0_1px_rgba(60,30,80,0.12)]"
      style={{ left: BX, top: BY, width: BW, height: BH, opacity: clamp(w * 4), transform: `scale(${lerp(BS0, 1, easeOutQuart(w))})`, transformOrigin: `${ox}px ${oy}px` }}
    >
      <div className="flex h-[30px] items-center gap-[7px] border-b border-black/[0.06] bg-white px-[12px]">
        <span className="h-[10px] w-[10px] rounded-full bg-[#ff5f57]" />
        <span className="h-[10px] w-[10px] rounded-full bg-[#febc2e]" />
        <span className="h-[10px] w-[10px] rounded-full bg-[#28c840]" />
        <span className="ml-auto flex gap-[12px] text-[#a19aa6]">
          <Glyph d={IC.refresh} size={14} />
          <Glyph d={IC.share} size={14} />
        </span>
      </div>
      <div className="px-[34px] pt-[18px]">
        <div className="flex items-start" style={rise(at(13.02), 8, 0)}>
          <div>
            <div className="text-[12px] font-semibold leading-[16px] tracking-[0.1em] text-[#7c4dea]">DAILY BRIEF</div>
            <div className="mt-[3px] text-[26px] font-semibold leading-[30px] tracking-[-0.01em] text-[#17141a]">Saturday, Sep 26</div>
            <div className="mt-[3px] text-[13.5px] leading-[20px] text-[#6f6875]">Pulled together from your texts, LinkedIn and email.</div>
          </div>
          <span className="ml-auto mt-[4px] flex h-[30px] items-center gap-[6px] rounded-[8px] bg-white px-[11px] text-[13px] font-medium text-[#3a3440] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.09)]">
            <Glyph d={IC.refresh} size={13} />
            Refresh
          </span>
        </div>
        <div className="mt-[14px] flex gap-[12px]">
          {STATS.map(([n, n2, label, color], i) => (
            <div key={label} className="flex-1 rounded-[10px] bg-white px-[14px] py-[8px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)]" style={rise(at(13.1 + i * 0.07), 8, 0)}>
              <div className="h-[28px] text-[24px] font-semibold leading-[28px] tabular-nums" style={{ color }}>
                <Roll a={Math.round(n * count)} b={n2} p={roll} />
              </div>
              <div className="text-[13px] leading-[18px] text-[#77707c]">{label}</div>
            </div>
          ))}
        </div>
        <div className="mt-[16px] flex h-[20px] items-baseline gap-[8px]" style={rise(at(13.28), 6, 0)}>
          <span className="text-[15px] font-semibold text-[#17141a]">Needs you today</span>
          <span className="text-[12px] text-[#8a8290]">Time sensitive, act now</span>
        </div>
        <div className="mt-[8px] flex flex-col gap-[6px]">
          {TODO.map((r, i) => {
            const p = at(13.34 + i * 0.08)
            if (p <= 0) return <div key={r.title} className="h-[44px]" />
            const c = i === 0 ? tick : 0
            return (
              <div key={r.title} className="flex h-[44px] items-center gap-[12px] rounded-[10px] bg-white px-[14px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07)]" style={rise(p, 8, 0)}>
                <span className="relative flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border-[1.5px]" style={{ borderColor: mix('#c9c3cc', '#1f9e5a', c), background: c > 0 ? `rgba(31,158,90,${c})` : undefined }}>
                  {c > 0 && (
                    <svg viewBox="0 0 10 10" width={10} height={10} aria-hidden style={{ opacity: c, transform: `scale(${0.6 + 0.4 * c})` }}>
                      <path d="M2 5.2 4.2 7.3 8 3" stroke="#fff" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {r.brand === B.imessage ? <DemoAppIcon asset="messages" size={24} /> : <Mark brand={r.brand} size={24} fill />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold leading-[18px]" style={{ color: mix('#1d1a20', '#9a94a0', c) }}>
                    <span className="relative inline-block">
                      {r.title}
                      {c > 0 && <span className="absolute left-0 right-0 top-[9.5px] h-[1.5px] origin-left bg-[#9a94a0]" style={{ transform: `scaleX(${c})` }} />}
                    </span>
                  </div>
                  <div className="text-[12px] leading-[16px] text-[#86808a]">{r.from}</div>
                </div>
                {r.high && (
                  <span className="rounded-[5px] bg-[#fde8eb] px-[6px] text-[12px] font-semibold leading-[18px] text-[#d6334a]" style={{ opacity: 1 - 0.55 * c }}>
                    High
                  </span>
                )}
                <span className="w-[60px] text-right text-[12px] text-[#86808a]">{r.due}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ---------- the phone camera ---------- */

// On a phone the whole stage would shrink to about a quarter and nothing would read, so a
// narrow frame films it instead: a 4:5 view that follows the action from ask to card to
// launcher to brief, never smaller than half size, and is back on its opening shot before
// the loop ends. Every view stays inside the stage, so the canvas always fills the frame.
const NARROW = 640 // container widths below this get the camera
const CAM = 5 / 4 // the view's height over its width, fixed so the frame never changes height
const CAM_MAX = H / CAM // the widest view that still fits the stage's height
/** a view `w` wide centred on (cx, cy), pushed back inside the stage */
const shot = (cx: number, cy: number, w: number): StageView => {
  const h = w * CAM
  return { x: Math.max(0, Math.min(W - w, cx - w / 2)), y: Math.max(0, Math.min(H - h, cy - h / 2)), w, h }
}

const OPEN = shot(640, 0, 440) // close on the voice pill
const CARD1 = shot(235, 346, 470) // card one, with the dock beside it
const MIDDLE = shot(638, 0, 512) // the voice pill over card two
const CARD3 = shot(998, 346, 440) // card three and its little browser
const WIDE = shot(638, 0, CAM_MAX) // all the way back: card two, with one and three at the edges
const DOCK = shot(0, 0, CAM_MAX) // along with the pointer to the dock's grid button
const LAUNCH = shot(640, 344, 500)
const BRIEF = shot(732, 361, 560) // the Daily Brief's title, counts and to-dos; its right edge is cropped
const BRIEF2 = shot(723, 356, 530) // a slow push in over the hold

// [time, view]: eased between keys, held where two keys match
const SHOTS: [number, StageView][] = [
  [0, OPEN],
  [1.5, OPEN],
  [2.4, CARD1],
  [3.3, CARD1],
  [4.2, MIDDLE],
  [6.0, MIDDLE],
  [6.9, CARD3],
  [8.45, CARD3],
  [9.3, WIDE],
  [9.8, WIDE],
  [10.5, DOCK],
  [10.7, DOCK],
  [11.5, LAUNCH],
  [12.85, LAUNCH],
  [13.75, BRIEF],
  [17.2, BRIEF2],
  [18.2, BRIEF2],
  [19.7, OPEN],
]

function camera(t: number): StageView {
  for (let i = 1; i < SHOTS.length; i++) {
    const [t1, b] = SHOTS[i]
    if (t <= t1) {
      const [t0, a] = SHOTS[i - 1]
      const p = easeInOut(seg(t, t0, t1))
      const w = lerp(a.w, b.w, p)
      return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w, h: w * CAM }
    }
  }
  return SHOTS[SHOTS.length - 1][1]
}

/* ---------- the scene ---------- */

export function HeroScene() {
  const ref = useRef<HTMLDivElement>(null)
  const t = useTimeline(LOOP, ref, REST)
  const cw = useStageWidth(ref)
  const view = cw > 0 && cw < NARROW ? camera(t) : undefined

  // everything but the rail fades back to the empty canvas at the end of the loop
  const out = 1 - easeInOut(seg(t, 19.3, 19.9))

  const d2 = ep(t, 8.9, 9.25) // card two finishes

  // launcher
  const lp = ep(t, 10.62, 11.1) * (1 - ep(t, 12.88, 13.2))
  const ps = APPS.map((_, i) => {
    const s = 10.78 + (Math.floor(i / 4) + (i % 4)) * 0.07
    return ep(t, s, s + 0.4)
  })
  const dim = ep(t, 10.55, 11.0) * (1 - ep(t, 12.95, 13.4))
  const tileHover = inOut(t, 12.2, 12.9, 0.2) * lp
  // it grows out of the rail's grid button, and closes toward its own centre
  const launcherOrigin = t < 12 ? `${GRID[0] - LX}px ${GRID[1] - LY}px` : '50% 50%'

  // the Daily Brief window, and its button joining the rail
  const bw = seg(t, 12.95, 13.6)
  const railP = ep(t, 13.35, 13.85) * out
  const railShift = (38 * clamp(railP * 2) + 10 * railP) / 2

  // pointer: rail grid button, then the Daily Brief tile; later it comes back to tick
  // the first to-do in the brief
  const [cx, cy] =
    t < 15
      ? path(t, [
          [9.75, 780, 556],
          [10.45, GRID[0], GRID[1]],
          [10.95, GRID[0], GRID[1]],
          [12.35, TILE0[0], TILE0[1]],
          [12.95, TILE0[0], TILE0[1]],
          [13.8, 600, 396],
        ])
      : path(t, [
          [16.0, 720, 516],
          [16.75, CHK[0], CHK[1]],
          [TICK + 0.15, CHK[0], CHK[1]],
          [17.95, 660, 476],
        ])
  const curO = t < 15 ? ep(t, 9.75, 10.1) * (1 - ep(t, 13.3, 13.8)) : ep(t, 16.0, 16.35) * (1 - ep(t, 17.6, 18.1))
  const click = t < 11.5 ? seg(t, 10.5, 10.9) : t < 15 ? seg(t, 12.62, 13.02) : seg(t, TICK - 0.1, TICK + 0.3)
  const gridHover = inOut(t, 10.3, 11.0, 0.2)

  return (
    <Stage w={W} h={H} view={view} stageRef={ref} width={cw} label="The Open Swarm desktop: three spoken requests start three AI agents that work side by side, then the app launcher opens a Daily Brief app.">
      <Desktop>
        {out > 0 && (
          <div className="absolute inset-0" style={{ opacity: out, transform: `scale(${0.99 + 0.01 * out})` }}>
            <Card x={COLS[0]} title="Messages and LinkedIn update" appear={seg(t, 1.75, 2.35)}>
              <Stream t={t} items={C1} working={1} thinkFrom={2.3} />
            </Card>
            {/* once the Daily Brief window fully covers cards two and three, their bodies are not rendered */}
            <Card x={COLS[1]} title="Post hotkeys videos" appear={seg(t, 4.05, 4.65)} done={d2} covered={bw >= 1}>
              <Stream t={t} items={C2} working={1 - d2} thinkFrom={4.6} custom={custom2} />
            </Card>
            <Card x={COLS[2]} title="Competitor research" appear={seg(t, 6.3, 6.9)} covered={bw >= 1}>
              <Stream t={t} items={C3} working={1} thinkFrom={6.85} custom={custom3} />
            </Card>

            <Voice t={t} />

            {dim > 0 && <div className="absolute inset-0" style={{ background: `rgba(44,24,56,${0.22 * dim})` }} />}
            {lp > 0 && (
              <Launcher
                apps={APPS}
                p={lp}
                ps={ps}
                count={54}
                cols={4}
                style={{ left: LX, top: LY, width: LW, height: LH, transformOrigin: launcherOrigin }}
              />
            )}
            {tileHover > 0 && (
              <span className="absolute rounded-[14px] bg-white/[0.09]" style={{ left: TILE0[0] - 52, top: TILE0[1] - 36, width: 104, height: 94, opacity: tileHover }} />
            )}
            {bw > 0 && <Brief t={t} w={bw} />}
          </div>
        )}

        <Rail
          style={{ left: 16, top: RAIL_Y - railShift }}
          extra={railP > 0 ? [{ key: 'brief', asset: 'brief', p: railP }] : []}
        />
        {gridHover > 0 && <span className="absolute rounded-[9px] bg-white/20" style={{ left: GRID[0] - 17, top: GRID[1] - 17, width: 34, height: 34, opacity: gridHover }} />}
        {curO > 0 && <Cursor x={cx - 2} y={cy - 1.5} click={click} style={{ opacity: curO }} />}
      </Desktop>
    </Stage>
  )
}
