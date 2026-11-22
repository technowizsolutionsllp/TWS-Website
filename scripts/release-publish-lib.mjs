// Publishing and updating app releases on GitHub. Process: RELEASE_MANAGEMENT.md in each product repository; background and
// decisions: docs/RELEASES.md, section B, in the website repository (the source of truth for this file; the product
// repositories hold byte-identical copies, kept in step with scripts/sync-release-scripts.mjs).
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
/** The percent of installs a new release is offered to when --rollout is not given: small on purpose, then raised. */
export const DEFAULT_ROLLOUT = 5;
/** "owner/name" (same rule as the website's RELEASES_REPO check): no "." or ".." part, no trailing ".git". */
export const isRepoName = (repo) => REPO_PATTERN.test(repo) && !repo.includes('..') && repo.split('/').every((part) => part !== '.') && !repo.endsWith('.git');
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
  if (!isRepoName(repo)) throw new Error('--repo must look like owner/name');
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
    entry.mandatory
      ? '  rollout        MANDATORY: every app is forced to update at once, whatever the rollout percent says (--pause still holds it)'
      : `  rollout        ${entry.rollout_percent}%`,
    `  min supported  ${entry.min_supported ?? 'none'}${entry.min_supported ? ' (apps below it are forced to update at once)' : ''}`,
    `  notes          ${entry.notes.join(' | ')}`,
  ];
}

/**
 * Publishes one release. Returns { tag, entry, published } (published is false for a dry run or a "no" answer).
 * opts: product, version, installer (path), channel, notes[], notesUrl, minSupported, mandatory, rollout, pubDate,
 *       repo, branch, seed, dryRun, yes, allowOlder, site, outDir, updateCommand (only used in the "Next:" hint)
 */
