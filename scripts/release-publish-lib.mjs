// Publishing and updating app releases on GitHub (docs/RELEASES.md, section B; releases/<Product>/RELEASE_MANAGEMENT.md).
// Pure orchestration: every outside effect (GitHub, files, prompts, the network) goes through the `io` object, so
// the tests can run it against an in-memory GitHub. scripts/release-cli.mjs supplies the real io.
//
// Order matters and is fixed:
//   1. checks (account may write, repository is public, tag is free, version is newer)
//   2. build and sign the entry, show the summary, ask for confirmation (dry run stops here)
//   3. create the GitHub release WITH the installer
//   4. download it back and check its SHA-256 (if this fails the list is never touched)
//   5. publish the list (retries once or twice if someone else changed it meanwhile)
//   6. read the list back
// The list is published last, so it never points at a download that does not exist.

import { buildEntry, mergeIndex, releaseTag, PRODUCTS } from './release-lib.mjs';

export const DEFAULT_REPO = 'technowizsolutionsllp/app-releases';
export const DEFAULT_SITE = 'https://technowizsolutions.com';
export const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/;
export const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_LIST_ATTEMPTS = 3;

/** Semantic version order (pre-releases sort before their release). Throws on anything that is not a version. */
export function compareVersions(a, b) {
  const pa = SEMVER.exec(a ?? '');
  const pb = SEMVER.exec(b ?? '');
  if (!pa || !pb) throw new Error(`not a semantic version: ${!pa ? a : b}`);
  for (let i = 1; i <= 3; i += 1) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  const ia = pa[4]?.split('.');
  const ib = pb[4]?.split('.');
  if (!ia && !ib) return 0;
  if (!ia) return 1;
  if (!ib) return -1;
  for (let i = 0; i < Math.max(ia.length, ib.length); i += 1) {
    if (i >= ia.length) return -1;
    if (i >= ib.length) return 1;
    const [x, y] = [ia[i], ib[i]];
    const [nx, ny] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (nx) return -1;
    else if (ny) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Command-line flags. Unknown flags are an error, so a typo such as --rollut never silently publishes at 100%. */
export function parseFlags(argv, { values = [], booleans = [] }) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (booleans.includes(name)) {
      if (eq !== -1) throw new Error(`${name} does not take a value`);
      flags[name] = true;
    } else if (values.includes(name)) {
      let value;
      if (eq !== -1) value = arg.slice(eq + 1);
      else {
        value = argv[i + 1];
        i += 1;
      }
      if (value === undefined || (eq === -1 && value.startsWith('--'))) throw new Error(`${name} needs a value`);
      flags[name] = value;
    } else {
      throw new Error(`unknown option ${name}`);
    }
  }
  return { flags, positional };
}

/** A new version must be higher than every version already listed in the SAME channel (so an old build is never re-offered as new). */
export function checkNewer(index, entry, allowOlder = false) {
  if (allowOlder || !index) return;
  const same = index.releases.filter((r) => r.channel === entry.channel);
  const highest = same.reduce((best, r) => (best === null || compareVersions(r.version, best) > 0 ? r.version : best), null);
  if (index.releases.some((r) => r.version === entry.version)) {
    throw new Error(`${entry.version} is already in the list; a released version is never replaced. Publish a new version.`);
  }
  if (highest !== null && compareVersions(entry.version, highest) <= 0) {
    throw new Error(
      `${entry.version} is not newer than ${highest}, which is already in the ${entry.channel} list. ` +
        'Use a higher version number. (If you really are publishing an older line on purpose, such as a hotfix, add --allow-older.)',
    );
  }
}

