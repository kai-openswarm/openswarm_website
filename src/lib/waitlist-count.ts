import { useEffect, useState } from 'react'

/** Shown until the live count loads, and if it cannot load. The live value is never lower. */
export const FALLBACK_WAITLIST_COUNT = 6327
/** Dispatched after a new signup so the visitor sees themselves counted immediately. */
export const WAITLIST_JOINED_EVENT = 'os:waitlist-joined'

/** The public waitlist size: an admin-set baseline plus real signups, cached by the server. */
export function useWaitlistCount() {
  const [count, setCount] = useState(FALLBACK_WAITLIST_COUNT)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}api/stats`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result: unknown) => {
        const value = result && typeof result === 'object' && 'count' in result ? result.count : null
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) setCount(value)
      })
      .catch(() => { /* Keep the fallback. */ })
    const joined = () => setCount((value) => value + 1)
    window.addEventListener(WAITLIST_JOINED_EVENT, joined)
    return () => {
      controller.abort()
      window.removeEventListener(WAITLIST_JOINED_EVENT, joined)
    }
  }, [])
  return count
}
