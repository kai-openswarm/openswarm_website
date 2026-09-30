import type { AnchorHTMLAttributes } from 'react'
import { ArrowRight } from 'lucide-react'
import { RollText } from './RollText'
import { cn } from '@/lib/utils'

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { source?: string }

export function WaitlistLink({ source = 'nav', children, className, onClick, ...props }: Props) {
  return (
    <a
      {...props}
      href="#waitlist"
      data-track={`waitlist-link:${source}`}
      className={cn('waitlist-link group inline-flex items-center justify-center gap-2', className)}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.currentTarget.target && event.currentTarget.target !== '_self')) return
        onClick?.(event)
        if (event.defaultPrevented) return
        window.dispatchEvent(new CustomEvent('os:waitlist', { detail: source }))
        const target = document.getElementById('waitlist-phone') ?? document.getElementById('waitlist-success')
        target?.focus({ preventScroll: true })
      }}
    >
      {children ?? <RollText>Get early access</RollText>}
      <ArrowRight size={16} strokeWidth={1.75} aria-hidden className="shrink-0 transition-transform group-hover:translate-x-0.5" />
    </a>
  )
}
