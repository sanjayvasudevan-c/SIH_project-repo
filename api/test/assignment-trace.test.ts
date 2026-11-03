import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { prisma, TX_OPTIONS } from '../src/lib/db.js';
import * as clock from '../src/lib/clock.js';
import { addDays } from '../src/lib/dates.js';
import { assign, selectOfficer, type Task, type TraceCandidate } from '../src/assignment/engine.js';
import { resetDb, userByEmail } from './helpers.js';
import { collegeOf, currentPin, openAssignment, submitApp } from './fixtures.js';

let app: Express;

async function submitAndAssign() {
  const res = await submitApp(app, await userByEmail('college.abc@demo.in'));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { applicationId: res.body.application.id as string };
}

async function taskOf(applicationId: string, taskType: Task['taskType'] = 'SCRUTINY'): Promise<Task> {
  const a = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
  return { applicationId, regionId: a.regionId, category: a.category, taskType };
}

/** A case whose scrutiny assignment has been released, so the task is open for assignment again. */
async function openTask() {
  const { applicationId } = await submitAndAssign();
  await prisma.assignment.updateMany({ where: { applicationId, releasedAt: null }, data: { releasedAt: clock.now(), releasedReason: 'TEST' } });
  return { applicationId, task: await taskOf(applicationId) };
}

const assignOnce = (task: Task) => prisma.$transaction((tx) => assign(tx, { ...task }), TX_OPTIONS);

