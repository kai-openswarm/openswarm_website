// Filter clauses: URL encoding, wire format for p_filters, labels and matching.
//
// URL: one key prefix per operator, repeated keys OR'd within a dimension.
//   f.country=US&f.country=CA   country is US or CA
//   fx.channel=Direct           channel is not Direct
//   fc.source=goo               source contains "goo"
//   fxc.utm_campaign=test       utm_campaign does not contain "test"
import type { Dimension, FilterClause, FilterOp, Filters } from './types'
import { DIMENSIONS, NONE } from './types'
import { DIMENSION_LABELS, dimValue } from './format'

export type Clauses = Partial<Record<Dimension, FilterClause>>

const PREFIX: Record<FilterOp, string> = { is: 'f.', is_not: 'fx.', contains: 'fc.', not_contains: 'fxc.' }
const BY_PREFIX: [string, FilterOp][] = [['fxc.', 'not_contains'], ['fx.', 'is_not'], ['fc.', 'contains'], ['f.', 'is']]

export const OP_LABELS: Record<FilterOp, string> = {
  is: 'is', is_not: 'is not', contains: 'contains', not_contains: 'does not contain',
}

export const MAX_VALUES = 50

const isDim = (d: string): d is Dimension => (DIMENSIONS as readonly string[]).includes(d)

export function isFilterKey(k: string) {
  return BY_PREFIX.some(([p]) => k.startsWith(p))
}

export function readClauses(params: URLSearchParams): Clauses {
  const out: Clauses = {}
  for (const [k, v] of params) {
    const hit = BY_PREFIX.find(([p]) => k.startsWith(p))
    if (!hit) continue
    const dim = k.slice(hit[0].length)
    if (!isDim(dim) || v.length > 200) continue
    const cur = out[dim]
    // One operator per dimension; the first one in the URL wins.
    if (cur && cur.op !== hit[1]) continue
    if (cur) {
      if (!cur.values.includes(v) && cur.values.length < MAX_VALUES) cur.values.push(v)
    } else out[dim] = { op: hit[1], values: [v] }
  }
  return out
}

export function clearClause(p: URLSearchParams, dim: Dimension) {
  for (const prefix of Object.values(PREFIX)) p.delete(`${prefix}${dim}`)
}

export function writeClause(p: URLSearchParams, dim: Dimension, clause: FilterClause | null) {
  clearClause(p, dim)
  if (!clause) return
  for (const v of clause.values.slice(0, MAX_VALUES)) p.append(`${PREFIX[clause.op]}${dim}`, v)
}

export function clearAllClauses(p: URLSearchParams) {
  for (const k of [...p.keys()]) if (isFilterKey(k)) p.delete(k)
}

/** p_filters: a plain string for a single "is" value, otherwise {op, values}. */
export function toWire(clauses: Clauses): Filters {
  const out: Filters = {}
  for (const [dim, c] of Object.entries(clauses) as [Dimension, FilterClause][]) {
    if (!c.values.length) continue
    out[dim] = c.op === 'is' && c.values.length === 1 ? c.values[0] : { op: c.op, values: [...c.values] }
  }
  return out
}

export function fromWire(filters: Filters): Clauses {
  const out: Clauses = {}
  for (const [dim, v] of Object.entries(filters) as [Dimension, string | FilterClause][]) {
    out[dim] = typeof v === 'string' ? { op: 'is', values: [v] } : { op: v.op, values: [...v.values] }
  }
  return out
}

export function flipOp(op: FilterOp): FilterOp {
  return op === 'is' ? 'is_not' : op === 'is_not' ? 'is' : op === 'contains' ? 'not_contains' : 'contains'
}

export function describeValues(dim: Dimension, c: FilterClause): string {
  const vals = c.op === 'contains' || c.op === 'not_contains' ? c.values.map((v) => `“${v}”`) : c.values.map((v) => dimValue(dim, v))
  return vals.join(c.op === 'is_not' || c.op === 'not_contains' ? ' nor ' : ' or ')
}

export function describeClause(dim: Dimension, c: FilterClause): string {
  return `${DIMENSION_LABELS[dim]} ${OP_LABELS[c.op]} ${describeValues(dim, c)}`
}

/** Same semantics as analytics.filtered_sessions (used by mock mode). */
export function matchesClause(value: string | null | undefined, c: FilterClause): boolean {
  const v = value ?? NONE
  switch (c.op) {
    case 'is': return c.values.includes(v)
    case 'is_not': return !c.values.includes(v)
    case 'contains': return c.values.some((x) => v.toLowerCase().includes(x.toLowerCase()))
    case 'not_contains': return !c.values.some((x) => v.toLowerCase().includes(x.toLowerCase()))
  }
}
