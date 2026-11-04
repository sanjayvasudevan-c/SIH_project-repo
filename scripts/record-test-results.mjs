// scripts/record-test-results.mjs — the only producer of docs/evidence/test-results.json.
//
//   npm run evidence:record-tests
//
// Runs the API test suite (vitest, JSON reporter) and records the outcome for the Evidence Center's Overview card:
//   { commit: full 40-char HEAD sha, status: 'PASS' | 'FAIL', passed, failed, notVerified: 0, runAt }
// It runs LOCALLY and needs the dev PostgreSQL up (the suite resets the dev database). CI does not run it.
// The file is gitignored: a committed copy would describe an older commit after the next commit.
//
// PASS is written only when no test failed, no suite failed to load, at least one test passed, and the working tree has
// no uncommitted changes (the result is recorded against HEAD, so it must describe HEAD). Otherwise FAIL is written, or,
// for a dirty tree with green tests, nothing is written and the script exits 2.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Pure: vitest JSON report + commit + time -> the record. Never returns PASS for a run with failures. */
export function mapResult(report, commit, now = new Date()) {
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/i.test(commit)) throw new Error('commit must be a full 40-character sha');
  if (!report || typeof report.numPassedTests !== 'number' || typeof report.numFailedTests !== 'number') {
    throw new Error('the test report has no numeric counts (numPassedTests / numFailedTests)');
  }
  const suitesFailed = typeof report.numFailedTestSuites === 'number' ? report.numFailedTestSuites : 0;
  const passed = report.numPassedTests;
  // A suite that could not load runs no tests, so it adds no failed test; count it so the record cannot read as clean.
  const failed = report.numFailedTests + (report.numFailedTests === 0 ? suitesFailed : 0);
  const status = failed === 0 && passed >= 1 ? 'PASS' : 'FAIL';
  return { commit: commit.toLowerCase(), status, passed, failed, notVerified: 0, runAt: now.toISOString() };
}

/** Refuses to let a PASS be written that its own counts contradict. */
export function assertRecordable(rec) {
  if (rec.status === 'PASS' && (rec.failed > 0 || rec.passed < 1)) throw new Error('refusing to record PASS: the counts show failures or no passing test');
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function main(argv) {
  const allowDirty = argv.includes('--allow-dirty');
  const commit = git('rev-parse', 'HEAD');
  const dirty = git('status', '--porcelain').length > 0;
  const tmp = mkdtempSync(join(tmpdir(), 'record-tests-'));
  const out = join(tmp, 'report.json');
  try {
    const run = spawnSync('npm', ['--workspace', 'api', 'run', 'test', '--', '--reporter=default', '--reporter=json', `--outputFile.json=${out}`], { cwd: root, stdio: 'inherit' });
    let report;
    try {
      report = JSON.parse(readFileSync(out, 'utf8'));
    } catch {
      console.error(`The test run produced no JSON report (exit ${run.status}); nothing recorded.`);
      return 2;
    }
    const rec = mapResult(report, commit);
    if (rec.status === 'PASS' && dirty && !allowDirty) {
      console.error('Tests passed, but the working tree has uncommitted changes, so the result would not describe HEAD. Commit first (or pass --allow-dirty). Nothing recorded.');
      return 2;
    }
    assertRecordable(rec);
    const dir = process.env.EVIDENCE_DIR ?? join(root, 'docs', 'evidence');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'test-results.json'), JSON.stringify(rec, null, 2) + '\n');
    console.log(`Recorded ${rec.status} for ${rec.commit.slice(0, 7)}: ${rec.passed} passed, ${rec.failed} failed.`);
    return rec.status === 'PASS' ? 0 : 1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