/** Changes the switches of one listed release. Signed facts (version, channel, file, hash, size, signature) are never touched. */
export function updateEntry(index, version, changes) {
  if (!index || !Array.isArray(index.releases)) throw new Error('there is no release list to change yet');
  const at = index.releases.findIndex((r) => r.version === version);
  if (at === -1) throw new Error(`${version} is not in the list. Listed: ${index.releases.map((r) => r.version).join(', ') || 'nothing'}`);
  const before = index.releases[at];
  const after = { ...before };
  const changed = [];
  const set = (field, value) => {
    if (JSON.stringify(after[field]) !== JSON.stringify(value)) {
      after[field] = value;
      changed.push(field);
    }
  };
  if (changes.rollout !== undefined) {
    if (!Number.isInteger(changes.rollout) || changes.rollout < 0 || changes.rollout > 100) throw new Error('rollout must be a whole number from 0 to 100');
    set('rollout_percent', changes.rollout);
  }
  if (changes.enabled !== undefined) set('enabled', changes.enabled);
  if (changes.mandatory !== undefined) set('mandatory', changes.mandatory);
  if (changes.minSupported !== undefined) {
    if (changes.minSupported !== null && !SEMVER.test(changes.minSupported)) throw new Error('min_supported must be a semantic version');
    set('min_supported', changes.minSupported);
  }
  if (changes.notes !== undefined) {
    const notes = changes.notes;
    if (!Array.isArray(notes) || notes.length < 1 || notes.length > 10 || notes.some((n) => typeof n !== 'string' || n.length < 1 || n.length > 200 || CONTROL.test(n))) {
      throw new Error('notes must be 1 to 10 short lines of plain text (200 characters each)');
    }
    set('notes', notes);
  }
  if (changes.notesUrl !== undefined) {
    if (changes.notesUrl !== null && !/^https:\/\/[^\s]+$/.test(changes.notesUrl)) throw new Error('notes_url must be an https address');
    set('notes_url', changes.notesUrl);
  }
  if (changed.length === 0) throw new Error(`nothing to change: ${version} already has those settings`);
  const releases = [...index.releases];
  releases[at] = after;
  return { index: { ...index, releases }, before, after, changed };
}

const firstLine = (text) => String(text ?? '').trim().split('\n')[0].slice(0, 200);
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;

function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`could not read ${what} from GitHub`);
  }
}

function checkTarget({ product, repo, branch }) {
  if (!PRODUCTS.includes(product)) throw new Error(`product must be one of ${PRODUCTS.join(', ')} (exact spelling)`);
  if (!REPO_PATTERN.test(repo) || repo.includes('..')) throw new Error('--repo must look like owner/name');
  if (!BRANCH_PATTERN.test(branch) || branch.includes('..')) throw new Error('--branch must be a plain branch name');
}

/** The account must be able to write to the repository, and the repository must be public (otherwise nobody could download). */
async function checkRepository(io, repo) {
  const r = await io.gh(['api', `repos/${repo}`]);
  if (r.status !== 0) throw new Error(`cannot see ${repo} with the GitHub account in use (${firstLine(r.stderr)}). Check which account is signed in: gh auth status`);
  const info = parseJson(r.stdout, repo);
  if (info.private !== false) throw new Error(`${repo} is not public. Releases must be public so the apps can download them; do not publish here.`);
  if (info.permissions?.push !== true) throw new Error(`the GitHub account in use cannot write to ${repo}. Sign in to the account that owns it (gh auth status, gh auth switch).`);
}

async function readList(io, { repo, branch, product }) {
  const r = await io.gh(['api', `repos/${repo}/contents/${product}/index.json?ref=${branch}`]);
  if (r.status !== 0) {
    if (/404|Not Found/i.test(`${r.stderr}${r.stdout}`)) return { index: null, sha: null };
    throw new Error(`could not read ${product}/index.json: ${firstLine(r.stderr)}`);
  }
  const meta = parseJson(r.stdout, `${product}/index.json`);
  const text = Buffer.from(String(meta.content ?? ''), 'base64').toString('utf8');
  return { index: parseJson(text, `${product}/index.json`), sha: meta.sha ?? null };
}

async function writeList(io, { repo, branch, product }, index, sha, message) {
  const args = ['api', '-X', 'PUT', `repos/${repo}/contents/${product}/index.json`, '-f', `message=${message}`, '-f', `content=${b64(pretty(index))}`, '-f', `branch=${branch}`];
  if (sha) args.push('-f', `sha=${sha}`);
  return io.gh(args);
}

const CONFLICT = /409|does not match|is at .* but expected/i;

function describe(entry) {
  return [
    `  version        ${entry.version}  (${entry.channel})`,
    `  installer      ${entry.file}`,
    `  size / sha256  ${entry.size} bytes / ${entry.sha256}`,
    `  rollout        ${entry.rollout_percent}%${entry.mandatory ? '   MANDATORY' : ''}`,
    `  min supported  ${entry.min_supported ?? 'none'}`,
    `  notes          ${entry.notes.join(' | ')}`,
  ];
}

