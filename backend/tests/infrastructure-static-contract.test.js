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
  });
});
