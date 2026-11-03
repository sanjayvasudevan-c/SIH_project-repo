import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { addDays, isoDate } from '../src/lib/dates.js';
import { runCycleWithLock, runEngineCycle } from '../src/engine/cycle.js';
import { buildFlags } from '../src/engine/flags.js';
import * as clock from '../src/lib/clock.js';
import { createApp } from '../src/app.js';
import { resetDb, setToday, userByEmail } from './helpers.js';
import { submitApp } from './fixtures.js';

// buildFlags runs mid-cycle, after the item loop: the least invasive place to force a failure.
vi.mock('../src/engine/flags.js', async (orig) => {
  const actual = await orig<typeof import('../src/engine/flags.js')>();
  return { ...actual, buildFlags: vi.fn(actual.buildFlags) };
});

describe('EngineRun history', () => {
  beforeEach(resetDb);

  it('records one OK row per cycle with the counters and the simulated date', async () => {
    const r = await runEngineCycle({ source: 'test' });
    const row = await prisma.engineRun.findUniqueOrThrow({ where: { id: BigInt(r.engineRunId as string) } });
    expect(row.status).toBe('OK');
    expect(row.finishedAt).not.toBeNull();
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
    expect(row.itemsChecked).toBe(r.itemsChecked);
    expect(row.provenance).toBe('TEST_RUN');
    expect(isoDate(row.simulatedToday)).toBe(r.today);
  });

  it('stamps startedAt/finishedAt with real time while simulatedToday follows the simulated clock', async () => {
    setToday(addDays(clock.today(), 30));
    const r = await runEngineCycle({ source: 'test' });
    const row = await prisma.engineRun.findUniqueOrThrow({ where: { id: BigInt(r.engineRunId as string) } });
    expect(Math.abs(row.startedAt.getTime() - Date.now())).toBeLessThan(60_000);
    expect(Math.abs(row.finishedAt!.getTime() - Date.now())).toBeLessThan(60_000);
    expect(row.finishedAt!.getTime()).toBeGreaterThanOrEqual(row.startedAt.getTime());
    expect(isoDate(row.simulatedToday)).toBe(r.today);
  });

  it('counts suppressed alerts on a repeated cycle and creates none', async () => {
    await submitApp(createApp(), await userByEmail('college.abc@demo.in'));
    setToday(addDays(clock.today(), 30)); // its stage deadline is now overdue, so the first cycle alerts
    const n0 = await prisma.alertLog.count();
    const first = await runEngineCycle({ source: 'test' });
    expect(Number(first.alertsCreated)).toBeGreaterThan(0);
    expect((await prisma.alertLog.count()) - n0).toBe(first.alertsCreated); // alertsCreated is ground truth
    const second = await runEngineCycle({ source: 'test' });
    expect(second.alertsCreated).toBe(0);
    expect(Number(second.alertsSuppressed)).toBeGreaterThan(0);
    const row = await prisma.engineRun.findUniqueOrThrow({ where: { id: BigInt(second.engineRunId as string) } });
    expect(row.alertsCreated).toBe(0);
    expect(row.alertsSuppressed).toBe(Number(second.alertsSuppressed));
  });

  it('marks the row FAILED with the error when the cycle throws midway [Review Focus 1]', async () => {
    vi.mocked(buildFlags).mockRejectedValueOnce(new Error('boom: flags exploded'));
    await expect(runEngineCycle({ source: 'test' })).rejects.toThrow('boom');
    const row = await prisma.engineRun.findFirstOrThrow({ orderBy: { id: 'desc' } });
    expect(row.status).toBe('FAILED');
    expect(row.error).toContain('boom');
    expect(row.finishedAt).not.toBeNull();
    expect(row.durationMs).not.toBeNull();
    expect(await prisma.engineRun.count({ where: { status: 'RUNNING' } })).toBe(0);
  });

  it('records the replica that ran each cycle, so a leader handover is visible', async () => {
    const prev = process.env.ENGINE_INSTANCE_ID;
    try {
      process.env.ENGINE_INSTANCE_ID = 'replica-a';
      const a = await runCycleWithLock({ source: 'a' });
      process.env.ENGINE_INSTANCE_ID = 'replica-b';
      const b = await runCycleWithLock({ source: 'b' });
      const rows = await prisma.engineRun.findMany({ where: { id: { in: [BigInt(a.engineRunId as string), BigInt(b.engineRunId as string)] } }, orderBy: { id: 'asc' } });
      expect(rows.map((r) => r.instanceId)).toEqual(['replica-a', 'replica-b']);
    } finally {
      if (prev === undefined) delete process.env.ENGINE_INSTANCE_ID;
      else process.env.ENGINE_INSTANCE_ID = prev;
    }
  });

  it('records a row per leader run and leaves none RUNNING', async () => {
    // Two concurrent runCycleWithLock calls: the advisory lock serialises them, so two rows appear
    // and neither is left RUNNING. (Both calls share this process, hence one instanceId here.)
    const before = await prisma.engineRun.count();
    await Promise.allSettled([runCycleWithLock({ source: 'a' }), runCycleWithLock({ source: 'b' })]);
    const rows = await prisma.engineRun.findMany({ orderBy: { id: 'desc' }, take: 2 });
    expect(await prisma.engineRun.count()).toBe(before + 2);
    expect(rows.every((r) => r.status === 'OK')).toBe(true);
    expect(rows.every((r) => r.instanceId.length > 0)).toBe(true);
  });
});

describe('EngineRun provenance', () => {
  beforeEach(resetDb);

  it('11. SIMULATED when the clock is overridden or offset; LIVE_DEMO on a real clock; TEST_RUN and BENCHMARK keep precedence', async () => {
    const env = { VITEST: process.env.VITEST, NODE_ENV: process.env.NODE_ENV };
    const prevOffset = clock.getOffsetDays();
    const restore = (k: 'VITEST' | 'NODE_ENV') => (env[k] === undefined ? delete process.env[k] : (process.env[k] = env[k]));
    const prov = async (meta: Record<string, string> = { source: 'test' }) =>
      (await prisma.engineRun.findUniqueOrThrow({ where: { id: BigInt(((await runEngineCycle(meta)) as { engineRunId: string }).engineRunId) } })).provenance;
    try {
      expect(await prov()).toBe('TEST_RUN'); // still wins under vitest, clock overridden
      delete process.env.VITEST;
      delete process.env.NODE_ENV;
      expect(clock.hasOverride()).toBe(true);
      expect(await prov()).toBe('SIMULATED'); // overridden clock
      clock.setOverride(null);
      expect(await prov()).toBe('LIVE_DEMO'); // real clock, no offset
      await clock.advance(3);
      expect(await prov()).toBe('SIMULATED'); // offset clock
      expect(await prov({ source: 'load-test' })).toBe('BENCHMARK'); // beats SIMULATED
    } finally {
      restore('VITEST');
      restore('NODE_ENV');
      await prisma.simClock.upsert({ where: { id: 1 }, create: { id: 1, offsetDays: prevOffset }, update: { offsetDays: prevOffset } });
      await clock.refresh();
      setToday();
    }
  });
});
