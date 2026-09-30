/*
  Session replays through PostHog, configured for replays only: its own analytics,
  autocapture, heatmaps, surveys and feature flags are off because the site's first-party
  analytics already cover them. Every form field is masked. Inactive until
  VITE_POSTHOG_KEY is set, and never runs locally, inside the dashboard's page overlay,
  for the team's own browsers (?internal=1), or when the visitor opted out or sends
  Global Privacy Control.
*/
import { analyticsIds, isFramed } from './analytics'
import { adTrackingAllowed } from './x-pixel'

const KEY = import.meta.env.VITE_POSTHOG_KEY?.trim() ?? ''
const HOST = import.meta.env.VITE_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com'

function localHost(hostname: string) {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || /^127(?:\.\d{1,3}){3}$/.test(hostname) || hostname === '[::1]'
}

function internal() {
  try { return localStorage.getItem('openswarm:internal') === '1' } catch { return false }
}

export function startReplays() {
  if (!KEY || typeof window === 'undefined' || import.meta.env.DEV) return
  if (localHost(window.location.hostname) || isFramed() || internal() || !adTrackingAllowed()) return
  // Load after the page is interactive so recording never delays the first paint.
  const load = () => void import('posthog-js').then(({ default: posthog }) => {
    posthog.init(KEY, {
      api_host: HOST,
      persistence: 'localStorage',
      person_profiles: 'never',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      disable_surveys: true,
      advanced_disable_feature_flags: true,
      enable_recording_console_log: false,
      session_recording: { maskAllInputs: true },
    })
    // Lets a replay be matched to the same visit in the dashboard.
    const { visitorId, sessionId } = analyticsIds()
    posthog.register({ openswarm_visitor: visitorId, openswarm_session: sessionId })
  }).catch(() => { /* Replays are optional. */ })
  if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 4_000 })
  else setTimeout(load, 2_000)
}
