// Global manual refresh (R7): bumping the nonce refetches every query on screen,
// and the time of the latest successful load drives "updated Xs ago".
import { useSyncExternalStore } from 'react'

let nonce = 0
let lastLoaded = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function bumpRefresh() {
  nonce++
  emit()
}

export function markLoaded() {
  lastLoaded = Date.now()
  emit()
}

export const useRefreshNonce = () => useSyncExternalStore(subscribe, () => nonce)
export const useLastLoaded = () => useSyncExternalStore(subscribe, () => lastLoaded)
