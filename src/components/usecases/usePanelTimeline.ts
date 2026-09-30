import { useRef, type RefObject } from 'react'
import { useTimeline } from '../os/kit'

/** App previews use an exact scene frame and stop the live clock until replayed. */
export function usePanelTimeline(loop: number, ref: RefObject<HTMLDivElement | null>, rest: number, previewTime?: number) {
  const pausedRef = useRef<HTMLDivElement>(null)
  const clock = useTimeline(loop, previewTime === undefined ? ref : pausedRef, rest)
  return previewTime ?? clock
}
