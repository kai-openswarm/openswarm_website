import { useEffect, useRef, type ComponentType } from 'react'
import {
  Activity, Filter, FlaskConical, Gauge, Layers, LayoutDashboard, LogOut, Mail, MousePointerClick, Settings as SettingsIcon, Share2, Signpost, UserPlus, Users,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useRoute, type Page } from './nav'
import { useView } from './hooks'
import { CompareSelect, DateRangePicker, FilterChips, RefreshButton } from './Toolbar'
import { DATA_CAVEATS } from './definitions'
import { EmailPage } from './pages/Email'
import { OverlayPage } from './pages/Overlay'
import { Overview } from './pages/Overview'
import { Realtime } from './pages/Realtime'
import { Traffic } from './pages/Traffic'
import { Audience } from './pages/Audience'
import { Behavior } from './pages/Behavior'
import { FunnelPage } from './pages/Funnel'
import { ExperimentsPage } from './pages/Experiments'
import { Signups } from './pages/Signups'
import { ReferralsPage } from './pages/Referrals'
import { PerformancePage } from './pages/Performance'
import { SettingsPage } from './pages/Settings'

interface PageDef {
  id: Page
  label: string
  icon: ComponentType<{ className?: string }>
  description: string
  /** full = range + filters; range = range only; none = no toolbar */
  toolbar: 'full' | 'range' | 'none'
  Component: ComponentType
}

const NAV: PageDef[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, description: 'Traffic and signups at a glance.', toolbar: 'full', Component: Overview },
  { id: 'realtime', label: 'Real-time', icon: Activity, description: 'Who is on the site right now. Refreshes every 15 seconds.', toolbar: 'none', Component: Realtime },
  { id: 'traffic', label: 'Traffic', icon: Signpost, description: 'Where visitors come from.', toolbar: 'full', Component: Traffic },
  { id: 'audience', label: 'Audience', icon: Users, description: 'Who the visitors are.', toolbar: 'full', Component: Audience },
  { id: 'behavior', label: 'Behavior', icon: MousePointerClick, description: 'What visitors see and do on the page.', toolbar: 'full', Component: Behavior },
  { id: 'overlay', label: 'Page overlay', icon: Layers, description: 'Where on the landing page visitors leave, scroll to and click, drawn on the page itself.', toolbar: 'full', Component: OverlayPage },
  { id: 'funnel', label: 'Funnel', icon: Filter, description: 'From first visit to joining and sharing.', toolbar: 'full', Component: FunnelPage },
  { id: 'experiments', label: 'Experiments', icon: FlaskConical, description: 'A/B tests: signup rate by variant, and links that send each ad to its matching headline.', toolbar: 'range', Component: ExperimentsPage },
  { id: 'signups', label: 'Signups', icon: UserPlus, description: 'Everyone who joined the waitlist in this range.', toolbar: 'range', Component: Signups },
  { id: 'email', label: 'Email', icon: Mail, description: 'Welcome email delivery, unsubscribes and signup email domains.', toolbar: 'range', Component: EmailPage },
  { id: 'referrals', label: 'Referrals', icon: Share2, description: 'Invite links and who is spreading the word.', toolbar: 'range', Component: ReferralsPage },
  { id: 'performance', label: 'Performance', icon: Gauge, description: 'Core Web Vitals and JavaScript errors from real visits.', toolbar: 'full', Component: PerformancePage },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, description: 'Waitlist counter, internal traffic, email signup, annotations, admins and audit log.', toolbar: 'none', Component: SettingsPage },
]

