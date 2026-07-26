import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';

function columnMap(columns) {
  return Object.fromEntries(columns.map(column => [column.name, column]));
}

describe('第一轮数据库兼容迁移', () => {
  it('升级旧数据库时保留记录并以空渠道倍率和空协议快照作为默认值', async () => {
    const migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ionailabs-schema-migration-'));
    const migrationDbPath = path.join(migrationDirectory, 'legacy.db');
    try {
      const SQL = await initSqlJs();
      const legacy = new SQL.Database();
      legacy.run(`CREATE TABLE upstream_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT, channel_name TEXT NOT NULL,
        base_url TEXT NOT NULL, api_key TEXT NOT NULL, model_mapping TEXT,
        priority INTEGER DEFAULT 0, weight INTEGER DEFAULT 100,
        status TEXT DEFAULT 'active',
        health_score REAL DEFAULT 100, last_check_time DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      legacy.run(`CREATE TABLE api_request_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT UNIQUE NOT NULL,
        user_id INTEGER, api_key_id INTEGER, model_code TEXT, upstream_channel_id INTEGER,
        input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
        total_cost REAL DEFAULT 0, status TEXT DEFAULT 'pending',
        error_message TEXT, error_type TEXT, request_ip TEXT, latency_ms INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      legacy.run(`INSERT INTO upstream_channels
        (channel_name,base_url,api_key) VALUES ('legacy-openai','https://legacy.example/v1','secret')`);
      legacy.run(`INSERT INTO api_request_logs
        (request_id,model_code,status,total_cost) VALUES ('req_legacy','gpt-legacy','success',1.25)`);
      fs.writeFileSync(migrationDbPath, Buffer.from(legacy.export()));
      legacy.close();

      const script = `
        const { initDatabase } = require('./src/database/init.js');
        initDatabase().then(db => {
          const channelColumns = db.prepare('PRAGMA table_info(upstream_channels)').all();
          const logColumns = db.prepare('PRAGMA table_info(api_request_logs)').all();
          const channel = db.prepare("SELECT channel_name,protocol_type,billing_multiplier_input,billing_multiplier_output,billing_multiplier_image FROM upstream_channels WHERE channel_name='legacy-openai'").get();
          const log = db.prepare("SELECT request_id,total_cost,request_protocol,upstream_protocol FROM api_request_logs WHERE request_id='req_legacy'").get();
          console.log('MIGRATION_RESULT=' + JSON.stringify({ channelColumns, logColumns, channel, log }));
        }).catch(error => { console.error(error); process.exit(1); });
      `;
      const result = spawnSync(process.execPath, ['-e', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'test', DB_PATH: migrationDbPath },
      });

      expect(result.status, result.stderr).toBe(0);
      const outputLine = result.stdout.split(/\r?\n/).find(line => line.startsWith('MIGRATION_RESULT='));
      expect(outputLine).toBeTruthy();
      const migrated = JSON.parse(outputLine.slice('MIGRATION_RESULT='.length));
      const channelColumns = columnMap(migrated.channelColumns);
      const logColumns = columnMap(migrated.logColumns);

      expect(channelColumns.billing_multiplier_input).toMatchObject({ type: 'REAL', notnull: 0, dflt_value: null });
      expect(channelColumns.billing_multiplier_output).toMatchObject({ type: 'REAL', notnull: 0, dflt_value: null });
      expect(channelColumns.billing_multiplier_image).toMatchObject({ type: 'REAL', notnull: 0, dflt_value: null });
      expect(logColumns.request_protocol).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });
      expect(logColumns.upstream_protocol).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });
      expect(migrated.channel).toEqual({
        channel_name: 'legacy-openai',
        protocol_type: 'openai_compatible',
        billing_multiplier_input: null,
        billing_multiplier_output: null,
        billing_multiplier_image: null,
      });
      expect(migrated.log).toEqual({
        request_id: 'req_legacy',
        total_cost: 1.25,
        request_protocol: null,
        upstream_protocol: null,
      });
    } finally {
      fs.rmSync(migrationDirectory, { recursive: true, force: true });
    }
  });
});