export async function publishRelease(opts, io) {
  const o = { repo: DEFAULT_REPO, branch: 'main', channel: 'stable', rollout: DEFAULT_ROLLOUT, mandatory: false, outDir: 'release-out', ...opts };
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
  io.log(`  will do        create GitHub release ${tag}${o.channel === 'beta' ? ' (pre-release)' : ''} as a draft, check its file, publish it, then publish ${o.product}/index.json on ${o.branch}`);
  io.log(`  local copies   ${releaseFile}, ${indexFile}`);

  if (o.dryRun) {
    io.log('\nDry run: nothing was published. Run again without --dry-run to publish.');
    return { tag, entry, published: false };
  }
  if (!o.yes && !(await io.confirm(o.version))) {
    io.log('\nNot confirmed: nothing was published.');
    return { tag, entry, published: false };
  }

  // The release is created as a DRAFT with the installer attached, checked, and only then published. Immutable releases
  // do not accept assets after publishing, and a draft lets the file be checked before anything is public.
  io.log(`\nStep 1 of 7: creating GitHub release ${tag} as a draft with the installer ...`);
  const notes = o.notes.map((n) => `- ${n}`).join('\n');
  const create = await io.gh([
    'release', 'create', tag, o.installer, releaseFile,
    '--repo', o.repo,
    '--title', `${o.product} ${o.version}`,
    '--notes', notes,
    '--latest=false',
    '--draft',
    ...(o.channel === 'beta' ? ['--prerelease'] : []),
  ]);
  if (create.status !== 0) throw new Error(`the GitHub release was not created (${firstLine(create.stderr)}). Nothing was published; if a draft ${tag} was left on GitHub, delete it, fix the cause and run again.`);

  io.log('Step 2 of 7: downloading the draft back to check the file ...');
  const checkDir = `${o.outDir}/${tag}/check`;
  await io.writeFile(`${checkDir}/.keep`, '');
  const fetched = await io.gh(['release', 'download', tag, '--repo', o.repo, '--pattern', fileName, '--dir', checkDir, '--clobber']);
  if (fetched.status !== 0) {
    throw new Error(`the draft release ${tag} exists, but its installer could not be downloaded back (${firstLine(fetched.stderr)}). Nothing is public. Delete the draft ${tag} on GitHub and run again.`);
  }
  const draftBytes = await io.readFile(`${checkDir}/${fileName}`);
  const draftHash = await io.sha256(draftBytes);
  if (draftHash !== entry.sha256 || draftBytes.length !== entry.size) {
    throw new Error(`STOP: the installer stored in the draft ${tag} does not match the one you signed (hash ${draftHash}, ${draftBytes.length} bytes). Nothing is public and the list was NOT published. Delete the draft ${tag} on GitHub and run again.`);
  }

  io.log('Step 3 of 7: publishing the release ...');
  const publish = await io.gh(['release', 'edit', tag, '--repo', o.repo, '--draft=false']);
  if (publish.status !== 0) {
    throw new Error(`the draft ${tag} is checked but could not be published (${firstLine(publish.stderr)}). The list was NOT published. Publish the draft on its GitHub page, then publish ${indexFile} by hand (docs/RELEASES.md).`);
  }

  io.log('Step 4 of 7: checking the public download ...');
  const url = `https://github.com/${o.repo}/releases/download/${tag}/${fileName}`;
  let downloaded = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    downloaded = await io.fetchBytes(url);
    if (downloaded.status === 200) break;
    await io.sleep(3000);
  }
  if (!downloaded || downloaded.status !== 200) {
    throw new Error(`the release ${tag} is published but its public download ${url} did not answer 200. The list was NOT published. Check the release page; once the download works, publish ${indexFile} by hand (docs/RELEASES.md).`);
  }
  const hash = await io.sha256(downloaded.bytes);
  if (hash !== entry.sha256 || downloaded.bytes.length !== entry.size) {
    throw new Error(`STOP: the file GitHub serves for ${tag} does not match the installer you signed (hash ${hash}, ${downloaded.bytes.length} bytes). The list was NOT published, so no app will be offered it. Do not reuse this version number.`);
  }

  io.log(`Step 5 of 7: publishing ${o.product}/index.json ...`);
  const message = `Release ${o.product} ${o.version} (${o.channel}, ${o.rollout}%)`;
  let state = current;
  let published = false;
  for (let attempt = 1; attempt <= MAX_LIST_ATTEMPTS && !published; attempt += 1) {
    if (attempt > 1) state = await readList(io, target); // someone else changed the list: start from their version
    const index = attempt === 1 ? nextIndex : mergeIndex(state.index, o.product, entry);
    const put = await writeList(io, target, index, state.sha, message);
    if (put.status === 0) published = true;
    else if (!CONFLICT.test(`${put.stderr}${put.stdout}`) || attempt === MAX_LIST_ATTEMPTS) {
      throw new Error(`the GitHub release ${tag} IS published, but the list was not published (${firstLine(put.stderr)}). Publish ${indexFile} as ${o.product}/index.json on ${o.branch} by hand (docs/RELEASES.md); nothing else needs redoing.`);
    } else {
      io.log('    the list changed while publishing; retrying on top of the new version ...');
    }
  }

  io.log('Step 6 of 7: reading the list back ...');
  const back = await readList(io, target);
  const listed = back.index?.releases?.find((r) => r.version === o.version);
  if (!listed || listed.signature !== entry.signature) throw new Error(`the list was written but ${o.version} is not in it when read back. Look at ${o.product}/index.json on ${o.repo} before doing anything else.`);

  io.log('Step 7 of 7: updating the downloads page ...');
  const page = await writePage(io, target, back.index);
  if (!page.ok) {
    io.log(`Warning: the release and the list are published, but the downloads page for ${o.product} could not be updated (${page.reason}). Run: ${o.pageCommand ?? `node scripts/release-page.mjs ${o.product}`}`);
  }

  io.log(`\nPublished ${o.product} ${o.version}.`);
  if (o.site) {
    const check = await io.fetchJson(`${o.site}/api/${o.product.toLowerCase()}/updates/v1/check?v=0.0.0&channel=${o.channel}`);
    const seen = check.status === 200 && check.json?.version === o.version;
    io.log(seen ? `The website already offers it (${o.site}).` : `The website does not offer it yet (answer ${check.status}); that is normal, it caches the list for about 10 minutes.`);
  }
  io.log('Next: wait about 10 minutes, check an older app is offered it, then raise the rollout:');
  io.log(`  ${o.updateCommand ?? `node scripts/release-update.mjs ${o.product}`} ${o.version} --rollout 25`);
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
      const page = await writePage(io, target, index);
      if (!page.ok) io.log(`Warning: the list is changed, but the downloads page for ${o.product} could not be updated (${page.reason}). Run: ${o.pageCommand ?? `node scripts/release-page.mjs ${o.product}`}`);
      return { changed, published: true };
    }
    if (!CONFLICT.test(`${put.stderr}${put.stdout}`) || attempt === MAX_LIST_ATTEMPTS) throw new Error(`the list was not changed (${firstLine(put.stderr)})`);
    io.log('    the list changed while saving; retrying on top of the new version ...');
  }
  return { changed, published: false };
}

