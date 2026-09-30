import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { RotateCcw } from 'lucide-react'
import { SectionHeading } from './ui/SectionHeading'
import { AppIcon } from './ui/AppIcon'
import { SalesPanel } from './usecases/SalesPanel'
import { OpsPanel } from './usecases/OpsPanel'
import { RecruitingPanel } from './usecases/RecruitingPanel'
import { ResearchPanel } from './usecases/ResearchPanel'
import type { PanelProps } from './usecases/shared'
import { B, type Brand } from '@/lib/brands'
import { cn, EASE, media } from '@/lib/utils'
import { track } from '@/lib/analytics'

/*
  Use cases by team, the answer to Alex's "are we having a business tab?" (3:49) and the
  inspiration Loom's point that even a consumer app should show who it is for.
  New copy, flagged for the team to review. Each team has its own animated panel (see
  usecases/), so switching tabs shows a different kind of work, not the same checklist.
*/

type Case = {
  key: string
  tab: string
  /** what the team gets, as the column's heading (the tab above already names the team) */
  head: string
  line: string
  tools: Brand[]
  steps: { at: number; detail: string }[]
  prompt: string
  Panel: (p: PanelProps) => React.JSX.Element
  wallpaper: string
  ground: string
  position: string
  treatment?: string
}

const CASES: Case[] = [
  {
    key: 'sales',
    tab: 'Sales and outreach',
    head: 'A first email ready for every lead',
    line: 'Find the right people, learn what they care about, and have a first email ready for each one.',
    tools: [B.linkedin, B.crunchbase, B.hubspot, B.gmail],
    steps: [
      { at: 2.2, detail: 'Find the founders behind each company.' },
      { at: 3.3, detail: 'Check each company’s latest funding round.' },
      { at: 4.6, detail: 'Bring qualified leads into HubSpot.' },
      { at: 12, detail: 'Review a first email tailored to each founder.' },
    ],
    prompt: 'Find 50 Series A fintech startups in New York and draft a first email to each founder.',
    Panel: SalesPanel,
    wallpaper: 'painterly-dawn.webp',
    ground: '#ecd4c9',
    position: '45% 58%',
  },
  {
    key: 'ops',
    tab: 'Operations',
    head: 'Weekly checks that run on their own',
    line: 'Hand off the weekly checks and reports that keep the business running, and get told only when something is off.',
    tools: [B.stripe, B.quickbooks, B.gsheets, B.gmail],
    steps: [
      { at: 2.3, detail: 'Read the week’s Stripe payouts.' },
      { at: 5.2, detail: 'Match invoices and flag the differences.' },
      { at: 9, detail: 'Log all three exceptions in Google Sheets.' },
      { at: 12.5, detail: 'Send finance a summary of what needs review.' },
    ],
    prompt: "Every Friday, match Stripe payouts against QuickBooks and flag anything that doesn't line up.",
    Panel: OpsPanel,
    wallpaper: 'painterly-jade.webp',
    ground: '#b7d3c9',
    position: '70% 55%',
  },
  {
    key: 'recruiting',
    tab: 'Recruiting',
    head: 'The strongest applicants on your calendar',
    line: 'Read every application, check the work behind it, and put the best people on your calendar.',
    tools: [B.greenhouse, B.linkedin, B.gcal, B.gmail],
    steps: [
      { at: 2.2, detail: 'Read and screen the incoming applications.' },
      { at: 5.8, detail: 'Check the work behind the strongest candidates.' },
      { at: 9.1, detail: 'Book intro calls with the ten shortlisted people.' },
      { at: 12, detail: 'Send invitations with the interview details.' },
    ],
    prompt: 'Screen the 120 new applicants for the design role and book calls with the top ten.',
    Panel: RecruitingPanel,
    wallpaper: 'painterly-dusk.webp',
    ground: '#bac8e3',
    position: '35% 60%',
  },
  {
    key: 'research',
    tab: 'Research',
    head: 'A cited brief from a month of papers',
    line: 'Read more than you have time for, follow the sources, and come back with a brief you can trust.',
    tools: [B.arxiv, B.scholar, B.chrome, B.notion],
    steps: [
      { at: 3, detail: 'Read the latest papers on browser agents.' },
      { at: 7.85, detail: 'Connect the findings back to their sources.' },
      { at: 8.5, detail: 'Cross-check results against live-web research.' },
      { at: 12, detail: 'Save the complete, cited brief to Notion.' },
    ],
    // a non-breaking hyphen, so a narrow bubble never splits "two" from "page"
    prompt: 'Read the last month of papers on browser agents and write me a two\u2011page brief.',
    Panel: ResearchPanel,
    wallpaper: 'painterly-dawn.webp',
    ground: '#d9ceab',
    position: '90% 30%',
    treatment: 'hue-rotate(32deg) saturate(0.8)',
  },
]

