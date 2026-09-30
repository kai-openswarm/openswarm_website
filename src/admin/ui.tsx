import { useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronUp, Download, Inbox, Info, RotateCw, X } from 'lucide-react'
import { clsx } from 'clsx'
import type { QueryState } from './hooks'
import { errorMessage } from './errors'
import { fmtPct } from './format'
import { csvFilename, downloadText, toCsv } from './csv'

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...rest}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-btn text-btn-ink hover:bg-btn-hover',
        variant === 'secondary' && 'border border-line-strong bg-panel text-ink hover:bg-hover',
        variant === 'ghost' && 'text-ink-2 hover:bg-hover hover:text-ink',
        variant === 'danger' && 'bg-poor text-white hover:opacity-90',
        className,
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// Panels and states
// ---------------------------------------------------------------------------

/**
 * An (i) button with a definition, shown on hover and keyboard focus (R10).
 * It positions itself `relative`; to place it absolutely, wrap it in a positioned element.
 */
export function InfoTip({ text, label = 'Definition', className }: { text: string; label?: string; className?: string }) {
  const id = useId()
  // Opens toward the side with more room, so it never widens the page.
  const [side, setSide] = useState<'left' | 'right'>('left')
  const place = (el: HTMLElement) => setSide(el.getBoundingClientRect().left > window.innerWidth / 2 ? 'right' : 'left')
  return (
    <span className={clsx('group/tip relative inline-flex align-middle', className)} onPointerEnter={(e) => place(e.currentTarget)} onFocus={(e) => place(e.currentTarget)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="inline-flex size-4 items-center justify-center rounded-full text-ink-3 hover:text-ink focus-visible:text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      <span
        role="tooltip"
        id={id}
        className={clsx(
          'pointer-events-none absolute top-full z-40 mt-1 hidden w-64 max-w-[calc(100vw-32px)] rounded-md border border-line-strong bg-panel px-2.5 py-2 text-left text-[12px] leading-snug font-normal tracking-normal text-ink-2 normal-case shadow-lg group-focus-within/tip:block group-hover/tip:block',
          side === 'right' ? '-right-1' : '-left-1',
        )}
      >
        {text}
      </span>
    </span>
  )
}

export function Panel({ title, subtitle, actions, children, className, bodyClassName, id, info }: {
  info?: string
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  id?: string
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={title ? headingId : undefined} id={id} className={clsx('min-w-0 rounded-lg border border-line bg-panel', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-3.5">
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className="flex items-center gap-1 text-[13.5px] font-semibold text-ink">
                {title}
                {info && <InfoTip text={info} />}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-[12.5px] text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx('px-4 pt-3 pb-4', bodyClassName)}>{children}</div>
    </section>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('skeleton', className)} />
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-5" />
      ))}
    </div>
  )
}

export function EmptyState({ text = 'No data for this range yet', hint }: { text?: string; hint?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
      <Inbox className="size-5 text-ink-3" aria-hidden />
      <p className="text-[13px] text-ink-2">{text}</p>
      {hint && <p className="max-w-sm text-[12px] text-ink-3">{hint}</p>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <AlertTriangle className="size-5 text-poor" aria-hidden />
      <p className="max-w-md text-[13px] text-ink-2">Couldn’t load this panel. {errorMessage(error)}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          <RotateCw className="size-3.5" aria-hidden /> Retry
        </Button>
      )}
    </div>
  )
}

