import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'

export const BASE_MIGRATIONS = ['../sql/test/supabase-stub.sql', '../sql/001_waitlist.sql']
export const LATER_MIGRATIONS = ['../sql/002_email_waitlist.sql', '../sql/003_analytics.sql', '../sql/004_api_role.sql', '../sql/005_admin_features.sql',
  '../sql/006_waitlist_email_delivery.sql', '../sql/007_email_admin.sql', '../sql/008_email_analytics.sql', '../sql/009_page_overlay.sql']

/** A pool connected as the least-privilege website role, as the hosted API is. */
export async function connectAsApiRole(database: Pool) {
  // Roles are shared by every database on the server; parallel test files may race here.
  for (let attempt = 0; ; attempt++) {
    try {
      await database.query("ALTER ROLE openswarm_api LOGIN PASSWORD 'test-only'")
      break
    } catch (error) {
      if (attempt >= 5 || !/concurrently updated/.test(String(error))) throw error
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
  const { rows } = await database.query<{ name: string }>('SELECT current_database() AS name')
  const url = new URL(process.env.TEST_DATABASE_URL!)
  url.pathname = `/${rows[0].name}`
  url.username = 'openswarm_api'
  url.password = 'test-only'
  return new Pool({ connectionString: url.toString(), max: 8 })
}

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

/** Applies migration files in order, twice, to prove they are re-runnable. */
export async function applyFiles(database: Pool, files: string[]) {
  for (let pass = 0; pass < 2; pass++) {
    for (const file of files) {
      await database.query(await readFile(new URL(file, import.meta.url), 'utf8'))
    }
  }
}

/** The Supabase stand-ins and every migration. */
export function applyMigrations(database: Pool) {
  return applyFiles(database, [...BASE_MIGRATIONS, ...LATER_MIGRATIONS])
}