/**
 * Publishes one release. Returns { tag, entry, published } (published is false for a dry run or a "no" answer).
 * opts: product, version, installer (path), channel, notes[], notesUrl, minSupported, mandatory, rollout, pubDate,
 *       repo, branch, seed, dryRun, yes, allowOlder, site, outDir
 */
export async function publishRelease(opts, io) {
  const o = { repo: DEFAULT_REPO, branch: 'main', channel: 'stable', rollout: 100, mandatory: false, outDir: 'release-out', ...opts };
  checkTarget(o);
  if (!o.seed) throw new Error('the signing seed is missing: set RELEASE_SIGNING_KEY or pass --key-file <file holding the seed>');
  const tag = releaseTag(o.product, o.version);
  const target = { product: o.product, repo: o.repo, branch: o.branch };

  io.log(`Checking ${o.repo} ...`);
  await checkRepository(io, o.repo);
  const existing = await io.gh(['api', `repos/${o.repo}/releases/tags/${tag}`]);
  if (existing.status === 0) throw new Error(`a GitHub release ${tag} already exists. A released version is never replaced: publish a new version.`);
  if (!/404|Not Found/i.test(`${existing.stderr}${existing.stdout}`)) throw new Error(`could not check for an existing release ${tag}: ${firstLine(existing.stderr)}`);

  const current = await readList(io, target);
  if (!current.index) io.log(`Note: ${o.product}/index.json does not exist yet in ${o.repo}; it will be created.`);

  const bytes = await io.readFile(o.installer);
  const fileName = o.installer.split(/[\\/]/).pop();
  const entry = buildEntry({
    product: o.product,
    channel: o.channel,
    version: o.version,
    fileName,
    bytes,
    notes: o.notes,
    notesUrl: o.notesUrl ?? null,
    minSupported: o.minSupported ?? null,
    mandatory: o.mandatory,
    rollout: o.rollout,
    pubDate: o.pubDate,
    seed: o.seed,
  });
  checkNewer(current.index, entry, o.allowOlder);
  const nextIndex = mergeIndex(current.index, o.product, entry);

  const releaseFile = `${o.outDir}/${tag}/release.json`;
  const indexFile = `${o.outDir}/${o.product}/index.json`;
  await io.writeFile(releaseFile, pretty(entry));
  await io.writeFile(indexFile, pretty(nextIndex));

  io.log(`\nAbout to publish ${o.product} ${o.version} to ${o.repo}:`);
  for (const line of describe(entry)) io.log(line);
  io.log(`  will create    GitHub release ${tag}${o.channel === 'beta' ? ' (pre-release)' : ''}, then publish ${o.product}/index.json on ${o.branch}`);
  io.log(`  local copies   ${releaseFile}, ${indexFile}`);

  if (o.dryRun) {
    io.log('\nDry run: nothing was published. Run again without --dry-run to publish.');
    return { tag, entry, published: false };
  }
  if (!o.yes && !(await io.confirm(o.version))) {
    io.log('\nNot confirmed: nothing was published.');
    return { tag, entry, published: false };
  }

  io.log(`\n1/4 Creating GitHub release ${tag} with the installer ...`);
  const notes = o.notes.map((n) => `- ${n}`).join('\n');
  const create = await io.gh([
    'release', 'create', tag, o.installer, releaseFile,
    '--repo', o.repo,
    '--title', `${o.product} ${o.version}`,
    '--notes', notes,
    '--latest=false',
    ...(o.channel === 'beta' ? ['--prerelease'] : []),
  ]);
  if (create.status !== 0) throw new Error(`the GitHub release was not created (${firstLine(create.stderr)}). Nothing was published; fix the cause and run again.`);

  io.log('2/4 Downloading it back to check the file ...');
  const url = `https://github.com/${o.repo}/releases/download/${tag}/${fileName}`;
  let downloaded = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    downloaded = await io.fetchBytes(url);
    if (downloaded.status === 200) break;
    await io.sleep(3000);
  }
  if (!downloaded || downloaded.status !== 200) {
    throw new Error(`the release ${tag} was created but its download ${url} did not answer 200. The list was NOT published. Check the release page, then run: publish the list by hand (docs/RELEASES.md) or delete the draft/release and start again with a new version.`);
  }
  const hash = await io.sha256(downloaded.bytes);
  if (hash !== entry.sha256 || downloaded.bytes.length !== entry.size) {
    throw new Error(`STOP: the file GitHub serves for ${tag} does not match the installer you signed (hash ${hash}, ${downloaded.bytes.length} bytes). The list was NOT published, so no app will be offered it. Do not reuse this version number.`);
  }

  io.log(`3/4 Publishing ${o.product}/index.json ...`);
  const message = `Release ${o.product} ${o.version} (${o.channel}, ${o.rollout}%)`;
  let state = current;
  let published = false;
  for (let attempt = 1; attempt <= MAX_LIST_ATTEMPTS && !published; attempt += 1) {
    if (attempt > 1) state = await readList(io, target); // someone else changed the list: start from their version
    const index = attempt === 1 ? nextIndex : mergeIndex(state.index, o.product, entry);
    const put = await writeList(io, target, index, state.sha, message);
    if (put.status === 0) published = true;
    else if (!CONFLICT.test(`${put.stderr}${put.stdout}`) || attempt === MAX_LIST_ATTEMPTS) {
      throw new Error(`the GitHub release ${tag} IS created, but the list was not published (${firstLine(put.stderr)}). Publish ${indexFile} as ${o.product}/index.json on ${o.branch} by hand (docs/RELEASES.md); nothing else needs redoing.`);
    } else {
      io.log('    the list changed while publishing; retrying on top of the new version ...');
    }
  }

  io.log('4/4 Reading the list back ...');
  const back = await readList(io, target);
  const listed = back.index?.releases?.find((r) => r.version === o.version);
  if (!listed || listed.signature !== entry.signature) throw new Error(`the list was written but ${o.version} is not in it when read back. Look at ${o.product}/index.json on ${o.repo} before doing anything else.`);

  io.log(`\nPublished ${o.product} ${o.version}.`);
  if (o.site) {
    const check = await io.fetchJson(`${o.site}/api/${o.product.toLowerCase()}/updates/v1/check?v=0.0.0&channel=${o.channel}`);
    const seen = check.status === 200 && check.json?.version === o.version;
    io.log(seen ? `The website already offers it (${o.site}).` : `The website does not offer it yet (answer ${check.status}); that is normal, it caches the list for about 10 minutes.`);
  }
  io.log('Next: wait about 10 minutes, check an older app is offered it, then raise the rollout:');
  io.log(`  node scripts/release-update.mjs ${o.product} ${o.version} --rollout 25`);
  return { tag, entry, published: true };
}

