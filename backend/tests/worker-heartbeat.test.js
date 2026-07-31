import { describe, expect, it, vi } from 'vitest';
import { WorkerHeartbeat } from '../src/modules/background-worker/heartbeat.js';

describe('WorkerHeartbeat', () => {
  it('refreshes independently from the sequential maintenance cycle', async () => {
    const callbacks = [];
    const redis = { set: vi.fn(async () => 'OK') };
    const heartbeat = new WorkerHeartbeat({
      redis,
      key: 'test:worker:heartbeat',
      clock: () => new Date('2026-08-01T00:00:00.000Z'),
      setIntervalFn: callback => { callbacks.push(callback); return { unref: vi.fn() }; },
      clearIntervalFn: vi.fn(),
    });

    await heartbeat.start();
    await callbacks[0]();

    expect(redis.set).toHaveBeenCalledTimes(2);
    expect(redis.set).toHaveBeenCalledWith(
      'test:worker:heartbeat',
      '2026-08-01T00:00:00.000Z',
      { EX: 90 },
    );
  });

  it('starts once and stops its dedicated timer', async () => {
    const timer = { unref: vi.fn() };
    const clearIntervalFn = vi.fn();
    const heartbeat = new WorkerHeartbeat({
      redis: { set: vi.fn(async () => 'OK') },
      key: 'test:worker:heartbeat',
      setIntervalFn: vi.fn(() => timer),
      clearIntervalFn,
    });

    await heartbeat.start();
    await heartbeat.start();
    await heartbeat.stop();

    expect(heartbeat.setIntervalFn).toHaveBeenCalledTimes(1);
    expect(clearIntervalFn).toHaveBeenCalledWith(timer);
  });
});
