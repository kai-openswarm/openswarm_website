import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, LoaderCircle } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { LiquidGlassInput } from './LiquidGlassInput'
import { LiquidMetalButton } from './LiquidMetalButton'
import { RollText } from './RollText'
import { SuccessParticles } from './particle-button'
import { OPEN_REFERRAL_EVENT, WaitlistReferralDialog, WaitlistShareButton } from './WaitlistReferral'
import { normalizeEmail } from '@/lib/email'
import { incomingReferralCode, parseReferral, saveReferralCode, type Referral } from '@/lib/referral'
import { LINKS } from '@/lib/utils'
import { analyticsIds, flush, track } from '@/lib/analytics'
import { trackXSignup } from '@/lib/x-pixel'
import { prepareTurnstile, turnstileToken } from '@/lib/turnstile'
import { WAITLIST_JOINED_EVENT } from '@/lib/waitlist-count'

/** Stored with each signup. Change it whenever the wording under the form changes. */
const CONSENT_VERSION = 'email-2026-09-30'

export function WaitlistForm({ placement }: { placement: 'hero' | 'closing' }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle')
  const [referral, setReferral] = useState<Referral | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const success = useRef<HTMLDivElement>(null)
  const pending = useRef(false)
  const activeRequest = useRef<{ controller: AbortController; timeout: number } | null>(null)
  const restoreInputFocus = useRef(false)
  const reducedMotion = useReducedMotion()
  const source = useRef<string>(placement)
  const started = useRef(false)
  const container = useRef<HTMLDivElement>(null)
  const id = placement === 'hero' ? 'waitlist-email' : 'waitlist-closing-email'

  useEffect(() => {
    if (placement !== 'hero') return
    incomingReferralCode()
    const pick = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail
      if (typeof detail === 'string') source.current = detail
    }
    const share = () => setDialogOpen(true)
    window.addEventListener('os:waitlist', pick)
    window.addEventListener(OPEN_REFERRAL_EVENT, share)
    return () => {
      window.removeEventListener('os:waitlist', pick)
      window.removeEventListener(OPEN_REFERRAL_EVENT, share)
    }
  }, [placement])

  useEffect(() => {
    const node = container.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      track('waitlist_view', { placement })
      observer.disconnect()
    }, { threshold: 0.5 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [placement])

  useEffect(() => {
    if (status === 'success' && !dialogOpen) success.current?.focus({ preventScroll: true })
    if (status === 'idle' && restoreInputFocus.current) {
      restoreInputFocus.current = false
      input.current?.focus({ preventScroll: true })
    }
  }, [status, dialogOpen])

  useEffect(() => () => {
    const request = activeRequest.current
    activeRequest.current = null
    request?.controller.abort()
    if (request) window.clearTimeout(request.timeout)
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current) return
    const normalized = normalizeEmail(email)
    if (!normalized) {
      track('waitlist_error', { code: email.trim() ? 'invalid_email' : 'empty' })
      setError('Enter a valid email address.')
      input.current?.focus({ preventScroll: true })
      return
    }
    pending.current = true
    setError('')
    setStatus('submitting')
    const invitedBy = incomingReferralCode()
    track('waitlist_submit', { placement, source: source.current, invited: !!invitedBy })
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12000)
    const request = { controller, timeout }
    activeRequest.current = request
    try {
      const verification = await turnstileToken()
      if (activeRequest.current !== request) return
      const response = await fetch(`${import.meta.env.BASE_URL}api/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalized,
          source: source.current,
          referralCode: invitedBy,
          consentVersion: CONSENT_VERSION,
          turnstileToken: verification,
          ...analyticsIds(),
        }),
        signal: controller.signal,
      })
      const result: unknown = await response.json()
      if (activeRequest.current !== request) return
      if (!response.ok || !result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
        track('waitlist_fail', { placement, status: String(response.status) })
        throw new Error(response.status === 429 ? 'rate_limited' : 'Signup unavailable')
      }
      const added = response.status === 201
      track('waitlist_success', { placement, source: source.current, added, invited: !!invitedBy })
      flush()
      if (added) {
        trackXSignup()
        window.dispatchEvent(new Event(WAITLIST_JOINED_EVENT))
      }
      const personalReferral = parseReferral(result)
      if (personalReferral) {
        saveReferralCode(personalReferral.code)
        setReferral(personalReferral)
      }
      setEmail('')
      setStatus('success')
      setDialogOpen(true)
    } catch (failure) {
      if (activeRequest.current !== request) return
      setStatus('idle')
      setError(failure instanceof Error && failure.message === 'rate_limited' ? 'Too many attempts. Wait a few minutes and try again.' : 'Couldn’t join. Try again.')
    } finally {
      pending.current = false
      window.clearTimeout(timeout)
      if (activeRequest.current === request) activeRequest.current = null
    }
  }

  return (
    <div ref={container} id={placement === 'hero' ? 'waitlist' : 'waitlist-closing'} className="waitlist relative mx-auto h-11 w-full max-w-[410px] scroll-mt-28">
      {status === 'success' ? (
        <motion.div id={placement === 'hero' ? 'waitlist-success' : 'waitlist-closing-success'} ref={success} tabIndex={-1} role="status" initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }} className="waitlist-success flex h-11 items-center justify-center gap-2 rounded-[8px] px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-4">
          <SuccessParticles active className="h-6 w-6 rounded-full bg-white/75 ring-1 ring-black/10">
            <motion.span initial={reducedMotion ? false : { scale: 0.65, rotate: -18 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', visualDuration: 0.24, bounce: 0.22 }}>
              <Check size={16} strokeWidth={2} aria-hidden />
            </motion.span>
          </SuccessParticles>
          <motion.span className="font-medium" initial={reducedMotion ? false : { opacity: 0, x: -3 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, delay: 0.04 }}>You’re in.</motion.span>
          <WaitlistShareButton className="ml-auto" onClick={(event) => { event.preventDefault(); setDialogOpen(true) }}>Invite friends</WaitlistShareButton>
          <div className="absolute inset-x-0 top-full mt-2 text-center text-[10.5px] leading-[1.4] text-ink/65">
            <p>We’ll email you when early access opens.</p>
            <button type="button" aria-label="Join with another email address" className="mt-0.5 underline decoration-black/25 underline-offset-2 hover:text-ink" onClick={() => { restoreInputFocus.current = true; setStatus('idle'); setError('') }}>Another email</button>
          </div>
        </motion.div>
      ) : (
        <form onSubmit={submit} noValidate aria-label="Join the Open Swarm waitlist" aria-busy={status === 'submitting'} className="group/form grid h-11 grid-cols-[minmax(0,1fr)_auto] gap-2.5">
          <label htmlFor={id} className="sr-only">Email address</label>
            <LiquidGlassInput
              ref={input}
              id={id}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Your email"
              value={email}
              maxLength={254}
              required
              disabled={status === 'submitting'}
              aria-invalid={!!error}
              aria-describedby={`${id}-hint ${id}-consent${error ? ` ${id}-error` : ''}`}
              onFocus={() => {
                prepareTurnstile()
                if (started.current) return
                started.current = true
                track('waitlist_start', { placement })
              }}
              onChange={(event) => { setEmail(event.target.value); if (error) setError('') }}
            />
          <LiquidMetalButton type="submit" disabled={status === 'submitting'} className="relative disabled:cursor-wait disabled:opacity-75">
            <span className={status === 'submitting' ? 'invisible flex items-center gap-2' : 'flex items-center gap-2'} aria-hidden={status === 'submitting' || undefined}><RollText>Join free waitlist</RollText><ArrowRight size={20} strokeWidth={1.8} aria-hidden className="liquid-action-arrow hidden min-[440px]:block" /></span>
            {status === 'submitting' && <span className="absolute inset-0 flex items-center justify-center gap-2" role="status"><LoaderCircle size={15} strokeWidth={1.75} aria-hidden className="motion-safe:animate-spin" /><span>Joining…</span></span>}
          </LiquidMetalButton>
          <div className="absolute inset-x-0 top-full mt-2 text-center text-[10.5px] leading-[1.4]">
            {error && <p id={`${id}-error`} role="alert" className="text-[#9f2424]">{error}</p>}
            <p id={`${id}-consent`} className={error ? 'sr-only' : 'text-ink/65'}>
              Early-access updates by email. Unsubscribe anytime.
              {' '}<a href={LINKS.privacy} className="underline decoration-black/25 underline-offset-2 hover:text-ink">Privacy</a>
              {' · '}<a href={LINKS.terms} className="underline decoration-black/25 underline-offset-2 hover:text-ink">Terms</a>
            </p>
            <p id={`${id}-hint`} className="sr-only">Enter your email address to receive early-access updates.</p>
            {!error && <p className="mt-0.5 text-ink/70 opacity-0 transition-opacity group-focus-within/form:opacity-100">Just launch updates. No spam.</p>}
          </div>
        </form>
      )}
      {dialogOpen && <WaitlistReferralDialog initialReferral={referral} justJoined={status === 'success'} onClose={() => setDialogOpen(false)} onJoin={() => {
        restoreInputFocus.current = true
        setDialogOpen(false)
        setStatus('idle')
        setError('')
        document.getElementById(placement === 'hero' ? 'waitlist' : 'waitlist-closing')?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'instant' : 'smooth' })
      }} />}
    </div>
  )
}
