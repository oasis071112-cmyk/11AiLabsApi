import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

const databaseUrl = process.env.POSTGRES_INTEGRATION_DATABASE_URL
const integration = databaseUrl ? describe : describe.skip

integration('PostgreSQL upstream TPM migration integration', () => {
  let pool

  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl, max: 1 }) })
  afterAll(async () => pool?.end())

  it('removes TPM limits without changing concurrency or RPM', async () => {
    const migration = fs.readFileSync(path.resolve(import.meta.dirname, '../migrations/postgres/007_upstream_tpm_unlimited.sql'), 'utf8')
    const client = await pool.connect()
    try {
      await client.query(`CREATE TEMP TABLE upstream_accounts (
        id BIGSERIAL PRIMARY KEY,
        max_concurrency INTEGER NOT NULL DEFAULT 20,
        rpm_limit INTEGER NOT NULL DEFAULT 60,
        tpm_limit INTEGER NOT NULL DEFAULT 100000
      )`)
      await client.query('CREATE TEMP TABLE schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL)')
      await client.query('INSERT INTO upstream_accounts(max_concurrency,rpm_limit,tpm_limit) VALUES (20,60,100000),(20,60,50000)')

      await client.query(migration)

      const migrated = await client.query('SELECT max_concurrency,rpm_limit,tpm_limit FROM upstream_accounts ORDER BY id')
      expect(migrated.rows.map(row => ({
        maxConcurrency: Number(row.max_concurrency),
        rpmLimit: Number(row.rpm_limit),
        tpmLimit: Number(row.tpm_limit),
      }))).toEqual([
        { maxConcurrency: 20, rpmLimit: 60, tpmLimit: 0 },
        { maxConcurrency: 20, rpmLimit: 60, tpmLimit: 0 },
      ])
      const inserted = await client.query('INSERT INTO upstream_accounts DEFAULT VALUES RETURNING max_concurrency,rpm_limit,tpm_limit')
      expect(inserted.rows[0]).toMatchObject({ max_concurrency: 20, rpm_limit: 60, tpm_limit: 0 })
      const columnDefault = await client.query(`SELECT pg_get_expr(def.adbin,def.adrelid) AS value
        FROM pg_attribute attr JOIN pg_attrdef def ON def.adrelid=attr.attrelid AND def.adnum=attr.attnum
        WHERE attr.attrelid='pg_temp.upstream_accounts'::regclass AND attr.attname='tpm_limit'`)
      expect(columnDefault.rows[0].value).toBe('0')
    } finally {
      await client.query('DROP TABLE IF EXISTS pg_temp.upstream_accounts,pg_temp.schema_migrations')
      client.release()
    }
  })
})
