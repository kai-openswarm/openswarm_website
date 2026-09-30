import { AD_OPT_OUT_KEY } from '../lib/x-pixel'

/* "Your privacy choices": turns the X advertising pixel off (or back on) for this browser. */
const status = document.getElementById('choice-status')
const optOut = document.getElementById('opt-out')
const optIn = document.getElementById('opt-in')
const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true

function read() {
  try { return localStorage.getItem(AD_OPT_OUT_KEY) === '1' } catch { return false }
}

function render(message = '') {
  const optedOut = gpc || read()
  if (optOut) optOut.hidden = optedOut
  if (optIn) optIn.hidden = !optedOut || gpc
  if (status) {
    status.textContent = message || (gpc
      ? 'Your browser sends a Global Privacy Control signal, so advertising tracking is off.'
      : optedOut ? 'Advertising tracking is off in this browser.' : 'Advertising tracking is on in this browser.')
  }
}

optOut?.addEventListener('click', () => {
  try { localStorage.setItem(AD_OPT_OUT_KEY, '1') } catch { /* Blocked storage already prevents the pixel from being remembered. */ }
  render('Done. Advertising tracking is off in this browser. Reload any open Open Swarm pages to apply it.')
})
optIn?.addEventListener('click', () => {
  try { localStorage.removeItem(AD_OPT_OUT_KEY) } catch { /* Nothing to undo. */ }
  render('Advertising tracking is on in this browser.')
})
render()
