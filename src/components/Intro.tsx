import { Reveal } from './ui/Reveal'

/*
  The two-tone opener Aside puts under its hero: a link on the left, two paragraphs on the
  right, each with a dark first sentence and a softer rest. It replaces the manifesto and
  the twelve-agent grid, which made the page long (Alex: "main page is way too long").
*/

export function Intro() {
  return (
    <section data-section="intro" className="relative">
      <div className="mx-auto grid gap-6 px-5 pb-20 pt-12 sm:px-8 sm:pb-28 sm:pt-16 lg:w-[calc(100%-64px)] lg:max-w-[1240px] lg:grid-cols-[1fr_1.6fr] lg:gap-10">
        <Reveal>
          <p className="-my-2 inline-flex items-center py-2 text-[16px] font-medium text-sky sm:text-[17px]">
            Introducing Open Swarm
          </p>
        </Reveal>
        <div className="flex flex-col gap-7 text-[19px] leading-[1.5] tracking-[-0.01em] text-ink-2 sm:text-[21px]">
          <Reveal delay={0.05}>
            <p>
              <span className="text-ink">Most AI tools still give you one agent in one chat.</span> It works on a single task while
              you wait, and anything bigger than that ends up back on your plate.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <p>
              <span className="text-ink">Open Swarm is a desktop where many agents work at once.</span> Each one gets its own
              browser, apps and tools, and you can watch the whole swarm on one canvas, step in when you want, and pick up the
              finished work.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
