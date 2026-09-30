import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, LoaderCircle, Share2, X } from 'lucide-react'
import { AntiMetalButton } from './anti-metal-button'
import { Button1 } from './button-1'
import { cn, media } from '@/lib/utils'
import { clearSavedReferralCode, parseReferral, referralLink, savedReferralCode, type Referral } from '@/lib/referral'
import './waitlist-referral.css'
import { track } from '@/lib/analytics'

export const OPEN_REFERRAL_EVENT = 'os:share-waitlist'

/** Paired with the dialog hosted by the hero WaitlistForm. */
export function WaitlistShareButton({ className, onClick, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} type="button" className={cn('waitlist-share-trigger', className)} onClick={(event) => {
      onClick?.(event)
      if (!event.defaultPrevented) window.dispatchEvent(new CustomEvent(OPEN_REFERRAL_EVENT))
    }}>
      <Share2 size={14} strokeWidth={1.7} aria-hidden />
      {children ?? 'Share'}
    </button>
  )
}

export function WaitlistReferralDialog({ initialReferral, justJoined, onClose, onJoin }: {
  initialReferral: Referral | null
  justJoined: boolean
  onClose: () => void
  onJoin: () => void
}) {
  const [referral, setReferral] = useState(initialReferral)
  const [loading, setLoading] = useState(!initialReferral && !!savedReferralCode())
  const [loadError, setLoadError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [copied, setCopied] = useState(false)
  const [nativeShare] = useState(() => typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  const [retry, setRetry] = useState(0)
  const [invalidCode, setInvalidCode] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const linkInput = useRef<HTMLInputElement>(null)
  const copyReset = useRef<number | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const candidateCode = initialReferral?.code ?? savedReferralCode()
  const code = candidateCode === invalidCode ? null : candidateCode
  const link = referral ? referralLink(referral.code) : ''

  // Once per opening; how the dialog was opened does not re-trigger it.
  const openedAfterJoin = useRef(justJoined)
  useEffect(() => {
    track('referral_open', { just_joined: openedAfterJoin.current })
  }, [])

  useEffect(() => {
    const node = dialog.current
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    node?.showModal()
    document.body.style.overflow = 'hidden'
    heading.current?.focus({ preventScroll: true })
    return () => {
      if (copyReset.current !== null) window.clearTimeout(copyReset.current)
      node?.close()
      document.body.style.overflow = previousOverflow
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true })
      else document.getElementById('waitlist-success')?.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (!code) return
    let request: AbortController | null = null
    let timeout: number | null = null
    let disposed = false
    async function refresh() {
      request?.abort()
      if (timeout !== null) window.clearTimeout(timeout)
      const controller = new AbortController()
      request = controller
      timeout = window.setTimeout(() => controller.abort(), 10000)
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}api/waitlist/referral?code=${encodeURIComponent(code!)}`, { signal: controller.signal, cache: 'no-store' })
        if (disposed || request !== controller) return
        if (response.status === 404) {
          clearSavedReferralCode(code!)
          setInvalidCode(code)
          setReferral(null)
          setLoadError('')
          setFeedback('')
          setCopied(false)
          return
        }
        const result = parseReferral(await response.json())
        if (disposed || request !== controller) return
        if (!response.ok || !result) throw new Error('Progress unavailable')
        setReferral(result)
        setLoadError('')
      } catch {
        if (disposed || request !== controller) return
        setLoadError('Couldn’t refresh your invites. Try again.')
      } finally {
        if (!disposed && request === controller) setLoading(false)
        if (request === controller && timeout !== null) window.clearTimeout(timeout)
      }
    }
    void refresh()
    const visibility = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      disposed = true
      request?.abort()
      if (timeout !== null) window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [code, retry])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      track('referral_copy', { channel: 'copy' })
      setCopied(true)
      setFeedback('Invite link copied.')
      if (copyReset.current !== null) window.clearTimeout(copyReset.current)
      copyReset.current = window.setTimeout(() => { setCopied(false); setFeedback('') }, 3000)
    } catch {
      linkInput.current?.focus()
      linkInput.current?.select()
      setFeedback('Select and copy your invite link above.')
    }
  }

  async function shareLink() {
    try {
      await navigator.share({ title: 'Everyone gets a Jarvis now.', text: 'Join me on the free OpenSwarm waitlist. Your free AI desktop for Mac.', url: link })
      track('referral_share', { channel: 'native' })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      await copyLink()
    }
  }

  return createPortal(
    <dialog ref={dialog} className="waitlist-referral-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} data-lenis-prevent onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="waitlist-referral-card">
        <div className="waitlist-referral-art" aria-hidden><img src={media('footer-cobalt-coast.webp')} alt="" width="1612" height="976" /></div>
        <button type="button" className="waitlist-referral-close" aria-label="Close invitation" onClick={onClose}><X size={18} strokeWidth={1.6} aria-hidden /></button>
        <div className="waitlist-referral-header">
          <div className="waitlist-referral-brand"><img src={media('logo-256.png')} alt="" width="21" height="21" aria-hidden /><span>OpenSwarm</span></div>
          <h2 id={titleId} ref={heading} tabIndex={-1}>{referral?.priorityAccess ? 'Priority access unlocked.' : justJoined && !invalidCode ? 'You’re on the list.' : 'Invite friends. Get early access.'}</h2>
        </div>
        <div className="waitlist-referral-body">
        <p id={descriptionId} className="waitlist-referral-description">
          {justJoined && !invalidCode && <span className="waitlist-referral-next-step">We’ll email you when early access opens.</span>}
          {referral?.priorityAccess ? 'Three friends joined through your link. You’ve unlocked priority early access.' : 'Invite 3 friends who join the waitlist to unlock priority early access. OpenSwarm is 100% free.'}
        </p>

        {loading ? <div className="waitlist-referral-loading" role="status"><LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden /> Getting your invite link…</div> : referral ? (
          <>
            <div className="waitlist-referral-progress" aria-label={`${Math.min(referral.count, referral.goal)} of ${referral.goal} friends joined`}>
              <div className="waitlist-referral-steps" aria-hidden>{[1, 2, 3].map((step) => <span key={step} data-complete={referral.count >= step} />)}</div>
              <span className="waitlist-referral-progress-copy">{Math.min(referral.count, referral.goal)} of {referral.goal} friends joined</span>
            </div>
            <label className="waitlist-referral-link-label" htmlFor={`${titleId}-link`}>Your personal invite link</label>
            <div className="waitlist-referral-link"><input ref={linkInput} id={`${titleId}-link`} value={link} readOnly spellCheck={false} onFocus={(event) => event.currentTarget.select()} /><button type="button" aria-label={copied ? 'Invite link copied' : 'Copy invite link'} onClick={() => void copyLink()}>{copied ? <Check size={17} strokeWidth={1.7} /> : <Copy size={17} strokeWidth={1.7} />}</button></div>
            <div className="waitlist-referral-actions">
              <AntiMetalButton onClick={() => void (nativeShare ? shareLink() : copyLink())} className="w-full">{nativeShare ? <><Share2 size={15} aria-hidden />Share invite</> : <>{copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}{copied ? 'Copied' : 'Copy invite link'}</>}</AntiMetalButton>
            </div>
            <p className="waitlist-referral-note">Your count updates when a new friend signs up.</p>
          </>
        ) : !code ? (
          <div className="waitlist-referral-actions">
            <Button1 className="w-full" onClick={onJoin}>Get my invite link</Button1>
            <p className="waitlist-referral-note">Already joined? Use the same email to get your link.</p>
          </div>
        ) : null}
        {loadError && <p role="status" className="waitlist-referral-error">{loadError} <button type="button" onClick={() => { setLoading(!referral); setLoadError(''); setRetry((value) => value + 1) }}>Retry</button>{!referral && <button type="button" onClick={onJoin}>Use your email address</button>}</p>}
        <p className="waitlist-referral-feedback" role="status" aria-live="polite">{feedback}</p>
        </div>
      </div>
    </dialog>, document.body,
  )
}
