import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'

const MIGRATIONS = ['../sql/test/supabase-stub.sql', '../sql/001_waitlist.sql', '../sql/002_analytics.sql']

/** Runs against a throwaway database on TEST_DATABASE_URL's server, then drops it. */
export async function withTestDatabase(run: (database: Pool) => Promise<void>) {
  const name = `openswarm_test_${randomUUID().replaceAll('-', '')}`
  const control = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 })
  let database: Pool | undefined
  try {
    await control.query(`CREATE DATABASE "${name}"`)
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.pathname = `/${name}`
    database = new Pool({ connectionString: url.toString(), max: 8 })
    await run(database)
  } finally {
    await database?.end()
    await control.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await control.end()
  }
}

/** Applies the Supabase stand-ins and every migration twice to prove they are re-runnable. */
export async function applyMigrations(database: Pool) {
  for (let pass = 0; pass < 2; pass++) {
    for (const file of MIGRATIONS) {
      await database.query(await readFile(new URL(file, import.meta.url), 'utf8'))
    }
  }
}
