import type { InputHTMLAttributes, Ref } from 'react'
import { Mail } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }

/** A quiet glass field that keeps the browser's native email and autofill behavior. */
export function LiquidGlassInput({ ref, className, disabled, ...props }: Props) {
  return (
    <div className="liquid-glass-input relative isolate flex h-11 min-w-0 items-center rounded-[9px]" data-disabled={disabled || undefined}>
      <Mail size={15} strokeWidth={1.6} aria-hidden className="ml-3 shrink-0 text-[#637889]" />
      <input ref={ref} {...props} disabled={disabled} className={cn('relative z-10 h-full w-full min-w-0 rounded-[9px] bg-transparent pl-2 pr-3 text-[16px] font-medium text-[#27272c] outline-none placeholder:text-[13px] placeholder:font-normal placeholder:text-[#626e78] disabled:opacity-60 sm:text-[14px]', className)} />
      <span aria-hidden className="input-focus-line pointer-events-none absolute inset-x-3 bottom-0 h-px" />
    </div>
  )
}