// ---------------------------------------------------------------------------------------------------------------------
// The downloads page: <Product>/README.md in the releases repository. GitHub shows a folder's README under its file list,
// so https://github.com/<repo>/tree/main/<Product> is the product's public downloads page. It is GENERATED from the signed
// list (index.json) every time a release is published or changed, so it can never disagree with what the apps are offered.
// ---------------------------------------------------------------------------------------------------------------------

const PAGE_NOTE = '<!-- Generated by the release scripts from index.json. Do not edit by hand: the next release overwrites it. -->';
const escapeMd = (text) => String(text).replace(/[\\`*_{}[\]<>#|~]/g, (c) => `\\${c}`);

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The downloads page for one product, as Markdown. Shows every release that is enabled and not paused (rollout above 0),
 * newest first; withdrawn and paused releases are not listed. Pure: the same list always gives the same page.
 */
export function renderDownloadsPage(product, index, repo) {
  const shown = shownReleases(index);
  const link = (r) => `https://github.com/${repo}/releases/download/${r.file}`;
  const fileName = (r) => r.file.split('/').pop();
  const lines = [PAGE_NOTE, '', `# ${product} downloads`, '', `Also as a web page: [${pagesUrl(repo, product)}](${pagesUrl(repo, product)})`, ''];
  if (shown.length === 0) {
    lines.push('No release has been published yet.', '');
  } else {
    const stable = shown.find((r) => r.channel === 'stable');
    const beta = shown.find((r) => r.channel === 'beta' && (!stable || compareVersions(r.version, stable.version) > 0));
    const feature = (r, label) => {
      lines.push(`**${label}: ${escapeMd(r.version)}** (released ${r.pub_date.slice(0, 10)})`, '');
      lines.push(`[Download ${escapeMd(fileName(r))}](${link(r)}), ${formatSize(r.size)}`, '', `SHA-256: \`${r.sha256}\``, '');
    };
    if (stable) feature(stable, 'Current version');
    if (beta) feature(beta, stable ? 'Newest beta (for testers)' : 'Newest beta (for testers, no stable version yet)');
    lines.push('## All versions', '', '| Version | Channel | Released | Download | Size | SHA-256 |', '|---|---|---|---|---|---|');
    for (const r of shown) {
      lines.push(`| ${escapeMd(r.version)} | ${r.channel} | ${r.pub_date.slice(0, 10)} | [${escapeMd(fileName(r))}](${link(r)}) | ${formatSize(r.size)} | \`${r.sha256}\` |`);
    }
    lines.push('', '## What changed', '');
    for (const r of shown) {
      lines.push(`### ${escapeMd(r.version)}${r.channel === 'beta' ? ' (beta)' : ''}`, '');
      for (const note of r.notes) lines.push(`- ${escapeMd(note)}`);
      if (r.notes_url) lines.push('', `[Full release notes](${r.notes_url})`);
      lines.push('');
    }
  }
  if (shown.length > 0) {
    lines.push('## Check your download', '', 'In PowerShell, run `Get-FileHash .\\<file name> -Algorithm SHA256`. The result must match the SHA-256 shown above for that file.', '');
  }
  lines.push(
    `Each version is listed here only once it is published and available. Every release is signed by Technowiz Solutions, and ${escapeMd(product)} checks that signature itself before it installs an update. All releases of all products: [${repo}](https://github.com/${repo}/releases).`,
    '',
  );
  return lines.join('\n');
}

/** The address of the product's web downloads page (GitHub Pages): https://<owner>.github.io/<repo>/<Product>/ */
export function pagesUrl(repo, product) {
  const [owner, name] = repo.split('/');
  return `https://${owner.toLowerCase()}.github.io/${name}/${product}/`;
}

const escapeHtml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The releases a visitor may download: enabled and not paused, newest first. */
function shownReleases(index) {
  return (index?.releases ?? []).filter((r) => r.enabled !== false && r.rollout_percent > 0).sort((a, b) => compareVersions(b.version, a.version));
}

const PAGE_CSS = `
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1a1d23; --muted: #5b6270; --line: #dfe3ea; --card: #f5f7fa; --accent: #1f5fd1; --accent-fg: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg: #14171c; --fg: #e8ebf0; --muted: #a2a9b6; --line: #2c323c; --card: #1c2027; --accent: #6ea0ff; --accent-fg: #0d1117; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 820px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 1.9rem; margin: 0 0 4px; }
h2 { font-size: 1.25rem; margin: 36px 0 12px; }
h3 { font-size: 1.05rem; margin: 20px 0 6px; }
.sub { color: var(--muted); margin: 0 0 24px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; margin: 0 0 16px; }
.card h2 { margin: 0 0 4px; }
.button { display: inline-block; background: var(--accent); color: var(--accent-fg); padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 10px 0 8px; }
.button:hover { filter: brightness(1.08); }
a { color: var(--accent); }
code { font: 0.85em ui-monospace, SFMono-Regular, Consolas, monospace; word-break: break-all; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
.muted { color: var(--muted); }
ul { margin: 6px 0 0; padding-left: 22px; }
footer { margin-top: 40px; color: var(--muted); font-size: 0.9rem; }
`;

/**
 * The same page as a small static web page (GitHub Pages serves <Product>/index.html at the product's address).
 * No script, inline CSS only, every value from the list escaped. Pure.
 */
export function renderDownloadsHtml(product, index, repo) {
  const shown = shownReleases(index);
  const link = (r) => `https://github.com/${repo}/releases/download/${r.file}`;
  const fileName = (r) => r.file.split('/').pop();
  const name = escapeHtml(product);
  const out = [];
  out.push('<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">');
  out.push(`<title>${name} downloads</title>`, `<meta name="description" content="Download ${name} for Windows: every available version with its size, SHA-256 and what changed.">`);
  out.push(`<style>${PAGE_CSS}</style>`, '</head>', '<body>', '<main>', `<!-- ${PAGE_NOTE.slice(5, -4).trim()} -->`);
  out.push(`<h1>${name} downloads</h1>`, `<p class="sub">Windows installers, published by Technowiz Solutions.</p>`);
  if (shown.length === 0) {
    out.push('<p>No release has been published yet.</p>');
  } else {
    const stable = shown.find((r) => r.channel === 'stable');
    const beta = shown.find((r) => r.channel === 'beta' && (!stable || compareVersions(r.version, stable.version) > 0));
    const card = (r, label) => {
      out.push('<section class="card">', `<h2>${label}: ${escapeHtml(r.version)}</h2>`, `<div class="muted">Released ${escapeHtml(r.pub_date.slice(0, 10))}, ${formatSize(r.size)}</div>`);
      out.push(`<a class="button" href="${escapeHtml(link(r))}">Download ${escapeHtml(fileName(r))}</a>`, `<div class="muted">SHA-256: <code>${escapeHtml(r.sha256)}</code></div>`, '</section>');
    };
    if (stable) card(stable, 'Current version');
    if (beta) card(beta, stable ? 'Newest beta (for testers)' : 'Newest beta (for testers, no stable version yet)');
    out.push('<h2>All versions</h2>', '<div class="table-wrap">', '<table>', '<thead><tr><th>Version</th><th>Channel</th><th>Released</th><th>Download</th><th>Size</th><th>SHA-256</th></tr></thead>', '<tbody>');
    for (const r of shown) {
      out.push(`<tr><td>${escapeHtml(r.version)}</td><td>${r.channel}</td><td>${escapeHtml(r.pub_date.slice(0, 10))}</td><td><a href="${escapeHtml(link(r))}">${escapeHtml(fileName(r))}</a></td><td>${formatSize(r.size)}</td><td><code>${escapeHtml(r.sha256)}</code></td></tr>`);
    }
    out.push('</tbody>', '</table>', '</div>', '<h2>What changed</h2>');
    for (const r of shown) {
      out.push(`<h3>${escapeHtml(r.version)}${r.channel === 'beta' ? ' (beta)' : ''}</h3>`, '<ul>');
      for (const note of r.notes) out.push(`<li>${escapeHtml(note)}</li>`);
      out.push('</ul>');
      if (r.notes_url) out.push(`<p><a href="${escapeHtml(r.notes_url)}">Full release notes</a></p>`);
    }
    out.push('<h2>Check your download</h2>', '<p>In PowerShell, run <code>Get-FileHash .\\&lt;file name&gt; -Algorithm SHA256</code>. The result must match the SHA-256 shown above for that file.</p>');
  }
  out.push('<footer>', `<p>Each version is listed here only once it is published and available. Every release is signed by Technowiz Solutions, and ${name} checks that signature itself before it installs an update.</p>`);
  out.push(`<p><a href="https://github.com/${escapeHtml(repo)}/releases">All releases</a> · <a href="https://github.com/${escapeHtml(repo)}/tree/main/${name}">This page on GitHub</a> · <a href="../">All apps</a></p>`, '</footer>', '</main>', '</body>', '</html>', '');
  return out.join('\n');
}

/** Writes one file of the releases repository if its content changed. Never throws: returns { ok, changed, reason }. */
async function writeFileIfChanged(io, { repo, branch }, path, next, message) {
  try {
    const current = await io.gh(['api', `repos/${repo}/contents/${path}?ref=${branch}`]);
    let sha = null;
    let currentText = null;
    if (current.status === 0) {
      const meta = parseJson(current.stdout, path);
      sha = meta.sha ?? null;
      currentText = Buffer.from(String(meta.content ?? ''), 'base64').toString('utf8');
    } else if (!/404|Not Found/i.test(`${current.stderr}${current.stdout}`)) {
      return { ok: false, changed: false, reason: firstLine(current.stderr) };
    }
    if (currentText === next) return { ok: true, changed: false };
    const args = ['api', '-X', 'PUT', `repos/${repo}/contents/${path}`, '-f', `message=${message}`, '-f', `content=${b64(next)}`, '-f', `branch=${branch}`];
    if (sha) args.push('-f', `sha=${sha}`);
    const put = await io.gh(args);
    return put.status === 0 ? { ok: true, changed: true } : { ok: false, changed: false, reason: firstLine(put.stderr) };
  } catch (error) {
    return { ok: false, changed: false, reason: String(error?.message ?? error).slice(0, 200) };
  }
}

/** Writes <Product>/README.md (the GitHub folder page) and <Product>/index.html (the GitHub Pages page). Never throws. */
async function writePage(io, { repo, branch, product }, index) {
  let changed = false;
  const files = [
    [`${product}/README.md`, renderDownloadsPage(product, index, repo)],
    [`${product}/index.html`, renderDownloadsHtml(product, index, repo)],
  ];
  for (const [path, content] of files) {
    const result = await writeFileIfChanged(io, { repo, branch }, path, content, `Update the ${product} downloads page`);
    if (!result.ok) return { ok: false, changed, reason: `${path}: ${result.reason}` };
    changed = changed || result.changed;
  }
  return { ok: true, changed };
}

/** Regenerates the downloads page from the list that is published now (after a manual edit, or the first time). */
export async function refreshPage(opts, io) {
  const o = { repo: DEFAULT_REPO, branch: 'main', ...opts };
  checkTarget(o);
  io.log(`Checking ${o.repo} ...`);
  await checkRepository(io, o.repo);
  const { index } = await readList(io, { repo: o.repo, branch: o.branch, product: o.product });
  if (o.dryRun) {
    io.log(renderDownloadsPage(o.product, index, o.repo));
    io.log(`Dry run: the page above (and the web page ${o.product}/index.html made from the same list) was not written.`);
    return { ok: true, changed: false };
  }
  const result = await writePage(io, { repo: o.repo, branch: o.branch, product: o.product }, index);
  if (!result.ok) throw new Error(`the downloads page could not be written (${result.reason})`);
  io.log(result.changed ? `Updated ${o.product}/README.md and ${o.product}/index.html: https://github.com/${o.repo}/tree/${o.branch}/${o.product} and ${pagesUrl(o.repo, o.product)}` : 'The downloads page is already up to date.');
  return result;
}

export const PAGE_FLAGS = { values: ['--repo', '--branch'], booleans: ['--dry-run'] };

/** argv: [...flags]. */
export async function pageFromArgs(argv, product, deps) {
  const { flags, positional } = parseFlags(argv, PAGE_FLAGS);
  if (positional.length !== 0) throw new Error('Usage: [--dry-run] [--repo owner/name] [--branch main] (regenerates the downloads page from the published list)');
  const repo = flags['--repo'] ?? DEFAULT_REPO;
  return refreshPage({ product, repo, branch: flags['--branch'] ?? 'main', dryRun: flags['--dry-run'] === true }, deps.makeIo(repo));
}

// ---------------------------------------------------------------------------------------------------------------------
// Command line arguments -> options. Kept here (not in release-cli.mjs) so the same code is tested with fake effects.
// deps = { makeIo(repo), env, exists(path), readText(path) }: GitHub and the files, supplied by release-cli.mjs.
// ---------------------------------------------------------------------------------------------------------------------

export const PUBLISH_FLAGS = {
  values: ['--channel', '--notes', '--notes-url', '--min-supported', '--rollout', '--pub-date', '--repo', '--branch', '--key-file', '--out', '--site'],
  booleans: ['--mandatory', '--dry-run', '--yes', '--allow-older', '--no-site-check'],
};
export const UPDATE_FLAGS = {
  values: ['--rollout', '--min-supported', '--notes', '--notes-url', '--repo', '--branch'],
  booleans: ['--pause', '--withdraw', '--enable', '--mandatory', '--not-mandatory', '--dry-run', '--yes', '--clear-min-supported'],
};

const splitNotes = (text) => text.split('|').map((n) => n.trim()).filter(Boolean);

/**
 * argv: [version, installer, ...flags].
 * options.defaults = { version, installer(version) }: the product's own version (from package.json) and where its
 *   build puts the installer. With no version or installer given they are used; a version that differs from it is refused,
 *   because the installer carries the package version.
 * options.updateCommand: how to run the update script, shown in the "Next:" hint.
 * options.buildHint: what to tell the person when the installer file is missing.
 * options.pageCommand: how to run the downloads page script, shown if the page could not be updated.
 */
export async function publishFromArgs(argv, product, options, deps) {
  const { flags, positional } = parseFlags(argv, PUBLISH_FLAGS);
  const { defaults } = options ?? {};
  let [version, installer] = positional;
  if (positional.length === 0 && defaults) {
    version = defaults.version;
    installer = defaults.installer(version);
  } else if (positional.length !== 2) {
    throw new Error(`Usage: ${defaults ? '[<version> <installer.exe>] ' : '<version> <installer.exe> '}--notes "first change|second change" [--channel stable|beta] [--rollout 5] [--dry-run] ... (see RELEASE_MANAGEMENT.md)`);
  }
  if (defaults && version !== defaults.version) {
    throw new Error(`Version ${version} is not the version in package.json (${defaults.version}). The installer carries the package version: bump it and build again, or fix the version you typed.`);
  }
  if (!deps.exists(installer)) throw new Error(`The installer ${installer} does not exist.${options?.buildHint ? ` ${options.buildHint}` : ''}`);
  if (!flags['--notes']) throw new Error('Add --notes "first change|second change" (the major changes users will read).');
  const seed = flags['--key-file'] ? (await deps.readText(flags['--key-file'])).trim() : deps.env.RELEASE_SIGNING_KEY?.trim();
  const repo = flags['--repo'] ?? DEFAULT_REPO;
  return publishRelease(
    {
      product,
      version,
      installer,
      channel: flags['--channel'] ?? 'stable',
      notes: splitNotes(flags['--notes']),
      notesUrl: flags['--notes-url'] ?? null,
      minSupported: flags['--min-supported'] ?? null,
      mandatory: flags['--mandatory'] === true,
      rollout: flags['--rollout'] === undefined ? DEFAULT_ROLLOUT : Number(flags['--rollout']),
      pubDate: flags['--pub-date'],
      repo,
      branch: flags['--branch'] ?? 'main',
      seed,
      dryRun: flags['--dry-run'] === true,
      yes: flags['--yes'] === true,
      allowOlder: flags['--allow-older'] === true,
      outDir: flags['--out'] ?? 'release-out',
      site: flags['--no-site-check'] ? null : (flags['--site'] ?? DEFAULT_SITE),
      updateCommand: options?.updateCommand,
      pageCommand: options?.pageCommand,
    },
    deps.makeIo(repo),
  );
}

/** argv: [version, ...flags]. */
export async function updateFromArgs(argv, product, deps, options) {
  const { flags, positional } = parseFlags(argv, UPDATE_FLAGS);
  if (positional.length !== 1) {
    throw new Error('Usage: <version> [--rollout 25 | --pause | --withdraw | --enable] [--mandatory | --not-mandatory] [--min-supported 1.1.0 | --clear-min-supported] [--notes "a|b"] [--dry-run] (see RELEASE_MANAGEMENT.md)');
  }
  const changes = {};
  if (flags['--pause'] && flags['--rollout'] !== undefined) throw new Error('use either --pause or --rollout, not both');
  if (flags['--pause']) changes.rollout = 0;
  if (flags['--rollout'] !== undefined) changes.rollout = Number(flags['--rollout']);
  if (flags['--withdraw'] && flags['--enable']) throw new Error('use either --withdraw or --enable, not both');
  if (flags['--withdraw']) changes.enabled = false;
  if (flags['--enable']) changes.enabled = true;
  if (flags['--mandatory'] && flags['--not-mandatory']) throw new Error('use either --mandatory or --not-mandatory, not both');
  if (flags['--mandatory']) changes.mandatory = true;
  if (flags['--not-mandatory']) changes.mandatory = false;
  if (flags['--min-supported'] !== undefined && flags['--clear-min-supported']) throw new Error('use either --min-supported or --clear-min-supported, not both');
  if (flags['--min-supported'] !== undefined) changes.minSupported = flags['--min-supported'];
  if (flags['--clear-min-supported']) changes.minSupported = null;
  if (flags['--notes'] !== undefined) changes.notes = splitNotes(flags['--notes']);
  if (flags['--notes-url'] !== undefined) changes.notesUrl = flags['--notes-url'];
  if (Object.keys(changes).length === 0) {
    throw new Error('Nothing to change: give at least one of --rollout, --pause, --withdraw, --enable, --mandatory, --not-mandatory, --min-supported, --notes.');
  }
  const repo = flags['--repo'] ?? DEFAULT_REPO;
  return updateRelease(
    { product, version: positional[0], changes, repo, branch: flags['--branch'] ?? 'main', dryRun: flags['--dry-run'] === true, yes: flags['--yes'] === true, pageCommand: options?.pageCommand },
    deps.makeIo(repo),
  );
}
