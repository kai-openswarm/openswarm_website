/*
  Meta (Facebook and Instagram) pixel. Off until VITE_META_PIXEL_ID is set. Sends page
  views and a Lead event for each new waitlist signup; the server sends the same Lead
  through Meta's Conversions API with the same event id, so Meta counts it once even
  when an ad blocker stops this script. Same opt-outs as the X pixel.
*/
import { adScriptsAllowed, adTrackingAllowed } from './x-pixel'

const PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID?.trim() ?? ''

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void, queue: unknown[], push?: unknown, loaded?: boolean, version?: string }
type MetaWindow = Window & { fbq?: Fbq, _fbq?: Fbq }

let installed = false

export function installMetaPixel() {
  if (installed || !PIXEL_ID || !/^\d{5,20}$/.test(PIXEL_ID) || !adScriptsAllowed()) return
  installed = true
  const win = window as MetaWindow
  if (!win.fbq) {
    // Meta's standard loader: queue calls until fbevents.js arrives.
    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args)
      else fbq.queue.push(args)
    } as Fbq
    fbq.queue = []
    fbq.push = fbq
    fbq.loaded = true
    fbq.version = '2.0'
    win.fbq = fbq
    win._fbq ??= fbq
    const script = document.createElement('script')
    script.async = true
    script.src = 'https://connect.facebook.net/en_US/fbevents.js'
    document.head.appendChild(script)
  }
  win.fbq!('init', PIXEL_ID)
  win.fbq!('track', 'PageView')
}

/** Reports a new waitlist signup. eventId matches the server's Conversions API event. */
export function trackMetaLead(eventId: string) {
  if (!installed || !adTrackingAllowed()) return
  ;(window as MetaWindow).fbq?.('track', 'Lead', { content_name: 'waitlist' }, { eventID: eventId })
}
