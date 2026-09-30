import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Calendar, Check, ChevronDown, Plus, RotateCw, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useQuery, useView } from './hooks'
import { COMPARE_MODES, PRESETS, fromDateInput, toDateInput, type CompareMode, type PresetId } from './nav'
import { DIMENSION_LABELS, dimValue, fmtAgo } from './format'
import { MAX_VALUES, OP_LABELS, describeValues, flipOp, toWire } from './filters'
import type { Dimension, FilterOp } from './types'
import { DIMENSIONS, FILTER_OPS } from './types'
import { bumpRefresh, useLastLoaded } from './refresh'
import { Button, inputClass } from './ui'

/** Click-outside + Escape handling for a small popover anchored in `root`. */
function usePopover() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Handled here: the global "Esc clears filters" shortcut must not also fire.
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        root.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  return { open, setOpen, root }
}

function Popover({ id, label, children, className }: { id: string; label: string; children: ReactNode; className?: string }) {
  return (
    <div id={id} role="dialog" aria-label={label} className={clsx('absolute top-9 left-0 z-30 rounded-lg border border-line-strong bg-panel p-1.5 shadow-xl', className)}>
      {children}
    </div>
  )
}

export function DateRangePicker() {
  const { range, update } = useView()
  const { open, setOpen, root } = usePopover()
  const [from, setFrom] = useState(toDateInput(range.from))
  const [to, setTo] = useState(toDateInput(new Date(range.to.getTime() - 86_400_000)))
  const popId = useId()
  const fromId = useId()
  const toId = useId()

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
      {open && (
        <Popover id={popId} label="Date range" className="w-[min(300px,calc(100vw-32px))]">
          <ul className="grid grid-cols-1 gap-px">
            {PRESETS.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => choose(p.id)}
                  aria-current={range.preset === p.id ? 'true' : undefined}
                  className={clsx('flex h-7.5 w-full items-center justify-between rounded-md px-2.5 text-left text-[13px] hover:bg-hover', range.preset === p.id && 'font-semibold')}
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
        </Popover>
      )}
    </div>
  )
}

export function CompareSelect() {
  const { range, update } = useView()
  const id = useId()
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-[12px] text-ink-3">Compare</label>
      <select
        id={id}
        value={range.compare}
        onChange={(e) => update((p) => {
          const v = e.target.value as CompareMode
          if (v === 'prev') p.delete('cmp')
          else p.set('cmp', v)
        })}
        className={`${inputClass} h-8 pr-7`}
        title={range.compareLabel ? `Comparing with ${range.compareLabel}` : undefined}
      >
        {COMPARE_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
    </div>
  )
}

/** Manual refresh with "updated Xs ago" (R7). */
export function RefreshButton() {
  const last = useLastLoaded()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(t)
  }, [])
  const secs = last ? Math.max(0, Math.round((now - last) / 1000)) : null
  const ago = secs === null ? '' : secs < 5 ? 'just now' : secs < 60 ? `${secs}s ago` : fmtAgo(new Date(last).toISOString(), now)
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
      <Button size="sm" variant="ghost" onClick={() => { bumpRefresh(); setNow(Date.now()) }} aria-label="Refresh data">
        <RotateCw className="size-3.5" aria-hidden /> <span className="hidden sm:inline">Refresh</span>
      </Button>
      {ago && <span aria-live="polite" className="whitespace-nowrap">Updated {ago}</span>}
    </div>
  )
}

const BOOL_DIMS: Partial<Record<Dimension, true>> = { is_new_visitor: true, has_invite: true }

