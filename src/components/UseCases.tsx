import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { SectionHeading } from './ui/SectionHeading'
import { AppStack } from './ui/AppIcon'
import { SalesPanel } from './usecases/SalesPanel'
import { OpsPanel } from './usecases/OpsPanel'
import { RecruitingPanel } from './usecases/RecruitingPanel'
import { ResearchPanel } from './usecases/ResearchPanel'
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
  prompt: string
  Panel: (p: { prompt: string }) => React.JSX.Element
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
  const caseFromHash = () => CASES.findIndex((item) => window.location.hash === `#uc-tab-${item.key}`)
  const [i, setI] = useState(() => Math.max(0, caseFromHash()))
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const c = CASES[i]
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
              onClick={() => { if (k !== i) track('tab', { group: 'use-cases', tab: x.key }); setI(k) }}
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
                tabs.current[next]?.focus({ preventScroll: true })
              }}
              className={cn(
                'relative h-10 w-full rounded-[8px] px-3 text-[14px] transition-colors md:w-auto md:shrink-0 md:px-4',
                k === i ? 'text-white' : 'text-ink-2 hover:bg-[#f2f2f2] hover:text-ink',
              )}
            >
              {k === i && <motion.span layoutId="usecase-tab" className="absolute inset-0 rounded-[8px] bg-ink" transition={{ duration: 0.35, ease: EASE }} />}
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
              <motion.div key={c.key} className="flex flex-1 flex-col" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: EASE }}>
                <h3 className="text-balance text-[21px] font-medium leading-[1.25] tracking-[-0.02em] text-ink sm:text-[24px]">{c.head}</h3>
                <p className="mt-3 max-w-[420px] text-[15px] leading-[1.6] text-ink-2">{c.line}</p>
                <div className="mt-auto pt-5 text-[12px] text-ink-3 sm:pt-8">Works with</div>
                <div className="mt-2.5 flex items-center gap-3">
                  <AppStack brands={c.tools} size={34} />
                  {/* the names only where there is room; on a phone the marks say enough */}
                  <span className="hidden text-[13px] text-ink-2 sm:inline">{c.tools.map((t) => t.title).join(', ')}</span>
                </div>
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
              <motion.div key={c.key} className="relative" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: EASE }}>
                <c.Panel prompt={c.prompt} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}
