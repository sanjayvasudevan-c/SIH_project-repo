// Independent verification of the Evidence Center numbers against raw SQL.
//   npm run evidence:verify          (reads DATABASE_URL and JWT_SECRET from ../.env; exits non-zero on any disagreement)
//
// Read-only. The API is called through createApp() on an in-process loopback server (an ephemeral port, no external network). The
// administrator is authenticated with a token minted by the repo's own signToken for an existing active ADMIN user, so no login
// request is made and NO audit row is written. The ground-truth SQL runs on its own pg connection with default_transaction_read_only
// on, so a write could not succeed even by mistake. Credentials and tokens are never printed.
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { signToken } from '../src/auth/token.js';
import { describeDatabase, formatTable, runVerification } from '../src/evidence-verify.js';

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url || !process.env.JWT_SECRET) {
    console.error('DATABASE_URL and JWT_SECRET must be set (they are read from ../.env).');
    return 2;
  }
  const db = new pg.Client({ connectionString: url, options: '-c default_transaction_read_only=on' });
  await db.connect();
  const sql = async (text: string, params: unknown[] = []) => (await db.query(text, params)).rows;
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  try {
    const admin = (await sql(`SELECT id FROM "User" WHERE role = 'ADMIN' AND active ORDER BY email LIMIT 1`))[0];
    if (!admin) {
      console.error('No active ADMIN user in this database.');
      return 2;
    }
    const token = signToken({ sub: String(admin.id), role: 'ADMIN' });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const get = async (p: string) => {
      const res = await fetch(base + p, { headers: { authorization: `Bearer ${token}` } });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    const info = await describeDatabase(url, sql);
    console.log('Evidence Center verification: every API headline number vs independent raw SQL');
    console.log(`Cluster:  ${info.cluster}`);
    console.log(`Database: ${info.host}:${info.port}/${info.database} (connected as ${info.user})`);
    console.log(`Auth:     administrator token minted with signToken (no login request, no audit row written); SQL session is read-only`);
    console.log(`Rows:     ${Object.entries(info.counts).map(([t, n]) => `${t}=${n}`).join('  ')}`);
    const report = await runVerification({ get, sql });
    console.log(`Windows:  ${report.windows.map((w) => `${w.label}[${w.from ?? '-'}..${w.to ?? '-'}]`).join('  ')}\n`);
    console.log(formatTable(report.checks));
    console.log(`\n${report.checks.length} checks, ${report.checks.length - report.failures.length} agree, ${report.failures.length} disagree`);
    if (!report.ok) {
      console.log('FAIL: disagreements:');
      for (const f of report.failures) console.log(`  [${f.window}] ${f.measure} (${f.endpoint}): API ${f.api} vs SQL ${f.sql}`);
      return 1;
    }
    console.log('PASS: every measure agrees with the independent SQL');
    return 0;
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await db.end();
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  },
);
