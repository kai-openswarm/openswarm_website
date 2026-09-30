import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const EASE = [0.22, 1, 0.36, 1] as const

/** An HTTPS override for a legal page; otherwise the page built with this site. */
function legalPage(value: string | undefined, fallback: string) {
  if (!value) return fallback
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : fallback
  } catch { return fallback }
}

export const LINKS = {
  discord: 'https://discord.gg/NRzxNZW5hH',
  x: 'https://x.com/openswarm',
  privacy: legalPage(import.meta.env.VITE_PRIVACY_URL, `${import.meta.env.BASE_URL}privacy/`),
  terms: legalPage(import.meta.env.VITE_TERMS_URL, `${import.meta.env.BASE_URL}terms/`),
  privacyChoices: `${import.meta.env.BASE_URL}privacy/#your-choices`,
}

/** Site images. Set VITE_MEDIA_BASE_URL (for example an R2 bucket's public URL) to serve them from elsewhere. */
const MEDIA_BASE = import.meta.env.VITE_MEDIA_BASE_URL?.trim().replace(/\/?$/, '/') || `${import.meta.env.BASE_URL}media/`
export const media = (name: string) => `${MEDIA_BASE}${name}`
