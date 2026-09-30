import type { CSSProperties } from 'react'
import { Reveal } from './ui/Reveal'
import { AppsScene } from './os/AppsScene'
import { BrowserScene } from './os/BrowserScene'
import { SwarmScene } from './os/SwarmScene'
import { Window } from './ui/Window'
import { B, type Brand } from '@/lib/brands'
import { cn, media } from '@/lib/utils'

/*
  Aside's "Anything you do in a browser" section, rebuilt for OpenSwarm: a tilted wall of
  the apps agents already work in, then three pastel cards, each with the ask and a real
  recording of the swarm doing it. Each product has its own painted wallpaper; the
  windows are frosted so the colour shows through without competing with the interface.
*/

type Tile = { brand: Brand; fill?: boolean }
const ROWS: Tile[][] = [
  [B.gmail, B.linkedin, B.notion, B.figma, B.gcal, B.stripe, B.pinterest, B.hubspot, B.gdrive, B.discord, B.airtable, B.zoom].map((b, i) => ({ brand: b, fill: i % 3 !== 0 })),
  [B.x, B.gsheets, B.linear, B.chrome, B.reddit, B.shopify, B.gdocs, B.spotify, B.calendly, B.whatsapp, B.youtube, B.instagram].map((b, i) => ({ brand: b, fill: i % 3 !== 1 })),
  [B.jira, B.gmaps, B.asana, B.dropbox, B.zapier, B.trello, B.intercom, B.todoist, B.telegram, B.crunchbase, B.quickbooks, B.producthunt].map((b, i) => ({ brand: b, fill: i % 3 !== 2 })),
]

