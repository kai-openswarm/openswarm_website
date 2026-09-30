import { useEffect } from 'react'
import Lenis from 'lenis'
import { MotionConfig } from 'motion/react'
import { setLenis } from './lib/scroll'
import { installXPixel } from './lib/x-pixel'
import { startAnalytics } from './lib/analytics'
import { startReplays } from './lib/replay'
import { Nav } from './components/Nav'
import { Hero } from './components/Hero'
import { Intro } from './components/Intro'
import { Capabilities } from './components/Capabilities'
import { UseCases } from './components/UseCases'
import { Marketplace } from './components/Marketplace'
import { Closing } from './components/Closing'
import { Seam } from './components/ui/Seam'

export default function App() {
  useEffect(() => {
    startAnalytics()
    installXPixel()
    startReplays()
  }, [])

  useEffect(() => {
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    // Handle anchors here so modified clicks keep their native behavior and every
    // destination uses the same header offset, with or without smooth scrolling.
    const lenis = motionPreference.matches ? null : new Lenis({ duration: 1.1, smoothWheel: true, anchors: false })
    setLenis(lenis)
    let raf = 0
    const loop = (t: number) => {
      lenis?.raf(t)
      raf = requestAnimationFrame(loop)
    }
    if (lenis) raf = requestAnimationFrame(loop)

    const resolveTarget = (hash: string) => {
      let targetId: string
      try {
        targetId = decodeURIComponent(hash.slice(1))
      } catch {
        return null
      }
      return document.getElementById(targetId)
    }
    const scrollToTarget = (target: HTMLElement, immediate = false) => {
      const scrollMargin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0
      const offset = Math.max(88, scrollMargin)
      // Passing a number avoids Lenis subtracting the target's scroll margin twice.
      const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset)
      if (lenis) {
        lenis.resize()
        lenis.scrollTo(top, { immediate: immediate || motionPreference.matches })
      } else {
        window.scrollTo({ top, behavior: 'instant' })
      }
    }
    const onAnchorClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.composedPath().find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement)
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
      const url = new URL(link.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || url.search !== window.location.search || !url.hash) return
      const target = resolveTarget(url.hash)
      if (!target) return
      event.preventDefault()
      if (window.location.hash !== url.hash) window.history.pushState(window.history.state, '', url)
      // WaitlistLink already focuses its input/success state. Other destinations
      // become the keyboard starting point instead of leaving focus in a closed menu.
      if (!target.contains(document.activeElement)) {
        if (!target.matches('a[href],button,input,select,textarea,[tabindex]')) target.tabIndex = -1
        target.focus({ preventScroll: true })
      }
      scrollToTarget(target)
    }

    // The browser can resolve the initial fragment before React mounts its target.
    // Retry after layout, and apply the same offset on Back/Forward hash navigation.
    let hashFrame = 0
    const syncHash = () => {
      cancelAnimationFrame(hashFrame)
      const hash = window.location.hash
      if (!hash) return
      hashFrame = requestAnimationFrame(() => {
        if (window.location.hash !== hash) return
        const target = resolveTarget(hash)
        if (target) scrollToTarget(target, true)
      })
    }
    syncHash()
    document.addEventListener('click', onAnchorClick)
    window.addEventListener('hashchange', syncHash)

    return () => {
      cancelAnimationFrame(raf)
      cancelAnimationFrame(hashFrame)
      document.removeEventListener('click', onAnchorClick)
      window.removeEventListener('hashchange', syncHash)
      setLenis(null)
      lenis?.destroy()
    }
  }, [])

  // reducedMotion "user": with the OS setting on, motion drops transform and layout
  // animations (the header slide, the tab pills) the way the rest of the page already does
  return (
    <MotionConfig reducedMotion="user">
      <Nav />
      <main className="relative">
        <Hero />
        {/* Intro, what agents do, teams, marketplace, then one illustrated ending.
            Two guide lines run the length of the column and every
            seam meets them at a crosshair. */}
        <div className="relative">
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 z-0 hidden w-[calc(100%-64px)] max-w-[1240px] -translate-x-1/2 border-x border-line lg:block" />
          <div className="relative z-[1]">
            <Intro />
            <Seam />
            <Capabilities />
            <Seam />
            <UseCases />
            <Seam />
            <Marketplace />
            <Seam />
          </div>
        </div>
        <Closing />
      </main>
    </MotionConfig>
  )
}
