// Keeps the shared release scripts in the product repositories identical to this repository's.
//
//   node scripts/sync-release-scripts.mjs "<path to PDF Compressor>" "<path to Duplicate Cleaner>"     copy them over
//   node scripts/sync-release-scripts.mjs --check "<path>" "<path>"                                   report any difference (exit 1)
//
// This repository is the source of truth for the signing and publishing code, because the signed bytes must be the
// same everywhere (the shared vectors prove it). Each product repository keeps byte-identical copies under
// scripts/release/, next to its own two small wrappers (publish.mjs, update.mjs), which are never touched here.
// Line endings are ignored when checking, so a checkout with CRLF does not count as a difference.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHARED = [
  ['scripts/release-lib.mjs', 'release-lib.mjs'],
  ['scripts/release-lib.d.mts', 'release-lib.d.mts'],
  ['scripts/release-publish-lib.mjs', 'release-publish-lib.mjs'],
  ['scripts/release-publish-lib.d.mts', 'release-publish-lib.d.mts'],
  ['scripts/release-cli.mjs', 'release-cli.mjs'],
  ['scripts/release-guided.mjs', 'release-guided.mjs'],
  ['scripts/release-guided.d.mts', 'release-guided.d.mts'],
  ['test/release-vectors.json', 'release-vectors.json'],
];

const args = process.argv.slice(2);
const check = args.includes('--check');
const targets = args.filter((a) => a !== '--check');
if (targets.length === 0) {
  console.error('Usage: node scripts/sync-release-scripts.mjs [--check] <product repository folder> [...]');
  process.exit(2);
}

const normal = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
let differences = 0;
for (const target of targets) {
  const folder = join(resolve(target), 'scripts', 'release');
  if (!existsSync(resolve(target, 'package.json'))) {
    console.error(`${target} does not look like a product repository (no package.json).`);
    process.exit(2);
  }
  for (const [from, name] of SHARED) {
    const source = join(here, from);
    const destination = join(folder, name);
    const same = existsSync(destination) && normal(source) === normal(destination);
    if (check) {
      if (!same) {
        differences += 1;
        console.log(`DIFFERENT  ${destination}`);
      }
    } else if (!same) {
      mkdirSync(folder, { recursive: true });
      copyFileSync(source, destination);
      console.log(`copied     ${destination}`);
    }
  }
}
if (check) {
  console.log(differences === 0 ? 'All copies match.' : `${differences} file(s) differ. Run without --check to copy them.`);
  process.exit(differences === 0 ? 0 : 1);
}
console.log('Done. Review and commit the changes in each product repository.');
