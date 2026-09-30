import { useRef } from 'react'
import type { AppAssetId } from '@/lib/app-assets'
import { DemoAppIcon } from './DemoAppIcon'
import { AppTile, Desktop, Glyph, Stage, StepRow, Thinking, clamp, easeInOut, easeOut, ep, inOut, lerp, popIn, rise, seg, typed, useTimeline, type Step } from './kit'

/*
  "Apps on request." The ask comes in as a spoken pill, an agent reads the calendar and
  inbox and writes App.tsx; beside it the Daily Brief window fills in as each line of code
  lands (header, stat tiles that count up, the to-do rows). When the card turns Done the
  window folds down into its violet app icon, which glides into the launcher and lands in
  the last open slot with a glow ring while the app count ticks from 53 to 54. Everything
  is a pure function of t.
*/

const W = 520
const H = 325
const LOOP = 11
const REST = 9.6

/* layout, in stage px */
const CARD = { x: 14, y: 17, w: 204, body: 258 }
const WIN = { x: 232, y: 52, w: 274, h: 258 }
const LAU = { x: 232, y: 52, w: 274, h: 258 }
const ASK_Y = 16
const ICON = 50
const COL = 82
const PITCH_X = 82
const PITCH_Y = 84
const GRID_TOP = 86
/** centre of launcher slot i, in stage px */
const slot = (i: number) => ({ x: LAU.x + 14 + (i % 3) * PITCH_X + COL / 2, y: LAU.y + GRID_TOP + Math.floor(i / 3) * PITCH_Y + ICON / 2 })
const LAND = 5

/* ---------- the ask ---------- */

const ASK = 'Make me an app for my daily brief'
const WAVE_CALM = [5, 9, 12, 8, 5]

/** The spoken ask, as the dark transcript pill above the window. Fixed width, so it never jitters while it types. */
function AskPill({ t }: { t: number }) {
  const p = ep(t, 0.1, 0.55)
  if (p <= 0) return null
  const talk = 1 - ep(t, 1.05, 1.5)
  return (
    <div
      className="absolute flex h-[28px] items-center gap-[9px] whitespace-nowrap rounded-full bg-[#3a2f47] pl-[12px] pr-[15px] shadow-[0_10px_24px_-14px_rgba(40,20,50,0.75)]"
      style={{ left: WIN.x + WIN.w / 2, top: ASK_Y, opacity: clamp(p * 1.6), transform: `translateX(-50%) translateY(${(1 - p) * 6}px) scale(${0.9 + 0.1 * p})` }}
    >
      <span className="flex h-[14px] items-center gap-[2px]">
        {WAVE_CALM.map((calm, i) => (
          <span key={i} className="w-[2px] rounded-full bg-white/70" style={{ height: lerp(calm, 3 + 10 * Math.abs(Math.sin(t * 7.3 + i * 1.3) * Math.cos(t * 2.9 + i * 0.6)), talk) }} />
        ))}
      </span>
      <span className="relative text-[13px] font-medium leading-[18px] text-white/90">
        <span className="invisible">{ASK}</span>
        <span className="absolute left-0 top-0">{typed(ASK, seg(t, 0.25, 1.05))}</span>
      </span>
    </div>
  )
}

const SEARCH = 'M9 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12.7 12.7 16.5 16.5'

/* ---------- the agent ---------- */

const S1: Step = { kind: 'read', label: 'Read', file: 'calendar.ics' }
const S2: Step = { kind: 'read', label: 'Read', file: 'inbox.json' }
const S3a: Step = { kind: 'active', label: 'Writing', file: 'App.tsx' }
const S3b: Step = { kind: 'edit', label: 'Wrote', file: 'App.tsx' }

const C = { kw: '#c9a2ff', fn: '#8ec4ff', str: '#8fe0ae', num: '#9fe6e0', attr: '#f2bfdc', p: '#e6dfe6' }
type Tok = [string, string]
const CODE: { toks: Tok[]; a: number; b: number }[] = [
  { toks: [['const', C.kw], [' todo = ', C.p], ['inbox', C.fn], ['()', C.p]], a: 2.25, b: 2.6 },
  { toks: [['const', C.kw], [' due = ', C.p], ['today', C.fn], ['(todo)', C.p]], a: 2.68, b: 3.05 },
  { toks: [['return', C.kw], [' <', C.p], ['Brief', C.fn]], a: 3.12, b: 3.3 },
  { toks: [['  title', C.attr], ['=', C.p], ['"Daily Brief"', C.str]], a: 3.38, b: 3.75 },
  { toks: [['  stats', C.attr], ['={[', C.p], ['5', C.num], [', ', C.p], ['2', C.num], [', ', C.p], ['0', C.num], [']}', C.p]], a: 3.85, b: 4.3 },
  { toks: [['  list', C.attr], ['={due} ', C.p], ['/>', C.fn]], a: 4.45, b: 4.8 },
]
const CODE_END = 5.1

