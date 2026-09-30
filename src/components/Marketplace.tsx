import { motion, useInView, useReducedMotion } from 'motion/react'
import { useRef, type ReactNode } from 'react'
import { SectionHeading } from './ui/SectionHeading'
import { AppStack } from './ui/AppIcon'
import { Mic, Phone } from 'lucide-react'
import { WaitlistLink } from './ui/WaitlistLink'
import { B, type Brand } from '@/lib/brands'
import { EASE } from '@/lib/utils'
import { PixelCanvas } from './ui/pixel-canvas'
import { GradientText } from './ui/gradient-text'

/*
  Agent Marketplace. Names and first four lines come from the team's Marketplace
  clips in the Open Swarm v2 Drive. Text, Call and Verbal Hotkeys lines are drafts.
  Problem Validator's agents and sources match its swarm in the Capabilities card
  (one agent per source), so the two agree; the team should confirm the count.
*/

type MarketplaceApp = { name: string; line: string; agents: number; tools: Brand[]; cta?: string; source?: string; mark?: ReactNode; draft?: boolean }

const apps: MarketplaceApp[] = [
  { name: 'Lead Finder', line: 'An app for finding your next customers with five agents.', agents: 5, tools: [B.gmaps, B.linkedin, B.chrome, B.gsheets], cta: 'Find leads', source: 'marketplace:lead-finder' },
  { name: 'Problem Validator', line: 'Describe a problem. Agents search Reddit, X, Hacker News and review sites for real people who have it.', agents: 6, tools: [B.reddit, B.x, B.ycombinator, B.producthunt], cta: 'Validate an idea', source: 'marketplace:problem-validator' },
  { name: 'Post Harvester', line: 'Paste a profile. Agents harvest the posts and turn them into a knowledge base you can talk to.', agents: 3, tools: [B.x, B.linkedin, B.instagram], cta: 'Harvest posts', source: 'marketplace:post-harvester' },
  { name: 'Social Footprint Finder', line: 'Give it a name or a handle. Agents find public profiles across the web.', agents: 6, tools: [B.threads, B.instagram, B.youtube, B.pinterest, B.spotify], cta: 'Find profiles', source: 'marketplace:social-footprint-finder' },
  { name: 'Text Agents', line: 'Text your swarm from your phone and get the work back the same way.', agents: 2, tools: [B.imessage, B.whatsapp, B.telegram], draft: true },
  { name: 'Call Agents', line: 'Agents that pick up the phone and make the call for you.', agents: 2, tools: [], mark: <Phone className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />, draft: true },
  { name: 'Verbal Hotkeys', line: 'Say what you want. Your agents hear it and get moving.', agents: 1, tools: [], mark: <Mic className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />, draft: true },
]

const appShimmerPalettes = [
  ['#ffd5c8', '#f6ac91', '#e8775e'],
  ['#c9e7fa', '#8ac8e8', '#5298c7'],
  ['#cbebdf', '#99d3ba', '#5fac8d'],
  ['#e4d8f8', '#c3a9e7', '#9c7ac4'],
]

function MarketplaceAppCard({ a, i }: { a: MarketplaceApp; i: number }) {
  const cardRef = useRef<HTMLElement>(null)
  const inView = useInView(cardRef, { amount: 0.2 })
  const reduce = useReducedMotion()
  return (
    <motion.article
      ref={cardRef}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.7, ease: EASE, delay: i * 0.06 }}
      className="group relative flex flex-col rounded-[14px] bg-white p-5 shadow-[0_0_0_1px_var(--line)] transition-[box-shadow,background-color] duration-300 hover:shadow-[0_0_0_1px_var(--line-strong),0_18px_40px_-28px_rgba(0,0,0,0.35)] focus-within:shadow-[0_0_0_1px_var(--line-strong),0_18px_40px_-28px_rgba(0,0,0,0.35)] active:bg-[#fafafa] sm:p-6"
    >
      <PixelCanvas
        variant="icon"
        gap={8}
        speed={24}
        colors={appShimmerPalettes[i % appShimmerPalettes.length]}
        style={{
          inset: '4px 4px auto',
          height: 82,
          borderRadius: 10,
          maskImage: 'radial-gradient(ellipse at 38% 38%, #000 12%, transparent 76%)',
        }}
      />
      <div className="relative"><AppStack brands={a.tools} size={34} /></div>
      <h3 className="mt-5 text-[18px] font-medium leading-[1.25] tracking-[-0.02em] text-ink">{a.name}</h3>
      <p className="mt-2 text-[14px] leading-[1.55] text-ink-2">{a.line}</p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-6">
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-2">
          <span className="flex gap-0.5">
            {Array.from({ length: a.agents }).map((_, k) => (
              <motion.span
                key={k}
                className="h-1.5 w-1.5 rounded-full bg-ink"
                animate={reduce || !inView ? { opacity: 0.65 } : { opacity: [0.25, 1, 0.25] }}
                transition={reduce || !inView ? { duration: 0.15 } : { repeat: Infinity, duration: 1.6, delay: k * 0.18 }}
              />
            ))}
          </span>
          {a.agents} agents
        </span>
        {/* Stretch the waitlist link over the card so the whole app card stays tappable. */}
        <WaitlistLink
          source={a.source ?? 'marketplace'}
          aria-label={`${a.cta ?? `Get ${a.name}`} — join the free waitlist to use ${a.name}`}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] transition-colors after:absolute after:inset-0 after:rounded-[14px] group-hover:bg-btn group-hover:text-btn-ink group-hover:shadow-none [&_svg]:hidden"
        >
          {a.cta ?? 'Get this app'}
        </WaitlistLink>
      </div>
    </motion.article>
  )
}

/*
  Four marketplace apps on a gray band, the way Aside lays out its four privacy cards.
  The three that aren't out yet sit on one line underneath instead of taking a card each.
*/
export function Marketplace() {
  const live = apps.filter((a) => !a.draft)
  const soon = apps.filter((a) => a.draft)
  return (
    <section id="marketplace" data-section="marketplace" className="relative">
      <div className="bg-bg-alt px-5 py-20 sm:px-8 sm:py-28 lg:mx-auto lg:w-[calc(100%-64px)] lg:max-w-[1240px]">
        <SectionHeading title={<GradientText className="gradient-text--swarm">Agent marketplace</GradientText>} sub="Apps your agents use inside Open Swarm to find leads, validate problems and more." />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {live.map((a, i) => (
            <MarketplaceAppCard key={a.name} a={a} i={i} />
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2 text-[13.5px] text-ink-2">
          <span className="mb-1 mr-1 basis-full sm:mb-0 sm:basis-auto">Coming soon</span>
          {soon.map((a) => (
            <span key={a.name} className="inline-flex h-8 items-center gap-2 rounded-full bg-white px-3 text-ink shadow-[0_0_0_1px_var(--line)]">
              <span className="text-ink-2 [&_svg]:h-3.5 [&_svg]:w-3.5">{a.mark ?? <AppStack brands={a.tools.slice(0, 1)} size={18} />}</span>
              {a.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
