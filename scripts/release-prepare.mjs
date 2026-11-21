// Prepares an app release for manual upload to R2 (docs/RELEASES.md, section B). Nothing is uploaded.
//
//   node scripts/release-prepare.mjs --keygen
//       Makes a new release signing key. Keep the seed offline (never in this repository); the public key
//       goes in the RELEASE_PUBLIC_KEY setting and is built into the app.
//
//   node scripts/release-prepare.mjs <PinchPDF|NoDupe> <version> <installer.exe> --notes "line 1|line 2"
//        [--channel stable|beta] [--notes-url https://...] [--min-supported 1.1.0] [--mandatory]
//        [--rollout 5] [--pub-date 2026-12-01T00:00:00Z]
//        [--index current-index.json] [--out release-out] [--bucket tws-releases] [--key-file seed.txt]
//
// The signing seed comes from --key-file or the RELEASE_SIGNING_KEY environment variable.
// It writes <out>/releases/<Product>/index.json and the release.json for this version, then prints the upload
// commands in the order that keeps the list from ever pointing at a missing file: installer, release.json,
// index.json last. A version already in the index is refused: a released version is never replaced.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { buildEntry, generateKeypair, mergeIndex } from './release-lib.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const valueFlags = ['--channel', '--notes', '--notes-url', '--min-supported', '--rollout', '--pub-date', '--index', '--out', '--bucket', '--key-file'];
const positional = args.filter((a, i) => !a.startsWith('--') && !valueFlags.includes(args[i - 1]));

function fail(message) {
  console.error(message);
  process.exit(2);
}

if (flag('--keygen')) {
  const { seed, publicKey } = generateKeypair();
  console.log('Release signing key made. Store the seed offline; it signs every release and cannot be recovered.\n');
  console.log(`  seed (secret):   ${seed}`);
  console.log(`  public key:      ${publicKey}\n`);
  console.log('Put the public key in the RELEASE_PUBLIC_KEY setting and build it into the app.');
  process.exit(0);
}

const [product, version, installer] = positional;
if (!product || !version || !installer) fail('Usage: node scripts/release-prepare.mjs <PinchPDF|NoDupe> <version> <installer> --notes "a|b" [--channel stable|beta] ... (see the top of this file)');
const seed = value('--key-file') ? readFileSync(value('--key-file'), 'utf8').trim() : process.env.RELEASE_SIGNING_KEY;
if (!seed) fail('Set RELEASE_SIGNING_KEY or pass --key-file <file holding the seed>.');
if (!value('--notes')) fail('Add --notes "first change|second change" (the major changes users will read).');

try {
  const bytes = readFileSync(installer);
  const entry = buildEntry({
    product,
    channel: value('--channel') ?? 'stable',
    version,
    fileName: basename(installer),
    bytes,
    notes: value('--notes').split('|').map((n) => n.trim()).filter(Boolean),
    notesUrl: value('--notes-url') ?? null,
    minSupported: value('--min-supported') ?? null,
    mandatory: flag('--mandatory'),
    rollout: value('--rollout') === undefined ? 100 : Number(value('--rollout')),
    pubDate: value('--pub-date'),
    seed,
  });
  const current = value('--index') ? JSON.parse(readFileSync(value('--index'), 'utf8')) : null;
  const index = mergeIndex(current, product, entry);

  const out = value('--out') ?? 'release-out';
  const folder = join(out, 'releases', product, entry.channel, version);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'release.json'), `${JSON.stringify(entry, null, 2)}\n`);
  writeFileSync(join(out, 'releases', product, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

  const bucket = value('--bucket') ?? 'tws-releases';
  const key = (name) => `releases/${product}/${entry.channel}/${version}/${name}`;
  console.log(`Prepared ${product} ${version} (${entry.channel}): ${entry.size} bytes, sha256 ${entry.sha256}\n`);
  if (!current) {
    console.log('WARNING: no --index was given, so index.json lists ONLY this release. Uploading it replaces the list in R2.');
    console.log(`Download the current one first and pass it with --index:  npx wrangler r2 object get ${bucket}/releases/${product}/index.json --file current-index.json\n`);
  }
  console.log('Upload in this order (the list last):');
  console.log(`  1. npx wrangler r2 object put ${bucket}/${key(basename(installer))} --file "${installer}"`);
  console.log(`  2. npx wrangler r2 object put ${bucket}/${key('release.json')} --file "${join(folder, 'release.json')}"`);
  console.log(`  3. npx wrangler r2 object put ${bucket}/releases/${product}/index.json --file "${join(out, 'releases', product, 'index.json')}" --content-type application/json`);
  console.log('\nThen check an older version is offered the release, the download works, and its SHA-256 matches. See docs/RELEASES.md.');
} catch (error) {
  fail(`Not prepared: ${error instanceof Error ? error.message : String(error)}`);
}