function CodeLine({ toks, n, caret }: { toks: Tok[]; n: number; caret: number }) {
  let left = n
  return (
    <div className="h-[16.5px] whitespace-pre">
      {toks.map(([s, c], i) => {
        if (left <= 0) return null
        const part = s.slice(0, left)
        left -= part.length
        return (
          <span key={i} style={{ color: c }}>
            {part}
          </span>
        )
      })}
      {caret > 0 && <span className="ml-[1px] inline-block h-[12px] w-[6px] translate-y-[2px] rounded-[1px] bg-[#b98cf8]" style={{ opacity: caret }} />}
    </div>
  )
}

function AgentPanel({ t }: { t: number }) {
  const a = ep(t, 0.95, 1.5)
  if (a <= 0) return null
  const done = ep(t, 6.0, 6.45)
  const s = [ep(t, 1.2, 1.55), ep(t, 1.48, 1.83), ep(t, 1.76, 2.11)]
  const swOut = easeInOut(seg(t, 4.95, 5.12))
  const swIn = ep(t, 5.1, 5.4)
  const codeP = ep(t, 1.95, 2.3)
  // the caret sits on the line being typed; solid while typing, a soft blink between lines
  let cur = 0
  CODE.forEach((l, i) => {
    if (t >= l.a) cur = i
  })
  const typing = t >= CODE[cur].a && t <= CODE[cur].b
  const caret = t < CODE_END ? (typing ? 1 : 0.55 + 0.45 * Math.cos(t * Math.PI * 3.2)) * (1 - seg(t, CODE_END - 0.2, CODE_END)) : 0
  const think = s[0] * (1 - done)
  return (
    <div className="absolute" style={{ left: CARD.x, top: CARD.y, width: CARD.w, opacity: clamp(a * 1.8), transform: `translateY(${(1 - a) * 14}px) scale(${0.93 + 0.07 * a})`, transformOrigin: '50% 30%' }}>
      {/* title pill */}
      <div className="mb-[9px] flex h-[26px] items-center gap-[5px]">
        <span className="h-[8px] w-[8px] rounded-full bg-black/15" />
        <span className="h-[8px] w-[8px] rounded-full bg-black/15" />
        <span className="h-[8px] w-[8px] rounded-full bg-black/15" />
        <span className="ml-[3px] flex h-[26px] items-center gap-[7px] demo-title rounded-full pl-[11px] pr-[8px] text-[13px] font-semibold text-white shadow-[0_4px_12px_-6px_rgba(40,20,40,0.6)]">
          Daily brief app
          <span className="relative h-[17px] w-[40px]">
            {done < 1 && (
              <span className="absolute left-0 top-0 text-[11px] font-normal leading-[17px] text-white/45" style={{ opacity: 1 - done }}>
                working
              </span>
            )}
            {done > 0 && (
              <span className="absolute left-0 top-0 rounded-full bg-[#2f9e6e] px-[7px] text-[11px] font-medium leading-[17px] text-white" style={{ ...popIn(done), transformOrigin: '30% 50%' }}>
                Done
              </span>
            )}
          </span>
        </span>
      </div>
      {/* card */}
      <div className="relative overflow-hidden rounded-[14px] demo-panel px-[12px] pt-[14px]" style={{ height: CARD.body }}>
        <div className="flex flex-col gap-[9px]">
          <div className="h-[17px]">{s[0] > 0 && <StepRow step={S1} p={s[0]} />}</div>
          <div className="h-[17px]">{s[1] > 0 && <StepRow step={S2} p={s[1]} />}</div>
          <div className="relative h-[17px]">
            {s[2] > 0 && swOut < 1 && (
              <div className="absolute inset-0" style={{ opacity: 1 - swOut }}>
                <StepRow step={S3a} p={s[2]} />
              </div>
            )}
            {swIn > 0 && (
              <div className="absolute inset-0">
                <StepRow step={S3b} p={swIn} />
              </div>
            )}
          </div>
        </div>
        <div className="mt-[14px] h-[117px]">
          {codeP > 0 && (
            <div className="h-full rounded-[9px] bg-[#29232a] px-[9px] py-[9px] font-mono text-[11px] leading-[16.5px] text-[#e6dfe6] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]" style={rise(codeP, 8, 0.02)}>
              {CODE.map((l, i) => (
                <CodeLine key={i} toks={l.toks} n={Math.round(l.toks.reduce((m, k) => m + k[0].length, 0) * seg(t, l.a, l.b))} caret={i === cur ? caret : 0} />
              ))}
            </div>
          )}
        </div>
        <div className="relative mt-[16px] h-[20px]">
          {think > 0 && (
            <div className="absolute left-[2px] top-[7px] flex" style={{ opacity: think }}>
              <Thinking t={t} />
            </div>
          )}
          {done > 0 && (
            <div className="absolute left-0 top-0 flex items-center gap-[7px]" style={rise(done, 6, 0)}>
              <span className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-[#2f9e6e]">
                <svg viewBox="0 0 12 12" width={10} height={10} aria-hidden>
                  <path d="M2.5 6.2 5 8.5l4.5-5" stroke="#fff" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="text-[13px] font-medium text-[#eee8ee]">App ready.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- the app it builds ---------- */

const STATS = [
  { n: 5, label: 'Open', c: '#17131a' },
  { n: 2, label: 'Due today', c: '#d4365c' },
  { n: 0, label: 'Done', c: '#1f9e68' },
]
// the hero Daily Brief's first three to-dos, in short: one app, one day
const ROWS = [
  { label: 'Reply to Maya', dot: '#8b5cf6', tag: 'Today' },
  { label: "Accept Sam's intro", dot: '#e8589a', tag: 'Today' },
  { label: 'Read competitor notes', dot: '#1fa971', tag: 'Tomorrow' },
]

/** Violet pulsing dots for the white window (the kit's Thinking dots are made for dark cards). */
function VDots({ t }: { t: number }) {
  return (
    <span className="inline-flex gap-[5px]">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-[6px] w-[6px] rounded-full bg-[#8b5cf6]" style={{ opacity: 0.25 + 0.75 * Math.max(0, Math.sin((t * 5 - i * 0.7) % (Math.PI * 2))) }} />
      ))}
    </span>
  )
}

function BriefContent({ t }: { t: number }) {
  const building = inOut(t, 2.15, 2.95, 0.3)
  const hL = ep(t, 3.05, 3.45)
  const hD = ep(t, 3.35, 3.8)
  const st = STATS.map((_, i) => ep(t, 4.1 + i * 0.1, 4.55 + i * 0.1))
  const lh = ep(t, 4.6, 5.0)
  const rows = ROWS.map((_, i) => ep(t, 4.8 + i * 0.12, 5.35 + i * 0.12))
  return (
    <div className="h-full w-full bg-white">
      <div className="flex h-[22px] items-center gap-[6px] border-b border-black/[0.06] bg-[#f4f2f5] px-[10px]">
        <span className="h-[8px] w-[8px] rounded-full bg-[#ff5f57]" />
        <span className="h-[8px] w-[8px] rounded-full bg-[#febc2e]" />
        <span className="h-[8px] w-[8px] rounded-full bg-[#28c840]" />
      </div>
      <div className="relative px-[14px] pt-[11px]">
        {building > 0 && (
          <div className="absolute left-0 right-0 top-[92px] flex flex-col items-center gap-[9px]" style={{ opacity: building }}>
            <VDots t={t} />
            <span className="text-[12px] font-medium text-[#7a7280]">Building your app</span>
          </div>
        )}
        {/* header */}
        <div className="relative h-[37px]">
          {hL > 0 && (
            <div className="absolute left-0 top-0 text-[11px] font-semibold leading-[14px] tracking-[0.12em] text-[#7c4dea]" style={rise(hL, 6, 0)}>
              DAILY BRIEF
            </div>
          )}
          {hD > 0 && (
            <div className="absolute left-0 top-[15px] text-[18px] font-semibold leading-[22px] tracking-[-0.01em] text-[#17131a]" style={rise(hD, 6, 0)}>
              Saturday, Sep 26
            </div>
          )}
        </div>
        {/* stats */}
        <div className="mt-[9px] grid h-[46px] grid-cols-3 gap-[8px]">
          {STATS.map((s, i) => (
            <div key={s.label}>
              {st[i] > 0 && (
                <div className="h-full rounded-[9px] bg-[#f6f4f8] px-[10px] pt-[4px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]" style={rise(st[i], 8, 0.04)}>
                  <div className="text-[20px] font-semibold leading-[23px] tabular-nums" style={{ color: s.c }}>
                    {Math.round(s.n * easeOut(seg(t, 4.3 + i * 0.1, 5.0 + i * 0.1)))}
                  </div>
                  <div className="text-[11px] leading-[14px] text-[#7a7280]">{s.label}</div>
                </div>
              )}
            </div>
          ))}
        </div>
        {/* to-do list */}
        <div className="mt-[11px] h-[17px]">
          {lh > 0 && (
            <div className="text-[13px] font-semibold leading-[17px] text-[#17131a]" style={rise(lh, 6, 0)}>
              Needs you today
            </div>
          )}
        </div>
        <div className="mt-[7px] flex flex-col gap-[4px]">
          {ROWS.map((r, i) => (
            <div key={r.label} className="h-[26px]">
              {rows[i] > 0 && (
                <div
                  className="flex h-full items-center gap-[8px] rounded-[8px] bg-white px-[10px] shadow-[0_0_0_1px_rgba(0,0,0,0.07),0_3px_8px_-6px_rgba(40,20,50,0.35)]"
                  style={{ opacity: rows[i], transform: `translateX(${(1 - rows[i]) * 18}px)` }}
                >
                  <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: r.dot }} />
                  <span className="text-[12.5px] font-medium text-[#221d26]">{r.label}</span>
                  {r.tag === 'Today' ? (
                    <span className="ml-auto rounded-full bg-[#fdecef] px-[7px] text-[11px] font-medium leading-[17px] text-[#cf3358]">Today</span>
                  ) : (
                    <span className="ml-auto pr-[4px] text-[11px] leading-[17px] text-[#8a8290]">{r.tag}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The Daily Brief window, which later folds into its own icon: one box whose size, corner,
 * fill and position are interpolated, so the window and the icon are the same element and
 * nothing is swapped mid-flight.
 */
function BriefMorph({ t }: { t: number }) {
  const appear = ep(t, 1.95, 2.5)
  if (appear <= 0) return null
  const sz = easeInOut(seg(t, 6.6, 7.5))
  // the glide starts while the window is still folding, so it never parks on another tile
  const fl = easeInOut(seg(t, 6.7, 8.25))
  const to = slot(LAND)
  const lift = Math.sin(Math.PI * fl)
  const cx = lerp(WIN.x + WIN.w / 2, to.x, fl)
  const cy = lerp(WIN.y + WIN.h / 2, to.y, fl) - 18 * lift
  const w = lerp(WIN.w, ICON, sz)
  const h = lerp(WIN.h, ICON, sz)
  // the window stays white while it shrinks and only turns into the violet tile once it is small
  const cf = 1 - easeInOut(seg(t, 7.08, 7.36))
  const vp = easeInOut(seg(t, 7.08, 7.4))
  const gp = ep(t, 7.22, 7.62)
  const settle = 1 - 0.07 * Math.sin(Math.PI * seg(t, 8.25, 8.6))
  const hover = 1 + 0.06 * lift * sz
  const a = easeOut(appear)
  const spawning = t < 3
  const transform = spawning ? `translateX(${(1 - a) * -12}px) scale(${0.9 + 0.1 * a})` : `scale(${settle * hover})`
  // landing ring and glow, drawn under the icon
  const rp = ep(t, 8.25, 8.8)
  const glow = ep(t, 8.25, 8.5) * (1 - 0.55 * ep(t, 8.65, 9.5))
  return (
    <>
      {rp > 0 && (
        <span
          className="absolute"
          style={{
            left: to.x - ICON / 2,
            top: to.y - ICON / 2,
            width: ICON,
            height: ICON,
            borderRadius: ICON * 0.24 + 1,
            opacity: rp,
            transform: `scale(${lerp(1.3, 1, rp)})`,
            boxShadow: `0 0 0 3px #1f1b22, 0 0 0 5px rgba(190,155,255,0.95), 0 0 22px 8px rgba(139,92,246,${0.75 * glow})`,
          }}
        />
      )}
      <div
        className="absolute overflow-hidden"
        style={{
          left: cx - w / 2,
          top: cy - h / 2,
          width: w,
          height: h,
          borderRadius: lerp(10, ICON * 0.24, sz),
          background: '#fff',
          opacity: clamp(appear * 1.6),
          transform,
          transformOrigin: spawning ? '0% 45%' : '50% 50%',
          boxShadow: `0 ${lerp(18, 8, sz) + 8 * lift}px ${lerp(40, 16, sz) + 10 * lift}px ${lerp(-22, -9, sz)}px rgba(50,20,60,${lerp(0.5, 0.6, sz)}), 0 0 0 1px rgba(60,30,70,${0.1 * (1 - vp)})`,
        }}
      >
        {cf > 0 && (
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: WIN.w, height: WIN.h, transform: `scale(${w / WIN.w})`, opacity: cf }}>
            <BriefContent t={t} />
          </div>
        )}
        {vp > 0 && (
          <div
            className="absolute inset-0 flex items-center justify-center text-white"
            style={{
              opacity: vp,
              background: '#7751cf',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -3px 6px rgba(0,0,0,0.12)',
            }}
          >
            {gp > 0 && (
              <span className="flex" style={{ opacity: gp, transform: `scale(${(w / ICON) * (0.75 + 0.25 * gp)})` }}>
                <DemoAppIcon asset="brief" size={ICON} />
              </span>
            )}
          </div>
        )}
      </div>
    </>
  )
}

/* ---------- the launcher ---------- */

// The same original app assets are used in the hero and the smaller capability scene.
const APPS: { label: string; asset: AppAssetId }[] = [
  { label: 'CRM Core', asset: 'crm' },
  { label: 'Post Harvester', asset: 'postHarvester' },
  { label: 'Lead Finder', asset: 'leads' },
  { label: 'Validator', asset: 'validator' },
  { label: 'Finder', asset: 'finder' },
]

function LauncherPanel({ t }: { t: number }) {
  const lp = ep(t, 6.9, 7.55)
  if (lp <= 0) return null
  const tick = easeInOut(seg(t, 8.35, 8.7))
  const lab = ep(t, 8.3, 8.7)
  return (
    <div
      className="demo-launcher absolute overflow-hidden rounded-[16px]"
      style={{ left: LAU.x, top: LAU.y, width: LAU.w, height: LAU.h, opacity: clamp(lp * 1.4), transform: `translateY(${(1 - lp) * 36}px) scale(${0.97 + 0.03 * lp})`, transformOrigin: '50% 100%' }}
    >
      <div className="absolute left-[14px] top-[14px] flex h-[16px] items-center gap-[8px]">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-white/80">APPLICATIONS</span>
        <span className="relative h-[17px] w-[27px] overflow-hidden rounded-full bg-white/10 text-center text-[11px] leading-[17px] text-white/70 tabular-nums">
          {tick < 1 && (
            <span className="absolute inset-0" style={{ transform: `translateY(${-tick * 14}px)`, opacity: 1 - tick }}>
              53
            </span>
          )}
          {tick > 0 && (
            <span className="absolute inset-0" style={{ transform: `translateY(${(1 - tick) * 14}px)`, opacity: tick }}>
              54
            </span>
          )}
        </span>
      </div>
      <div className="demo-launcher-search absolute left-[14px] right-[14px] top-[40px] flex h-[28px] items-center gap-[7px] rounded-[8px] px-[10px] text-[12px]">
        <Glyph d={SEARCH} size={13} />
        Search your apps
      </div>
      {APPS.map((app, i) => (
        <div key={app.label} className="absolute flex justify-center" style={{ left: 14 + (i % 3) * PITCH_X, top: GRID_TOP + Math.floor(i / 3) * PITCH_Y, width: COL }}>
          <AppTile label={app.label} asset={app.asset} size={ICON} labelClass="text-[12px] max-w-[80px]" p={ep(t, 7.05 + i * 0.07, 7.5 + i * 0.07)} />
        </div>
      ))}
      {lab > 0 && (
        <div className="absolute flex flex-col items-center gap-[7px]" style={{ left: 14 + (LAND % 3) * PITCH_X, top: GRID_TOP + Math.floor(LAND / 3) * PITCH_Y, width: COL }}>
          <span style={{ height: ICON }} />
          <span className="text-[12px] text-white/85" style={rise(lab, 5, 0)}>
            Daily Brief
          </span>
        </div>
      )}
    </div>
  )
}

/* ---------- scene ---------- */

export function AppsScene() {
  const ref = useRef<HTMLDivElement>(null)
  const t = useTimeline(LOOP, ref, REST)
  const fade = 1 - easeInOut(seg(t, 10.4, LOOP))
  return (
    <Stage w={W} h={H} stageRef={ref} label="Asked for a daily brief app, an agent writes it, the app window fills in with stats and a to-do list, then folds into a violet icon that lands in the app launcher.">
      <Desktop wallpaper>
        {fade > 0 && (
          <div className="absolute inset-0" style={{ opacity: fade }}>
            <AskPill t={t} />
            <AgentPanel t={t} />
            <LauncherPanel t={t} />
            <BriefMorph t={t} />
          </div>
        )}
      </Desktop>
    </Stage>
  )
}
