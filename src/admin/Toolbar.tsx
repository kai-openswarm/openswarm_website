import { useEffect, useId, useRef, useState } from 'react'
import { Calendar, Check, ChevronDown, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useView } from './hooks'
import { PRESETS, fromDateInput, toDateInput, type PresetId } from './nav'
import { DIMENSION_LABELS, dimValue } from './format'
import type { Dimension } from './types'
import { Button, inputClass } from './ui'

export function DateRangePicker() {
  const { range, update } = useView()
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(toDateInput(range.from))
  const [to, setTo] = useState(toDateInput(new Date(range.to.getTime() - 86_400_000)))
  const root = useRef<HTMLDivElement>(null)
  const popId = useId()
  const fromId = useId()
  const toId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        root.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (id: PresetId) => {
    update((p) => {
      p.set('range', id)
      p.delete('from')
      p.delete('to')
    })
    setOpen(false)
  }

  const f = fromDateInput(from)
  const t = fromDateInput(to)
  const customValid = !!f && !!t && f <= t

  const applyCustom = () => {
    if (!customValid) return
    update((p) => {
      p.set('range', 'custom')
      p.set('from', from)
      p.set('to', to)
    })
    setOpen(false)
  }

  const sameDay = +range.from === +new Date(range.to.getTime() - 86_400_000)
  const detail = range.preset === 'custom' ? null : sameDay ? toDateInput(range.from) : `${toDateInput(range.from)} → ${toDateInput(new Date(range.to.getTime() - 86_400_000))}`

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => {
          if (!open) {
            setFrom(toDateInput(range.from))
            setTo(toDateInput(new Date(range.to.getTime() - 86_400_000)))
          }
          setOpen(!open)
        }}
        className="inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] font-medium hover:bg-hover"
      >
        <Calendar className="size-3.5 shrink-0 text-ink-3" aria-hidden />
        <span className="truncate">{range.label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-ink-3" aria-hidden />
      </button>
      {detail && <span className="ml-2 hidden text-[12px] text-ink-3 num md:inline">{detail}</span>}
      {open && (
        <div id={popId} role="dialog" aria-label="Date range" className="absolute top-9 left-0 z-30 w-[min(300px,calc(100vw-32px))] rounded-lg border border-line-strong bg-panel p-1.5 shadow-xl">
          <ul className="space-y-px">
            {PRESETS.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => choose(p.id)}
                  aria-current={range.preset === p.id ? 'true' : undefined}
                  className={clsx('flex h-8 w-full items-center justify-between rounded-md px-2.5 text-left text-[13px] hover:bg-hover', range.preset === p.id && 'font-semibold')}
                >
                  {p.label}
                  {range.preset === p.id && <Check className="size-4" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-1.5 border-t border-line px-1 pt-2.5 pb-1"
            onSubmit={(e) => {
              e.preventDefault()
              applyCustom()
            }}
          >
            <p className={clsx('mb-2 px-1 text-[12px] font-medium text-ink-2', range.preset === 'custom' && 'text-ink')}>Custom range</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={fromId} className="text-[11.5px] text-ink-3">From</label>
                <input id={fromId} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={toId} className="text-[11.5px] text-ink-3">To</label>
                <input id={toId} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputClass} />
              </div>
            </div>
            <Button type="submit" variant="primary" className="mt-2.5 w-full" disabled={!customValid}>Apply</Button>
          </form>
        </div>
      )}
    </div>
  )
}

export function FilterChips() {
  const { filters, removeFilter, clearFilters } = useView()
  const entries = Object.entries(filters) as [Dimension, string][]
  if (entries.length === 0) {
    return <p className="text-[12px] text-ink-3">Click any row in a breakdown to filter.</p>
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Active filters">
      {entries.map(([dim, value]) => (
        <span key={dim} className="inline-flex h-7 max-w-full items-center gap-1 rounded-md border border-accent/30 bg-accent-soft pr-0.5 pl-2 text-[12.5px]">
          <span className="text-ink-2">{DIMENSION_LABELS[dim]}:</span>
          <span className="truncate font-medium">{dimValue(dim, value)}</span>
          <button
            type="button"
            onClick={() => removeFilter(dim)}
            className="ml-0.5 rounded p-1 text-ink-2 hover:bg-hover hover:text-ink"
            aria-label={`Remove filter ${DIMENSION_LABELS[dim]}: ${dimValue(dim, value)}`}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      {entries.length > 1 && (
        <Button size="sm" variant="ghost" onClick={clearFilters}>Clear all</Button>
      )}
    </div>
  )
}