describe('AssignmentTrace', () => {
  beforeEach(async () => {
    await resetDb();
    app = createApp();
  });

  it('writes one trace row per assignment, naming the chosen officer and every candidate', async () => {
    const { applicationId } = await submitAndAssign();
    const a = await openAssignment(applicationId);
    const t = await prisma.assignmentTrace.findFirstOrThrow({ where: { applicationId }, orderBy: { id: 'desc' } });
    expect(t.outcome).toBe('ASSIGNED');
    expect(t.assignmentId).toBe(a!.id);
    expect(t.chosenOfficerId).toBe(a!.officerId);
    expect(t.reasonText).toBe(a!.reasonText);
    const cands = t.candidates as unknown as TraceCandidate[];
    expect(cands.length).toBeGreaterThan(1);
    expect(cands.filter((c) => c.chosen)).toHaveLength(1);
    expect(cands.find((c) => c.chosen)!.officerId).toBe(t.chosenOfficerId);
    expect(cands.every((c) => c.eligible === (c.excludedBy === null))).toBe(true);
  });

  it('writes a BLOCKED trace with no officer and the exclusion reasons when nobody is eligible [Review Focus 5]', async () => {
    // Everyone who could take the case (officers and Bureau) is on leave today.
    const today = clock.today();
    const staff = await prisma.user.findMany({ where: { role: { in: ['OFFICER', 'BUREAU'] } } });
    for (const u of staff) await prisma.officerAvailability.create({ data: { userId: u.id, kind: 'LEAVE', startsOn: today, endsOn: addDays(today, 5), reason: 'Leave', createdById: u.id } });
    const { applicationId } = await submitAndAssign();
    expect(await openAssignment(applicationId)).toBeNull();
    const t = await prisma.assignmentTrace.findFirstOrThrow({ where: { applicationId }, orderBy: { id: 'desc' } });
    expect(t.outcome).toBe('BLOCKED');
    expect(t.chosenOfficerId).toBeNull();
    expect(t.assignmentId).toBeNull();
    const cands = t.candidates as unknown as TraceCandidate[];
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.every((c) => !c.eligible && c.excludedBy !== null && !c.chosen)).toBe(true);
    expect(new Set(cands.map((c) => c.excludedBy))).toEqual(new Set(['UNAVAILABLE']));
  });

  it('records Bureau overflow, and the first reason that excluded each candidate', async () => {
    const today = clock.today();
    const officers = await prisma.user.findMany({ where: { role: 'OFFICER' } });
    for (const u of officers) await prisma.officerAvailability.create({ data: { userId: u.id, kind: 'LEAVE', startsOn: today, endsOn: addDays(today, 5), reason: 'Leave', createdById: u.id } });
    // An unavailable AND recused-looking officer must still read UNAVAILABLE (first in the engine's order).
    const { applicationId } = await submitAndAssign();
    const t = await prisma.assignmentTrace.findFirstOrThrow({ where: { applicationId }, orderBy: { id: 'desc' } });
    const cands = t.candidates as unknown as TraceCandidate[];
    expect(t.outcome).toBe('BUREAU_OVERFLOW');
    expect((await openAssignment(applicationId))!.tier).toBe(1);
    expect(cands.find((c) => c.chosen)!.tier).toBe(1);
    expect(cands.some((c) => c.tier === 0 && c.excludedBy === 'UNAVAILABLE')).toBe(true);
  });

  it('names BARRED, RECUSED and OVER_CAPACITY candidates, not just counts', async () => {
    const abc = await prisma.institution.findFirstOrThrow({ where: { name: 'ABC Engineering College' } });
    const officers = await prisma.user.findMany({ where: { role: 'OFFICER', region: { code: 'SOUTH' } }, orderBy: { id: 'asc' } });
    const [barred, recused, heavy] = officers;
    const profile = await prisma.officerProfile.findUniqueOrThrow({ where: { userId: barred!.id } });
    await prisma.officerProfile.update({ where: { userId: barred!.id }, data: { barredInstitutionIds: [...(profile.barredInstitutionIds as string[]), abc.id] } });
    const { applicationId } = await openTask();
    const pin = (await currentPin()).rulePackVersionId;
    const row = (officerId: string, taskRefId: string, weight: number, extra: object = {}) =>
      prisma.assignment.create({ data: { applicationId, taskType: 'VERIFY', taskRefId, officerId, weight, tier: 0, reasonText: 'fixture', rulePackVersionId: pin, assignedAt: clock.now(), ...extra } });
    await row(recused!.id, 'recusal', 0, { releasedAt: clock.now(), releasedReason: 'RECUSED' });
    await row(heavy!.id, 'heavy', 1000);
    await assignOnce(await taskOf(applicationId));
    const t = await prisma.assignmentTrace.findFirstOrThrow({ where: { applicationId }, orderBy: { id: 'desc' } });
    const by = new Map((t.candidates as unknown as TraceCandidate[]).map((c) => [c.officerId, c]));
    expect(by.get(barred!.id)).toMatchObject({ excludedBy: 'BARRED', eligible: false });
    expect(by.get(recused!.id)).toMatchObject({ excludedBy: 'RECUSED', eligible: false });
    expect(by.get(heavy!.id)).toMatchObject({ excludedBy: 'OVER_CAPACITY', eligible: false });
    expect(by.get(heavy!.id)!.projectedUtil).toBeGreaterThan(1);
  });

  it('two concurrent assignments of the same task produce one assignment and one trace', async () => {
    const { applicationId, task } = await openTask();
    const before = await prisma.assignmentTrace.count({ where: { applicationId, outcome: 'ASSIGNED' } });
    await Promise.allSettled([assignOnce(task), assignOnce(task)]);
    expect(await prisma.assignment.count({ where: { applicationId, releasedAt: null } })).toBe(1);
    // The loser rolled back, taking its trace with it.
    expect(await prisma.assignmentTrace.count({ where: { applicationId, outcome: 'ASSIGNED' } })).toBe(before + 1);
  });

  it('records the same chosen officer as before the trace was added', async () => {
    // Regression guard on the Exclusions type change: a fixed fixture must still pick the same officer.
    const inst = await prisma.institution.findFirstOrThrow({ where: { region: { code: 'SOUTH' }, name: { not: 'ABC Engineering College' } }, orderBy: { permanentId: 'desc' } });
    await prisma.institution.update({ where: { id: inst.id }, data: { portfolioOfficerId: null } });
    const anchor = await submitAndAssign();
    const officers = await prisma.user.findMany({ where: { role: 'OFFICER', region: { code: 'SOUTH' } }, orderBy: { id: 'asc' } });
    const pin = (await currentPin()).rulePackVersionId;
    const load = async (officerId: string, points: number) =>
      prisma.assignment.create({ data: { applicationId: anchor.applicationId, taskType: 'VERIFY', taskRefId: `load-${officerId}`, officerId, weight: points, tier: 0, reasonText: 'fixture', rulePackVersionId: pin, assignedAt: clock.now() } });
    for (const o of officers) await load(o.id, 3); // equal load: the choice is decided by score, then tie-break
    const college = await collegeOf(inst.name);
    const s = await submitApp(app, college);
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    // Pinned from the engine as it was before the trace change: with equal load everywhere, Ravi Kumar's skills win on mismatch.
    expect((await openAssignment(s.body.application.id))!.officer.name).toBe('Ravi Kumar');

    // And the read-only selection agrees, on a fresh task for the same case.
    await prisma.assignment.updateMany({ where: { applicationId: s.body.application.id, releasedAt: null }, data: { releasedAt: clock.now(), releasedReason: 'TEST' } });
    const task = await taskOf(s.body.application.id);
    const sel = await prisma.$transaction((tx) => selectOfficer(tx, task, { institutionId: inst.id, institutionName: inst.name, portfolioOfficerId: null, regionCode: 'SOUTH' }), TX_OPTIONS);
    expect(sel.pick!.officer.name).toBe('Ravi Kumar');
    expect(sel.pick!.tier).toBe(0);
  });
});
