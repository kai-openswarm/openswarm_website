import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useIsPresent, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react'
import { ChevronDown, ChevronRight, Menu as MenuIcon, X } from 'lucide-react'
import { WaitlistLink } from './ui/WaitlistLink'
import { IconAsset, type IconAssetName } from './IconAsset'
import { NavFeature } from './NavFeature'
import { cn, EASE, LINKS, media } from '@/lib/utils'
import { lockScroll } from '@/lib/scroll'

/* Published Fluent Emoji artwork gives every menu topic its own recognizable object. */
const G = {
  browser: 'globe',
  apps: 'app-builder',
  ops: 'workflows',
  people: 'people',
  search: 'research',
  book: 'resources',
  chat: 'conversation',
} as const

type Item = { label: string; desc: string; href: string; glyph: IconAssetName; external?: boolean; pick?: string }
type Menu = { key: string; label: string; items: Item[]; cols?: 1 | 2; href?: undefined } | { key: string; label: string; href: string; items?: undefined }

const MENUS: Menu[] = [
  {
    key: 'product',
    label: 'Product',
    cols: 2,
    items: [
      { label: 'Browser agents', desc: 'An agent in every browser tab', href: '#browser-agents', glyph: G.browser },
      { label: 'App builder', desc: 'Describe a tool, get an app', href: '#app-builder', glyph: G.apps },
      { label: 'Agent swarms', desc: 'Multiple agents on one job', href: '#agent-swarms', glyph: G.people },
      { label: 'The desktop', desc: 'See Open Swarm in action', href: '#product', glyph: G.book },
    ],
  },
  {
    key: 'use-cases',
    label: 'Use cases',
    items: [
      { label: 'Sales and outreach', desc: 'Find leads, research, write first touches', href: '#uc-tab-sales', glyph: G.chat, pick: 'sales' },
      { label: 'Operations', desc: 'Reports, inboxes and weekly busywork', href: '#uc-tab-ops', glyph: G.ops, pick: 'ops' },
      { label: 'Recruiting', desc: 'Source, screen and schedule candidates', href: '#uc-tab-recruiting', glyph: G.people, pick: 'recruiting' },
      { label: 'Research', desc: 'Read the web and bring back answers', href: '#uc-tab-research', glyph: G.search, pick: 'research' },
    ],
  },
  { key: 'marketplace', label: 'Marketplace', href: '#marketplace' },
  {
    key: 'resources',
    label: 'Resources',
    items: [
      { label: 'Community', desc: 'Talk to the team on Discord', href: LINKS.discord, glyph: G.people, external: true },
      { label: 'Updates', desc: 'Follow Open Swarm on X', href: LINKS.x, glyph: G.chat, external: true },
    ],
  },
]

function MenuItem({ item, onPick, order = 0, compact = false }: { item: Item; onPick: () => void; order?: number; compact?: boolean }) {
  const reduce = useReducedMotion()
  return (
    <motion.a
      href={item.href}
      initial={reduce ? false : { opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.24, delay: reduce ? 0 : order * 0.025, ease: EASE }}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        // Use-case links also switch the Use cases section to that team's tab.
        if (item.pick) window.dispatchEvent(new CustomEvent('os:usecase', { detail: item.pick }))
        onPick()
      }}
      {...(item.external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className={cn('group/item flex gap-3 rounded-[12px] transition-colors duration-150 hover:bg-white/65 focus-visible:bg-white/65', compact ? 'min-h-11 items-center px-3 py-2.5' : 'items-start p-3')}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <IconAsset name={item.glyph} className="h-6 w-6 max-w-none" />
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium leading-5 text-ink">{item.label}</span>
        <span className={cn('text-[12.5px] leading-5 text-ink-2', compact ? 'sr-only' : 'block')}>{item.desc}</span>
      </span>
    </motion.a>
  )
}

function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronDown className={cn('h-3 w-3 text-ink-3 transition-transform duration-300', open && 'rotate-180', className)} strokeWidth={1.75} aria-hidden />
  )
}

