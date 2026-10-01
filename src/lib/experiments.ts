/*
  First-party A/B tests. A visitor's variant comes from, in order:
    1. the link they arrived on: ?h=<variant> picks the hero variant, so each ad can land on
       the headline it promises (message match). The choice sticks for that visitor.
    2. a random split, only while the experiment's `split` is on;
    3. the control.
  The variant shown is recorded once per session as an `experiment` event and saved with
  any signup, so the dashboard's Experiments page can compare signup rates.
*/
import { analyticsIds, track } from './analytics'

export type HeroVariant = { headline: string, sub?: string }

type Experiment<V> = {
  /** Query parameter that forces a variant, for ad links. */
  param: string
  /** Random split across all variants. Off means everyone without a forcing link sees control. */
  split: boolean
  variants: Record<string, V>
}

export const EXPERIMENTS = {
  hero: {
    param: 'h',
    split: false,
    variants: {
      control: { headline: 'Everyone gets a Jarvis now.' },
      free: {
        headline: 'Everyone gets a Jarvis now.',
        sub: 'OpenSwarm is a free AI desktop for Mac. Ask once, and a team of agents gets it done.',
      },
      agents: {
        headline: 'Run a team of AI agents on your Mac.',
        sub: 'Research, outreach and busywork run in parallel while you keep working. Free.',
      },
      desktop: {
        headline: 'One desktop for all your AI.',
        sub: 'Your agents, apps and chats in one place on your Mac. Free.',
      },
    },
  } satisfies Experiment<HeroVariant>,
}

export type ExperimentId = keyof typeof EXPERIMENTS

const STORE_KEY = 'openswarm:exp'
const NAME = /^[a-z0-9_]{1,32}$/
const reported = new Set<string>()
const chosen: Partial<Record<ExperimentId, { variant: string, assigned: 'forced' | 'random' | 'default' }>> = {}

function stored(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {}
  } catch { return {} }
}

function remember(id: string, variant: string) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...stored(), [id]: variant })) } catch { /* Storage can be blocked. */ }
}

/** Stable 0..1 value per visitor and experiment (FNV-1a). */
function bucket(seed: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193)
  return (hash >>> 0) / 0x1_0000_0000
}

function resolve(id: ExperimentId) {
  const experiment: Experiment<unknown> = EXPERIMENTS[id]
  const names = Object.keys(experiment.variants)
  let forced: string | null = null
  try { forced = new URLSearchParams(window.location.search).get(experiment.param) } catch { /* No URL access. */ }
  if (forced && NAME.test(forced) && names.includes(forced)) {
    remember(id, forced)
    return { variant: forced, assigned: 'forced' as const }
  }
  const previous = stored()[id]
  if (previous && names.includes(previous)) return { variant: previous, assigned: 'forced' as const }
  if (experiment.split) {
    const { visitorId } = analyticsIds()
    const index = Math.min(names.length - 1, Math.floor(bucket(`${id}:${visitorId ?? ''}`) * names.length))
    return { variant: names[index], assigned: 'random' as const }
  }
  return { variant: 'control', assigned: 'default' as const }
}

/** The variant to render. Records the exposure once per page load. */
export function useVariant<K extends ExperimentId>(id: K): keyof (typeof EXPERIMENTS)[K]['variants'] & string {
  if (typeof window === 'undefined') return 'control' as never
  chosen[id] ??= resolve(id)
  const choice = chosen[id]!
  // Visitors on the plain page while no test runs are not part of an experiment.
  if (choice.assigned !== 'default' && !reported.has(id)) {
    reported.add(id)
    track('experiment', { exp: id, variant: choice.variant, assigned: choice.assigned })
  }
  return choice.variant as never
}

/** Variants this visitor is in, sent with a signup. */
export function activeExperiments(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [id, choice] of Object.entries(chosen)) {
    if (choice && choice.assigned !== 'default') result[id] = choice.variant
  }
  return result
}
