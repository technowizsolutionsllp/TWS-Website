// Retention and erasure for app telemetry (see docs/PINCHPDF_TELEMETRY.md).
//
//   node scripts/telemetry-purge.mjs                          show what would run (nothing is changed)
//   node scripts/telemetry-purge.mjs --run --remote           delete events older than 730 days (production D1)
//   node scripts/telemetry-purge.mjs --run --local            same, against the local D1
//   node scripts/telemetry-purge.mjs --days 365 --run --remote
//   node scripts/telemetry-purge.mjs --erase <customer-uuid> --run --remote     erase one customer on request
//   add --nodupe to any of the above to act on the NoDupe scan reports (database "nodupe") instead of PinchPDF
//
// Run the purge regularly (monthly is enough); the admin Health check warns when old events remain.
// Deletion is permanent: look at the dry run first, and note D1 backups age out on their own schedule.

import { spawnSync } from 'node:child_process';
import { DEFAULT_RETENTION_DAYS, eraseStatements, nodupeEraseStatements, nodupePurgeStatements, purgeStatements } from './telemetry-purge-sql.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const nodupe = flag('--nodupe');
const days = value('--days') ? Number(value('--days')) : DEFAULT_RETENTION_DAYS;
let statements;
try {
  statements = value('--erase')
    ? (nodupe ? nodupeEraseStatements : eraseStatements)(value('--erase'))
    : (nodupe ? nodupePurgeStatements : purgeStatements)(Math.floor(Date.now() / 1000), days);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

console.log(statements.map((sql) => `${sql};`).join('\n'));
if (!flag('--run')) {
  console.log('\nDry run only. Add --run and --remote (production) or --local to execute.');
  process.exit(0);
}
if (flag('--remote') === flag('--local')) {
  console.error('Choose exactly one of --remote or --local.');
  process.exit(2);
}
const result = spawnSync(
  'npx',
  ['wrangler', 'd1', 'execute', nodupe ? 'nodupe' : 'pinchpdf', flag('--remote') ? '--remote' : '--local', '--config', 'wrangler.json', '--command', statements.join('; ')],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