/** Changes rollout, pause, withdrawal, mandatory, min_supported or notes of a listed release. Needs no signing seed. */
export async function updateRelease(opts, io) {
  const o = { repo: DEFAULT_REPO, branch: 'main', ...opts };
  checkTarget(o);
  io.log(`Checking ${o.repo} ...`);
  await checkRepository(io, o.repo);
  const target = { product: o.product, repo: o.repo, branch: o.branch };
  let state = await readList(io, target);
  let { index, before, after, changed } = updateEntry(state.index, o.version, o.changes);

  io.log(`\nAbout to change ${o.product} ${o.version} in ${o.repo}:`);
  for (const field of changed) io.log(`  ${field}: ${JSON.stringify(before[field])}  ->  ${JSON.stringify(after[field])}`);
  io.log('  (signed facts such as the installer, hash, size and signature are not touched)');
  if (o.dryRun) {
    io.log('\nDry run: nothing was changed.');
    return { changed, published: false };
  }
  if (!o.yes && !(await io.confirm(o.version))) {
    io.log('\nNot confirmed: nothing was changed.');
    return { changed, published: false };
  }

  const message = `${o.product} ${o.version}: ${changed.map((f) => `${f} ${JSON.stringify(before[f])} -> ${JSON.stringify(after[f])}`).join(', ')}`.slice(0, 200);
  for (let attempt = 1; attempt <= MAX_LIST_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      state = await readList(io, target);
      ({ index } = updateEntry(state.index, o.version, o.changes));
    }
    const put = await writeList(io, target, index, state.sha, message);
    if (put.status === 0) {
      io.log(`\nChanged. It takes effect within about 10 minutes (the website and GitHub both cache the list).`);
      return { changed, published: true };
    }
    if (!CONFLICT.test(`${put.stderr}${put.stdout}`) || attempt === MAX_LIST_ATTEMPTS) throw new Error(`the list was not changed (${firstLine(put.stderr)})`);
    io.log('    the list changed while saving; retrying on top of the new version ...');
  }
  return { changed, published: false };
}
