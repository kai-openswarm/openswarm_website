import { motion, useReducedMotion } from 'motion/react'
import { ArrowUpRight } from 'lucide-react'
import { B } from '@/lib/brands'
import { LINKS, media } from '@/lib/utils'

const product = [
  ['The desktop', '#product'],
  ['What agents do', '#capabilities'],
  ['Agent marketplace', '#marketplace'],
  ['Use cases', '#use-cases'],
]
const groups = [
  { title: 'Community', links: [['Discord', LINKS.discord], ['X / Twitter', LINKS.x]] },
  { title: 'Legal', links: [['Privacy', LINKS.privacy], ['Terms', LINKS.terms], ['Your privacy choices', LINKS.privacyChoices]] },
].filter((group) => group.links.length > 0)

function FooterLinks({ title, links }: { title: string; links: string[][] }) {
  return (
    <div>
      <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#3c5167]">{title}</h3>
      <ul className="mt-2 flex flex-col gap-0.5">
        {links.map(([label, href]) => (
          <li key={label}>
            <a
              href={href}
              {...(href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}
              className="group inline-flex min-h-9 items-center gap-1 rounded-sm text-[13px] text-[#263c53] underline-offset-4 transition-colors duration-150 hover:text-[#173f72] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#366e88] sm:min-h-7"
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Closing() {
  const reduce = useReducedMotion()
  return (
    <footer data-section="closing" className="relative px-2 pb-3 pt-10 sm:px-3 sm:pb-5 sm:pt-12 lg:px-0">
      <div className="relative isolate mx-auto flex min-h-[600px] max-w-[1240px] flex-col overflow-hidden rounded-[22px] bg-[#eee9dc] ring-1 ring-inset ring-[#30476e]/10 lg:min-h-[480px] lg:w-[calc(100%-64px)]">
        <img
          src={media('footer-cobalt-coast.webp')}
          alt=""
          width="1612"
          height="976"
          loading="lazy"
          decoding="async"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-[90%_center] sm:object-[65%_center] lg:object-[center_24%]"
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(244,240,228,0.82)_0%,rgba(244,240,228,0.72)_55%,rgba(244,240,228,0)_79%)] sm:bg-[linear-gradient(180deg,rgba(244,240,228,0.65)_0%,rgba(244,240,228,0.35)_44%,rgba(244,240,228,0)_70%)] lg:bg-[linear-gradient(180deg,rgba(244,240,228,0.32),rgba(244,240,228,0)_53%)]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(0deg,rgba(12,38,67,0.6),transparent)]" />
        <div className="relative z-10 grid gap-6 px-6 pb-8 pt-8 sm:px-10 sm:pt-10 lg:w-[86%] lg:grid-cols-[200px_1fr] lg:gap-10">
          <div>
            <a href="#top" className="inline-flex items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#366e88]" aria-label="OpenSwarm home">
              <img src={media('logo-256.png')} alt="" width="28" height="28" className="h-7 w-7 [image-rendering:pixelated]" />
              <span className="text-[17px] font-semibold tracking-[-0.02em] text-[#26384a]">OpenSwarm</span>
            </a>
            <p className="mt-3 max-w-[270px] text-[14px] leading-[1.6] text-[#3e5061]">Your AI desktop. One place for you and your agents to work together.</p>
            <div className="mt-3 flex gap-2">
              {[[B.x, LINKS.x, 'X'], [B.discord, LINKS.discord, 'Discord']].map(([brand, href, label]) => (
                <a key={label as string} href={href as string} target="_blank" rel="noreferrer" aria-label={label as string} className="flex h-9 w-9 items-center justify-center rounded-full border border-[#30476e]/15 bg-white/15 text-[#26384a] transition-[background-color,transform] duration-150 hover:bg-white/70 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#366e88]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden><path d={(brand as typeof B.x).path} fill="currentColor" /></svg>
                </a>
              ))}
            </div>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 sm:grid-cols-[1.35fr_1fr_0.7fr]">
            <FooterLinks title="Product" links={product} />
            <div className="flex flex-col gap-5 sm:contents">
              {groups.map((group) => <FooterLinks key={group.title} {...group} />)}
            </div>
          </nav>
        </div>

        <div className="relative z-10 mx-6 mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-white/25 py-3 text-[11px] text-white/90 sm:mx-10">
          <span>© 2026 Open Swarm Inc.</span>
          <motion.a
            href="#top"
            initial={reduce ? false : { opacity: 0, y: 5 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ amount: 0.8 }}
            transition={{ type: 'spring', visualDuration: 0.25, bounce: 0.08 }}
            className="group inline-flex min-h-9 items-center gap-2 rounded-full px-2 text-[12px] font-medium text-white transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Back to top
            <ArrowUpRight className="h-4 w-4 transition-transform duration-150 motion-safe:group-hover:-translate-y-0.5" strokeWidth={1.6} aria-hidden />
          </motion.a>
        </div>
      </div>
    </footer>
  )
}