export function Nav() {
  const { scrollY } = useScroll()
  const reduce = useReducedMotion()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [mobile, setMobile] = useState(false)
  const [menuHeight, setMenuHeight] = useState(0)
  const closeTimer = useRef(0)
  const navRoot = useRef<HTMLDivElement>(null)
  const releaseMobile = useRef<(() => void) | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const desktopTriggers = useRef<Record<string, HTMLButtonElement | null>>({})
  const menuContentRef = useRef<HTMLDivElement>(null)
  const pendingMenuFocus = useRef<'first' | 'last' | null>(null)
  const activeMenu = MENUS.find((menu) => menu.key === open && menu.items)
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 24))

  // Measure the unscaled content so switching menus animates a real height target.
  // The shell's two 1px borders sit outside the inner grid's measured height.
  useLayoutEffect(() => {
    const content = menuContentRef.current
    if (!activeMenu || !content) return
    const measure = () => {
      const height = content.getBoundingClientRect().height
      if (height > 0) setMenuHeight(Math.ceil(height) + 2)
    }
    measure()
    if (pendingMenuFocus.current) {
      const links = content.querySelectorAll<HTMLAnchorElement>('a[href]')
      links[pendingMenuFocus.current === 'last' ? links.length - 1 : 0]?.focus({ preventScroll: true })
      pendingMenuFocus.current = null
    }
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [activeMenu])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (open) desktopTriggers.current[open]?.focus()
      setOpen(null)
      if (mobile) {
        releaseMobile.current?.()
        setMobile(false)
        toggleRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobile, open])

  // The phone menu is a full-screen sheet: hold the page still behind it and take the page
  // out of the tab order, and put it away if the window grows past the phone layout.
  useEffect(() => {
    if (!mobile) return
    const main = document.querySelector('main')
    const wasInert = main?.hasAttribute('inert')
    const htmlOverflow = document.documentElement.style.overflow
    const bodyOverflow = document.body.style.overflow
    lockScroll(true)
    main?.setAttribute('inert', '')
    const focusables = () => Array.from(navRoot.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [])
      .filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'))
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const elements = focusables()
      const first = elements[0]
      const last = elements.at(-1)
      if (!first || !last) return
      if (event.shiftKey && (document.activeElement === first || !navRoot.current?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.getElementById('mobile-menu')?.querySelector<HTMLElement>('button,a[href]')?.focus({ preventScroll: true })
    document.addEventListener('keydown', trapFocus)
    let released = false
    const release = () => {
      if (released) return
      released = true
      document.removeEventListener('keydown', trapFocus)
      lockScroll(false)
      document.documentElement.style.overflow = htmlOverflow
      document.body.style.overflow = bodyOverflow
      if (!wasInert) main?.removeAttribute('inert')
      if (releaseMobile.current === release) releaseMobile.current = null
    }
    releaseMobile.current = release
    return release
  }, [mobile])
  // Menu links let the page scroll again right in the tap, before the jump to their section.
  const closeMobile = () => {
    releaseMobile.current?.()
    setMobile(false)
    setOpen(null)
  }

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = () => {
      if (mq.matches) {
        if (document.activeElement === toggleRef.current || document.activeElement?.closest('#mobile-menu')) {
          navRoot.current?.querySelector<HTMLAnchorElement>('a[href="#top"]')?.focus({ preventScroll: true })
        }
        releaseMobile.current?.()
        setMobile(false)
      }
      else setOpen(null)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  const openMenu = (key: string | null) => {
    window.clearTimeout(closeTimer.current)
    setOpen(key)
  }
  const closeSoon = () => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      if (!menuContentRef.current?.contains(document.activeElement)) setOpen(null)
    }, 140)
  }

  return (
    <>
      <motion.header
        initial={reduce ? false : { y: -12 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: EASE, delay: 0.05 }}
        className="pointer-events-none fixed inset-x-0 top-0 z-50"
      >
        <div
          ref={navRoot}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(null)
          }}
          onMouseLeave={() => {
            closeSoon()
            setHover(null)
          }}
          className={cn(
            'pointer-events-auto relative mx-auto transition-[max-width,margin,border-radius,background-color,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
            mobile
              ? 'glass-strong mt-2 w-[calc(100%-16px)] max-w-[1240px] rounded-[16px] shadow-[0_0_0_1px_rgba(255,255,255,0.7),0_0_0_1.5px_var(--line),0_24px_50px_-20px_rgba(10,20,40,0.35)] sm:mt-3'
              : scrolled
                ? 'glass nav-glass mt-2 w-[calc(100%-16px)] max-w-[1240px] rounded-[12px] shadow-[0_0_0_1px_var(--line),0_10px_30px_-18px_rgba(0,0,0,0.35)] sm:mt-3'
                : 'mt-3 w-[calc(100%-16px)] max-w-[1320px] rounded-[12px] bg-transparent sm:mt-4',
          )}
        >
          <nav className="flex h-14 items-center justify-between pl-4 pr-2.5 sm:pl-5" aria-label="Main">
            <a href="#top" onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) closeMobile() }} className="flex shrink-0 items-center gap-2" aria-label="Open Swarm home">
              <img src={media('logo-256.png')} alt="" className="h-7 w-7 [image-rendering:pixelated]" />
              <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink min-[360px]:text-[17px]">Open Swarm</span>
            </a>

            <ul className="absolute left-1/2 hidden w-max -translate-x-1/2 items-center whitespace-nowrap md:flex">
              {MENUS.map((m) => {
                const isOpen = open === m.key
                const common = cn(
                  'relative isolate flex h-9 origin-center items-center gap-1 rounded-[8px] px-2.5 text-[13px] font-medium transition-[color,background-color,scale] duration-150 ease-out motion-safe:active:scale-[0.985] lg:px-3.5 lg:text-[14px]',
                  isOpen ? 'text-ink' : 'text-ink-2 hover:text-ink',
                )
                const pill = (hover === m.key || (hover === null && isOpen)) && (
                  <motion.span
                    aria-hidden
                    layoutId={reduce ? undefined : 'nav-hover'}
                    className="pointer-events-none absolute inset-0 -z-10 rounded-[8px] bg-white/45 bg-[linear-gradient(160deg,rgba(255,255,255,0.28),rgba(159,184,202,0.12))] shadow-[inset_0_1px_0_rgba(255,255,255,0.72),inset_0_0_0_1px_rgba(125,150,170,0.12),0_2px_4px_rgba(30,50,70,0.035)] backdrop-blur-md"
                    transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 38, mass: 0.7 }}
                  />
                )
                return (
                  <li
                    key={m.key}
                    className="relative"
                    onMouseEnter={() => setHover(m.key)}
                  >
                    {m.items ? (
                      <button
                        id={`nav-trigger-${m.key}`}
                        ref={(element) => { desktopTriggers.current[m.key] = element }}
                        className={common}
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? `menu-${m.key}` : undefined}
                        onMouseEnter={() => openMenu(m.key)}
                        onClick={() => openMenu(isOpen ? null : m.key)}
                        onKeyDown={(event) => {
                          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                          event.preventDefault()
                          const edge = event.key === 'ArrowUp' ? 'last' : 'first'
                          if (isOpen) {
                            const links = menuContentRef.current?.querySelectorAll<HTMLAnchorElement>('a[href]')
                            links?.[edge === 'last' ? links.length - 1 : 0]?.focus({ preventScroll: true })
                            return
                          }
                          pendingMenuFocus.current = edge
                          openMenu(m.key)
                        }}
                      >
                        {pill}
                        {m.label}
                        <Chevron open={isOpen} />
                      </button>
                    ) : (
                      <a href={m.href} className={common} onMouseEnter={() => openMenu(null)}>
                        {pill}
                        {m.label}
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <WaitlistLink
                source="nav"
                onClick={closeMobile}
                className="liquid-metal-control hidden h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 text-[12px] font-medium text-white sm:px-3.5 sm:text-[13px] md:inline-flex md:h-9 [&_svg]:hidden sm:[&_svg]:block"
              />
              <button
                ref={toggleRef}
                className="flex h-10 w-9 shrink-0 items-center justify-center rounded-[8px] text-ink shadow-[0_0_0_1px_var(--line)] sm:w-10 md:hidden"
                aria-label={mobile ? 'Close menu' : 'Open menu'}
                aria-expanded={mobile}
                aria-controls="mobile-menu"
                onClick={() => { if (mobile) closeMobile(); else setMobile(true) }}
              >
                {mobile ? <X className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden /> : <MenuIcon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />}
              </button>
            </div>
          </nav>

          <AnimatePresence>
            {activeMenu?.items && (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: reduce ? 0 : 0.24, ease: EASE }}
                onMouseEnter={() => openMenu(activeMenu.key)}
                className="absolute inset-x-4 top-full mx-auto hidden max-w-[900px] pt-2 md:block"
              >
                <motion.div
                  initial={reduce ? false : { height: 0 }}
                  animate={{ height: menuHeight }}
                  exit={{ height: 0 }}
                  transition={{ duration: reduce ? 0 : 0.4, ease: EASE }}
                  className="overflow-hidden rounded-[20px] border border-white/65 bg-[#f4f7fa]/85 shadow-[0_16px_48px_-18px_rgba(18,40,60,0.25),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-2xl"
                >
                  <motion.div
                    key={activeMenu.key}
                    ref={menuContentRef}
                    id={`menu-${activeMenu.key}`}
                    role="region"
                    aria-labelledby={`nav-trigger-${activeMenu.key}`}
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: reduce ? 0 : 0.16, ease: EASE }}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(160px,24%)]"
                  >
                    <div className="grid content-start grid-cols-2 gap-1 p-3">
                      {activeMenu.items.map((item, order) => <MenuItem key={item.label} item={item} order={order} onPick={() => setOpen(null)} />)}
                    </div>
                    <NavFeature onPick={() => setOpen(null)} />
                  </motion.div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {mobile && <MobileMenu onClose={closeMobile} />}
          </AnimatePresence>
        </div>
      </motion.header>
      {/* A light scrim under the glass: taps outside the menu close it. */}
      <AnimatePresence>
        {mobile && (
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            onClick={() => {
              closeMobile()
              toggleRef.current?.focus()
            }}
            className="fixed inset-0 z-40 bg-[rgba(10,20,40,0.16)] md:hidden"
          />
        )}
      </AnimatePresence>
    </>
  )
}

