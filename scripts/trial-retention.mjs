// Applies the free-trial retention periods by hand (the tws-retention Worker does the same every day; see docs/RETENTION.md).
//
//   node scripts/trial-retention.mjs                          show what would run (nothing is changed)
//   node scripts/trial-retention.mjs --run --remote           erase name and email after 24 months, delete records after 5 years (production D1)
//   node scripts/trial-retention.mjs --run --local            same, against the local D1
//   add --nodupe to act on NoDupe (database "nodupe") instead of PinchPDF; the statements are the same
//
// Deletion is permanent: look at the dry run first, and note D1 backups age out on their own schedule.

import { spawnSync } from 'node:child_process';
import { trialRetentionStatements } from './trial-retention-sql.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

const statements = trialRetentionStatements(Math.floor(Date.now() / 1000));
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
  ['wrangler', 'd1', 'execute', flag('--nodupe') ? 'nodupe' : 'pinchpdf', flag('--remote') ? '--remote' : '--local', '--config', 'wrangler.json', '--command', statements.join('; ')],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
