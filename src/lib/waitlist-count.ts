import { useEffect, useState } from 'react'

/** Shown until the live count loads, and if it cannot load. The live value is never lower. */
export const FALLBACK_WAITLIST_COUNT = 6327
/** Dispatched after a new signup so the visitor sees themselves counted immediately. */
export const WAITLIST_JOINED_EVENT = 'os:waitlist-joined'

export type WaitlistStats = { count: number, signupsOpen: boolean, closedMessage?: string }

let request: Promise<WaitlistStats | null> | null = null

/** One shared request per page: the public count and whether signups are open (admin setting). */
function loadStats() {
  request ??= fetch(`${import.meta.env.BASE_URL}api/stats`)
    .then((response) => response.ok ? response.json() : null)
    .then((result: unknown) => {
      if (!result || typeof result !== 'object') return null
      const { count, signupsOpen, closedMessage } = result as Record<string, unknown>
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null
      return {
        count,
        signupsOpen: signupsOpen !== false,
        ...(typeof closedMessage === 'string' && closedMessage ? { closedMessage: closedMessage.slice(0, 200) } : {}),
      }
    })
    .catch(() => null)
  return request
}

export function useWaitlistStats() {
  const [stats, setStats] = useState<WaitlistStats>({ count: FALLBACK_WAITLIST_COUNT, signupsOpen: true })
  useEffect(() => {
    let active = true
    void loadStats().then((loaded) => { if (active && loaded) setStats((current) => ({ ...loaded, count: Math.max(loaded.count, current.count) })) })
    const joined = () => setStats((current) => ({ ...current, count: current.count + 1 }))
    window.addEventListener(WAITLIST_JOINED_EVENT, joined)
    return () => {
      active = false
      window.removeEventListener(WAITLIST_JOINED_EVENT, joined)
    }
  }, [])
  return stats
}

/** The public waitlist size: an admin-set baseline plus real signups, cached by the server. */
export function useWaitlistCount() {
  return useWaitlistStats().count
}
