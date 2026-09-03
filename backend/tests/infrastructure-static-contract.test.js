import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

describe('infrastructure delivery contract', () => {
  it('keeps Compose limited to data services and documents configuration and readiness', () => {
    const compose = fs.readFileSync(path.join(repositoryRoot, 'docker-compose.infrastructure.yml'), 'utf8');
    const environment = fs.readFileSync(path.join(repositoryRoot, 'backend/.env.infrastructure.example'), 'utf8');
    const healthContract = fs.readFileSync(path.join(repositoryRoot, 'docs/infrastructure-health-contract.md'), 'utf8');

    expect(compose).toContain('postgres:');
    expect(compose).toContain('redis:');
    expect(compose).toContain('backup:');
    expect(compose).not.toContain('backend:');
    expect(environment).toContain('POSTGRES_URL=');
    expect(environment).toContain('REDIS_URL=');
    expect(environment).toContain('INFRA_SECRET_KEYRING=');
    expect(healthContract).toContain('checkPostgres');
    expect(healthContract).toContain('checkRedis');
    expect(healthContract).toContain('/api/ready');
    const apiSource = fs.readFileSync(path.join(repositoryRoot, 'backend/src/index.js'), 'utf8');
    expect(apiSource).toContain('schema: runtimeHealth.schema');
  });

  it('proxies only the approved Codex root POST endpoints to the API service', () => {
    const nginxFiles = ['nginx.conf', 'nginx-http-8601.conf'];
    for (const file of nginxFiles) {
      const nginx = fs.readFileSync(path.join(repositoryRoot, file), 'utf8');
      for (const endpoint of ['/responses', '/images/generations', '/images/edits']) {
        expect(nginx, file).toContain(`location = ${endpoint} {`);
      }
      expect(nginx, file).not.toContain('location = /chat/completions {');
      expect(nginx, file).not.toContain('location = /models {');
    }
    const nginx = fs.readFileSync(path.join(repositoryRoot, 'nginx-http-8601.conf'), 'utf8');
    expect(nginx).toContain('location = /v1/images/edits {');
    expect(nginx.match(/client_max_body_size 70m;/g)).toHaveLength(2);
    const apiSource = fs.readFileSync(path.join(repositoryRoot, 'backend/src/index.js'), 'utf8');
    expect(apiSource).toContain("app.use(['/v1/images/edits', '/images/edits'], express.json({ limit: '70mb' }))");
  });
});
