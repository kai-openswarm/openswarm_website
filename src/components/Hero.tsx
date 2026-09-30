import { EfWordmark } from './icons'
import { Sky } from './ui/Sky'
import { HeroCloudBorder } from './ui/HeroCloudBorder'
import { HeroScene } from './os/HeroScene'
import { Window } from './ui/Window'
import { WaitlistForm } from './ui/WaitlistForm'
import { WaitlistShareButton } from './ui/WaitlistReferral'
import { media } from '@/lib/utils'
import { NumberTicker } from './ui/number-ticker'
import { useWaitlistCount } from '@/lib/waitlist-count'

export function Hero() {
  const waitlistCount = useWaitlistCount()
  return (
    <section id="top" data-section="top" className="relative px-2 pt-2 sm:px-3 sm:pt-3">
      <div className="relative isolate [--hero-reveal:18px] sm:[--hero-reveal:70px]">
        <div className="pointer-events-none absolute inset-x-0 top-0 bottom-[var(--hero-reveal)] overflow-hidden rounded-[20px] border border-[#6197a6]/20 sm:rounded-[28px]">
          <Sky className="absolute inset-0" />
        </div>
        <HeroCloudBorder />

        <div className="relative mx-auto max-w-[1240px] px-4 pt-[104px] text-center sm:px-8 sm:pt-[116px]">
          <a
            href="https://www.joinef.com"
            target="_blank"
            rel="noreferrer"
            className="group relative inline-flex h-8 items-center gap-2 rounded-full bg-[var(--ef-purple)] pl-3.5 pr-2.5 text-[12.5px] font-medium text-white/90 shadow-[0_6px_18px_-8px_rgba(99,0,221,0.7)] transition-transform after:absolute after:inset-x-0 after:-inset-y-1 hover:-translate-y-px"
          >
            Backed by
            <EfWordmark className="h-[9px] w-auto" />
            <svg viewBox="0 0 12 12" className="h-3 w-3 opacity-60 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
              <path d="M4.5 3 7.5 6l-3 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>

          <h1 className="mx-auto mt-5 max-w-[850px] font-display text-[40px] font-normal leading-[1.08] tracking-[-0.045em] text-[#0a2028] sm:mt-5 sm:text-[54px] lg:text-[60px]">
            Everyone gets a Jarvis now.
          </h1>
          <div className="mt-5">
            <WaitlistForm placement="hero" />
          </div>
          <div className="mx-auto mt-9 flex min-h-10 flex-wrap items-center justify-center gap-2 text-[#35515a]">
            <p className="inline-flex h-10 items-center gap-2">
              <NumberTicker value={waitlistCount} className="font-semibold tracking-[-0.03em] text-[#52268b] text-[21px]" />
              <span className="text-[11.5px] font-medium text-[#3f5260]">on the waitlist</span>
            </p>
            <WaitlistShareButton />
          </div>
        </div>

        {/* Only the outer window grows. The original scene's camera and motion remain intact. */}
        <div className="relative mx-auto mt-7 w-full max-w-[1480px] px-2 sm:mt-8 sm:px-8 lg:px-12">
          <div id="product" className="relative scroll-mt-24">
            <img
              src={media('logo-256.png')}
              alt=""
              aria-hidden
              className="pointer-events-none absolute -top-[31px] right-[6%] z-10 h-10 w-10 [image-rendering:pixelated] sm:-top-[43px] sm:h-[56px] sm:w-[56px]"
            />
            <Window title="Open Swarm" className="ring-1 ring-[#233f56]/20">
              <HeroScene />
            </Window>
          </div>
        </div>
      </div>
    </section>
  )
}
