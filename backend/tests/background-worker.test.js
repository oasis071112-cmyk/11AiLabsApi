import { describe, expect, it, vi } from 'vitest';
import { BackgroundWorker } from '../src/modules/background-worker/index.js';

describe('BackgroundWorker', () => {
  it('runs account monitoring, cooldown recovery, aggregation, partitions, and retention independently', async () => {
    const calls = [];
    const tasks = [
      'account-monitor', 'cooldown-recovery', 'daily-aggregation', 'partition-maintenance', 'log-retention',
    ].map(name => ({ name, run: vi.fn(async () => calls.push(name)) }));
    const worker = new BackgroundWorker({ tasks, clock: () => new Date('2026-08-01T00:00:00.000Z') });

    const result = await worker.runCycle();

    expect(calls).toEqual(tasks.map(task => task.name));
    expect(result.status).toBe('ok');
    expect(result.tasks).toHaveLength(5);
    expect(result.tasks.every(task => task.status === 'ok')).toBe(true);
  });

  it('continues safe maintenance tasks when one account probe task fails', async () => {
    const aggregate = vi.fn(async () => ({ rows: 4 }));
    const worker = new BackgroundWorker({ tasks: [
      { name: 'account-monitor', run: async () => { throw new Error('upstream timeout'); } },
      { name: 'daily-aggregation', run: aggregate },
    ] });

    const result = await worker.runCycle();

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('degraded');
    expect(result.tasks).toMatchObject([
      { name: 'account-monitor', status: 'error', error: 'upstream timeout' },
      { name: 'daily-aggregation', status: 'ok' },
    ]);
  });

  it('does not create duplicate intervals when start is called twice', async () => {
    const scheduled = [];
    const task = { name: 'aggregate', run: vi.fn(async () => {}) };
    const worker = new BackgroundWorker({
      tasks: [task],
      setIntervalFn: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; },
      clearIntervalFn: vi.fn(),
    });

    await worker.start();
    await worker.start();

    expect(task.run).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(1);
  });
});