function BigIcon({ t }: { t: Tile }) {
  const hex = `#${t.brand.hex}`
  return (
    <span
      title={t.brand.title}
      className="relative flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-[16px] sm:h-[76px] sm:w-[76px] sm:rounded-[19px]"
      style={
        t.fill
          ? { background: `linear-gradient(160deg, color-mix(in oklab, ${hex} 72%, white) 0%, ${hex} 55%, color-mix(in oklab, ${hex} 85%, black) 100%)`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 4px rgba(0,0,0,0.12), 0 10px 18px -10px rgba(20,30,60,0.45)' }
          : { background: 'linear-gradient(180deg,#ffffff,#f1f3f6)', boxShadow: 'inset 0 1px 0 #fff, inset 0 0 0 1px rgba(0,0,0,0.06), 0 10px 18px -10px rgba(20,30,60,0.35)' }
      }
    >
      <svg viewBox="0 0 24 24" className="h-[34px] w-[34px] sm:h-[40px] sm:w-[40px]" aria-hidden>
        <path d={t.brand.path} fill={t.fill ? '#fff' : hex} />
      </svg>
    </span>
  )
}

function IconWall() {
  return (
    <div
      aria-hidden
      className="relative -mx-5 mt-12 h-[200px] overflow-hidden sm:-mx-8 [mask-composite:intersect] [mask-image:linear-gradient(to_bottom,#000_40%,transparent_96%),linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)] [perspective:900px] sm:mt-14 sm:h-[250px]"
    >
      <div className="flex origin-top flex-col gap-4 [transform:rotateX(34deg)_scale(1.08)] sm:gap-5">
        {ROWS.map((row, r) => (
          <div key={r} className="flex w-max gap-4 motion-safe:animate-[drift_70s_linear_infinite] sm:gap-5" style={{ animationDirection: r % 2 ? 'reverse' : 'normal', marginLeft: r % 2 ? -60 : 0 } as CSSProperties}>
            {[...row, ...row].map((t, i) => (
              <BigIcon key={i} t={t} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

type Card = { key: string; ask: string; Scene: () => React.JSX.Element; title: string; body: string; ground: string; wallpaper: string; position: string }

const CARDS: Card[] = [
  {
    key: 'browser',
    ask: 'Best food in Berkeley',
    Scene: BrowserScene,
    title: 'Browsing in parallel.',
    body: 'One ask opens six browsers at once, and each agent reads its own set of pages.',
    ground: '#ecd4c9',
    wallpaper: 'painterly-dawn.webp',
    position: '42% 50%',
  },
  {
    key: 'apps',
    ask: 'Make me an app for my daily brief',
    Scene: AppsScene,
    title: 'Apps on request.',
    body: 'Describe a tool and an agent builds it, then it sits in your launcher next to the rest.',
    ground: '#b7d3c9',
    wallpaper: 'painterly-jade.webp',
    position: '60% 50%',
  },
  {
    key: 'swarm',
    ask: 'Find people who have this problem',
    Scene: SwarmScene,
    title: 'A swarm for the big jobs.',
    body: 'Problem Validator gives every source its own agent, so Reddit, X and Hacker News are searched at the same time.',
    ground: '#bac8e3',
    wallpaper: 'painterly-dusk.webp',
    position: '55% 50%',
  },
]

function Ask({ text }: { text: string }) {
  return (
    <div className="flex h-10 items-center gap-2 rounded-full bg-white/85 pl-4 pr-1.5 text-[13.5px] text-ink shadow-[0_0_0_1px_rgba(255,255,255,0.9),0_6px_16px_-10px_rgba(20,30,60,0.4)] backdrop-blur-md">
      <span className="truncate">{text}</span>
      <span className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-white">
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
          <path d="M6 9.5v-7M3 5.5l3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  )
}

function CapCard({ c, i }: { c: Card; i: number }) {
  return (
    // two across until xl, so each scene is big enough to read; the third card centres under them
    <Reveal delay={i * 0.08} className={cn('flex flex-col', i === 2 && 'md:col-span-2 md:mx-auto md:w-[calc(50%-10px)] xl:col-span-1 xl:mx-0 xl:w-auto')}>
      <div id={{ browser: 'browser-agents', apps: 'app-builder', swarm: 'agent-swarms' }[c.key]}
        className="relative scroll-mt-24 overflow-hidden rounded-[16px] shadow-[0_0_0_1px_rgba(10,30,60,0.06)]"
        style={{
          '--product-wallpaper': `url("${media(c.wallpaper)}")`,
          '--product-wallpaper-position': c.position,
          '--product-ground': c.ground,
          backgroundColor: c.ground,
          backgroundImage: `url("${media(c.wallpaper)}")`,
          backgroundPosition: c.position,
          backgroundSize: 'cover',
        } as CSSProperties}
      >
        <div className="relative px-5 pt-5 sm:px-6 sm:pt-6">
          <Ask text={c.ask} />
        </div>
        <div className="relative -mb-3 mt-5 px-4 sm:px-5">
          <Window size="sm" title="OpenSwarm">
            <c.Scene />
          </Window>
        </div>
      </div>
      <p className="mt-5 max-w-[380px] text-[15px] leading-[1.55] text-ink-3">
        <span className="font-medium text-ink">{c.title}</span> {c.body}
      </p>
    </Reveal>
  )
}

export function Capabilities() {
  return (
    <section id="capabilities" data-section="capabilities" className="relative">
      {/* the gray band stays inside the two guide lines, like Aside's */}
      <div className="bg-bg-alt px-5 pb-20 pt-20 sm:px-8 sm:pb-28 sm:pt-28 lg:mx-auto lg:w-[calc(100%-64px)] lg:max-w-[1240px]">
        <Reveal className="text-center">
          <span className="text-[15px] font-medium text-sky">Unlimited capability</span>
          <h2 className="display mx-auto mt-4 max-w-[920px] text-[34px] sm:text-[44px] lg:text-[52px]">
            Anything you do on your computer, a swarm can do for you.
          </h2>
        </Reveal>

        <IconWall />

        <Reveal className="mx-auto mt-4 max-w-[640px] text-center">
          <p className="text-[16px] leading-[1.6] text-ink-2 sm:text-[17px]">
            Agents use your browser, your apps and <span className="text-ink">connected tools</span>, so they can finish the whole
            task instead of telling you how to do it.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-10 md:grid-cols-2 md:gap-5 xl:grid-cols-3 xl:gap-6">
          {CARDS.map((c, i) => (
            <CapCard key={c.key} c={c} i={i} />
          ))}
        </div>
      </div>
    </section>
  )
}