export function UseCases() {
  const reduce = useReducedMotion()
  const caseFromHash = () => CASES.findIndex((item) => window.location.hash === `#uc-tab-${item.key}`)
  const [i, setI] = useState(() => Math.max(0, caseFromHash()))
  const [preview, setPreview] = useState<{ team: string; tool: number } | null>(null)
  const [run, setRun] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const c = CASES[i]
  const selectedTool = preview?.team === c.key ? preview.tool : null
  const step = selectedTool === null ? undefined : c.steps[selectedTool]
  useEffect(() => {
    const pick = (e: Event) => {
      const k = CASES.findIndex((x) => x.key === (e as CustomEvent<string>).detail)
      if (k >= 0) setI(k)
    }
    const fromHash = () => {
      const k = CASES.findIndex((item) => window.location.hash === `#uc-tab-${item.key}`)
      if (k >= 0) setI(k)
    }
    window.addEventListener('os:usecase', pick)
    window.addEventListener('hashchange', fromHash)
    return () => {
      window.removeEventListener('os:usecase', pick)
      window.removeEventListener('hashchange', fromHash)
    }
  }, [])
  return (
    <section id="use-cases" data-section="use-cases" className="py-20 sm:py-28">
      <div className="mx-auto px-5 sm:px-8 lg:w-[calc(100%-64px)] lg:max-w-[1240px]">
        <SectionHeading title="One desktop for every team." sub="Hand the repetitive, multi-step work to a swarm, whether you sell, run operations, hire or research." />

        {/* On a phone the four tabs sit in an even 2 x 2 grid on a gray track. */}
        <div className="mt-10 grid grid-cols-2 gap-1 rounded-[10px] bg-[#f2f2f2] p-1 md:flex md:flex-wrap md:rounded-none md:bg-transparent md:p-0" role="tablist" aria-label="Teams">
          {CASES.map((x, k) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              id={`uc-tab-${x.key}`}
              ref={(element) => { tabs.current[k] = element }}
              aria-selected={k === i}
              aria-controls="uc-panel"
              tabIndex={k === i ? 0 : -1}
              onClick={() => { if (k !== i) track('tab', { group: 'use-cases', tab: x.key }); setI(k); setPreview(null) }}
              onKeyDown={(event) => {
                let next: number
                if (event.key === 'ArrowRight') next = (i + 1) % CASES.length
                else if (event.key === 'ArrowLeft') next = (i - 1 + CASES.length) % CASES.length
                else if (event.key === 'Home') next = 0
                else if (event.key === 'End') next = CASES.length - 1
                else return
                event.preventDefault()
                track('tab', { group: 'use-cases', tab: CASES[next].key })
                setI(next)
                setPreview(null)
                tabs.current[next]?.focus({ preventScroll: true })
              }}
              className={cn(
                'relative h-10 w-full origin-center rounded-[8px] px-3 text-[14px] transition-[color,background-color,box-shadow,translate,scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#253441] motion-safe:active:scale-[0.985] motion-reduce:transition-none md:w-auto md:shrink-0 md:px-4',
                k === i ? 'text-white' : 'text-ink-2 hover:bg-white hover:text-ink hover:shadow-[0_1px_5px_rgba(20,35,50,0.08)] motion-safe:hover:-translate-y-px md:hover:bg-[#f2f2f2]',
              )}
            >
              {k === i && (
                <motion.span
                  aria-hidden
                  layoutId={reduce ? undefined : 'usecase-tab'}
                  className="pointer-events-none absolute inset-0 rounded-[8px] bg-[#253441]/95 bg-[linear-gradient(155deg,rgba(255,255,255,0.14),rgba(255,255,255,0))] shadow-[inset_0_1px_0_rgba(255,255,255,0.26),inset_0_0_0_1px_rgba(255,255,255,0.12),0_2px_5px_rgba(25,42,57,0.12)] backdrop-blur-md"
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 38, mass: 0.7 }}
                />
              )}
              <span className="relative">{x.tab}</span>
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id="uc-panel"
          aria-labelledby={`uc-tab-${c.key}`}
          tabIndex={0}
          className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-[14px] bg-line shadow-[0_0_0_1px_var(--line)] md:grid-cols-[0.85fr_1.15fr]"
        >
          <div className="flex flex-col bg-white p-5 sm:p-8">
            <AnimatePresence mode="wait">
              {/* the copy sits at the top and "Works with" at the bottom, so the column is as full as the panel beside it */}
              <motion.div
                key={c.key}
                className="flex flex-1 flex-col"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : -4, transition: { duration: reduce ? 0 : 0.12 } }}
                transition={{ duration: reduce ? 0 : 0.22, ease: EASE }}
              >
                <h3 className="text-balance text-[21px] font-medium leading-[1.25] tracking-[-0.02em] text-ink sm:text-[24px]">{c.head}</h3>
                <p className="mt-3 max-w-[420px] text-[15px] leading-[1.6] text-ink-2">{c.line}</p>
                <div className="mt-auto flex items-center justify-between gap-3 pt-5 text-[12px] text-ink-3 sm:pt-8">
                  <span>Works with</span>
                  <button
                    type="button"
                    onClick={() => { setPreview(null); setRun((value) => value + 1) }}
                    aria-label={reduce ? `Reset ${c.tab} preview` : `Replay ${c.tab} demo`}
                    className="group -my-2 flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-ink-2 transition-colors duration-150 hover:bg-black/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#253441] motion-reduce:transition-none"
                  >
                    <RotateCcw size={12} aria-hidden className="transition-transform duration-150 motion-safe:group-hover:-rotate-45 motion-reduce:transition-none" />
                    {reduce ? 'Overview' : 'Replay demo'}
                  </button>
                </div>
                <div className="mt-2 flex min-h-11 items-center gap-3">
                  <div className="flex shrink-0 gap-0.5" role="group" aria-label={`${c.tab} app previews`}>
                    {c.tools.map((brand, index) => (
                      <button
                        key={brand.title}
                        type="button"
                        aria-label={`Preview ${brand.title} step`}
                        aria-pressed={index === selectedTool}
                        title={`${brand.title}: ${c.steps[index].detail}`}
                        onClick={() => setPreview({ team: c.key, tool: index })}
                        className={cn(
                          'relative flex h-11 w-11 items-center justify-center rounded-[11px] transition-[background-color,box-shadow,translate,scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#253441] motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.96] motion-reduce:transition-none',
                          index === selectedTool ? 'bg-[#edf1f5] shadow-[inset_0_0_0_1px_rgba(37,52,65,0.26)]' : 'hover:bg-[#f2f4f6] hover:shadow-[inset_0_0_0_1px_rgba(37,52,65,0.08)]',
                        )}
                      >
                        <AppIcon brand={brand} size={30} />
                      </button>
                    ))}
                  </div>
                  <span className="hidden text-[12px] leading-[1.4] text-ink-2 sm:inline" aria-hidden>{selectedTool === null ? c.tools.map((t) => t.title).join(', ') : c.tools[selectedTool].title}</span>
                </div>
                <p className="mt-1 min-h-9 text-[12px] leading-[1.5] text-ink-2" role="status" aria-live="polite" aria-atomic="true">{step?.detail ?? 'Select an app to explore its part in the workflow.'}</p>
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="relative overflow-hidden p-5 sm:p-8" style={{ backgroundColor: c.ground }}>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ backgroundImage: `url("${media(c.wallpaper)}")`, backgroundSize: 'cover', backgroundPosition: c.position, filter: c.treatment }}
            />
            <AnimatePresence mode="wait">
              <motion.div
                key={c.key}
                className="relative"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : -4, transition: { duration: reduce ? 0 : 0.12 } }}
                transition={{ duration: reduce ? 0 : 0.22, ease: EASE }}
              >
                <c.Panel key={`${c.key}-${run}`} prompt={c.prompt} previewTime={step?.at} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}