/*
  The phone menu, inside the glass nav bar. The old one used the page's light glass, so the
  dark product window smeared through it in grey, and it stopped at 70% of the screen with
  the last item cut off. Now the glass is frosted harder, each menu is one row that opens in
  place so the panel stays short, it scrolls on its own if it ever gets taller than the
  screen, and the page holds still behind it.
*/
function MobileMenu({ onClose }: { onClose: () => void }) {
  const reduce = useReducedMotion()
  const present = useIsPresent()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const row = 'flex w-full items-center justify-between px-2.5 py-3.5 text-left text-[16px] font-medium tracking-[-0.01em] text-ink'
  return (
    <motion.div
      id="mobile-menu"
      inert={!present}
      initial={reduce ? false : { height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.28, ease: EASE }}
      className="overflow-hidden md:hidden"
    >
      <div data-lenis-prevent className="max-h-[calc(100dvh-84px)] overflow-y-auto overscroll-contain border-t border-line px-2 pb-3 pt-1">
        <ul>
          {MENUS.map((m) => {
            const isOpen = openKey === m.key
            return (
              <li key={m.key} className="border-b border-line last:border-b-0">
                {m.items ? (
                  <>
                    <button className={row} aria-expanded={isOpen} aria-controls={`mm-${m.key}`} onClick={() => setOpenKey(isOpen ? null : m.key)}>
                      {m.label}
                      <Chevron open={isOpen} className="h-3.5 w-3.5" />
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          id={`mm-${m.key}`}
                          initial={reduce ? false : { height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: reduce ? 0 : 0.24, ease: EASE }}
                          className="overflow-hidden"
                        >
                          <div className="pb-2">
                            {/* an item that is also a top-level row (Marketplace) shows only once */}
                            {m.items
                              .filter((it) => !MENUS.some((x) => x.href === it.href))
                              .map((it, order) => (
                                <MenuItem key={it.label} item={it} compact order={order} onPick={onClose} />
                              ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                ) : (
                  <a href={m.href} onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) onClose() }} className={row}>
                    {m.label}
                    <ChevronRight className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.75} aria-hidden />
                  </a>
                )}
              </li>
            )
          })}
        </ul>
        <WaitlistLink source="nav" onClick={onClose} className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-btn text-[14px] font-medium text-btn-ink transition-colors hover:bg-[#262626]" />
      </div>
    </motion.div>
  )
}
