import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { cn, media } from '@/lib/utils'
import type { AppAssetId } from '@/lib/app-assets'
import { DemoAppIcon } from './DemoAppIcon'
import './demo-surfaces.css'

/*
  The Open Swarm desktop, rebuilt as components so the product scenes on the page are
  crisp animation instead of screen recordings. Colours, shapes and labels are measured
  from Haik's launch videos, with a wallpaper canvas, translucent glass dock, dark agent cards
  with title pills, a voice pill and an app launcher. Every scene is a pure function
  of one clock `t` (seconds), so a scene can be
  frozen at any moment with ?t=4.5 in the URL for screenshots.
*/

/* ---------- time ---------- */

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
/** 0..1 progress of t through [a, b] */
export const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3)
export const easeInOut = (x: number) => {
  const v = clamp(x)
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2
}
/** eased progress of t through [a, b] */
export const ep = (t: number, a: number, b: number) => easeOut(seg(t, a, b))
/** in over [a, a+d], out over [b, b+d]: 0..1..0 */
export const inOut = (t: number, a: number, b: number, d = 0.4) => Math.min(ep(t, a, a + d), 1 - ep(t, b, b + d))
/** the first part of `text` that has been "typed" by progress p */
export const typed = (text: string, p: number) => text.slice(0, Math.round(text.length * clamp(p)))
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p

/** style for something that fades and lifts in with progress p (0..1) */
export const rise = (p: number, dy = 10, s = 0.03): CSSProperties => ({
  opacity: p,
  transform: `translateY(${(1 - p) * dy}px) scale(${1 - s + s * p})`,
})
/** style for something that pops in with progress p, from its own centre */
export const popIn = (p: number): CSSProperties => ({
  opacity: clamp(p * 1.6),
  transform: `scale(${0.86 + 0.14 * easeOut(p)})`,
})

/** ?t= in dev only, read once: a live link with a cache-buster like ?t=1727400000 must not freeze the page */
const FROZEN: number | null = (() => {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get('t')
  const n = v === null || v === '' ? NaN : Number(v)
  return Number.isFinite(n) ? n : null
})()

/**
 * The scene clock. Loops over `loop` seconds, runs only while `ref` is on screen, ticks at
 * about 30 fps. Reduced motion (or ?t=) holds it still, at `rest` or the frozen time.
 */
export function useTimeline(loop: number, ref: RefObject<HTMLElement | null>, rest = loop * 0.6) {
  const frozen = FROZEN
  const [reduce] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [t, setT] = useState(() => (frozen !== null ? frozen % loop : reduce ? rest : 0))

  useEffect(() => {
    if (frozen !== null || reduce) return
    const el = ref.current
    if (!el) return
    let raf = 0
    let last = 0
    let clock = 0
    let prev = 0
    let visible = false
    const tick = (now: number) => {
      if (!prev) prev = now
      clock = (clock + Math.min(0.1, (now - prev) / 1000)) % loop
      prev = now
      if (now - last > 32) {
        last = now
        setT(clock)
      }
      if (visible) raf = requestAnimationFrame(tick)
    }
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      cancelAnimationFrame(raf)
      if (visible) {
        prev = 0
        raf = requestAnimationFrame(tick)
      }
    })
    io.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
    }
  }, [frozen, reduce, loop, ref])

  return t
}

/* ---------- stage ---------- */

/** A rectangle of a stage, in stage px: what a camera shows. */
export type StageView = { x: number; y: number; w: number; h: number }

/**
 * The CSS width of an element (0 until it is measured), kept current as it resizes. Measured
 * before paint, so a scene can pick its layout for the first frame. Pass it the stageRef.
 */
export function useStageWidth(ref: RefObject<HTMLElement | null>, on = true) {
  const [cw, setCw] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !on) return
    const ro = new ResizeObserver(() => setCw(el.clientWidth))
    ro.observe(el)
    setCw(el.clientWidth)
    return () => ro.disconnect()
  }, [ref, on])
  return cw
}

/**
 * A fixed-size design surface (w x h px) scaled to the width of its container, so a scene
 * is laid out once and stays sharp and in proportion from phone to desktop. Pass `stageRef`
 * to the scene's useTimeline.
 *
 * `view` films a part of the stage instead of all of it: the container takes the view's
 * aspect and shows just that rectangle, filling its width. The rectangle may pan and zoom
 * from frame to frame as long as its aspect stays the same, so the container never changes
 * height.
 */
