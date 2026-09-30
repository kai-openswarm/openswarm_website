import type { ReactNode, RefObject } from 'react'
import { cn } from '@/lib/utils'

export type PanelProps = { prompt: string; previewTime?: number }

/*
  Shared pieces for the Use cases panels. Every team gets its own animated view (a lead list,
  a reconciliation table, a hiring pipeline, a research brief) so switching tabs actually
  shows different work; these are only the frame and the few bits they all share. Each panel
  runs on the scene clock from os/kit (useTimeline), so ?t= freezes it for screenshots.
*/

/** Fixed-height root, so switching tabs never makes the page jump. */
export function PanelRoot({ ref, label, children, className }: { ref: RefObject<HTMLDivElement | null>; label: string; children: ReactNode; className?: string }) {
  return (
    <div ref={ref} role="img" aria-label={label} className={cn('relative h-[440px] w-full', className)}>
      <div aria-hidden className="absolute inset-0">
        {children}
      </div>
    </div>
  )
}

/** A translucent reading surface with a fine lit rim; text stays on the sharp foreground. */
export function Glass({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn('rounded-[12px] bg-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.3),rgba(235,244,250,0.06)_55%,rgba(255,255,255,0.14))] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),inset_0_0_0_1px_rgba(255,255,255,0.52),0_0_0_1px_rgba(10,30,60,0.05),0_20px_42px_-28px_rgba(10,30,60,0.36)] backdrop-blur-xl backdrop-saturate-[130%] [@media(prefers-reduced-transparency:reduce)]:bg-[#f4f7f9]', className)}
      style={style}
    >
      {children}
    </div>
  )
}

/** The ask, as a black chat bubble at the top right. `shown` is how much of it has been typed. */
export function Ask({ text, shown = text.length, className, style }: { text: string; shown?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn('ml-auto w-fit max-w-[92%] text-pretty rounded-[10px] rounded-tr-[3px] bg-ink px-3 py-2 text-[13px] leading-[1.45] text-white', className)} style={style}>
      {text.slice(0, shown)}
      {/* keep the bubble at its final size while it types */}
      <span className="invisible">{text.slice(shown)}</span>
    </div>
  )
}

/** Turned by the scene clock rather than a CSS animation, so a frozen frame is always the same. */
export function Spinner({ t, className }: { t: number; className?: string }) {
  return (
    <span
      className={cn('block h-3.5 w-3.5 rounded-full border-[1.5px] border-black/15 border-t-black', className)}
      style={{ transform: `rotate(${(t * 400) % 360}deg)` }}
    />
  )
}
