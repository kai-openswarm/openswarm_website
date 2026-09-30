import { handleProductionEmailWorker } from '../../server/production-waitlist.ts'

export const config = { maxDuration: 60 }

export default handleProductionEmailWorker
