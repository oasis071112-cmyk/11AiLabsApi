import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

process.env.DB_PATH = path.join(os.tmpdir(), `11ailabs-vitest-${process.pid}-${process.env.VITEST_POOL_ID || '0'}.db`);
process.env.JWT_SECRET = 'test-secret';

afterAll(() => {
  fs.rmSync(process.env.DB_PATH, { force: true });
});