export function Shell({ email, mock, onSignOut }: { email: string; mock: boolean; onSignOut: () => void }) {
  const { page, go } = useRoute()
  const { filters, clearFilters } = useView()
  const def = NAV.find((n) => n.id === page) ?? NAV[0]
  const heading = useRef<HTMLHeadingElement>(null)
  const mobileNav = useRef<HTMLElement>(null)
  const shownPage = useRef(def.id)

  useEffect(() => {
    document.title = `${def.label} · OpenSwarm Admin`
    if (shownPage.current === def.id) return
    shownPage.current = def.id
    // Move focus to the new page's heading for keyboard and screen reader users.
    heading.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
    mobileNav.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [def])

  const hasFilters = Object.keys(filters).length > 0

  // Esc clears filters (R4), unless a dialog, popover or text field is handling it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !hasFilters || def.toolbar !== 'full') return
      const t = e.target instanceof Element ? e.target : null
      if (t?.closest('input, textarea, select, dialog, [role="dialog"]') || document.querySelector('dialog[open]')) return
      clearFilters()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [hasFilters, def.toolbar, clearFilters])
  const Page = def.Component

  const navLink = (n: PageDef, compact: boolean) => {
    const Icon = n.icon
    const active = n.id === def.id
    return (
      <a
        key={n.id}
        href={`#/${n.id}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return
          e.preventDefault()
          go(n.id)
        }}
        aria-current={active ? 'page' : undefined}
        className={clsx(
          'flex shrink-0 items-center gap-2.5 rounded-md font-medium whitespace-nowrap transition-colors',
          compact ? 'h-8 px-2.5 text-[13px]' : 'h-8 px-2.5 text-[13.5px]',
          active ? 'bg-btn text-btn-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
        )}
      >
        <Icon className={clsx('size-4 shrink-0', compact && 'hidden')} aria-hidden />
        {n.label}
      </a>
    )
  }

  return (
    <div className="min-h-svh lg:flex">
      <a href="#main" onClick={(e) => { e.preventDefault(); heading.current?.focus() }} className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-panel focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-svh w-[224px] shrink-0 flex-col border-r border-line bg-panel lg:flex">
        <div className="flex h-14 items-center gap-2 px-4">
          <img src="../favicon.png" alt="" className="size-6 rounded" />
          <span className="text-[14px] font-semibold">OpenSwarm</span>
          <span className="text-[13px] text-ink-3">Admin</span>
        </div>
        <nav aria-label="Dashboard" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-2">
          {NAV.map((n) => navLink(n, false))}
        </nav>
        <div className="border-t border-line p-3">
          {mock && <p className="mb-2 rounded bg-accent-soft px-2 py-1 text-[11.5px] font-medium text-accent">Mock data (development)</p>}
          <p className="truncate px-1 text-[12px] text-ink-3" title={email}>{email}</p>
          <button type="button" onClick={onSignOut} className="mt-1 flex h-8 w-full items-center gap-2 rounded-md px-1 text-[13px] text-ink-2 hover:bg-hover hover:text-ink">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile header + scrollable tabs */}
      <header className="sticky top-0 z-20 border-b border-line bg-panel lg:hidden">
        <div className="flex h-12 items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <img src="../favicon.png" alt="" className="size-5 rounded" />
            <span className="truncate text-[14px] font-semibold">OpenSwarm Admin</span>
            {mock && <span className="rounded bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent">Mock</span>}
          </div>
          <button type="button" onClick={onSignOut} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-2 hover:bg-hover" aria-label={`Sign out ${email}`}>
            <LogOut className="size-4" aria-hidden /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
        <nav ref={mobileNav} aria-label="Dashboard" className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-2">
          {NAV.map((n) => navLink(n, true))}
        </nav>
      </header>

      <div className="min-w-0 flex-1">
        <main id="main" className="mx-auto w-full max-w-[1280px] px-4 pt-5 pb-16 sm:px-6 lg:px-8 lg:pt-7">
          <div className="mb-4 flex flex-col gap-3">
            <div>
              <h1 ref={heading} tabIndex={-1} className="text-[20px] font-semibold tracking-tight outline-none">{def.label}</h1>
              <p className="mt-0.5 text-[13px] text-ink-3">{def.description}</p>
            </div>
            {def.toolbar !== 'none' && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <DateRangePicker />
                  {def.id === 'overview' && <CompareSelect />}
                  <RefreshButton />
                </div>
                {def.toolbar === 'full' ? (
                  <FilterChips />
                ) : hasFilters ? (
                  <p className="text-[12px] text-ink-3">Filters don’t apply to this page.</p>
                ) : null}
              </div>
            )}
            {def.toolbar === 'none' && def.id !== 'settings' && <div><RefreshButton /></div>}
          </div>
          <Page key={def.id} />
          {def.id !== 'settings' && (
            <footer className="mt-8 border-t border-line pt-3 text-[12px] text-ink-3">
              <p className="font-medium text-ink-2">About this data</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {DATA_CAVEATS.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </footer>
          )}
        </main>
      </div>
    </div>
  )
}
