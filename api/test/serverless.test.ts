import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

const refresh = vi.fn(async () => {});
const loadHolidays = vi.fn(async () => {});
const runCycleWithLock = vi.fn(async () => ({ alertsCreated: 1 }));
const upsert = vi.fn(async () => ({}));

vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
vi.mock('../src/lib/hosted.js', () => ({}));
vi.mock('../src/app.js', () => ({ createApp: vi.fn(() => vi.fn()) }));
vi.mock('../src/lib/db.js', () => ({ prisma: { schedulerHeartbeat: { upsert } } }));
vi.mock('../src/lib/clock.js', () => ({ refresh, now: () => new Date('2026-11-04T00:00:00.000Z') }));
vi.mock('../src/lib/workdays.js', () => ({ loadHolidays }));
vi.mock('../src/engine/cycle.js', () => ({ runCycleWithLock }));

const { default: handler } = await import('../src/serverless.js');

function response() {
  return { statusCode: 200, setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse;
}

function request(authorization?: string) {
  return { url: '/api/cron/tick', headers: { authorization } } as unknown as IncomingMessage;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('serverless cron authorization', () => {
  it('rejects cron calls when CRON_SECRET is missing before initializing or running the engine', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = response();

    await handler(request(), res);

    expect(res.statusCode).toBe(401);
    expect(refresh).not.toHaveBeenCalled();
    expect(runCycleWithLock).not.toHaveBeenCalled();
  });

  it('rejects a wrong bearer token before initializing the service', async () => {
    vi.stubEnv('CRON_SECRET', 'configured-secret');
    const res = response();

    await handler(request('Bearer wrong-secret'), res);

    expect(res.statusCode).toBe(401);
    expect(refresh).not.toHaveBeenCalled();
    expect(runCycleWithLock).not.toHaveBeenCalled();
  });

  it('runs the cron tick only with the configured bearer token', async () => {
    vi.stubEnv('CRON_SECRET', 'configured-secret');
    const res = response();

    await handler(request('Bearer configured-secret'), res);

    expect(refresh).toHaveBeenCalledOnce();
    expect(runCycleWithLock).toHaveBeenCalledWith({ source: 'cron' }, 0);
    expect(upsert).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });
});
