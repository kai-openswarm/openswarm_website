import type { Pool } from 'pg'
import type { AnalyticsStore } from './analytics.ts'

type Database = Pick<Pool, 'query'>

/** Each batch is one round trip; analytics.ingest applies it in a single statement. */
export function createPostgresAnalyticsStore(database: Database): AnalyticsStore {
  return {
    async ingest(batch) {
      await database.query('SELECT analytics.ingest($1::jsonb)', [JSON.stringify(batch)])
    },
    async hit(key, windowSeconds, limit) {
      const result = await database.query<{ allowed: boolean }>('SELECT analytics.hit($1, $2, $3) AS allowed', [key, windowSeconds, limit])
      return result.rows[0]?.allowed !== false
    },
  }
}
