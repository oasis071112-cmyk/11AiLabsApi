import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

const databaseUrl = process.env.POSTGRES_INTEGRATION_DATABASE_URL
const integration = databaseUrl ? describe : describe.skip

integration('PostgreSQL upstream concurrency migration integration', () => {
  let pool

  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }) })
  afterAll(async () => pool?.end())

  it('executes migration 006 against temporary tables and changes both existing rows and the database default to five', async () => {
    const migration = fs.readFileSync(path.resolve(import.meta.dirname, '../migrations/postgres/006_upstream_concurrency_default.sql'), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('CREATE TEMP TABLE upstream_accounts (id BIGSERIAL PRIMARY KEY, max_concurrency INTEGER NOT NULL DEFAULT 1)')
      await client.query('CREATE TEMP TABLE schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL)')
      await client.query('INSERT INTO upstream_accounts(max_concurrency) VALUES (1),(2),(9)')

      await client.query(migration)

      const migrated = await client.query('SELECT max_concurrency FROM upstream_accounts ORDER BY id')
      expect(migrated.rows.map(row => Number(row.max_concurrency))).toEqual([5, 5, 5])
      const inserted = await client.query('INSERT INTO upstream_accounts DEFAULT VALUES RETURNING max_concurrency')
      expect(Number(inserted.rows[0].max_concurrency)).toBe(5)
      const columnDefault = await client.query(`SELECT pg_get_expr(def.adbin,def.adrelid) AS value
        FROM pg_attribute attr JOIN pg_attrdef def ON def.adrelid=attr.attrelid AND def.adnum=attr.attnum
        WHERE attr.attrelid='pg_temp.upstream_accounts'::regclass AND attr.attname='max_concurrency'`)
      expect(columnDefault.rows[0].value).toBe('5')
    } finally {
      await client.query('DROP TABLE IF EXISTS pg_temp.upstream_accounts,pg_temp.schema_migrations')
      client.release()
    }
  })
})
