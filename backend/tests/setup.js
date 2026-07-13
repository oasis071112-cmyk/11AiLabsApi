import os from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(os.tmpdir(), `11ailabs-vitest-${process.pid}.db`);
process.env.JWT_SECRET = 'test-secret';
