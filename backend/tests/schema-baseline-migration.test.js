import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';

function columnMap(columns) {
  return Object.fromEntries(columns.map(column => [column.name, column]));
}

function runDatabaseScript(dbPath, script, marker) {
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', DB_PATH: dbPath },
  });
  expect(result.status, result.stderr).toBe(0);
  const outputLine = result.stdout.split(/\r?\n/).find(line => line.startsWith(`${marker}=`));
  expect(outputLine).toBeTruthy();
  return JSON.parse(outputLine.slice(marker.length + 1));
}

function expectNullableBaseline(channelColumns, logColumns) {
  expect(channelColumns.billing_multiplier_input).toMatchObject({ type: 'REAL', notnull: 0, dflt_value: null });
  expect(channelColumns.billing_multiplier_output).toMatchObject({ type: 'REAL', notnull: 0, dflt_value: null });
  expect(channelColumns.billing_multiplier_image).toMatchObject({ type: 'REAL', notnull: 0, dflt_value: null });
  expect(logColumns.request_protocol).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });
  expect(logColumns.upstream_protocol).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: null });
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
        (channel_name,base_url,api_key,model_mapping,priority,weight,status,health_score,last_check_time,created_at,updated_at)
        VALUES ('legacy-openai','https://legacy.example/v1','secret','{"gpt-legacy":"vendor-legacy"}',7,80,'active',92.5,
          '2026-01-01 01:02:03','2026-01-02 02:03:04','2026-01-03 03:04:05')`);
      legacy.run(`INSERT INTO api_request_logs
        (request_id,user_id,api_key_id,model_code,upstream_channel_id,input_tokens,output_tokens,total_cost,status,
          error_message,error_type,request_ip,latency_ms,created_at)
        VALUES ('req_legacy',11,22,'gpt-legacy',1,123,45,1.25,'success',
          NULL,NULL,'127.0.0.9',678,'2026-01-04 04:05:06')`);
      fs.writeFileSync(migrationDbPath, Buffer.from(legacy.export()));
      legacy.close();

      const script = `
        const { initDatabase } = require('./src/database/init.js');
        initDatabase().then(() => initDatabase()).then(db => {
          const channelColumns = db.prepare('PRAGMA table_info(upstream_channels)').all();
          const logColumns = db.prepare('PRAGMA table_info(api_request_logs)').all();
          const channel = db.prepare("SELECT channel_name,base_url,api_key,model_mapping,priority,weight,status,health_score,last_check_time,created_at,updated_at,protocol_type,max_concurrency,billing_multiplier_input,billing_multiplier_output,billing_multiplier_image FROM upstream_channels WHERE channel_name='legacy-openai'").get();
          const log = db.prepare("SELECT request_id,user_id,api_key_id,model_code,upstream_channel_id,input_tokens,output_tokens,total_cost,status,error_message,error_type,request_ip,latency_ms,created_at,request_protocol,upstream_protocol FROM api_request_logs WHERE request_id='req_legacy'").get();
          console.log('MIGRATION_RESULT=' + JSON.stringify({ channelColumns, logColumns, channel, log }));
        }).catch(error => { console.error(error); process.exit(1); });
      `;
      const migrated = runDatabaseScript(migrationDbPath, script, 'MIGRATION_RESULT');
      const channelColumns = columnMap(migrated.channelColumns);
      const logColumns = columnMap(migrated.logColumns);

      expectNullableBaseline(channelColumns, logColumns);
      expect(migrated.channel).toEqual({
        channel_name: 'legacy-openai',
        base_url: 'https://legacy.example/v1',
        api_key: 'secret',
        model_mapping: '{"gpt-legacy":"vendor-legacy"}',
        priority: 7,
        weight: 80,
        status: 'active',
        health_score: 92.5,
        last_check_time: '2026-01-01 01:02:03',
        created_at: '2026-01-02 02:03:04',
        updated_at: '2026-01-03 03:04:05',
        protocol_type: 'openai_compatible',
        max_concurrency: 5,
        billing_multiplier_input: null,
        billing_multiplier_output: null,
        billing_multiplier_image: null,
      });
      expect(migrated.log).toEqual({
        request_id: 'req_legacy',
        user_id: 11,
        api_key_id: 22,
        model_code: 'gpt-legacy',
        upstream_channel_id: 1,
        input_tokens: 123,
        output_tokens: 45,
        total_cost: 1.25,
        status: 'success',
        error_message: null,
        error_type: null,
        request_ip: '127.0.0.9',
        latency_ms: 678,
        created_at: '2026-01-04 04:05:06',
        request_protocol: null,
        upstream_protocol: null,
      });
    } finally {
      fs.rmSync(migrationDirectory, { recursive: true, force: true });
    }
  });

  it('新数据库重复初始化后仍保持相同的空值基线', () => {
    const migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ionailabs-schema-fresh-'));
    const migrationDbPath = path.join(migrationDirectory, 'fresh.db');
    try {
      const script = `
        const { initDatabase } = require('./src/database/init.js');
        initDatabase().then(() => initDatabase()).then(db => {
          const channelColumns = db.prepare('PRAGMA table_info(upstream_channels)').all();
          const logColumns = db.prepare('PRAGMA table_info(api_request_logs)').all();
          db.prepare("INSERT INTO upstream_channels (channel_name,base_url,api_key) VALUES ('fresh-openai','https://fresh.example/v1','secret')").run();
          db.prepare("INSERT INTO api_request_logs (request_id,model_code,status) VALUES ('req_fresh','gpt-fresh','success')").run();
          const channel = db.prepare("SELECT protocol_type,max_concurrency,billing_multiplier_input,billing_multiplier_output,billing_multiplier_image FROM upstream_channels WHERE channel_name='fresh-openai'").get();
          const log = db.prepare("SELECT request_protocol,upstream_protocol FROM api_request_logs WHERE request_id='req_fresh'").get();
          console.log('FRESH_RESULT=' + JSON.stringify({ channelColumns, logColumns, channel, log }));
        }).catch(error => { console.error(error); process.exit(1); });
      `;
      const fresh = runDatabaseScript(migrationDbPath, script, 'FRESH_RESULT');

      expectNullableBaseline(columnMap(fresh.channelColumns), columnMap(fresh.logColumns));
      expect(fresh.channel).toEqual({
        protocol_type: 'openai_compatible',
        max_concurrency: 5,
        billing_multiplier_input: null,
        billing_multiplier_output: null,
        billing_multiplier_image: null,
      });
      expect(fresh.log).toEqual({
        request_protocol: null,
        upstream_protocol: null,
      });
    } finally {
      fs.rmSync(migrationDirectory, { recursive: true, force: true });
    }
  });

  it('仅将历史默认品牌迁移为 IonAiLabs，保留管理员自定义值', () => {
    const migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ionailabs-brand-migration-'));
    const migrationDbPath = path.join(migrationDirectory, 'brand.db');
    try {
      const script = `
        const { initDatabase } = require('./src/database/init.js');
        initDatabase().then(async db => {
          db.prepare("UPDATE system_config SET config_value='11AiLabs' WHERE config_key='platform_name'").run();
          db.prepare("UPDATE system_config SET config_value='欢迎使用 11AiLabs API调用中心！新用户注册即送 1 额度点数' WHERE config_key='platform_announcement'").run();
          await initDatabase();
          const migrated = {
            platformName: db.prepare("SELECT config_value FROM system_config WHERE config_key='platform_name'").get().config_value,
            announcement: db.prepare("SELECT config_value FROM system_config WHERE config_key='platform_announcement'").get().config_value,
          };
          db.prepare("UPDATE system_config SET config_value='客户自定义品牌' WHERE config_key='platform_name'").run();
          db.prepare("UPDATE system_config SET config_value='客户自定义公告' WHERE config_key='platform_announcement'").run();
          await initDatabase();
          const customized = {
            platformName: db.prepare("SELECT config_value FROM system_config WHERE config_key='platform_name'").get().config_value,
            announcement: db.prepare("SELECT config_value FROM system_config WHERE config_key='platform_announcement'").get().config_value,
          };
          console.log('BRAND_RESULT=' + JSON.stringify({ migrated, customized }));
        }).catch(error => { console.error(error); process.exit(1); });
      `;
      const result = runDatabaseScript(migrationDbPath, script, 'BRAND_RESULT');

      expect(result.migrated).toEqual({
        platformName: 'IonAiLabs',
        announcement: '欢迎使用 IonAiLabs API调用中心！新用户注册即送 1 额度点数',
      });
      expect(result.customized).toEqual({
        platformName: '客户自定义品牌',
        announcement: '客户自定义公告',
      });
    } finally {
      fs.rmSync(migrationDirectory, { recursive: true, force: true });
    }
  });
});
