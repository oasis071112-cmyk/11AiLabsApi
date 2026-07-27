import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initDatabase, getDatabase } = require('../src/database/init.js');
const { generateToken } = require('../src/middleware/auth.js');
const adminRoutes = require('../src/routes/admin.js');

describe('渠道模型同步状态保护', () => {
  let apiServer;
  let upstreamServer;
  let baseUrl;
  let adminToken;
  let channelId;
  let existingModelCode;
  let newModelCode;

  beforeAll(async () => {
    await initDatabase();
    const db = getDatabase();
    const suffix = `${Date.now()}-${Math.random()}`;
    existingModelCode = `sync-existing-${suffix}`;
    newModelCode = `sync-new-${suffix}`;
    upstreamServer = http.createServer((req, res) => {
      if (req.url !== '/v1/models') return res.writeHead(404).end();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        data: [{ id: existingModelCode }, { id: newModelCode }],
      }));
    });
    await new Promise(resolve => upstreamServer.listen(0, '127.0.0.1', resolve));
    const upstreamBase = `http://127.0.0.1:${upstreamServer.address().port}/v1`;

    const admin = db.prepare(`INSERT INTO users
      (username,email,password_hash,role,status) VALUES (?,?,?,?,?)`)
      .run(`sync-admin-${suffix}`, `sync-admin-${suffix}@test.local`,
        bcrypt.hashSync('safe-pass', 4), 'admin', 'active');
    adminToken = generateToken({
      id: admin.lastInsertRowid, username: `sync-admin-${suffix}`, role: 'admin',
    });
    db.prepare("INSERT INTO models (model_code,model_name,status) VALUES (?,?,'inactive')")
      .run(existingModelCode, existingModelCode);
    channelId = db.prepare(`INSERT INTO upstream_channels
      (channel_name,base_url,api_key,status) VALUES (?,?,?,'active')`)
      .run(`sync-channel-${suffix}`, upstreamBase, 'upstream-key').lastInsertRowid;
    db.prepare(`INSERT INTO channel_models
      (channel_id,model_code,upstream_model_name,status) VALUES (?,?,?,'inactive')`)
      .run(channelId, existingModelCode, existingModelCode);

    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRoutes);
    await new Promise(resolve => { apiServer = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${apiServer.address().port}`;
  });

  afterAll(async () => {
    if (apiServer) await new Promise(resolve => apiServer.close(resolve));
    if (upstreamServer) await new Promise(resolve => upstreamServer.close(resolve));
  });

  it('同步不重新启用已下架映射，首次发现的新模型也默认下架', async () => {
    const response = await fetch(`${baseUrl}/api/admin/channels/${channelId}/sync-models`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(response.status).toBe(200);

    const db = getDatabase();
    expect(db.prepare(`SELECT status FROM channel_models
      WHERE channel_id=? AND model_code=?`).get(channelId, existingModelCode).status).toBe('inactive');
    expect(db.prepare(`SELECT status FROM channel_models
      WHERE channel_id=? AND model_code=?`).get(channelId, newModelCode).status).toBe('inactive');
    expect(db.prepare('SELECT status FROM models WHERE model_code=?').get(newModelCode).status)
      .toBe('inactive');
  });
});
