// scripts/record-test-results.test.mjs — run with: node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { mapResult, assertRecordable } from './record-test-results.mjs';

const SHA = 'a'.repeat(40);
const NOW = new Date('2026-11-04T10:00:00Z');
const report = (o) => ({ numPassedTests: 0, numFailedTests: 0, numFailedTestSuites: 0, ...o });

test('all passing -> PASS with the counts and a full sha', () => {
  const r = mapResult(report({ numPassedTests: 241 }), SHA, NOW);
  assert.deepStrictEqual(r, { commit: SHA, status: 'PASS', passed: 241, failed: 0, notVerified: 0, runAt: '2026-11-04T10:00:00.000Z' });
});

test('any failed test -> FAIL, never PASS', () => {
  const r = mapResult(report({ numPassedTests: 240, numFailedTests: 1 }), SHA, NOW);
  assert.strictEqual(r.status, 'FAIL');
  assert.strictEqual(r.failed, 1);
});

test('zero tests passed -> FAIL (nothing was verified)', () => {
  assert.strictEqual(mapResult(report({}), SHA, NOW).status, 'FAIL');
});

test('a suite that failed to load -> FAIL even with no failed test', () => {
  const r = mapResult(report({ numPassedTests: 10, numFailedTestSuites: 1 }), SHA, NOW);
  assert.strictEqual(r.status, 'FAIL');
  assert.ok(r.failed >= 1);
});

test('rejects a commit that is not a full 40-char sha', () => {
  assert.throws(() => mapResult(report({ numPassedTests: 1 }), 'abc1234', NOW), /40/);
});

test('rejects a report without numeric counts', () => {
  assert.throws(() => mapResult({}, SHA, NOW), /counts/);
  assert.throws(() => mapResult(null, SHA, NOW), /counts/);
});

test('assertRecordable refuses a PASS that contradicts its counts', () => {
  assert.throws(() => assertRecordable({ commit: SHA, status: 'PASS', passed: 5, failed: 1, notVerified: 0, runAt: NOW.toISOString() }), /PASS/);
  assert.throws(() => assertRecordable({ commit: SHA, status: 'PASS', passed: 0, failed: 0, notVerified: 0, runAt: NOW.toISOString() }), /PASS/);
  assert.doesNotThrow(() => assertRecordable({ commit: SHA, status: 'FAIL', passed: 5, failed: 1, notVerified: 0, runAt: NOW.toISOString() }));
});
