import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

const testDbDirectory = fs.mkdtempSync(path.join(os.tmpdir(), '11ailabs-vitest-'));
const testDbPath = path.join(testDbDirectory, 'proxy.db');

process.env.DB_PATH = testDbPath;
process.env.JWT_SECRET = 'test-secret';

afterAll(() => {
  fs.rmSync(testDbDirectory, { recursive: true, force: true });
});
