import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPostgresPublicRouter } = require('../src/routes/postgres-public.js');
const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

describe('PostgreSQL public read routes', () => {
  it('returns site information and the capability catalog without SQL.js', async () => {
    const pool = {
      async query(sql) {
        if (sql.includes('FROM system_config')) return { rows: [
          { config_key: 'platform_name', config_value: 'Ion Test' },
          { config_key: 'registration_enabled', config_value: false },
        ] };
        if (sql.includes('FROM models m')) return { rows: [{
          model_code: 'image-2', model_name: 'Image 2', model_type: 'image', context_length: null,
          billing_multiplier_input: '1', billing_multiplier_output: '1',
          capabilities: { image_input: true, image_generations: true, image_edits: true },
        }] };
        throw new Error('unexpected SQL');
      },
    };
    const app = express().use('/api/public', createPostgresPublicRouter({ pool }));
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/public`;

    expect(await fetch(`${base}/info`).then(response => response.json())).toMatchObject({
      platform_name: 'Ion Test', registration_enabled: false,
    });
    expect(await fetch(`${base}/models`).then(response => response.json())).toEqual({ data: [{
      model_code: 'image-2', model_name: 'Image 2', model_type: 'image', context_length: null,
      billing_multiplier_input: 1, billing_multiplier_output: 1,
      is_multimodal: true, supports_image_input: true,
      capabilities: { image_input: true, image_generations: true, image_edits: true },
    }] });
  });
});