/** "Add filter" popover (R4): dimension, operator, one or more OR'd values. */
function AddFilter() {
  const { clauses, setClause, range } = useView()
  const { open, setOpen, root } = usePopover()
  const popId = useId()
  const listId = useId()
  const [dim, setDim] = useState<Dimension>('channel')
  const [op, setOp] = useState<FilterOp>('is')
  const [values, setValues] = useState<string[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const others = toWire(Object.fromEntries(Object.entries(clauses).filter(([d]) => d !== dim)))
  const suggest = useQuery(
    `suggest|${dim}|${range.fromIso}|${range.toIso}|${JSON.stringify(others)}`,
    (a) => a.breakdown({ from: range.fromIso, to: range.toIso, filters: others }, dim, 100),
    { enabled: open && !BOOL_DIMS[dim] },
  )

  const load = (d: Dimension) => {
    setDim(d)
    const c = clauses[d]
    setOp(c?.op ?? 'is')
    setValues(c?.values ?? [])
    setText('')
    setErr(null)
  }

  const addText = () => {
    const parts = text.split(',').map((x) => x.trim()).filter(Boolean)
    if (!parts.length) return values
    const next = [...new Set([...values, ...parts])]
    setValues(next)
    setText('')
    return next
  }

  const apply = () => {
    const all = addText()
    if (!all.length) {
      setErr('Add at least one value.')
      return
    }
    if (all.length > MAX_VALUES) {
      setErr(`Up to ${MAX_VALUES} values.`)
      return
    }
    if (all.some((v) => v.length > 200)) {
      setErr('Values can be up to 200 characters.')
      return
    }
    setClause(dim, { op, values: all })
    setOpen(false)
  }

  const bool = !!BOOL_DIMS[dim]
  const ops = bool ? (['is'] as FilterOp[]) : FILTER_OPS
  return (
    <div ref={root} className="relative">
      <Button
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => {
          if (!open) load(dim)
          setOpen(!open)
        }}
      >
        <Plus className="size-3.5" aria-hidden /> Filter
      </Button>
      {open && (
        <Popover id={popId} label="Add filter" className="w-[min(340px,calc(100vw-32px))] p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              apply()
            }}
            className="flex flex-col gap-2.5"
          >
            <div className="grid grid-cols-2 gap-2">
              <label className="flex min-w-0 flex-col gap-1 text-[11.5px] text-ink-3">
                Dimension
                <select value={dim} onChange={(e) => load(e.target.value as Dimension)} className={`${inputClass} pr-7`}>
                  {DIMENSIONS.map((d) => <option key={d} value={d}>{DIMENSION_LABELS[d]}</option>)}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-[11.5px] text-ink-3">
                Operator
                <select value={op} onChange={(e) => setOp(e.target.value as FilterOp)} className={`${inputClass} pr-7`}>
                  {ops.map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
                </select>
              </label>
            </div>
            {bool ? (
              <fieldset className="flex gap-4 text-[13px]">
                <legend className="mb-1 text-[11.5px] text-ink-3">Value</legend>
                {['true', 'false'].map((v) => (
                  <label key={v} className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={values.includes(v)}
                      onChange={(e) => setValues(e.target.checked ? [...values, v] : values.filter((x) => x !== v))}
                    />
                    {dimValue(dim, v)}
                  </label>
                ))}
              </fieldset>
            ) : (
              <div className="flex flex-col gap-1">
                <label htmlFor={`${popId}-v`} className="text-[11.5px] text-ink-3">
                  Values <span className="text-ink-3">(Enter or comma adds; any value matches)</span>
                </label>
                {values.length > 0 && (
                  <ul className="flex flex-wrap gap-1">
                    {values.map((v) => (
                      <li key={v} className="inline-flex max-w-full items-center gap-0.5 rounded bg-hover py-0.5 pr-0.5 pl-1.5 text-[12px]">
                        <span className="truncate">{op === 'is' || op === 'is_not' ? dimValue(dim, v) : v}</span>
                        <button type="button" className="rounded p-0.5 text-ink-3 hover:text-ink" aria-label={`Remove ${v}`} onClick={() => setValues(values.filter((x) => x !== v))}>
                          <X className="size-3" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <input
                  id={`${popId}-v`}
                  list={listId}
                  value={text}
                  autoFocus
                  autoComplete="off"
                  onChange={(e) => {
                    setText(e.target.value)
                    setErr(null)
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' && text.trim()) || e.key === ',') {
                      e.preventDefault()
                      addText()
                    }
                  }}
                  placeholder={op === 'contains' || op === 'not_contains' ? 'Text to match…' : 'Type or pick a value…'}
                  className={inputClass}
                />
                <datalist id={listId}>
                  {(suggest.data ?? []).map((r) => <option key={r.value} value={r.value}>{dimValue(dim, r.value)}</option>)}
                </datalist>
              </div>
            )}
            {err && <p role="alert" className="text-[12px] text-down">{err}</p>}
            <div className="flex justify-end gap-2">
              {clauses[dim] && (
                <Button size="sm" variant="ghost" onClick={() => { setClause(dim, null); setOpen(false) }}>Remove</Button>
              )}
              <Button size="sm" type="submit" variant="primary">Apply</Button>
            </div>
          </form>
        </Popover>
      )}
    </div>
  )
}

export function FilterChips() {
  const { clauses, removeFilter, clearFilters, toggleOp } = useView()
  const entries = Object.entries(clauses) as [Dimension, NonNullable<(typeof clauses)[Dimension]>][]
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Active filters">
      {entries.map(([dim, c]) => {
        const negative = c.op === 'is_not' || c.op === 'not_contains'
        return (
          <span
            key={dim}
            className={clsx(
              'inline-flex h-7 max-w-full items-center rounded-md border pr-0.5 text-[12.5px]',
              negative ? 'border-down/40 bg-[color-mix(in_srgb,var(--down)_10%,transparent)]' : 'border-accent/30 bg-accent-soft',
            )}
          >
            <button
              type="button"
              onClick={() => toggleOp(dim)}
              className="inline-flex h-full min-w-0 items-center gap-1 rounded-l-md pl-2 hover:underline"
              title={`Click to switch to “${OP_LABELS[flipOp(c.op)]}”`}
              aria-label={`${DIMENSION_LABELS[dim]} ${OP_LABELS[c.op]} ${describeValues(dim, c)}. Switch to ${OP_LABELS[flipOp(c.op)]}`}
            >
              <span className="text-ink-2">{DIMENSION_LABELS[dim]}</span>
              <span className={clsx('font-medium', negative ? 'text-down' : 'text-ink-2')}>{OP_LABELS[c.op]}</span>
              <span className="max-w-[220px] truncate font-medium">{describeValues(dim, c)}</span>
            </button>
            <button
              type="button"
              onClick={() => removeFilter(dim)}
              className="ml-0.5 rounded p-1 text-ink-2 hover:bg-hover hover:text-ink"
              aria-label={`Remove filter ${DIMENSION_LABELS[dim]}`}
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        )
      })}
      <AddFilter />
      {entries.length > 0 ? (
        <Button size="sm" variant="ghost" onClick={clearFilters} title="Esc also clears filters">Clear</Button>
      ) : (
        <span className="text-[12px] text-ink-3">or click any row to filter</span>
      )}
    </div>
  )
}