export function Stage({
  w,
  h,
  view,
  children,
  className,
  stageRef,
  width,
  label,
}: {
  w: number
  h: number
  view?: StageView
  children: ReactNode
  className?: string
  stageRef?: RefObject<HTMLDivElement | null>
  /** the frame's width, when the scene already measures it with useStageWidth(stageRef) */
  width?: number
  label?: string
}) {
  const own = useRef<HTMLDivElement>(null)
  const box = stageRef ?? own
  const measured = useStageWidth(box, width === undefined)
  const cw = width ?? measured
  const scale = cw / (view ? view.w : w)
  // scale first, then shift by the view's corner in stage px
  const transform = view ? `scale(${scale}) translate(${-view.x}px, ${-view.y}px)` : `scale(${scale})`
  return (
    <div ref={box} role={label ? 'img' : undefined} aria-label={label} className={cn('relative w-full overflow-hidden', className)} style={{ aspectRatio: view ? `${view.w} / ${view.h}` : `${w} / ${h}` }}>
      <div aria-hidden={label ? true : undefined} className="absolute left-0 top-0 origin-top-left" style={{ width: w, height: h, transform, visibility: scale ? 'visible' : 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

/* ---------- surfaces ---------- */

/** The default hero canvas, or a product wallpaper explicitly inherited from a card. */
export function Desktop({ children, className, style, wallpaper = false }: { children?: ReactNode; className?: string; style?: CSSProperties; wallpaper?: boolean }) {
  return (
    <div
      className={cn('absolute inset-0 overflow-hidden font-sans', className)}
      style={{
        ...(wallpaper
          ? {
              backgroundColor: 'var(--product-ground, #ecdcf0)',
              backgroundImage: 'linear-gradient(rgba(255,255,255,0.12),rgba(255,255,255,0.12)), var(--product-wallpaper, none)',
              backgroundPosition: 'var(--product-wallpaper-position, center)',
              backgroundSize: 'cover',
            }
          : { background: '#203442' }),
        ...style,
      }}
    >
      {!wallpaper && <>
        {/* Wallpaper only: keep the timeline, camera, cards, cursor and all foreground layers intact. */}
        <div aria-hidden className="pointer-events-none absolute -inset-[12px]" style={{ backgroundImage: `url("${media('canvas-twilight.webp')}")`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(3px) brightness(1.32) saturate(0.82)' }} />
        <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(160deg,rgba(194,221,246,0.19),rgba(231,235,248,0.08))' }} />
      </>}
      {children}
    </div>
  )
}

const railIcons = {
  chat: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 3v-3A2.5 2.5 0 0 1 3 10.5z',
  video: 'M3.5 6A1.5 1.5 0 0 1 5 4.5h6.5A1.5 1.5 0 0 1 13 6v7a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 13zM13 8.5l3.5-2v6l-3.5-2',
  book: 'M3.5 4.5h4a2.5 2.5 0 0 1 2.5 2.5v8.5a2 2 0 0 0-2-2H3.5zM16.5 4.5h-4A2.5 2.5 0 0 0 10 7v8.5a2 2 0 0 1 2-2h4.5z',
  globe: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM3 10h14M10 3c2 2 2.8 4.4 2.8 7S12 15 10 17M10 3C8 5 7.2 7.4 7.2 10S8 15 10 17',
  calendar: 'M4 5.5h12v10H4zM4 8.5h12M7 3.5v3M13 3.5v3',
  store: 'M3.5 7.5 5 4h10l1.5 3.5M3.5 7.5h13v8h-13zM8 15.5v-4h4v4',
  gear: 'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4',
  grid: 'M4 4h4.5v4.5H4zM11.5 4H16v4.5h-4.5zM4 11.5h4.5V16H4zM11.5 11.5H16V16h-4.5z',
}
export type RailIcon = keyof typeof railIcons

export function Glyph({ d, className, size = 18 }: { d: string; className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

/**
 * Slim frosted navigation with original app artwork. Keep the slot geometry stable:
 * the hero's pointer and expanding dock are choreographed against these coordinates.
 */
export function Rail({
  className,
  style,
  extra = [],
  highlight,
}: {
  className?: string
  style?: CSSProperties
  extra?: { key: string; asset: AppAssetId; p?: number }[]
  highlight?: string
}) {
  const top: { key: string; asset: AppAssetId; p?: number }[] = [
    { key: 'chat', asset: 'messages' },
    { key: 'video', asset: 'facetime' },
    { key: 'chatgpt', asset: 'chatgpt' },
    { key: 'claude', asset: 'claude' },
  ]
  return (
    <div className={cn('demo-rail absolute ml-[4px] flex w-[48px] flex-col items-center gap-[10px] rounded-[24px] py-[12px]', className)} style={style}>
      {[...top, ...extra].map((b) => {
        const p = 'p' in b && typeof b.p === 'number' ? b.p : 1
        return (
          <span
            key={b.key}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] text-white"
            style={{
              boxShadow: highlight === b.key ? '0 0 0 2px #fff, 0 0 0 5px rgba(71,115,164,0.3)' : undefined,
              opacity: clamp(p * 1.5),
              transform: `scale(${0.6 + 0.4 * easeOut(p)})`,
              height: 38 * clamp(p * 2),
              marginBottom: p < 1 ? -10 * (1 - p) : 0,
            }}
          >
            <DemoAppIcon asset={b.asset} size={32} />
          </span>
        )
      })}
      <span className="my-[2px] h-px w-[22px] bg-white/15 shadow-[0_1px_0_rgba(16,32,48,0.12)]" />
      {(['globe', 'calendar', 'store'] as RailIcon[]).map((k) => (
        <span key={k} className="flex h-[30px] w-[30px] items-center justify-center text-white/85">
          {k === 'globe' ? <DemoAppIcon asset="safari" size={24} /> : k === 'calendar' ? <DemoAppIcon asset="calendar" size={24} /> : <Glyph d={railIcons[k]} size={17} />}
        </span>
      ))}
      <span className="my-[2px] h-px w-[22px] bg-white/15 shadow-[0_1px_0_rgba(16,32,48,0.12)]" />
      {(['gear', 'grid'] as RailIcon[]).map((k) => (
        <span key={k} className="flex h-[30px] w-[30px] items-center justify-center text-white/85">
          <Glyph d={railIcons[k]} size={17} />
        </span>
      ))}
    </div>
  )
}

/* ---------- agent card ---------- */

export type Step = { kind?: 'read' | 'list' | 'edit' | 'search' | 'browse' | 'text' | 'active'; label: string; file?: string; ms?: string }

const stepIcon: Record<NonNullable<Step['kind']>, string> = {
  read: 'M5 3.5h7l3 3v10H5zM12 3.5v3h3',
  list: 'M3.5 5.5h13M3.5 10h13M3.5 14.5h9',
  edit: 'M4 16l1-4 8-8 3 3-8 8zM11.5 5.5l3 3',
  search: 'M9 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12.7 12.7 16.5 16.5',
  browse: railIcons.globe,
  text: railIcons.chat,
  active: 'M5 3.5h7l3 3v10H5z',
}

/** One step row inside an agent card. `p` fades it in. */
export function StepRow({ step, p = 1 }: { step: Step; p?: number }) {
  if (step.kind === 'text') {
    return (
      <p className="text-[13px] leading-[1.6] text-[#e6dfe6]" style={rise(p, 6, 0)}>
        {step.label}
      </p>
    )
  }
  const active = step.kind === 'active'
  return (
    <div className="flex items-center gap-[8px] text-[12.5px]" style={rise(p, 6, 0)}>
      <Glyph d={stepIcon[step.kind ?? 'read']} size={14} className={active ? 'text-[#b085f5]' : 'text-[#a99fa9]'} />
      <span className={active ? 'font-medium text-[#b98cf8]' : 'font-medium text-[#eee8ee]'}>{step.label}</span>
      {step.file && <span className="font-mono text-[11.5px] text-[#a99fa9]">{step.file}</span>}
      {step.ms && <span className="ml-auto font-mono text-[10.5px] text-[#7d737d]">{step.ms}</span>}
    </div>
  )
}

export type AgentStatus = 'working' | 'done' | 'queued'

/**
 * A dark agent card with its title pill above it. `appear` (0..1) pops the card in.
 * Children go in the scrolling body; `prompt` is the user's message at the top right.
 */
export function AgentCard({
  title,
  status = 'working',
  prompt,
  promptP = 1,
  children,
  className,
  style,
  appear = 1,
  composer = true,
  width = 360,
  height = 420,
}: {
  title: string
  status?: AgentStatus
  prompt?: string
  promptP?: number
  children?: ReactNode
  className?: string
  style?: CSSProperties
  appear?: number
  composer?: boolean
  width?: number
  height?: number
}) {
  const a = easeOut(appear)
  return (
    <div className={cn('absolute', className)} style={{ width, opacity: clamp(appear * 1.8), transform: `translateY(${(1 - a) * 16}px) scale(${0.92 + 0.08 * a})`, transformOrigin: '50% 30%', ...style }}>
      {/* title pill */}
      <div className="mb-[10px] flex items-center gap-[6px] pl-[2px]">
        <span className="h-[9px] w-[9px] rounded-full bg-black/15" />
        <span className="h-[9px] w-[9px] rounded-full bg-black/15" />
        <span className="h-[9px] w-[9px] rounded-full bg-black/15" />
        <span className="ml-[4px] flex h-[26px] items-center gap-[8px] demo-title rounded-full pl-[11px] pr-[9px] text-[13px] font-semibold text-white shadow-[0_4px_12px_-6px_rgba(40,20,40,0.6)]">
          <span className="max-w-[230px] truncate">{title}</span>
          <StatusChip status={status} />
        </span>
      </div>
      {/* card */}
      <div className="relative flex flex-col overflow-hidden rounded-[14px] demo-panel" style={{ height }}>
        <div className="flex flex-1 flex-col gap-[12px] overflow-hidden px-[16px] pt-[16px]">
          {prompt && (
            <div className="ml-auto max-w-[85%] rounded-[10px] demo-inset px-[12px] py-[8px] text-[13px] leading-[1.5] text-white" style={rise(promptP, 6, 0)}>
              {prompt}
            </div>
          )}
          {children}
        </div>
        {composer && (
          <div className="m-[10px] mt-0 rounded-[10px] demo-inset px-[12px] py-[9px]">
            <div className="text-[13px] text-[#cfc6cf]">{status === 'done' ? 'Ask a follow-up...' : 'Agent is working, messages will queue...'}</div>
            <div className="mt-[6px] flex items-center gap-[12px] text-[11px] text-[#8e848e]">
              <span>Claude Opus ⌄</span>
              <span>Auto ⌄</span>
              <span className="ml-auto h-[14px] w-[14px] rounded-full border border-[#6d636d]" />
              <span className="text-[14px] leading-none text-[#b3aab3]">+</span>
              <span className={cn('flex h-[20px] w-[20px] items-center justify-center rounded-full', status === 'done' ? 'bg-[#6d636d]' : 'bg-[#e5484d]')}>
                {status === 'done' ? (
                  <svg viewBox="0 0 10 10" width={9} height={9} aria-hidden>
                    <path d="M5 8V2M2.5 4.5 5 2l2.5 2.5" stroke="#fff" strokeWidth={1.4} fill="none" strokeLinecap="round" />
                  </svg>
                ) : (
                  <span className="h-[7px] w-[7px] rounded-[1.5px] bg-white" />
                )}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function StatusChip({ status }: { status: AgentStatus }) {
  if (status === 'done')
    return <span className="rounded-full bg-[#2f9e6e] px-[7px] py-[1px] text-[10.5px] font-medium text-white">Done</span>
  if (status === 'queued') return <span className="text-[10.5px] font-normal text-white/40">queued</span>
  return <span className="text-[10.5px] font-normal text-white/45">working</span>
}

/** Three dots that pulse, for "thinking". */
export function Thinking({ t, className }: { t: number; className?: string }) {
  return (
    <span className={cn('inline-flex gap-[4px]', className)}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-[5px] w-[5px] rounded-full bg-[#b3aab3]" style={{ opacity: 0.4 + 0.6 * Math.max(0, Math.sin(t * 5 - i * 0.7)), transform: `scale(${0.86 + 0.14 * Math.max(0, Math.sin(t * 5 - i * 0.7))})` }} />
      ))}
    </span>
  )
}

/* ---------- voice ---------- */

/** The dark voice pill with a live waveform, and the transcript bubble under it. */
export function VoicePill({ t, text, p = 1, textP = 1, done = false, className, style }: { t: number; text?: string; p?: number; textP?: number; done?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <div className={cn('absolute flex flex-col items-center gap-[10px]', className)} style={{ ...popIn(p), ...style }}>
      <div className="flex h-[48px] items-center gap-[12px] rounded-full bg-[#2a252c] pl-[8px] pr-[8px] shadow-[0_14px_30px_-14px_rgba(40,20,50,0.7)]">
        <span className="flex h-[32px] w-[32px] items-center justify-center rounded-full bg-white/10 text-white/80">
          <svg viewBox="0 0 10 10" width={10} height={10} aria-hidden>
            <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
          </svg>
        </span>
        <span className="flex h-[22px] items-center gap-[3px]">
          {Array.from({ length: 16 }).map((_, i) => {
            const amp = done ? 0.25 : 0.35 + 0.65 * Math.abs(Math.sin(t * 7 + i * 0.9) * Math.cos(t * 3.1 + i * 0.4))
            return <span key={i} className="w-[2.5px] rounded-full bg-white/85" style={{ height: 4 + 18 * amp }} />
          })}
        </span>
        <span className={cn('flex h-[32px] w-[32px] items-center justify-center rounded-full', done ? 'bg-white text-[#2a252c]' : 'bg-white/90 text-[#2a252c]')}>
          <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden>
            <path d="M2.5 6.2 5 8.5l4.5-5" stroke="currentColor" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      {text && textP > 0 && (
        <div className="max-w-[420px] rounded-full bg-[#3a2f47] px-[18px] py-[9px] text-center text-[15px] text-white/90 shadow-[0_10px_24px_-14px_rgba(40,20,50,0.7)]" style={rise(clamp(textP * 3), 6, 0)}>
          {typed(text, textP)}
        </div>
      )}
    </div>
  )
}

/* ---------- browser ---------- */

/** A small light browser window. `loading` (0..1) shows the blue load bar while < 1. */
export function BrowserWin({ url, children, className, style, loading = 1, dark = false }: { url: string; children?: ReactNode; className?: string; style?: CSSProperties; loading?: number; dark?: boolean }) {
  return (
    <div className={cn('absolute overflow-hidden rounded-[10px] shadow-[0_18px_40px_-22px_rgba(50,20,60,0.55),0_0_0_1px_rgba(60,30,70,0.1)]', dark ? 'bg-[#1c1a1e]' : 'bg-white', className)} style={style}>
      <div className={cn('relative flex h-[26px] items-center gap-[6px] px-[9px]', dark ? 'bg-[#2a272c]' : 'bg-[#f3f1f4]')}>
        <span className="h-[7px] w-[7px] rounded-full bg-[#ff5f57]" />
        <span className="h-[7px] w-[7px] rounded-full bg-[#febc2e]" />
        <span className="h-[7px] w-[7px] rounded-full bg-[#28c840]" />
        <span className={cn('ml-[6px] flex h-[16px] flex-1 items-center truncate rounded-[5px] px-[7px] text-[9.5px]', dark ? 'bg-white/10 text-white/60' : 'bg-white text-[#7a7280]')}>{url}</span>
        {loading < 1 && <span className="absolute bottom-0 left-0 h-[2px] bg-[#3b82f6]" style={{ width: `${Math.max(6, loading * 100)}%` }} />}
      </div>
      <div className="relative">{children}</div>
    </div>
  )
}

/* ---------- apps ---------- */

/** Original app artwork at a fixed size; preserves the existing tile animation geometry. */
export function AppTile({ label, asset, size = 64, labelClass, p = 1, style }: { label?: string; asset: AppAssetId; size?: number; labelClass?: string; p?: number; style?: CSSProperties }) {
  return (
    <div className="flex flex-col items-center gap-[7px]" style={{ ...popIn(p), ...style }}>
      <DemoAppIcon asset={asset} size={size} />
      {label && <span title={label} className={cn('max-w-[96px] truncate text-[12px] leading-[17px] text-white/90', labelClass)}>{label}</span>}
    </div>
  )
}

/* ---------- pointer ---------- */

/** A macOS pointer at (x, y) with a click ripple while `click` runs 0..1. */
export function Cursor({ x, y, click = 0, style }: { x: number; y: number; click?: number; style?: CSSProperties }) {
  return (
    <div className="pointer-events-none absolute z-50" style={{ left: x, top: y, ...style }}>
      {click > 0 && click < 1 && (
        <span className="absolute -left-[14px] -top-[14px] h-[28px] w-[28px] rounded-full border-2 border-[#8b5cf6]" style={{ opacity: 1 - click, transform: `scale(${0.4 + click * 1.2})` }} />
      )}
      <svg width="20" height="24" viewBox="0 0 20 24" aria-hidden style={{ transform: `scale(${click > 0 && click < 0.5 ? 0.88 : 1})`, transformOrigin: '2px 2px' }}>
        <path d="M2 1.5v17.2l4.6-4.3 3 6.9 3-1.3-3-6.8h6.3z" fill="#111" stroke="#fff" strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/** Moves a point along a list of [time, x, y] keyframes with easing between them. */
export function path(t: number, keys: [number, number, number][]): [number, number] {
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]]
  for (let i = 1; i < keys.length; i++) {
    const [t1, x1, y1] = keys[i]
    const [t0, x0, y0] = keys[i - 1]
    if (t <= t1) {
      const p = easeInOut(seg(t, t0, t1))
      return [lerp(x0, x1, p), lerp(y0, y1, p)]
    }
  }
  const k = keys[keys.length - 1]
  return [k[1], k[2]]
}

/* ---------- misc ---------- */

/** A gray bar standing in for a line of text in tiny previews. */
export function Line({ w, className, style }: { w: number | string; className?: string; style?: CSSProperties }) {
  return <span className={cn('block h-[6px] rounded-full bg-black/10', className)} style={{ width: w, ...style }} />
}

/** A brand mark from lib/brands in a small tile: white tile with the brand colour, or filled. */
export function Mark({ brand, size = 28, fill = false, className }: { brand: { path: string; hex: string; title: string }; size?: number; fill?: boolean; className?: string }) {
  const hex = `#${brand.hex}`
  return (
    <span
      title={brand.title}
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.26,
        background: fill ? hex : '#fff',
        boxShadow: fill ? 'inset 0 1px 0 rgba(255,255,255,0.3)' : 'inset 0 0 0 1px rgba(0,0,0,0.07)',
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} aria-hidden>
        <path d={brand.path} fill={fill ? '#fff' : hex} />
      </svg>
    </span>
  )
}

/**
 * The dark "Applications" panel: count in the header, a search field, then a grid of
 * tiles. `p` (0..1) opens the panel; each tile pops in on its own `ps[i]` when given.
 */
export function Launcher({
  apps,
  p = 1,
  ps,
  count,
  cols = 5,
  className,
  style,
  query = '',
  highlight,
}: {
  apps: { label: string; asset: AppAssetId }[]
  p?: number
  ps?: number[]
  count?: number
  cols?: number
  className?: string
  style?: CSSProperties
  query?: string
  highlight?: number
}) {
  return (
    <div className={cn('demo-launcher absolute overflow-hidden rounded-[18px] p-[20px]', className)} style={{ ...popIn(p), transformOrigin: '50% 60%', ...style }}>
      <div className="flex items-center gap-[10px]">
        <span className="text-[12px] font-semibold tracking-[0.14em] text-white/80">APPLICATIONS</span>
        <span className="rounded-full bg-white/10 px-[7px] py-[1px] text-[11px] text-white/75 tabular-nums">{count ?? apps.length}</span>
      </div>
      <div className="demo-launcher-search mt-[12px] flex h-[34px] items-center gap-[8px] rounded-[9px] px-[11px] text-[13px]">
        <Glyph d="M9 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12.7 12.7 16.5 16.5" size={14} />
        {query ? <span className="text-white/85">{query}</span> : 'Search your apps'}
      </div>
      <div className="mt-[18px] grid gap-x-[14px] gap-y-[16px]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {apps.map((a, i) => (
          <div key={a.label + i} className="relative flex justify-center">
            {highlight === i && <span className="absolute -inset-[6px] rounded-[14px] bg-white/10" />}
            <AppTile label={a.label} asset={a.asset} size={58} p={ps ? ps[i] ?? 1 : 1} />
          </div>
        ))}
      </div>
    </div>
  )
}
