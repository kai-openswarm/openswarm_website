import { useState, type FormEvent } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useApi, useQuery } from './hooks'
import { errorMessage } from './errors'
import { toDateInput } from './nav'
import { ANNOTATION_COLOR_VARS } from './chartUtil'
import { fmtDate } from './format'
import type { AnnotationColor } from './types'
import { ANNOTATION_COLORS } from './types'
import { Button, CsvButton, EmptyState, QueryView, SkeletonRows, inputClass } from './ui'

/** Every annotation ever made (the RPC takes a range; this one covers everything). */
const ALL_RANGE = { from: '2000-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z' }

export function AnnotationForm({ onSaved, onCancel, initialDate }: { onSaved: () => void; onCancel?: () => void; initialDate?: string }) {
  const api = useApi()
  const [start, setStart] = useState(initialDate ?? toDateInput(new Date()))
  const [end, setEnd] = useState('')
  const [title, setTitle] = useState('')
  const [color, setColor] = useState<AnnotationColor>('blue')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const trimmed = title.trim()
  const valid = !!start && trimmed.length >= 1 && trimmed.length <= 60 && (!end || end >= start)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) {
      setErr(!trimmed ? 'Add a title.' : end && end < start ? 'The end date must be on or after the start date.' : 'Check the fields.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await api.addAnnotation({ starts_on: start, ends_on: end || null, title: trimmed, color })
      setTitle('')
      setEnd('')
      onSaved()
    } catch (e2) {
      setErr(errorMessage(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-ink-2">
          Date
          <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-ink-2">
          End date <span className="sr-only">(optional)</span>
          <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className={inputClass} aria-describedby="ann-end-hint" />
        </label>
      </div>
      <p id="ann-end-hint" className="-mt-2 text-[12px] text-ink-3">Leave the end date empty for a single day.</p>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
        Title
        <input
          value={title}
          maxLength={60}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Product Hunt launch"
          className={inputClass}
          data-autofocus
        />
        <span className="text-right text-[11.5px] font-normal text-ink-3 num">{trimmed.length}/60</span>
      </label>
      <fieldset>
        <legend className="mb-1 text-[12px] font-medium text-ink-2">Color</legend>
        <div className="flex gap-2">
          {ANNOTATION_COLORS.map((c) => (
            <label key={c} className="relative cursor-pointer" title={c}>
              <input type="radio" name="ann-color" value={c} checked={color === c} onChange={() => setColor(c)} className="peer sr-only" />
              <span
                className={clsx('block size-6 rounded-full ring-offset-2 ring-offset-[var(--panel)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--focus)]', color === c && 'ring-2 ring-ink')}
                style={{ background: ANNOTATION_COLOR_VARS[c] }}
              />
              <span className="sr-only">{c}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {err && <p role="alert" className="text-[12.5px] text-down">{err}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <Button onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Add annotation
        </Button>
      </div>
    </form>
  )
}

/** Settings section: list, add and delete annotations (R60). */
export function AnnotationsManager() {
  const api = useApi()
  const q = useQuery('annotations|all', () => api.annotations(ALL_RANGE))
  const [deleting, setDeleting] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function remove(id: number) {
    setDeleting(id)
    setErr(null)
    try {
      await api.deleteAnnotation(id)
      q.reload()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <QueryView q={q} isEmpty={(d) => d.length === 0} skeleton={<SkeletonRows rows={3} />} empty={<EmptyState text="No annotations yet" hint="Mark launches, posts and deploys so spikes explain themselves." />}>
          {(rows) => (
            <>
              <div className="mb-1 flex justify-end">
                <CsvButton name="annotations" getRows={() => ({ header: ['Start', 'End', 'Title', 'Color', 'Created by', 'Created at'], rows: rows.map((a) => [a.starts_on, a.ends_on, a.title, a.color, a.created_by, a.created_at]) })} />
              </div>
              <ul className="-mx-4 divide-y divide-line border-y border-line">
                {[...rows].reverse().map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                    <span className="flex min-w-0 items-start gap-2">
                      <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: ANNOTATION_COLOR_VARS[a.color] }} aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{a.title}</span>
                        <span className="block truncate text-[12px] text-ink-3">
                          {fmtDate(`${a.starts_on}T12:00:00`)}{a.ends_on && a.ends_on !== a.starts_on ? ` – ${fmtDate(`${a.ends_on}T12:00:00`)}` : ''} · {a.created_by}
                        </span>
                      </span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => remove(a.id)} disabled={deleting === a.id} aria-label={`Delete annotation ${a.title}`}>
                      {deleting === a.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Trash2 className="size-3.5" aria-hidden />}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </QueryView>
        {err && <p role="alert" className="mt-2 text-[12.5px] text-down">{err}</p>}
      </div>
      <div className="min-w-0">
        <h3 className="mb-2 text-[12.5px] font-semibold">Add an annotation</h3>
        <AnnotationForm onSaved={q.reload} />
      </div>
    </div>
  )
}
