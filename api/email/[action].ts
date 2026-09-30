import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleEmailClick, handleEmailOpen, handleResendWebhook } from '../../server/production-waitlist.ts'
import { routeByLastSegment } from '../../server/http.ts'

// One function for email tracking keeps the deployment within Vercel's function limit.
export default (request: IncomingMessage, response: ServerResponse) => routeByLastSegment(request, response, {
  open: handleEmailOpen,
  click: handleEmailClick,
  'resend-webhook': handleResendWebhook,
})
