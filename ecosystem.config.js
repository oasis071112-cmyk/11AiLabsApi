module.exports = {
  apps: [
    {
      name: '11ailabs-api',
      cwd: './backend',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      kill_timeout: 15_000,
      listen_timeout: 15_000,
      wait_ready: true,
      env: { NODE_ENV: 'production' },
    },
    {
      name: '11ailabs-worker',
      cwd: './backend',
      script: 'src/worker.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      kill_timeout: 30_000,
      listen_timeout: 30_000,
      wait_ready: true,
      env: { NODE_ENV: 'production' },
    },
  ],
};
