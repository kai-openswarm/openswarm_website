import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleAdminInvite, handleEmailPreview, handleSendPending, handleTestEmail } from '../../server/admin-api.ts'
import { routeByLastSegment } from '../../server/http.ts'

// One function for every admin action keeps the deployment within Vercel's function limit.
export default (request: IncomingMessage, response: ServerResponse) => routeByLastSegment(request, response, {
  invite: handleAdminInvite,
  'test-email': handleTestEmail,
  'send-pending': handleSendPending,
  'email-preview': handleEmailPreview,
})
