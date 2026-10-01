import { createHash } from 'node:crypto'

/**
 * Meta Conversions API: reports a waitlist signup as a Lead from the server, so Meta can
 * credit the ad even when an ad blocker stopped the browser pixel. The browser pixel sends
 * the same event id, and Meta keeps one of the two. Off until META_CAPI_TOKEN and a pixel
 * id are set.
 */

export const META_GRAPH_VERSION = 'v23.0'

export type MetaConfig = { pixelId: string, token: string, testEventCode?: string }

export function readMetaConfig(env: NodeJS.ProcessEnv = process.env): MetaConfig | null {
  const pixelId = (env.META_PIXEL_ID ?? env.VITE_META_PIXEL_ID)?.trim()
  const token = env.META_CAPI_TOKEN?.trim()
  if (!pixelId || !/^\d{5,20}$/.test(pixelId) || !token) return null
  const testEventCode = env.META_TEST_EVENT_CODE?.trim()
  return { pixelId, token, ...(testEventCode ? { testEventCode } : {}) }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export type MetaLead = {
  eventId: string
  email: string
  page?: string
  ip?: string
  userAgent?: string
  fbc?: string
  fbp?: string
  /** The site's random visitor id, hashed before it is sent. */
  visitorId?: string
  now?: number
}

/** The request body Meta expects. Contact details are SHA-256 hashed as Meta requires. */
export function metaLeadPayload(lead: MetaLead, config: MetaConfig) {
  return {
    data: [{
      event_name: 'Lead',
      event_time: Math.floor((lead.now ?? Date.now()) / 1000),
      event_id: lead.eventId,
      action_source: 'website',
      ...(lead.page ? { event_source_url: lead.page } : {}),
      user_data: {
        em: [sha256(lead.email.trim().toLowerCase())],
        ...(lead.visitorId ? { external_id: [sha256(lead.visitorId)] } : {}),
        ...(lead.ip ? { client_ip_address: lead.ip } : {}),
        ...(lead.userAgent ? { client_user_agent: lead.userAgent } : {}),
        ...(lead.fbc ? { fbc: lead.fbc } : {}),
        ...(lead.fbp ? { fbp: lead.fbp } : {}),
      },
      custom_data: { content_name: 'waitlist' },
    }],
    ...(config.testEventCode ? { test_event_code: config.testEventCode } : {}),
  }
}

/** Sends one Lead. Resolves false on any failure; a signup never depends on it. */
export async function sendMetaLead(lead: MetaLead, config: MetaConfig, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(`https://graph.facebook.com/${META_GRAPH_VERSION}/${config.pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The token goes in the body, not the URL, so it never appears in request logs.
      body: JSON.stringify({ ...metaLeadPayload(lead, config), access_token: config.token }),
      signal: AbortSignal.timeout(5_000),
    })
    return response.ok
  } catch {
    return false
  }
}
