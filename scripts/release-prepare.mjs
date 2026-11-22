// Prepares an app release for publishing on GitHub (docs/RELEASES.md, section B). Nothing is uploaded.
//
//   node scripts/release-prepare.mjs --keygen
//       Makes a new release signing key. Keep the seed offline (never in this repository); the public key
//       goes in the RELEASE_PUBLIC_KEY setting and is built into the app.
//
//   node scripts/release-prepare.mjs <PinchPDF|NoDupe> <version> <installer.exe> --notes "line 1|line 2"
//        [--channel stable|beta] [--notes-url https://...] [--min-supported 1.1.0] [--mandatory]
//        [--rollout 5] [--pub-date 2026-12-01T00:00:00Z]
//        [--index current-index.json] [--out release-out] [--repo owner/name] [--key-file seed.txt]
//
// The signing seed comes from --key-file or the RELEASE_SIGNING_KEY environment variable.
// It writes <out>/<Product>/index.json (the new list) and <out>/<tag>/release.json (this release's entry), then
// prints the two steps in the order that keeps the list from ever pointing at a missing file: create the GitHub
// release with the installer first, then publish the list. A version already in the list is refused: a released
// version is never replaced.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { buildEntry, generateKeypair, mergeIndex, releaseTag } from './release-lib.mjs';

const DEFAULT_REPO = 'technowizsolutionsllp/app-releases';
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const valueFlags = ['--channel', '--notes', '--notes-url', '--min-supported', '--rollout', '--pub-date', '--index', '--out', '--repo', '--key-file'];
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
const repo = value('--repo') ?? DEFAULT_REPO;
if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)) fail('--repo must look like owner/name');

try {
  const bytes = readFileSync(installer);
  const notes = value('--notes').split('|').map((n) => n.trim()).filter(Boolean);
  const entry = buildEntry({
    product,
    channel: value('--channel') ?? 'stable',
    version,
    fileName: basename(installer),
    bytes,
    notes,
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
  const tag = releaseTag(product, version);
  mkdirSync(join(out, tag), { recursive: true });
  mkdirSync(join(out, product), { recursive: true });
  const releaseFile = join(out, tag, 'release.json');
  const indexFile = join(out, product, 'index.json');
  writeFileSync(releaseFile, `${JSON.stringify(entry, null, 2)}\n`);
  writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);

  console.log(`Prepared ${product} ${version} (${entry.channel}): ${entry.size} bytes, sha256 ${entry.sha256}\n`);
  if (!current) {
    console.log('WARNING: no --index was given, so the new list contains ONLY this release. Publishing it replaces the list.');
    console.log(`Fetch the current one first and pass it with --index:\n  curl -fsSL https://raw.githubusercontent.com/${repo}/main/${product}/index.json -o current-index.json\n`);
  }
  const prerelease = entry.channel === 'beta' ? ' --prerelease' : '';
  console.log('Publish in this order (the list last):');
  console.log(`  1. Create the GitHub release with the installer attached, signed in to the account that owns ${repo}`);
  console.log(`     (browser: https://github.com/${repo}/releases/new, or the command below after "gh auth switch"):`);
  console.log(`     gh release create ${tag} "${installer}" "${releaseFile}" --repo ${repo} --title "${product} ${version}" --notes "${notes.join('; ').replaceAll('"', "'")}"${prerelease}`);
  console.log(`  2. Publish the list: replace ${product}/index.json on the main branch of ${repo} with`);
  console.log(`     ${indexFile}`);
  console.log(`     (in the GitHub web editor, or: clone the repository, copy the file over, commit and push).`);
  console.log('\nThen check an older version is offered the release, the download works, and its SHA-256 matches. See docs/RELEASES.md.');
} catch (error) {
  fail(`Not prepared: ${error instanceof Error ? error.message : String(error)}`);
}