/** Renders loading / error / empty / data states for one query. */
export function QueryView<T>({ q, isEmpty, skeleton, empty, children }: {
  q: QueryState<T>
  isEmpty?: (data: T) => boolean
  skeleton?: ReactNode
  empty?: ReactNode
  children: (data: T) => ReactNode
}) {
  if (q.error && q.data === undefined) return <ErrorState error={q.error} onRetry={q.reload} />
  if (q.data === undefined) return <>{skeleton ?? <SkeletonRows />}</>
  if (isEmpty?.(q.data)) return <>{empty ?? <EmptyState />}</>
  return (
    <div className={clsx('transition-opacity', q.loading && 'opacity-60')} aria-busy={q.loading}>
      {q.error && (
        <div role="alert" className="mb-2 flex items-center justify-between gap-2 rounded-md bg-hover px-2.5 py-1.5 text-[12px] text-ink-2">
          <span>Refresh failed: {errorMessage(q.error)}</span>
          <Button size="sm" variant="ghost" onClick={q.reload}>Retry</Button>
        </div>
      )}
      {children(q.data)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function Tabs<K extends string>({ tabs, value, onChange, label, className }: {
  tabs: readonly { key: K; label: string }[]
  value: K
  onChange: (k: K) => void
  label: string
  className?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next < 0) return
    e.preventDefault()
    onChange(tabs[next].key)
    refs.current[next]?.focus()
  }
  return (
    <div role="tablist" aria-label={label} className={clsx('no-scrollbar -mx-1 flex max-w-full gap-0.5 overflow-x-auto px-1 py-0.5 md:flex-wrap md:overflow-visible', className)}>
      {tabs.map((t, i) => (
        <button
          key={t.key}
          ref={(el) => { refs.current[i] = el }}
          role="tab"
          type="button"
          aria-selected={t.key === value}
          tabIndex={t.key === value ? 0 : -1}
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => onKey(e, i)}
          className={clsx(
            'h-7 shrink-0 rounded-md px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors',
            t.key === value ? 'bg-btn text-btn-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/** Relative change badge. lowerIsBetter flips the color, not the arrow. */
export function Delta({ current, previous, lowerIsBetter = false, points = false }: { current: number; previous: number; lowerIsBetter?: boolean; points?: boolean }) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  let text: string
  let diff: number
  if (points) {
    diff = current - previous
    text = `${Math.abs(diff * 100).toFixed(1)} pts`
  } else {
    if (previous === 0) {
      return <span className="text-[12px] text-ink-3">{current === 0 ? 'No change' : 'New'}</span>
    }
    diff = (current - previous) / previous
    text = fmtPct(Math.abs(diff))
  }
  if (Math.abs(diff) < 0.0005) return <span className="text-[12px] text-ink-3 num">0.0%</span>
  const up = diff > 0
  const good = lowerIsBetter ? !up : up
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span className={clsx('inline-flex items-center gap-0.5 text-[12px] font-medium num', good ? 'text-up' : 'text-down')}>
      <Icon className="size-3" aria-hidden />
      <span className="sr-only">{up ? 'Up' : 'Down'} </span>
      {text}
    </span>
  )
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'poor'; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded px-1.5 py-px text-[11.5px] font-medium whitespace-nowrap',
        tone === 'neutral' && 'bg-hover text-ink-2',
        tone === 'accent' && 'bg-accent-soft text-accent',
        tone === 'good' && 'bg-[color-mix(in_srgb,var(--good)_15%,transparent)] text-up',
        tone === 'warn' && 'bg-[color-mix(in_srgb,var(--warn)_20%,transparent)] text-ink',
        tone === 'poor' && 'bg-[color-mix(in_srgb,var(--poor)_15%,transparent)] text-down',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** A thin proportional bar behind or below a figure. */
export function Meter({ value, max, className, color = 'var(--accent)' }: { value: number; max: number; className?: string; color?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-hover', className)} aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// CSV (R68): every table and panel can download what it shows
// ---------------------------------------------------------------------------

export function CsvButton({ name, getRows, label = 'CSV' }: {
  name: string
  /** Header + rows, or a promise of them (e.g. to fetch the full list first). */
  getRows: () => { header: string[]; rows: unknown[][] } | Promise<{ header: string[]; rows: unknown[][] }>
  label?: string
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        aria-label={`Download ${name} as CSV`}
        title={err ?? `Download ${name} as CSV`}
        onClick={async () => {
          setBusy(true)
          setErr(null)
          try {
            const { header, rows } = await getRows()
            const objs = rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
            downloadText(csvFilename(name), toCsv(objs, header))
          } catch (e) {
            setErr(errorMessage(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <Download className="size-3.5" aria-hidden /> {label}
      </Button>
      {err && <span role="alert" className="text-[12px] text-down">{err}</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Ranked list (top-N with bars; rows optionally add a filter)
// ---------------------------------------------------------------------------

export interface ListItem {
  key: string
  label: ReactNode
  value: number
  display?: ReactNode
  /** Plain-text label (tooltips and CSV). */
  title?: string
}

export function RankedList({ items, onSelect, valueLabel, limit, selectHint = 'Filter by', csv }: {
  items: ListItem[]
  onSelect?: (key: string) => void
  valueLabel: string
  limit?: number
  selectHint?: string
  /** Adds a CSV button for the full list; nameHeader is the first column's name. */
  csv?: { name: string; nameHeader: string }
}) {
  const shown = limit ? items.slice(0, limit) : items
  const max = Math.max(...shown.map((i) => i.value), 0)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">
        <span className="sr-only">Name</span>
        {csv ? (
          <span className="-ml-2.5 normal-case">
            <CsvButton name={csv.name} getRows={() => ({ header: [csv.nameHeader, valueLabel], rows: items.map((i) => [i.title ?? i.key, i.value]) })} />
          </span>
        ) : <span aria-hidden />}
        <span>{valueLabel}</span>
      </div>
      <ul className="space-y-0.5">
        {shown.map((it) => {
          const inner = (
            <>
              <span className="absolute inset-y-0.5 left-0 rounded bg-accent-soft" style={{ width: `${max ? (it.value / max) * 100 : 0}%` }} aria-hidden />
              <span className="relative min-w-0 truncate" title={it.title}>{it.label}</span>
              <span className="relative shrink-0 text-ink-2 num">{it.display ?? it.value}</span>
            </>
          )
          return (
            <li key={it.key}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(it.key)}
                  title={`${selectHint} ${it.title ?? it.key}`}
                  className="relative flex h-7 w-full items-center justify-between gap-3 rounded px-2 text-left text-[13px] hover:bg-hover"
                >
                  {inner}
                </button>
              ) : (
                <div className="relative flex h-7 items-center justify-between gap-3 px-2 text-[13px]">{inner}</div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sortable table
// ---------------------------------------------------------------------------

export interface Column<T> {
  key: string
  label: string
  align?: 'left' | 'right'
  render: (row: T) => ReactNode
  sort?: (row: T) => number | string
  className?: string
  /** Hidden from the header visually (still read by screen readers). */
  srOnly?: boolean
  /** Definition tooltip next to the header. */
  info?: string
  /** CSV value; defaults to the sort value. Columns with neither are left out of the CSV. */
  csv?: (row: T) => unknown
}

export function DataTable<T>({ columns, rows, rowKey, defaultSort, onRowClick, rowLabel, caption, dense, csvName }: {
  /** Shows a CSV button that downloads the rows in their current order. */
  csvName?: string
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  defaultSort?: { key: string; dir: 'asc' | 'desc' }
  onRowClick?: (row: T) => void
  rowLabel?: (row: T) => string
  caption?: string
  dense?: boolean
}) {
  const [sort, setSort] = useState(defaultSort)
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key)
    if (!sort || !col?.sort) return rows
    const get = col.sort
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir
    })
  }, [rows, columns, sort])

  const csvCols = columns.filter((c) => c.csv || c.sort)
  const table = (
    <div className="relative -mx-4 overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-line text-[11.5px] tracking-wide text-ink-3 uppercase">
            {columns.map((c, i) => {
              const active = sort?.key === c.key
              const aria = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={aria}
                  className={clsx('h-8 font-medium whitespace-nowrap', c.align === 'right' ? 'text-right' : 'text-left', i === 0 ? 'pl-4 pr-3' : i === columns.length - 1 ? 'pl-3 pr-4' : 'px-3')}
                >
                  <span className={clsx('inline-flex items-center gap-1', c.align === 'right' && 'flex-row-reverse')}>
                    {c.sort ? (
                      <button
                        type="button"
                        className={clsx('inline-flex items-center gap-0.5 uppercase hover:text-ink', active && 'text-ink')}
                        onClick={() => setSort({ key: c.key, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
                      >
                        {c.label}
                        {active ? (sort.dir === 'desc' ? <ChevronDown className="size-3" aria-hidden /> : <ChevronUp className="size-3" aria-hidden />) : null}
                      </button>
                    ) : c.srOnly ? <span className="sr-only">{c.label}</span> : c.label}
                    {c.info && <InfoTip text={c.info} label={`${c.label} definition`} />}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={rowKey(r)}
              className={clsx('border-b border-line last:border-0', onRowClick && 'cursor-pointer hover:bg-hover')}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
            >
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={clsx(
                    dense ? 'h-8' : 'h-9',
                    'whitespace-nowrap',
                    c.align === 'right' ? 'text-right num' : 'text-left',
                    i === 0 ? 'pl-4 pr-3' : i === columns.length - 1 ? 'pl-3 pr-4' : 'px-3',
                    c.className,
                  )}
                >
                  {i === 0 && onRowClick ? (
                    <button
                      type="button"
                      className="max-w-full text-left hover:underline"
                      aria-label={rowLabel ? rowLabel(r) : undefined}
                      onClick={(e) => { e.stopPropagation(); onRowClick(r) }}
                    >
                      {c.render(r)}
                    </button>
                  ) : c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  if (!csvName) return table
  return (
    <>
      <div className="-mt-1 mb-1 flex justify-end">
        <CsvButton
          name={csvName}
          getRows={() => ({ header: csvCols.map((c) => c.label), rows: sorted.map((r) => csvCols.map((c) => (c.csv ?? c.sort)!(r))) })}
        />
      </div>
      {table}
    </>
  )
}

// ---------------------------------------------------------------------------
// Dialog (native <dialog>: focus trapping, Escape and inert background for free)
// ---------------------------------------------------------------------------

export function Dialog({ open, onClose, title, children, footer, size = 'md' }: {
  size?: 'md' | 'lg'
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose() }}
      className={clsx('m-auto max-h-[calc(100svh-32px)] rounded-lg border border-line-strong bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/40', size === 'lg' ? 'w-[min(960px,calc(100vw-32px))]' : 'w-[min(440px,calc(100vw-32px))]')}
    >
      {open && (
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="text-[15px] font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="-mt-1 -mr-1 rounded p-1 text-ink-3 hover:bg-hover hover:text-ink" aria-label="Close">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="mt-2 text-[13px] text-ink-2">{children}</div>
          {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

export function Switch({ checked, onChange, disabled, labelledBy, label }: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  labelledBy?: string
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60', checked ? 'bg-accent' : 'bg-line-strong')}
    >
      <span className={clsx('absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
    </button>
  )
}

export function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: ReactNode }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-medium text-ink-2">{label}</label>
      {children(id)}
      {hint && <p className="text-[12px] text-ink-3">{hint}</p>}
    </div>
  )
}

export const inputClass =
  'h-8 min-w-0 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] text-ink placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-0'
